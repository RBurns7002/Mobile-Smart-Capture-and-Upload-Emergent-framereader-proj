# FrameReader Android Companion

A companion Android app and automation profiles for seamless screen capture integration with the FrameReader web app.

**Optimized for Samsung Galaxy S25** - Supports 120Hz display, One UI 7, and efficient screen capture.

## 🚀 Quick Install (Samsung Galaxy S25)

### Option A: Download Pre-built APK (Easiest)
1. Go to [Releases](https://github.com/YOUR_REPO/releases)
2. Download `framereader-debug.apk`
3. On your S25: Settings → Security → Install unknown apps → Allow
4. Open the APK file to install

### Option B: Build Locally
```bash
# Clone the repo
git clone https://github.com/YOUR_REPO.git
cd android-companion

# Build (requires JDK 17)
./build-apk.sh

# Or install directly via ADB
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

---

## 📱 Using the App

### First Time Setup
1. Open **FrameReader** app on your S25
2. On desktop: Go to framereader.preview.emergentagent.com
3. Click **"MOBILE CAPTURE"** button
4. Enter the 6-digit code shown on desktop into the app
5. Tap **CONNECT**

### Capturing Content (ChatGPT, WhatsApp, etc.)
1. **Connect** to a session (see above)
2. Open the app you want to capture (e.g., ChatGPT)
3. Return to FrameReader app
4. Tap **START CAPTURE**
5. Grant screen recording permission when prompted
6. Switch back to the target app
7. The app will automatically:
   - Take screenshots at intervals
   - Scroll down between captures
   - Upload directly to the web app
8. Check desktop for processed transcripts!

---

## ⚙️ Settings Explained

| Setting | Default | Description |
|---------|---------|-------------|
| Scroll Distance | 80% | How far to scroll between captures (S25: ~1872px) |
| Interval | 1.5s | Time between screenshots |
| Total Captures | 10 | Number of screenshots to take |

### Samsung S25 Recommended Settings
- **Long conversations**: Scroll 85%, Interval 1.0s, Captures 20+
- **Quick capture**: Scroll 90%, Interval 0.8s, Captures 5

---

## 🔐 Permissions Required

| Permission | Why |
|------------|-----|
| Screen Recording | Capture screen content |
| Overlay | Show capture controls |
| Accessibility | Auto-scroll in any app |
| Internet | Upload to web app |

### Enable Accessibility Service
1. Settings → Accessibility → Installed apps
2. Find **FrameReader**
3. Turn ON

---

## 🛠️ Alternative Methods

### Tasker Automation (No app required)
1. Install [Tasker](https://play.google.com/store/apps/details?id=net.dinglisch.android.taskerm)
2. Import `automation/framereader_tasker.xml`
3. Edit task to set your session code

### ADB Script (Computer required)
```bash
# Download session-specific script from mobile capture page
# Or run manually:
adb shell input swipe 540 2000 540 500 300  # Scroll
adb exec-out screencap -p > screenshot.png   # Capture
```

---

## 📊 Data Efficiency

The Android app is **much more efficient** than screen recording:

| Method | Data per 10 captures |
|--------|---------------------|
| Manual video recording | ~50-100 MB |
| Android app (JPEG 70%) | ~2-5 MB |
| Savings | **95%+** |

---

## 🐛 Troubleshooting

### "Screen capture permission denied"
- Go to Settings → Apps → FrameReader → Permissions
- Enable all permissions
- Try again

### "Auto-scroll not working"
- Enable Accessibility Service (see above)
- Some apps block accessibility scrolling

### "Upload failed"
- Check internet connection
- Verify session code hasn't expired
- Create new session on desktop

---

## 🏗️ Building from Source

### Requirements
- Android Studio Arctic Fox+
- JDK 17
- Android SDK 34

### Build Commands
```bash
# Debug build
./gradlew assembleDebug

# Release build
./gradlew assembleRelease

# Clean build
./gradlew clean assembleDebug
```

### GitHub Actions
The repo includes automatic APK building via GitHub Actions. Every push to `main` creates a new release with downloadable APKs.

---

## 📄 License

MIT License - See LICENSE file
