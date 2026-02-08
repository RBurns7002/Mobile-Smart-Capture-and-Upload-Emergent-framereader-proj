#!/bin/bash
# FrameReader Android APK Build Script
# Run this on your computer to build the APK locally

set -e

echo "======================================"
echo "FrameReader Android APK Builder"
echo "======================================"

# Check for Java
if ! command -v java &> /dev/null; then
    echo "❌ Java not found. Please install JDK 17+"
    echo "   Ubuntu: sudo apt install openjdk-17-jdk"
    echo "   Mac: brew install openjdk@17"
    exit 1
fi

JAVA_VERSION=$(java -version 2>&1 | head -1 | cut -d'"' -f2 | cut -d'.' -f1)
echo "✓ Java version: $JAVA_VERSION"

# Navigate to android-companion directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo ""
echo "📦 Building Debug APK..."
echo ""

# Make gradlew executable
chmod +x gradlew

# Build
./gradlew assembleDebug --no-daemon

APK_PATH="app/build/outputs/apk/debug/app-debug.apk"

if [ -f "$APK_PATH" ]; then
    echo ""
    echo "======================================"
    echo "✅ BUILD SUCCESSFUL!"
    echo "======================================"
    echo ""
    echo "APK Location: $SCRIPT_DIR/$APK_PATH"
    echo "APK Size: $(du -h "$APK_PATH" | cut -f1)"
    echo ""
    echo "To install on connected device:"
    echo "  adb install -r $APK_PATH"
    echo ""
    echo "Or copy to phone and install manually."
    echo ""
    
    # Check if device is connected
    if command -v adb &> /dev/null; then
        DEVICE=$(adb devices | grep -v "List" | grep "device" | head -1)
        if [ -n "$DEVICE" ]; then
            echo "📱 Device detected: $DEVICE"
            read -p "Install now? (y/n) " -n 1 -r
            echo
            if [[ $REPLY =~ ^[Yy]$ ]]; then
                adb install -r "$APK_PATH"
                echo "✅ Installed! Look for 'FrameReader' app on your phone."
            fi
        fi
    fi
else
    echo "❌ Build failed - APK not found"
    exit 1
fi
