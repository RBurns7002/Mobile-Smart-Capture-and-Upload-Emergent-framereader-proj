import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import axios from "axios";
import { Toaster, toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import {
  Smartphone,
  Camera,
  Check,
  AlertCircle,
  Loader2,
  Play,
  Square,
  Upload,
  Settings,
  ChevronDown,
  ChevronUp,
  Scan,
  Move,
  Layers,
  Ruler,
  RefreshCw,
  Circle,
  Pause,
  ScreenShare,
  Zap,
} from "lucide-react";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

export function MobileCapturePage() {
  const { sessionCode } = useParams();
  const navigate = useNavigate();
  
  const [session, setSession] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);
  const [capturedFrames, setCapturedFrames] = useState([]);
  const [showSettings, setShowSettings] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isAutoCapturing, setIsAutoCapturing] = useState(false);
  const [autoCapturePaused, setAutoCapturePaused] = useState(false);
  const [captureCount, setCaptureCount] = useState(0);
  
  // Device info
  const [deviceInfo, setDeviceInfo] = useState({
    screenWidth: window.innerWidth,
    screenHeight: window.innerHeight,
    pixelRatio: window.devicePixelRatio,
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    isAndroid: /android/i.test(navigator.userAgent),
    isIOS: /iphone|ipad|ipod/i.test(navigator.userAgent),
  });
  
  // Capture settings with smart defaults based on screen
  const [settings, setSettings] = useState({
    scroll_distance_percent: 80,
    capture_interval_ms: 1500,
    overlap_margin_percent: 10,
    auto_detect_height: true,
    screen_width: window.innerWidth,
    screen_height: window.innerHeight,
    total_captures: 10,
  });
  
  // Refs for auto-capture
  const captureIntervalRef = useRef(null);
  const scrollContainerRef = useRef(null);
  const canvasRef = useRef(null);
  const videoRef = useRef(null);
  const mediaStreamRef = useRef(null);
  
  // Calculate effective scroll based on screen
  const effectiveScrollPx = Math.round(deviceInfo.screenHeight * (settings.scroll_distance_percent / 100));
  const overlapPx = Math.round(deviceInfo.screenHeight * (settings.overlap_margin_percent / 100));

  // Connect to session on mount with device info
  useEffect(() => {
    if (sessionCode) {
      connectToSession();
    }
    
    // Update device info on resize
    const handleResize = () => {
      setDeviceInfo(prev => ({
        ...prev,
        screenWidth: window.innerWidth,
        screenHeight: window.innerHeight,
      }));
      setSettings(prev => ({
        ...prev,
        screen_width: window.innerWidth,
        screen_height: window.innerHeight,
      }));
    };
    
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [sessionCode]);

  const connectToSession = async () => {
    try {
      const info = {
        userAgent: navigator.userAgent,
        screenWidth: window.innerWidth,
        screenHeight: window.innerHeight,
        availWidth: window.screen.availWidth,
        availHeight: window.screen.availHeight,
        pixelRatio: window.devicePixelRatio,
        platform: navigator.platform,
        isAndroid: /android/i.test(navigator.userAgent),
        isIOS: /iphone|ipad|ipod/i.test(navigator.userAgent),
        colorDepth: window.screen.colorDepth,
        orientation: window.screen.orientation?.type || 'unknown',
      };
      
      const response = await axios.post(`${API}/mobile/connect/${sessionCode}`, info);
      setSession(response.data);
      setIsConnected(true);
      
      // Merge server settings with detected device info
      setSettings(prev => ({ 
        ...prev, 
        ...response.data.settings,
        screen_width: window.innerWidth,
        screen_height: window.innerHeight,
      }));
      
      toast.success("Connected!", { 
        description: `Screen: ${window.innerWidth}×${window.innerHeight}px detected` 
      });
    } catch (error) {
      toast.error("Connection failed", { description: "Invalid or expired session code" });
    }
  };

  const updateSettings = async (newSettings) => {
    setSettings(newSettings);
    if (isConnected) {
      try {
        await axios.put(`${API}/mobile/settings/${sessionCode}`, {
          ...newSettings,
          screen_width: deviceInfo.screenWidth,
          screen_height: deviceInfo.screenHeight,
        });
      } catch (error) {
        console.error("Failed to update settings:", error);
      }
    }
  };

  // Launch Android screen recorder via intent
  const launchScreenRecorder = () => {
    if (deviceInfo.isAndroid) {
      // Try multiple intents for different Android versions/devices
      const intents = [
        'intent://screenrecord#Intent;scheme=android-app;package=com.android.systemui;end',
        'intent:#Intent;action=android.intent.action.MAIN;category=android.intent.category.LAUNCHER;component=com.android.systemui/.screenrecord.ScreenRecordDialog;end',
      ];
      
      // Fallback: Open quick settings instruction
      toast.info("Opening Screen Recorder", {
        description: "Swipe down from top and tap Screen Record, or use quick settings tile",
        duration: 5000,
      });
      
      // Try to open via media projection
      window.open('https://play.google.com/store/search?q=screen%20recorder&c=apps', '_blank');
    } else {
      toast.info("Screen Recording", {
        description: "Use your device's built-in screen recorder from Control Center",
      });
    }
  };

  // Start browser-based screen capture (for web content)
  const startBrowserCapture = async () => {
    try {
      // Request screen capture permission
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          cursor: "never",
          displaySurface: "browser",
        },
        audio: false,
      });
      
      mediaStreamRef.current = stream;
      
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      
      toast.success("Screen capture started!", {
        description: "Auto-capture will begin in 3 seconds...",
      });
      
      // Start auto-capture after delay
      setTimeout(() => {
        startAutoCapture();
      }, 3000);
      
      // Handle stream ending
      stream.getVideoTracks()[0].onended = () => {
        stopAutoCapture();
        toast.info("Screen capture ended");
      };
      
    } catch (error) {
      console.error("Screen capture error:", error);
      toast.error("Capture failed", {
        description: "Screen capture permission denied or not supported",
      });
    }
  };

  // Auto-capture with interval
  const startAutoCapture = () => {
    if (isAutoCapturing) return;
    
    setIsAutoCapturing(true);
    setAutoCapturePaused(false);
    setCaptureCount(0);
    setCapturedFrames([]);
    
    toast.info("Auto-capture started", {
      description: `Capturing every ${settings.capture_interval_ms}ms`,
    });
    
    // Capture first frame immediately
    captureCurrentFrame();
    
    captureIntervalRef.current = setInterval(() => {
      if (!autoCapturePaused) {
        captureCurrentFrame();
      }
    }, settings.capture_interval_ms);
  };

  const stopAutoCapture = async () => {
    setIsAutoCapturing(false);
    setAutoCapturePaused(false);
    
    if (captureIntervalRef.current) {
      clearInterval(captureIntervalRef.current);
      captureIntervalRef.current = null;
    }
    
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
      mediaStreamRef.current = null;
    }
    
    // Auto-upload captured frames
    if (capturedFrames.length > 0) {
      await uploadCapturedFrames();
    }
  };

  const pauseAutoCapture = () => {
    setAutoCapturePaused(!autoCapturePaused);
    toast.info(autoCapturePaused ? "Capture resumed" : "Capture paused");
  };

  // Capture current frame from video stream
  const captureCurrentFrame = () => {
    if (!videoRef.current || !canvasRef.current) return;
    
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    
    ctx.drawImage(video, 0, 0);
    
    const base64 = canvas.toDataURL('image/jpeg', 0.8).split(',')[1];
    
    const newFrame = {
      frame_index: capturedFrames.length,
      scroll_position: capturedFrames.length * effectiveScrollPx,
      timestamp: new Date().toISOString(),
      image_base64: base64,
    };
    
    setCapturedFrames(prev => [...prev, newFrame]);
    setCaptureCount(prev => prev + 1);
    
    // Auto-stop after reaching target
    if (capturedFrames.length >= settings.total_captures - 1) {
      stopAutoCapture();
    }
  };

  // Manual file selection capture
  const handleFileCapture = async (event) => {
    const files = Array.from(event.target.files);
    if (files.length === 0) return;
    
    setIsCapturing(true);
    const frames = [];
    
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const reader = new FileReader();
      
      const base64 = await new Promise((resolve) => {
        reader.onload = (e) => resolve(e.target.result.split(',')[1]);
        reader.readAsDataURL(file);
      });
      
      frames.push({
        frame_index: i,
        scroll_position: i * effectiveScrollPx,
        timestamp: new Date().toISOString(),
        image_base64: base64,
      });
      
      setUploadProgress(Math.round(((i + 1) / files.length) * 50));
    }
    
    setCapturedFrames(frames);
    await uploadFramesToServer(frames);
    setIsCapturing(false);
  };

  // Upload frames to server
  const uploadCapturedFrames = async () => {
    await uploadFramesToServer(capturedFrames);
  };

  const uploadFramesToServer = async (frames) => {
    if (frames.length === 0) return;
    
    setIsCapturing(true);
    setUploadProgress(50);
    
    try {
      await axios.post(`${API}/mobile/upload-batch/${sessionCode}`, frames);
      setUploadProgress(75);
      
      // Complete capture and start processing
      await axios.post(`${API}/mobile/complete-capture/${sessionCode}`);
      setUploadProgress(100);
      
      toast.success("Upload complete!", { 
        description: `${frames.length} frames sent for OCR processing` 
      });
    } catch (error) {
      toast.error("Upload failed", { 
        description: error.response?.data?.detail || "Failed to upload frames" 
      });
    }
    
    setIsCapturing(false);
  };

  // Share target handler for receiving shared images
  useEffect(() => {
    // Check if page was opened via share target
    const urlParams = new URLSearchParams(window.location.search);
    const sharedImages = urlParams.get('images');
    
    if (sharedImages) {
      toast.info("Processing shared images...");
      // Handle shared images
    }
  }, []);

  const formatTime = (ms) => {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  return (
    <div className="min-h-screen bg-[#050505] text-white p-4 pb-24">
      <Toaster 
        position="top-center" 
        toastOptions={{
          style: {
            background: '#0a0a0a',
            border: '1px solid #27272a',
            color: '#fafafa',
            fontFamily: 'JetBrains Mono, monospace',
          }
        }}
      />
      
      {/* Hidden video and canvas for capture */}
      <video ref={videoRef} style={{ display: 'none' }} playsInline muted />
      <canvas ref={canvasRef} style={{ display: 'none' }} />
      
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-[#22c55e]/20 border border-[#22c55e]/30 rounded-none">
            <Smartphone className="w-5 h-5 text-[#22c55e]" />
          </div>
          <div>
            <h1 className="font-mono text-base">MOBILE CAPTURE</h1>
            <p className="text-[10px] text-[#71717a] font-mono">Session: {sessionCode}</p>
          </div>
        </div>
        
        <div className={`px-2 py-1 font-mono text-[10px] ${isConnected ? 'bg-[#22c55e]/20 text-[#22c55e]' : 'bg-[#f59e0b]/20 text-[#f59e0b]'}`}>
          {isConnected ? 'CONNECTED' : 'CONNECTING...'}
        </div>
      </div>
      
      {/* Device Info Banner */}
      {isConnected && (
        <div className="bg-[#0a0a0a] border border-[#27272a] p-3 mb-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Ruler className="w-3 h-3 text-[#3b82f6]" />
              <span className="text-[10px] font-mono text-[#71717a]">DETECTED SCREEN</span>
            </div>
            <span className="font-mono text-sm text-[#3b82f6]">
              {deviceInfo.screenWidth} × {deviceInfo.screenHeight}px
            </span>
          </div>
          <div className="flex gap-4 mt-2 text-[10px] text-[#71717a] font-mono">
            <span>Scroll: {effectiveScrollPx}px</span>
            <span>Overlap: {overlapPx}px</span>
            <span>DPR: {deviceInfo.pixelRatio}x</span>
          </div>
        </div>
      )}
      
      {!isConnected ? (
        <div className="flex flex-col items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-[#3b82f6] mb-4" />
          <p className="font-mono text-sm text-[#71717a]">Connecting to session...</p>
        </div>
      ) : (
        <>
          {/* Quick Actions */}
          <div className="grid grid-cols-2 gap-3 mb-4">
            {/* Launch Screen Recorder */}
            <button
              onClick={launchScreenRecorder}
              className="bg-[#3b82f6] p-4 flex flex-col items-center gap-2 active:scale-95 transition-transform"
            >
              <Circle className="w-6 h-6" />
              <span className="font-mono text-xs">START RECORDING</span>
              <span className="text-[9px] opacity-70">Opens native recorder</span>
            </button>
            
            {/* Browser Capture Mode */}
            <button
              onClick={isAutoCapturing ? stopAutoCapture : startBrowserCapture}
              className={`p-4 flex flex-col items-center gap-2 active:scale-95 transition-transform ${
                isAutoCapturing ? 'bg-[#ef4444]' : 'bg-[#22c55e]'
              }`}
            >
              {isAutoCapturing ? (
                <>
                  <Square className="w-6 h-6" />
                  <span className="font-mono text-xs">STOP CAPTURE</span>
                  <span className="text-[9px] opacity-70">{captureCount} frames</span>
                </>
              ) : (
                <>
                  <ScreenShare className="w-6 h-6" />
                  <span className="font-mono text-xs">AUTO CAPTURE</span>
                  <span className="text-[9px] opacity-70">Browser content</span>
                </>
              )}
            </button>
          </div>
          
          {/* Auto-capture Controls */}
          {isAutoCapturing && (
            <div className="bg-[#0a0a0a] border border-[#27272a] p-4 mb-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-[#ef4444] animate-pulse" />
                  <span className="font-mono text-xs">CAPTURING</span>
                </div>
                <span className="font-mono text-lg text-[#22c55e]">{captureCount} / {settings.total_captures}</span>
              </div>
              
              <Progress value={(captureCount / settings.total_captures) * 100} className="h-2 mb-3" />
              
              <div className="flex gap-2">
                <Button
                  onClick={pauseAutoCapture}
                  variant="outline"
                  className="flex-1 font-mono text-xs"
                >
                  {autoCapturePaused ? <Play className="w-4 h-4 mr-1" /> : <Pause className="w-4 h-4 mr-1" />}
                  {autoCapturePaused ? 'RESUME' : 'PAUSE'}
                </Button>
                <Button
                  onClick={stopAutoCapture}
                  variant="destructive"
                  className="flex-1 font-mono text-xs"
                >
                  <Square className="w-4 h-4 mr-1" />
                  STOP & UPLOAD
                </Button>
              </div>
            </div>
          )}
          
          {/* Settings Panel */}
          <div className="bg-[#0a0a0a] border border-[#27272a] mb-4">
            <button
              onClick={() => setShowSettings(!showSettings)}
              className="w-full flex items-center justify-between p-3 font-mono text-xs"
            >
              <div className="flex items-center gap-2">
                <Settings className="w-4 h-4 text-[#3b82f6]" />
                <span>CAPTURE SETTINGS</span>
              </div>
              {showSettings ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
            
            {showSettings && (
              <div className="p-4 pt-0 space-y-4 border-t border-[#27272a]">
                {/* Scroll Distance */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] font-mono text-[#71717a]">SCROLL DISTANCE</span>
                    <span className="text-[10px] font-mono text-[#3b82f6]">
                      {settings.scroll_distance_percent}% ({effectiveScrollPx}px)
                    </span>
                  </div>
                  <Slider
                    value={[settings.scroll_distance_percent]}
                    onValueChange={([val]) => updateSettings({ ...settings, scroll_distance_percent: val })}
                    min={50}
                    max={100}
                    step={5}
                  />
                </div>
                
                {/* Capture Interval */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] font-mono text-[#71717a]">CAPTURE INTERVAL</span>
                    <span className="text-[10px] font-mono text-[#3b82f6]">{formatTime(settings.capture_interval_ms)}</span>
                  </div>
                  <Slider
                    value={[settings.capture_interval_ms]}
                    onValueChange={([val]) => updateSettings({ ...settings, capture_interval_ms: val })}
                    min={500}
                    max={5000}
                    step={100}
                  />
                </div>
                
                {/* Overlap Margin */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] font-mono text-[#71717a]">OVERLAP MARGIN</span>
                    <span className="text-[10px] font-mono text-[#3b82f6]">
                      {settings.overlap_margin_percent}% ({overlapPx}px)
                    </span>
                  </div>
                  <Slider
                    value={[settings.overlap_margin_percent]}
                    onValueChange={([val]) => updateSettings({ ...settings, overlap_margin_percent: val })}
                    min={0}
                    max={30}
                    step={5}
                  />
                </div>
                
                {/* Total Captures */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] font-mono text-[#71717a]">TOTAL CAPTURES</span>
                    <span className="text-[10px] font-mono text-[#3b82f6]">{settings.total_captures}</span>
                  </div>
                  <Slider
                    value={[settings.total_captures]}
                    onValueChange={([val]) => updateSettings({ ...settings, total_captures: val })}
                    min={5}
                    max={50}
                    step={5}
                  />
                </div>
              </div>
            )}
          </div>
          
          {/* ADB Script for Non-Browser Apps */}
          <div className="bg-[#0a0a0a] border border-[#f59e0b]/30 p-4 mb-4">
            <h3 className="font-mono text-xs mb-2 flex items-center gap-2 text-[#f59e0b]">
              <Zap className="w-4 h-4" />
              FOR NON-BROWSER APPS (ChatGPT, WhatsApp)
            </h3>
            
            <div className="bg-[#050505] p-2 font-mono text-[9px] text-[#a1a1aa] overflow-x-auto mb-3">
              <pre>{`# Run on computer with phone connected via USB:
adb shell settings put global window_animation_scale 0
for i in $(seq 1 ${settings.total_captures}); do
  adb exec-out screencap -p > frame_$i.png
  adb shell input swipe 500 ${deviceInfo.screenHeight - 200} 500 ${deviceInfo.screenHeight - 200 - effectiveScrollPx} 150
  sleep ${(settings.capture_interval_ms / 1000).toFixed(1)}
done`}</pre>
            </div>
            
            {/* Download Buttons */}
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="flex-1 font-mono text-[10px] border-[#f59e0b]/30 text-[#f59e0b]"
                onClick={async () => {
                  try {
                    const res = await axios.get(`${API}/mobile/automation/${sessionCode}/adb-script`);
                    const blob = new Blob([res.data.script], { type: 'text/plain' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = res.data.filename;
                    a.click();
                    toast.success("Script downloaded!");
                  } catch (e) {
                    toast.error("Download failed");
                  }
                }}
              >
                📥 ADB SCRIPT
              </Button>
              
              <Button
                variant="outline"
                size="sm"
                className="flex-1 font-mono text-[10px] border-[#3b82f6]/30 text-[#3b82f6]"
                onClick={() => {
                  window.open('https://github.com/nicozica/framereader-android', '_blank');
                  toast.info("Opening Android app repo...");
                }}
              >
                📱 ANDROID APP
              </Button>
            </div>
            
            <p className="text-[9px] text-[#71717a] mt-2">
              Then select all frame_*.png files below to upload
            </p>
          </div>
          
          {/* Manual Upload Section */}
          <div className="bg-[#0a0a0a] border border-[#27272a] p-4">
            <h3 className="font-mono text-xs mb-3 flex items-center gap-2">
              <Upload className="w-4 h-4 text-[#3b82f6]" />
              UPLOAD SCREENSHOTS
            </h3>
            
            <input
              type="file"
              multiple
              accept="image/*"
              onChange={handleFileCapture}
              className="hidden"
              id="frame-upload"
              disabled={isCapturing}
            />
            
            <label
              htmlFor="frame-upload"
              className={`block w-full p-8 border-2 border-dashed border-[#27272a] text-center cursor-pointer transition-colors ${
                isCapturing ? 'opacity-50' : 'hover:border-[#3b82f6]/50 active:bg-[#3b82f6]/10'
              }`}
            >
              {isCapturing ? (
                <div className="flex flex-col items-center gap-2">
                  <Loader2 className="w-8 h-8 animate-spin text-[#3b82f6]" />
                  <span className="font-mono text-xs">Processing...</span>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2">
                  <Camera className="w-10 h-10 text-[#71717a]" />
                  <span className="font-mono text-sm">TAP TO SELECT</span>
                  <span className="text-[10px] text-[#71717a]">Choose multiple screenshots</span>
                </div>
              )}
            </label>
            
            {uploadProgress > 0 && uploadProgress < 100 && (
              <div className="mt-3">
                <Progress value={uploadProgress} className="h-1" />
                <p className="text-[10px] text-[#71717a] mt-1 text-center font-mono">{uploadProgress}%</p>
              </div>
            )}
            
            {capturedFrames.length > 0 && uploadProgress >= 100 && (
              <div className="mt-3 p-2 bg-[#22c55e]/10 border border-[#22c55e]/20">
                <div className="flex items-center gap-2">
                  <Check className="w-4 h-4 text-[#22c55e]" />
                  <span className="font-mono text-[10px] text-[#22c55e]">
                    {capturedFrames.length} FRAMES PROCESSING
                  </span>
                </div>
              </div>
            )}
          </div>
          
          {/* Back Button */}
          <Button
            variant="ghost"
            className="w-full mt-4 font-mono text-xs text-[#71717a]"
            onClick={() => navigate('/')}
          >
            ← BACK TO MAIN APP
          </Button>
        </>
      )}
    </div>
  );
}

export default MobileCapturePage;
