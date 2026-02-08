# Installing FrameReader APK via F-Droid / Obtainium

## Recommended: Use Obtainium (Available on F-Droid)

**Obtainium** lets you install and auto-update apps directly from GitHub releases - no ADB needed!

### Step 1: Install Obtainium
1. Open **F-Droid** on your Samsung S25
2. Search for **"Obtainium"**
3. Install it (or get it from: https://f-droid.org/packages/dev.imranr.obtainium.fdroid/)

### Step 2: Add FrameReader to Obtainium
1. Open **Obtainium**
2. Tap the **+** button (Add App)
3. Enter the GitHub URL:
   ```
   https://github.com/YOUR_USERNAME/YOUR_REPO
   ```
4. Tap **Add**
5. Obtainium will find the latest release APK
6. Tap **Install**

### Step 3: Enable Auto-Updates (Optional)
1. In Obtainium, tap on FrameReader
2. Enable **"Track as installed"**
3. Obtainium will notify you of new releases!

---

## Alternative: Direct Download from GitHub

### On Your Phone:
1. Open Chrome/Samsung Internet
2. Go to: `https://github.com/YOUR_USERNAME/YOUR_REPO/releases`
3. Find the latest release
4. Tap on `framereader-debug.apk` to download
5. Open the downloaded file
6. If prompted, allow "Install unknown apps" for your browser
7. Tap **Install**

### First-Time Setup (Samsung S25):
1. Go to **Settings → Apps → ⋮ menu → Special access**
2. Tap **Install unknown apps**
3. Find your browser (Chrome/Samsung Internet)
4. Enable **"Allow from this source"**

---

## After Installation

1. Open **FrameReader** app
2. On your computer, go to: https://frame-extract-lab.preview.emergentagent.com
3. Click **"MOBILE CAPTURE"** button
4. Enter the 6-digit code into the app
5. Tap **CONNECT**
6. Open the app you want to capture (ChatGPT, etc.)
7. Return to FrameReader and tap **START CAPTURE**
8. Watch it auto-scroll and upload!

---

## Permissions to Grant

When first running, allow these permissions:
- **Screen Recording** - Required for capture
- **Display over other apps** - For overlay controls
- **Accessibility Service** - For auto-scroll (Settings → Accessibility → FrameReader)

---

## Troubleshooting

### "App not installed" error
- Enable **Install unknown apps** for your browser (see above)
- Or try downloading with a different browser

### Obtainium can't find releases
- Make sure the GitHub repo is public
- Check that the Actions workflow completed successfully
- Releases appear after the first successful build

### Need the direct APK link?
Once built, it will be at:
```
https://github.com/YOUR_USERNAME/YOUR_REPO/releases/latest/download/app-debug.apk
```
