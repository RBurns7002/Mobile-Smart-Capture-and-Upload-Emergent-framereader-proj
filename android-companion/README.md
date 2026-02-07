# FrameReader Android Companion

A companion Android app and automation profiles for seamless screen capture integration with the FrameReader web app.

## Quick Start Options

### Option 1: Tasker Automation (Recommended - No coding required)
1. Install [Tasker](https://play.google.com/store/apps/details?id=net.dinglisch.android.taskerm) ($3.49)
2. Import the profile: `automation/framereader_tasker.xml`
3. Open FrameReader web app → Mobile Capture → Get session code
4. Run the Tasker task with your session code

### Option 2: MacroDroid Automation (Free alternative)
1. Install [MacroDroid](https://play.google.com/store/apps/details?id=com.arlosoft.macrodroid)
2. Import the macro: `automation/framereader_macrodroid.json`
3. Configure with your session code and API URL

### Option 3: Native Android App (Full features)
Build the companion app from source for the most seamless experience.

---

## Tasker Setup (Detailed)

### Prerequisites
- Tasker app installed
- AutoInput plugin (for scrolling): [AutoInput](https://play.google.com/store/apps/details?id=com.joaomgcd.autoinput)

### Import Profile
1. Open Tasker
2. Long-press on "Profiles" tab → Import
3. Select `framereader_tasker.xml`
4. Grant required permissions when prompted

### Configure Variables
Edit the task and set these variables:
- `%session_code` - Your 6-digit session code from desktop
- `%api_url` - https://framereader.preview.emergentagent.com/api
- `%scroll_px` - Scroll distance in pixels (shown on mobile page)
- `%interval_ms` - Time between captures in milliseconds
- `%total_captures` - Number of screenshots to take

### Run
1. Open the app you want to capture (ChatGPT, WhatsApp, etc.)
2. Run the "FrameReader Capture" task from Tasker
3. Watch as it auto-scrolls and captures!

---

## MacroDroid Setup

### Import Macro
1. Open MacroDroid
2. Tap ⋮ menu → Import/Export → Import Macro
3. Select `framereader_macrodroid.json`

### Configure
1. Edit the macro
2. Update the HTTP Request action with your session code
3. Adjust scroll and timing parameters

### Trigger
- Use the floating button trigger, or
- Add a home screen widget to start capture

---

## Native Android App

### Build Requirements
- Android Studio Arctic Fox or newer
- Android SDK 24+ (Android 7.0)
- Kotlin 1.8+

### Build Steps
```bash
cd android-companion
./gradlew assembleDebug
```

### Install
```bash
adb install app/build/outputs/apk/debug/app-debug.apk
```

### Features
- One-tap capture with session code input
- Auto-scroll with configurable speed
- Real-time upload to web app
- Background capture support
- Accessibility service for cross-app scrolling

---

## Permissions Required

| Permission | Purpose |
|------------|---------|
| SYSTEM_ALERT_WINDOW | Overlay for capture controls |
| WRITE_EXTERNAL_STORAGE | Save screenshots temporarily |
| INTERNET | Upload to web app |
| FOREGROUND_SERVICE | Background capture |
| ACCESSIBILITY_SERVICE | Auto-scroll in any app |

---

## API Integration

The automation tools call these endpoints:

```
POST /api/mobile/connect/{session_code}
  Body: { device_info }
  
POST /api/mobile/upload-frame/{session_code}
  Body: FormData with image file
  
POST /api/mobile/complete-capture/{session_code}
```

---

## Troubleshooting

### Tasker: "AutoInput not responding"
- Grant Accessibility permission to AutoInput
- Disable battery optimization for AutoInput

### MacroDroid: "HTTP request failed"
- Check internet connection
- Verify session code hasn't expired (create new session)

### App: "Screen capture permission denied"
- Grant screen recording permission in system settings
- Some devices require enabling in Developer Options

---

## Support

For issues or feature requests, contact support through the main web app.
