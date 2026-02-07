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
    """List all jobs."""
    jobs = await db.ocr_jobs.find({}, {"_id": 0}).sort("created_at", -1).to_list(100)
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
    status_checks = await db.status_checks.find({}, {"_id": 0}).to_list(1000)
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
