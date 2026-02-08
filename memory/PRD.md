# FRAME_READER - Video OCR Transcript Extractor

## Original Problem Statement
Create an app that takes a video that I record of my phone screen and is able to analyze frame by frame and pull out transcripts from a long scroll down video. OCR style, high accuracy, best OCR model. Should be a lightweight app.

## Architecture
- **Frontend**: React with Tailwind CSS, Shadcn/UI components
- **Backend**: FastAPI with Python
- **Database**: MongoDB for job tracking
- **OCR Engine**: OpenAI GPT-4o Vision via Emergent Integrations
- **Video Processing**: OpenCV for frame extraction

## User Personas
1. **Content Reviewer** - Needs to extract text from screen recording tutorials
2. **Researcher** - Extracting chat logs or social media content from video recordings
3. **Data Analyst** - Converting scrolling video content to searchable text

## Core Requirements (Static)
- [x] Video upload (MP4, MOV, AVI, MKV, WebM)
- [x] Configurable frame extraction intervals (0.5s - 3s)
- [x] High-accuracy OCR using GPT-4o vision
- [x] Timestamped transcript output
- [x] Export to TXT file
- [x] Copy to clipboard
- [x] Real-time progress tracking

## What's Been Implemented (Jan 2026)
- ✅ Full-stack app with dark "Cyber-Swiss" UI design
- ✅ Drag & drop video upload zone
- ✅ Frame interval selector (0.5s, 1.0s, 2.0s, 3.0s)
- ✅ **Frame Crop controls** - Adjust top/bottom/left/right margins (0-45%) with visual overlay preview
- ✅ **Benchmark Mode** with side-by-side transcript comparison
- ✅ **Mobile Capture Mode (SaaS Feature) - Full Integration**:
  - Auto-detects screen resolution on connect
  - Live pixel calculations for scroll/overlap
  - Two capture modes: Native Recorder + Browser Auto-Capture
  - **Android Companion App** (Kotlin) - Full source code
  - **Tasker Automation Profile** - Pre-configured XML
  - **MacroDroid Macro** - JSON export
  - **ADB Script Generator** - Session-specific, downloadable
  - Accessibility Service for cross-app auto-scroll
  - MediaProjection API for screen capture
  - Real-time upload with deduplication
- ✅ GPT-4o vision OCR integration via Emergent LLM Key
- ✅ Timestamped transcript display
- ✅ Export to TXT + Copy to clipboard

## Android Companion Files (/app/android-companion/)

### App Source Code
- `app/src/main/java/com/framereader/capture/`
  - `MainActivity.kt` - Main UI with session code input & settings
  - `CaptureService.kt` - Screen capture via MediaProjection API
  - `AutoScrollService.kt` - Accessibility service for cross-app scrolling
  - `FrameReaderApp.kt` - Application class with settings
- `app/src/main/res/layout/activity_main.xml` - Material Design UI
- `app/src/main/AndroidManifest.xml` - Permissions & services

### Automation Profiles
- `automation/framereader_tasker.xml` - Tasker profile
- `automation/framereader_macrodroid.json` - MacroDroid macro

### Build System
- `.github/workflows/build-apk.yml` - GitHub Actions auto-build
- `build-apk.sh` - Local build script
- `build.gradle` & `app/build.gradle` - Gradle config

### Samsung Galaxy S25 Optimizations
- 120Hz refresh rate detection
- One UI 7 compatibility
- Optimized JPEG compression (70%) for smaller uploads
- Reduced capture density (320dpi) for efficiency
- ~95% smaller data transfer vs video recording

## API Endpoints
- `POST /api/upload-video` - Upload video file
- `POST /api/process-video` - Start OCR processing job
- `GET /api/job/{job_id}` - Get job status and transcripts
- `DELETE /api/job/{job_id}` - Delete job
- `GET /api/jobs` - List all jobs

## Prioritized Backlog

### P0 (Critical)
- All implemented ✅

### P1 (High Priority)
- [ ] Smart frame detection (only extract when content changes)
- [ ] Batch processing multiple videos
- [ ] Search within extracted transcripts

### P2 (Medium Priority)
- [ ] Export to JSON/CSV formats
- [ ] Video thumbnail preview
- [ ] Duplicate text detection/merging
- [ ] User authentication

## Next Tasks
1. Add smart frame detection to reduce API calls on static content
2. Implement text deduplication for scrolling content
3. Add search functionality in transcripts
