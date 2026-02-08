from fastapi import FastAPI, APIRouter, UploadFile, File, HTTPException, BackgroundTasks
from fastapi.responses import JSONResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field, ConfigDict
from typing import List, Optional
import uuid
from datetime import datetime, timezone
import cv2
import base64
import io
from PIL import Image
import tempfile
import asyncio
from emergentintegrations.llm.chat import LlmChat, UserMessage, ImageContent
import difflib
import secrets
import json

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# Create the main app without a prefix
app = FastAPI()

# Create a router with the /api prefix
api_router = APIRouter(prefix="/api")

# Upload directory
UPLOAD_DIR = Path(tempfile.gettempdir()) / "video_ocr_uploads"
UPLOAD_DIR.mkdir(exist_ok=True)

# Define Models
class StatusCheck(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    client_name: str
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class StatusCheckCreate(BaseModel):
    client_name: str

class JobCreate(BaseModel):
    video_filename: str
    frame_interval: float = 1.0

class TranscriptEntry(BaseModel):
    timestamp: float
    text: str
    frame_index: int

class JobResponse(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str
    status: str
    progress: int
    total_frames: int
    transcripts: List[TranscriptEntry]
    error: Optional[str] = None
    created_at: str

# In-memory job storage for quick access
jobs_cache = {}

# Mobile capture sessions
mobile_sessions = {}

class MobileCaptureSession(BaseModel):
    model_config = ConfigDict(extra="ignore")
    session_id: str
    session_code: str  # 6-digit code for pairing
    status: str = "waiting"  # waiting, connected, capturing, completed
    settings: dict = {}
    frames: List[dict] = []
    created_at: str
    device_info: Optional[dict] = None

class MobileCaptureSettings(BaseModel):
    scroll_distance_percent: float = 80  # % of viewport to scroll
    capture_interval_ms: int = 1500  # ms between captures
    overlap_margin_percent: float = 10  # % overlap between captures
    auto_detect_height: bool = True
    screen_width: Optional[int] = None
    screen_height: Optional[int] = None
    estimated_content_height: Optional[int] = None
    total_captures_estimate: Optional[int] = None

async def extract_frames_from_video(video_path: str, interval: float, crop: dict = None) -> List[tuple]:
    """Extract frames from video at specified interval with optional cropping."""
    frames = []
    cap = cv2.VideoCapture(video_path)
    
    if not cap.isOpened():
        raise ValueError("Could not open video file")
    
    fps = cap.get(cv2.CAP_PROP_FPS)
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    duration = total_frames / fps if fps > 0 else 0
    
    frame_step = int(fps * interval) if fps > 0 else 1
    frame_step = max(1, frame_step)
    
    # Default crop values (percentages)
    crop_top = crop.get('top', 0) if crop else 0
    crop_bottom = crop.get('bottom', 0) if crop else 0
    crop_left = crop.get('left', 0) if crop else 0
    crop_right = crop.get('right', 0) if crop else 0
    
    frame_index = 0
    while True:
        cap.set(cv2.CAP_PROP_POS_FRAMES, frame_index)
        ret, frame = cap.read()
        
        if not ret:
            break
        
        timestamp = frame_index / fps if fps > 0 else frame_index
        
        # Apply cropping based on percentages
        h, w = frame.shape[:2]
        y1 = int(h * crop_top / 100)
        y2 = int(h * (100 - crop_bottom) / 100)
        x1 = int(w * crop_left / 100)
        x2 = int(w * (100 - crop_right) / 100)
        
        # Ensure valid crop region
        if y2 > y1 and x2 > x1:
            frame = frame[y1:y2, x1:x2]
        
        # Convert BGR to RGB
        frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        
        # Convert to PIL Image and then to base64
        pil_image = Image.fromarray(frame_rgb)
        
        # Resize if too large (max 1024px on longest side)
        max_size = 1024
        if max(pil_image.size) > max_size:
            ratio = max_size / max(pil_image.size)
            new_size = (int(pil_image.size[0] * ratio), int(pil_image.size[1] * ratio))
            pil_image = pil_image.resize(new_size, Image.LANCZOS)
        
        # Convert to base64
        buffer = io.BytesIO()
        pil_image.save(buffer, format="JPEG", quality=85)
        base64_image = base64.b64encode(buffer.getvalue()).decode('utf-8')
        
        frames.append((frame_index, timestamp, base64_image))
        frame_index += frame_step
        
        if frame_index >= total_frames:
            break
    
    cap.release()
    return frames

async def ocr_frame(base64_image: str, api_key: str) -> str:
    """Extract text from a single frame using GPT-4o vision."""
    try:
        chat = LlmChat(
            api_key=api_key,
            session_id=str(uuid.uuid4()),
            system_message="You are an OCR assistant. Extract ALL visible text from the image exactly as it appears. Include line breaks where appropriate. If there is no readable text, respond with '[No text detected]'. Do not add any commentary or explanation - only output the extracted text."
        ).with_model("openai", "gpt-4o")
        
        image_content = ImageContent(image_base64=base64_image)
        
        user_message = UserMessage(
            text="Extract all text from this image. Output only the text content, nothing else.",
            file_contents=[image_content]
        )
        
        response = await chat.send_message(user_message)
        return response.strip() if response else "[No text detected]"
    except Exception as e:
        logging.error(f"OCR error: {str(e)}")
        return f"[OCR Error: {str(e)}]"

async def process_video_job(job_id: str, video_path: str, interval: float, crop: dict = None):
    """Background task to process video and extract text."""
    api_key = os.environ.get('EMERGENT_LLM_KEY')
    if not api_key:
        await db.ocr_jobs.update_one(
            {"id": job_id},
            {"$set": {"status": "failed", "error": "EMERGENT_LLM_KEY not configured"}}
        )
        return
    
    try:
        # Extract frames
        await db.ocr_jobs.update_one(
            {"id": job_id},
            {"$set": {"status": "extracting_frames"}}
        )
        
        frames = await extract_frames_from_video(video_path, interval, crop)
        total_frames = len(frames)
        
        await db.ocr_jobs.update_one(
            {"id": job_id},
            {"$set": {"status": "processing", "total_frames": total_frames}}
        )
        
        transcripts = []
        
        for idx, (frame_index, timestamp, base64_image) in enumerate(frames):
            # OCR the frame
            text = await ocr_frame(base64_image, api_key)
            
            if text and text != "[No text detected]":
                transcripts.append({
                    "timestamp": round(timestamp, 2),
                    "text": text,
                    "frame_index": frame_index
                })
            
            # Update progress
            progress = int(((idx + 1) / total_frames) * 100)
            await db.ocr_jobs.update_one(
                {"id": job_id},
                {"$set": {"progress": progress, "transcripts": transcripts}}
            )
            
            # Small delay to avoid rate limiting
            await asyncio.sleep(0.1)
        
        # Mark as completed
        await db.ocr_jobs.update_one(
            {"id": job_id},
            {"$set": {"status": "completed", "progress": 100}}
        )
        
    except Exception as e:
        logging.error(f"Job {job_id} failed: {str(e)}")
        await db.ocr_jobs.update_one(
            {"id": job_id},
            {"$set": {"status": "failed", "error": str(e)}}
        )
    finally:
        # Cleanup video file
        try:
            os.remove(video_path)
        except:
            pass

# Routes
@api_router.get("/")
async def root():
    return {"message": "Video OCR API"}

@api_router.post("/upload-video")
async def upload_video(file: UploadFile = File(...)):
    """Upload a video file for processing."""
    if not file.filename:
        raise HTTPException(status_code=400, detail="No file provided")
    
    # Validate file type
    allowed_extensions = ['.mp4', '.mov', '.avi', '.mkv', '.webm', '.m4v']
    file_ext = Path(file.filename).suffix.lower()
    
    if file_ext not in allowed_extensions:
        raise HTTPException(
            status_code=400, 
            detail=f"Invalid file type. Allowed: {', '.join(allowed_extensions)}"
        )
    
    # Save file
    file_id = str(uuid.uuid4())
    file_path = UPLOAD_DIR / f"{file_id}{file_ext}"
    
    try:
        contents = await file.read()
        with open(file_path, 'wb') as f:
            f.write(contents)
        
        return {
            "file_id": file_id,
            "filename": file.filename,
            "path": str(file_path),
            "size": len(contents)
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save file: {str(e)}")

class BenchmarkResult(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str
    status: str
    progress: int
    uncropped_transcripts: List[dict]
    cropped_transcripts: List[dict]
    comparison: Optional[dict] = None
    error: Optional[str] = None
    created_at: str

def compare_texts(uncropped_texts: List[str], cropped_texts: List[str]) -> dict:
    """Compare uncropped vs cropped OCR results and generate metrics."""
    # Combine all texts
    uncropped_combined = "\n".join(uncropped_texts)
    cropped_combined = "\n".join(cropped_texts)
    
    # Calculate similarity ratio
    similarity = difflib.SequenceMatcher(None, cropped_combined, uncropped_combined).ratio()
    
    # Find unique words in each
    uncropped_words = set(uncropped_combined.lower().split())
    cropped_words = set(cropped_combined.lower().split())
    
    # Extra words in uncropped (potential artifacts)
    extra_in_uncropped = uncropped_words - cropped_words
    extra_in_cropped = cropped_words - uncropped_words
    common_words = uncropped_words & cropped_words
    
    # Character counts
    uncropped_chars = len(uncropped_combined)
    cropped_chars = len(cropped_combined)
    
    # Line-by-line diff
    uncropped_lines = uncropped_combined.split('\n')
    cropped_lines = cropped_combined.split('\n')
    
    differ = difflib.Differ()
    diff_lines = list(differ.compare(cropped_lines, uncropped_lines))
    
    # Count additions and removals
    additions = [line[2:] for line in diff_lines if line.startswith('+ ')]
    removals = [line[2:] for line in diff_lines if line.startswith('- ')]
    
    return {
        "similarity_percentage": round(similarity * 100, 2),
        "uncropped_char_count": uncropped_chars,
        "cropped_char_count": cropped_chars,
        "char_difference": uncropped_chars - cropped_chars,
        "uncropped_word_count": len(uncropped_words),
        "cropped_word_count": len(cropped_words),
        "common_words": len(common_words),
        "extra_words_in_uncropped": len(extra_in_uncropped),
        "extra_words_in_cropped": len(extra_in_cropped),
        "extra_artifacts": list(extra_in_uncropped)[:50],  # Limit to 50 for display
        "missing_in_uncropped": list(extra_in_cropped)[:50],
        "lines_only_in_uncropped": additions[:20],  # Lines present only in uncropped
        "lines_only_in_cropped": removals[:20],  # Lines present only in cropped
    }

async def process_benchmark_job(job_id: str, video_path: str, interval: float, crop: dict):
    """Background task to process video twice - uncropped and cropped - for comparison."""
    import time
    
    api_key = os.environ.get('EMERGENT_LLM_KEY')
    if not api_key:
        await db.benchmark_jobs.update_one(
            {"id": job_id},
            {"$set": {"status": "failed", "error": "EMERGENT_LLM_KEY not configured"}}
        )
        return
    
    try:
        # Update status
        await db.benchmark_jobs.update_one(
            {"id": job_id},
            {"$set": {"status": "extracting_frames"}}
        )
        
        # Extract frames for both versions in parallel
        import asyncio
        uncropped_task = asyncio.create_task(
            extract_frames_from_video(video_path, interval, None)
        )
        cropped_task = asyncio.create_task(
            extract_frames_from_video(video_path, interval, crop)
        )
        
        uncropped_frames, cropped_frames = await asyncio.gather(uncropped_task, cropped_task)
        
        total_frames = len(uncropped_frames) + len(cropped_frames)
        
        await db.benchmark_jobs.update_one(
            {"id": job_id},
            {"$set": {"status": "processing", "total_frames": total_frames}}
        )
        
        # Process both sets of frames with timing
        uncropped_transcripts = []
        cropped_transcripts = []
        processed = 0
        
        # Process uncropped frames with timing
        uncropped_start_time = time.time()
        for idx, (frame_index, timestamp, base64_image) in enumerate(uncropped_frames):
            text = await ocr_frame(base64_image, api_key)
            if text and text != "[No text detected]":
                uncropped_transcripts.append({
                    "timestamp": round(timestamp, 2),
                    "text": text,
                    "frame_index": frame_index
                })
            processed += 1
            progress = int((processed / total_frames) * 100)
            await db.benchmark_jobs.update_one(
                {"id": job_id},
                {"$set": {
                    "progress": progress, 
                    "uncropped_transcripts": uncropped_transcripts,
                    "uncropped_processing_time": round(time.time() - uncropped_start_time, 2)
                }}
            )
            await asyncio.sleep(0.1)
        uncropped_end_time = time.time()
        uncropped_total_time = round(uncropped_end_time - uncropped_start_time, 2)
        
        # Process cropped frames with timing
        cropped_start_time = time.time()
        for idx, (frame_index, timestamp, base64_image) in enumerate(cropped_frames):
            text = await ocr_frame(base64_image, api_key)
            if text and text != "[No text detected]":
                cropped_transcripts.append({
                    "timestamp": round(timestamp, 2),
                    "text": text,
                    "frame_index": frame_index
                })
            processed += 1
            progress = int((processed / total_frames) * 100)
            await db.benchmark_jobs.update_one(
                {"id": job_id},
                {"$set": {
                    "progress": progress, 
                    "cropped_transcripts": cropped_transcripts,
                    "cropped_processing_time": round(time.time() - cropped_start_time, 2)
                }}
            )
            await asyncio.sleep(0.1)
        cropped_end_time = time.time()
        cropped_total_time = round(cropped_end_time - cropped_start_time, 2)
        
        # Generate comparison metrics
        uncropped_texts = [t["text"] for t in uncropped_transcripts]
        cropped_texts = [t["text"] for t in cropped_transcripts]
        
        comparison = compare_texts(uncropped_texts, cropped_texts)
        
        # Add timing to comparison
        comparison["uncropped_processing_time"] = uncropped_total_time
        comparison["cropped_processing_time"] = cropped_total_time
        comparison["time_saved"] = round(uncropped_total_time - cropped_total_time, 2)
        comparison["uncropped_frames_processed"] = len(uncropped_frames)
        comparison["cropped_frames_processed"] = len(cropped_frames)
        
        # Mark as completed
        await db.benchmark_jobs.update_one(
            {"id": job_id},
            {"$set": {
                "status": "completed", 
                "progress": 100,
                "comparison": comparison,
                "uncropped_processing_time": uncropped_total_time,
                "cropped_processing_time": cropped_total_time
            }}
        )
        
    except Exception as e:
        logging.error(f"Benchmark job {job_id} failed: {str(e)}")
        await db.benchmark_jobs.update_one(
            {"id": job_id},
            {"$set": {"status": "failed", "error": str(e)}}
        )
    finally:
        # Don't delete video file - might be used for regular processing too
        pass

@api_router.post("/benchmark-video")
async def benchmark_video(
    background_tasks: BackgroundTasks,
    file_id: str,
    filename: str,
    frame_interval: float = 1.0,
    crop_top: float = 0,
    crop_bottom: float = 0,
    crop_left: float = 0,
    crop_right: float = 0
):
    """Start benchmark processing - runs OCR on both cropped and uncropped versions."""
    # Validate frame interval
    if frame_interval < 0.5 or frame_interval > 5.0:
        raise HTTPException(status_code=400, detail="Frame interval must be between 0.5 and 5.0 seconds")
    
    # Validate crop values - need at least some crop for meaningful benchmark
    if crop_top == 0 and crop_bottom == 0 and crop_left == 0 and crop_right == 0:
        raise HTTPException(status_code=400, detail="Please set crop values to compare against uncropped version")
    
    # Find the video file
    video_path = None
    for ext in ['.mp4', '.mov', '.avi', '.mkv', '.webm', '.m4v']:
        potential_path = UPLOAD_DIR / f"{file_id}{ext}"
        if potential_path.exists():
            video_path = str(potential_path)
            break
    
    if not video_path:
        raise HTTPException(status_code=404, detail="Video file not found")
    
    crop = {
        "top": crop_top,
        "bottom": crop_bottom,
        "left": crop_left,
        "right": crop_right
    }
    
    # Create benchmark job
    job_id = str(uuid.uuid4())
    job_doc = {
        "id": job_id,
        "file_id": file_id,
        "filename": filename,
        "frame_interval": frame_interval,
        "crop": crop,
        "status": "queued",
        "progress": 0,
        "total_frames": 0,
        "uncropped_transcripts": [],
        "cropped_transcripts": [],
        "comparison": None,
        "error": None,
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    
    await db.benchmark_jobs.insert_one(job_doc)
    
    # Start background processing
    background_tasks.add_task(process_benchmark_job, job_id, video_path, frame_interval, crop)
    
    return {"job_id": job_id, "status": "queued", "type": "benchmark"}

@api_router.get("/benchmark/{job_id}")
async def get_benchmark_status(job_id: str):
    """Get the status and results of a benchmark job."""
    job = await db.benchmark_jobs.find_one({"id": job_id}, {"_id": 0})
    
    if not job:
        raise HTTPException(status_code=404, detail="Benchmark job not found")
    
    return job

# ==================== MOBILE CAPTURE ENDPOINTS ====================

@api_router.post("/mobile/create-session")
async def create_mobile_session(settings: MobileCaptureSettings = None):
    """Create a new mobile capture session with a pairing code."""
    session_id = str(uuid.uuid4())
    session_code = ''.join([str(secrets.randbelow(10)) for _ in range(6)])
    
    session_doc = {
        "session_id": session_id,
        "session_code": session_code,
        "status": "waiting",
        "settings": settings.model_dump() if settings else MobileCaptureSettings().model_dump(),
        "frames": [],
        "created_at": datetime.now(timezone.utc).isoformat(),
        "device_info": None,
        "processed_transcripts": [],
        "processing_status": None
    }
    
    await db.mobile_sessions.insert_one(session_doc)
    mobile_sessions[session_code] = session_id
    
    return {
        "session_id": session_id,
        "session_code": session_code,
        "status": "waiting",
        "pairing_url": f"/mobile/capture/{session_code}"
    }

@api_router.get("/mobile/session/{session_id}")
async def get_mobile_session(session_id: str):
    """Get mobile session status and data."""
    session = await db.mobile_sessions.find_one({"session_id": session_id}, {"_id": 0})
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return session

@api_router.post("/mobile/connect/{session_code}")
async def connect_mobile_device(session_code: str, device_info: dict = None):
    """Connect a mobile device to a session using the pairing code."""
    session = await db.mobile_sessions.find_one({"session_code": session_code})
    if not session:
        raise HTTPException(status_code=404, detail="Invalid session code")
    
    # Extract device dimensions for smart scroll calculation
    screen_width = device_info.get('screenWidth', 0) if device_info else 0
    screen_height = device_info.get('screenHeight', 0) if device_info else 0
    pixel_ratio = device_info.get('pixelRatio', 1) if device_info else 1
    
    # Update settings with detected device info
    current_settings = session.get('settings', {})
    current_settings['screen_width'] = screen_width
    current_settings['screen_height'] = screen_height
    current_settings['pixel_ratio'] = pixel_ratio
    
    # Calculate smart defaults based on screen size
    if screen_height > 0:
        # Effective scroll = screen height * scroll_percent * (1 - overlap)
        scroll_percent = current_settings.get('scroll_distance_percent', 80) / 100
        overlap_percent = current_settings.get('overlap_margin_percent', 10) / 100
        effective_scroll = int(screen_height * scroll_percent * (1 - overlap_percent))
        current_settings['effective_scroll_px'] = effective_scroll
    
    await db.mobile_sessions.update_one(
        {"session_code": session_code},
        {"$set": {
            "status": "connected",
            "device_info": device_info or {},
            "settings": current_settings,
            "connected_at": datetime.now(timezone.utc).isoformat()
        }}
    )
    
    return {
        "session_id": session["session_id"],
        "status": "connected",
        "settings": current_settings,
        "device_detected": {
            "screen_width": screen_width,
            "screen_height": screen_height,
            "pixel_ratio": pixel_ratio,
        }
    }

@api_router.post("/mobile/upload-frame/{session_code}")
async def upload_mobile_frame(session_code: str, body: dict):
    """Upload a single frame from mobile device as JSON with base64 image."""
    session = await db.mobile_sessions.find_one({"session_code": session_code})
    if not session:
        raise HTTPException(status_code=404, detail="Invalid session code")
    
    image_base64 = body.get("image_base64", "")
    frame_data = {
        "frame_index": body.get("frame_index", 0),
        "scroll_position": body.get("scroll_position", 0),
        "timestamp": body.get("timestamp", datetime.now(timezone.utc).isoformat()),
        "image_base64": image_base64,
        "size": len(image_base64)
    }
    
    await db.mobile_sessions.update_one(
        {"session_code": session_code},
        {
            "$push": {"frames": frame_data},
            "$set": {"status": "capturing"}
        }
    )
    
    return {"status": "uploaded", "frame_index": frame_data["frame_index"]}

@api_router.post("/mobile/upload-batch/{session_code}")
async def upload_mobile_batch(session_code: str, frames: List[dict]):
    """Upload multiple frames at once from mobile device."""
    session = await db.mobile_sessions.find_one({"session_code": session_code})
    if not session:
        raise HTTPException(status_code=404, detail="Invalid session code")
    
    # Process each frame
    processed_frames = []
    for frame in frames:
        frame_data = {
            "frame_index": frame.get("frame_index", len(processed_frames)),
            "scroll_position": frame.get("scroll_position", 0),
            "timestamp": frame.get("timestamp", datetime.now(timezone.utc).isoformat()),
            "image_base64": frame.get("image_base64"),
            "size": len(frame.get("image_base64", ""))
        }
        processed_frames.append(frame_data)
    
    await db.mobile_sessions.update_one(
        {"session_code": session_code},
        {
            "$push": {"frames": {"$each": processed_frames}},
            "$set": {"status": "capturing"}
        }
    )
    
    return {"status": "uploaded", "frames_count": len(processed_frames)}

@api_router.post("/mobile/complete-capture/{session_code}")
async def complete_mobile_capture(session_code: str, background_tasks: BackgroundTasks):
    """Mark capture as complete and start OCR processing."""
    session = await db.mobile_sessions.find_one({"session_code": session_code})
    if not session:
        raise HTTPException(status_code=404, detail="Invalid session code")
    
    await db.mobile_sessions.update_one(
        {"session_code": session_code},
        {"$set": {"status": "processing", "processing_status": "queued"}}
    )
    
    # Start background OCR processing
    background_tasks.add_task(process_mobile_capture, session["session_id"])
    
    return {"status": "processing", "session_id": session["session_id"], "frames_count": len(session.get("frames", []))}

async def process_mobile_capture(session_id: str):
    """Process all frames from a mobile capture session."""
    api_key = os.environ.get('EMERGENT_LLM_KEY')
    if not api_key:
        await db.mobile_sessions.update_one(
            {"session_id": session_id},
            {"$set": {"status": "failed", "processing_status": "error", "error": "API key not configured"}}
        )
        return
    
    session = await db.mobile_sessions.find_one({"session_id": session_id})
    if not session:
        return
    
    frames = session.get("frames", [])
    if not frames:
        await db.mobile_sessions.update_one(
            {"session_id": session_id},
            {"$set": {"status": "completed", "processing_status": "no_frames"}}
        )
        return
    
    try:
        transcripts = []
        total = len(frames)
        
        for idx, frame in enumerate(frames):
            # OCR the frame
            text = await ocr_frame(frame.get("image_base64", ""), api_key)
            
            if text and text != "[No text detected]":
                transcripts.append({
                    "frame_index": frame.get("frame_index", idx),
                    "scroll_position": frame.get("scroll_position", 0),
                    "timestamp": frame.get("timestamp"),
                    "text": text
                })
            
            # Update progress
            progress = int(((idx + 1) / total) * 100)
            await db.mobile_sessions.update_one(
                {"session_id": session_id},
                {"$set": {
                    "processing_status": f"processing_{progress}",
                    "processed_transcripts": transcripts
                }}
            )
            
            await asyncio.sleep(0.1)
        
        # Deduplicate similar consecutive transcripts
        deduplicated = deduplicate_transcripts(transcripts)
        
        await db.mobile_sessions.update_one(
            {"session_id": session_id},
            {"$set": {
                "status": "completed",
                "processing_status": "done",
                "processed_transcripts": deduplicated,
                "raw_transcript_count": len(transcripts),
                "deduplicated_count": len(deduplicated)
            }}
        )
        
    except Exception as e:
        logging.error(f"Mobile capture processing failed: {str(e)}")
        await db.mobile_sessions.update_one(
            {"session_id": session_id},
            {"$set": {"status": "failed", "processing_status": "error", "error": str(e)}}
        )

def deduplicate_transcripts(transcripts: List[dict], similarity_threshold: float = 0.85) -> List[dict]:
    """Remove near-duplicate consecutive transcripts based on text similarity."""
    if not transcripts:
        return []
    
    deduplicated = [transcripts[0]]
    
    for current in transcripts[1:]:
        last = deduplicated[-1]
        similarity = difflib.SequenceMatcher(None, last["text"], current["text"]).ratio()
        
        if similarity < similarity_threshold:
            deduplicated.append(current)
        else:
            # Keep the longer one if very similar
            if len(current["text"]) > len(last["text"]):
                deduplicated[-1] = current
    
    return deduplicated

@api_router.put("/mobile/settings/{session_code}")
async def update_mobile_settings(session_code: str, settings: MobileCaptureSettings):
    """Update capture settings for a mobile session."""
    result = await db.mobile_sessions.update_one(
        {"session_code": session_code},
        {"$set": {"settings": settings.model_dump()}}
    )
    
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Session not found")
    
    return {"status": "updated", "settings": settings.model_dump()}

@api_router.get("/mobile/calculate-scroll")
async def calculate_scroll_settings(
    screen_height: int,
    content_height: int,
    overlap_percent: float = 10
):
    """Calculate optimal scroll settings based on screen and content dimensions."""
    effective_scroll = screen_height * (1 - overlap_percent / 100)
    total_scrolls = max(1, int((content_height - screen_height) / effective_scroll) + 1)
    total_captures = total_scrolls + 1  # Include initial capture
    
    return {
        "screen_height": screen_height,
        "content_height": content_height,
        "effective_scroll_distance": int(effective_scroll),
        "overlap_pixels": int(screen_height * overlap_percent / 100),
        "total_scrolls_needed": total_scrolls,
        "total_captures": total_captures,
        "scroll_positions": [int(i * effective_scroll) for i in range(total_captures)]
    }

@api_router.get("/mobile/automation/{session_code}/tasker")
async def get_tasker_profile(session_code: str):
    """Generate a Tasker profile pre-configured with session code."""
    session = await db.mobile_sessions.find_one({"session_code": session_code})
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    
    settings = session.get("settings", {})
    device_info = session.get("device_info", {})
    
    scroll_px = int(device_info.get("screenHeight", 800) * settings.get("scroll_distance_percent", 80) / 100)
    
    tasker_xml = f'''<?xml version="1.0" encoding="utf-8"?>
<TaskerData sr="" dession="com.joaomgcd.tasker" sv="4">
  <Task sr="task1">
    <cname>FrameReader_{session_code}</cname>
    <id>1</id>
    <Action sr="act0" ve="7">
      <code>547</code>
      <Str sr="arg0" ve="3">session_code</Str>
      <Str sr="arg1" ve="3">{session_code}</Str>
    </Action>
    <Action sr="act1" ve="7">
      <code>547</code>
      <Str sr="arg0" ve="3">api_url</Str>
      <Str sr="arg1" ve="3">https://frame-extract-lab.preview.emergentagent.com/api</Str>
    </Action>
    <Action sr="act2" ve="7">
      <code>547</code>
      <Str sr="arg0" ve="3">scroll_px</Str>
      <Str sr="arg1" ve="3">{scroll_px}</Str>
    </Action>
    <Action sr="act3" ve="7">
      <code>547</code>
      <Str sr="arg0" ve="3">interval_ms</Str>
      <Str sr="arg1" ve="3">{settings.get("capture_interval_ms", 1500)}</Str>
    </Action>
    <Action sr="act4" ve="7">
      <code>547</code>
      <Str sr="arg0" ve="3">total_captures</Str>
      <Str sr="arg1" ve="3">{settings.get("total_captures", 10)}</Str>
    </Action>
  </Task>
</TaskerData>'''
    
    return JSONResponse(
        content={"xml": tasker_xml, "filename": f"framereader_{session_code}.tsk.xml"},
        headers={"Content-Type": "application/json"}
    )

@api_router.get("/mobile/automation/{session_code}/adb-script")
async def get_adb_script(session_code: str):
    """Generate an ADB shell script pre-configured with session settings."""
    session = await db.mobile_sessions.find_one({"session_code": session_code})
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    
    settings = session.get("settings", {})
    device_info = session.get("device_info", {})
    
    screen_height = device_info.get("screenHeight", 2400)
    scroll_percent = settings.get("scroll_distance_percent", 80)
    scroll_px = int(screen_height * scroll_percent / 100)
    interval = settings.get("capture_interval_ms", 1500) / 1000
    total = settings.get("total_captures", 10)
    
    script = f'''#!/bin/bash
# FrameReader Auto-Capture Script
# Session: {session_code}
# Generated for screen height: {screen_height}px

API_URL="https://frame-extract-lab.preview.emergentagent.com/api"
SESSION="{session_code}"
SCROLL_PX={scroll_px}
INTERVAL={interval}
TOTAL={total}

# Create temp directory
mkdir -p /tmp/framereader_captures

# Connect to session
curl -X POST "$API_URL/mobile/connect/$SESSION" \\
  -H "Content-Type: application/json" \\
  -d '{{"userAgent":"ADB-Script","screenHeight":{screen_height},"screenWidth":{device_info.get("screenWidth", 1080)}}}'

echo "Starting capture in 3 seconds..."
sleep 3

# Disable animations for smoother capture
adb shell settings put global window_animation_scale 0
adb shell settings put global transition_animation_scale 0
adb shell settings put global animator_duration_scale 0

# Capture loop
for i in $(seq 1 $TOTAL); do
  echo "Capturing frame $i/$TOTAL..."
  
  # Take screenshot
  adb exec-out screencap -p > /tmp/framereader_captures/frame_$i.png
  
  # Convert to base64 and upload
  BASE64=$(base64 -w 0 /tmp/framereader_captures/frame_$i.png)
  
  curl -X POST "$API_URL/mobile/upload-batch/$SESSION" \\
    -H "Content-Type: application/json" \\
    -d "[{{\\"frame_index\\":$i,\\"scroll_position\\":$((i * SCROLL_PX)),\\"image_base64\\":\\"$BASE64\\"}}]"
  
  # Scroll down
  adb shell input swipe 540 $((screen_height - 200)) 540 $((screen_height - 200 - SCROLL_PX)) 300
  
  sleep $INTERVAL
done

# Complete capture
curl -X POST "$API_URL/mobile/complete-capture/$SESSION" \\
  -H "Content-Type: application/json" -d '{{}}'

# Re-enable animations
adb shell settings put global window_animation_scale 1
adb shell settings put global transition_animation_scale 1
adb shell settings put global animator_duration_scale 1

# Cleanup
rm -rf /tmp/framereader_captures

echo "Capture complete! Check web app for results."
'''
    
    return JSONResponse(
        content={"script": script, "filename": f"framereader_{session_code}.sh"},
        headers={"Content-Type": "application/json"}
    )

@api_router.get("/mobile/download-info")
async def get_download_info():
    """Get Android app download information."""
    return {
        "apk_url": "https://github.com/nicozica/framereader-android/releases/latest/download/framereader-debug.apk",
        "github_url": "https://github.com/nicozica/framereader-android",
        "version": "1.0.0",
        "min_android": "7.0 (API 24)",
        "optimized_for": ["Samsung Galaxy S25", "Samsung Galaxy S24", "Pixel 8", "OnePlus 12"],
        "features": [
            "One-tap screen capture",
            "Auto-scroll in any app",
            "Direct upload to web app",
            "70% smaller than video recording",
            "120Hz display support"
        ]
    }

class CropSettings(BaseModel):
    top: float = 0
    bottom: float = 0
    left: float = 0
    right: float = 0

@api_router.post("/process-video")
async def process_video(
    background_tasks: BackgroundTasks,
    file_id: str,
    filename: str,
    frame_interval: float = 1.0,
    crop_top: float = 0,
    crop_bottom: float = 0,
    crop_left: float = 0,
    crop_right: float = 0
):
    """Start processing a video for OCR."""
    # Validate frame interval
    if frame_interval < 0.5 or frame_interval > 5.0:
        raise HTTPException(status_code=400, detail="Frame interval must be between 0.5 and 5.0 seconds")
    
    # Validate crop values
    for val in [crop_top, crop_bottom, crop_left, crop_right]:
        if val < 0 or val > 45:
            raise HTTPException(status_code=400, detail="Crop values must be between 0 and 45%")
    
    # Find the video file
    video_path = None
    for ext in ['.mp4', '.mov', '.avi', '.mkv', '.webm', '.m4v']:
        potential_path = UPLOAD_DIR / f"{file_id}{ext}"
        if potential_path.exists():
            video_path = str(potential_path)
            break
    
    if not video_path:
        raise HTTPException(status_code=404, detail="Video file not found")
    
    # Crop settings
    crop = {
        "top": crop_top,
        "bottom": crop_bottom,
        "left": crop_left,
        "right": crop_right
    }
    
    # Create job
    job_id = str(uuid.uuid4())
    job_doc = {
        "id": job_id,
        "file_id": file_id,
        "filename": filename,
        "frame_interval": frame_interval,
        "crop": crop,
        "status": "queued",
        "progress": 0,
        "total_frames": 0,
        "transcripts": [],
        "error": None,
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    
    await db.ocr_jobs.insert_one(job_doc)
    
    # Start background processing
    background_tasks.add_task(process_video_job, job_id, video_path, frame_interval, crop)
    
    return {"job_id": job_id, "status": "queued"}

@api_router.get("/job/{job_id}")
async def get_job_status(job_id: str):
    """Get the status and results of a processing job."""
    job = await db.ocr_jobs.find_one({"id": job_id}, {"_id": 0})
    
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    
    return job

@api_router.delete("/job/{job_id}")
async def delete_job(job_id: str):
    """Delete a job and its results."""
    result = await db.ocr_jobs.delete_one({"id": job_id})
    
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Job not found")
    
    return {"message": "Job deleted"}

@api_router.get("/jobs")
async def list_jobs():
    """List all jobs (without full transcripts for performance)."""
    jobs = await db.ocr_jobs.find(
        {}, 
        {"_id": 0, "id": 1, "filename": 1, "status": 1, "progress": 1, "total_frames": 1, "created_at": 1, "error": 1}
    ).sort("created_at", -1).limit(100).to_list(100)
    return jobs

# Legacy routes for compatibility
@api_router.post("/status", response_model=StatusCheck)
async def create_status_check(input: StatusCheckCreate):
    status_dict = input.model_dump()
    status_obj = StatusCheck(**status_dict)
    doc = status_obj.model_dump()
    doc['timestamp'] = doc['timestamp'].isoformat()
    _ = await db.status_checks.insert_one(doc)
    return status_obj

@api_router.get("/status", response_model=List[StatusCheck])
async def get_status_checks():
    status_checks = await db.status_checks.find({}, {"_id": 0}).limit(100).to_list(100)
    for check in status_checks:
        if isinstance(check['timestamp'], str):
            check['timestamp'] = datetime.fromisoformat(check['timestamp'])
    return status_checks

# Include the router in the main app
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
