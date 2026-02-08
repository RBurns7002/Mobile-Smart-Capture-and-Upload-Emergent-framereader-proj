# FrameReader - Product Requirements Document

## Original Problem Statement
Build a lightweight app that analyzes screen recording videos of a phone. The app performs frame-by-frame analysis to pull out transcripts from long scroll-down videos using a high-accuracy OCR model.

## Core Features
1. **Video Upload & OCR Processing** — Upload video, extract frames with OpenCV, process via OpenAI GPT-4o Vision
2. **Frame Cropping** — Adjustable crop region for video before processing
3. **Benchmark Mode** — Compare OCR results on cropped vs. uncropped versions side-by-side with timing metrics
4. **Mobile Capture (SaaS)** — QR-code pairing for mobile device, screen resolution detection, dynamic scroll calc
5. **Android Companion App** — Native Kotlin app for automated screen capture + auto-scroll via Accessibility Service
6. **GitHub Actions CI/CD** — Automated APK build on push to main, with GitHub Releases

## Tech Stack
- **Backend**: FastAPI, MongoDB (motor), opencv-python-headless, python-multipart
- **Frontend**: React, react-router-dom, axios, TailwindCSS, shadcn/ui
- **OCR**: OpenAI GPT-4o Vision (via Emergent LLM Key)
- **Mobile App**: Native Android (Kotlin), OkHttp, Accessibility Service
- **CI/CD**: GitHub Actions

## Architecture
```
/app/
├── .github/workflows/build-apk.yml    # GitHub Actions for Android APK
├── android-companion/                  # Native Android app (Kotlin)
├── backend/server.py                   # FastAPI server
├── frontend/src/App.js                 # Main React component
├── frontend/src/MobileCapture.js       # Mobile capture page
└── memory/PRD.md                       # This file
```

## What's Been Implemented
- [x] Core video upload and OCR processing (Dec 2025)
- [x] Frame cropping feature (Dec 2025)
- [x] Benchmark mode with side-by-side comparison (Dec 2025)
- [x] Mobile capture SaaS with QR pairing (Dec 2025)
- [x] Android companion app scaffolding (Dec 2025)
- [x] GitHub Actions workflow for APK build (Dec 2025)
- [x] Fix: Moved workflow to correct directory (Dec 2025)
- [x] Fix: Added missing gradle-wrapper.jar (Dec 2025)
- [x] Fix: Self-healing wrapper JAR in CI, Gradle DSL conflict, .gitattributes (Dec 2025)

## Pending Verification
- [ ] GitHub Actions APK build — user must push and verify

## Upcoming Tasks (P0/P1)
- [ ] APK installation guidance (Obtainium/F-Droid)
- [ ] End-to-end mobile capture testing on Samsung Galaxy S25
- [ ] Replace mocked `/api/mobile/apk-url` with real GitHub Releases URL

## Future/Backlog (P2)
- [ ] Improve auto-scroll accuracy based on real-device feedback
- [ ] Device-specific optimizations for Samsung Galaxy S25
- [ ] Iterate on Android app UX based on testing

## Known Issues
- `/api/mobile/apk-url` endpoint returns a hardcoded placeholder URL (MOCKED)
- Android APK has never been successfully built or tested on-device

## 3rd Party Integrations
- OpenAI GPT-4o (Vision) — via Emergent LLM Key
