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
- ✅ Background job processing with progress tracking
- ✅ GPT-4o vision OCR integration via Emergent LLM Key
- ✅ Timestamped transcript display with terminal-style output
- ✅ Copy to clipboard functionality
- ✅ Export to TXT file download
- ✅ Responsive design

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
