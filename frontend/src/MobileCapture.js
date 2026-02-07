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
  
  // Capture settings
  const [settings, setSettings] = useState({
    scroll_distance_percent: 80,
    capture_interval_ms: 1500,
    overlap_margin_percent: 10,
    auto_detect_height: true,
    screen_width: window.innerWidth,
    screen_height: window.innerHeight,
  });
  
  // Scroll tracking
  const [scrollInfo, setScrollInfo] = useState({
    currentScroll: 0,
    estimatedHeight: 0,
    captureCount: 0,
  });

  // Connect to session on mount
  useEffect(() => {
    if (sessionCode) {
      connectToSession();
    }
  }, [sessionCode]);

  const connectToSession = async () => {
    try {
      const deviceInfo = {
        userAgent: navigator.userAgent,
        screenWidth: window.innerWidth,
        screenHeight: window.innerHeight,
        pixelRatio: window.devicePixelRatio,
        platform: navigator.platform,
      };
      
      const response = await axios.post(`${API}/mobile/connect/${sessionCode}`, deviceInfo);
      setSession(response.data);
      setIsConnected(true);
      setSettings(prev => ({ ...prev, ...response.data.settings }));
      toast.success("Connected!", { description: "Ready to capture" });
    } catch (error) {
      toast.error("Connection failed", { description: "Invalid or expired session code" });
    }
  };

  const updateSettings = async (newSettings) => {
    setSettings(newSettings);
    if (isConnected) {
      try {
        await axios.put(`${API}/mobile/settings/${sessionCode}`, newSettings);
      } catch (error) {
        console.error("Failed to update settings:", error);
      }
    }
  };

  const calculateScrollPlan = async () => {
    // Estimate content height (user can override)
    const estimatedHeight = settings.estimated_content_height || window.innerHeight * 5;
    
    try {
      const response = await axios.get(`${API}/mobile/calculate-scroll`, {
        params: {
          screen_height: settings.screen_height || window.innerHeight,
          content_height: estimatedHeight,
          overlap_percent: settings.overlap_margin_percent,
        }
      });
      
      setScrollInfo({
        ...response.data,
        estimatedHeight,
      });
      
      return response.data;
    } catch (error) {
      console.error("Failed to calculate scroll plan:", error);
      return null;
    }
  };

  const captureFrame = async (frameIndex, scrollPosition) => {
    // This would be triggered by user or automated script
    // In a real implementation, this would use screen capture API
    // For now, we'll show instructions for manual capture
    
    return {
      frame_index: frameIndex,
      scroll_position: scrollPosition,
      timestamp: new Date().toISOString(),
    };
  };

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
        scroll_position: i * (settings.screen_height * settings.scroll_distance_percent / 100),
        timestamp: new Date().toISOString(),
        image_base64: base64,
      });
      
      setUploadProgress(Math.round(((i + 1) / files.length) * 50));
    }
    
    setCapturedFrames(frames);
    
    // Upload batch
    try {
      await axios.post(`${API}/mobile/upload-batch/${sessionCode}`, frames);
      setUploadProgress(75);
      
      // Complete capture
      await axios.post(`${API}/mobile/complete-capture/${sessionCode}`);
      setUploadProgress(100);
      
      toast.success("Capture complete!", { description: `${frames.length} frames uploaded and processing` });
    } catch (error) {
      toast.error("Upload failed", { description: error.response?.data?.detail || "Failed to upload frames" });
    }
    
    setIsCapturing(false);
  };

  const formatTime = (ms) => {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  return (
    <div className="min-h-screen bg-[#050505] text-white p-4">
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
      
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-[#22c55e]/20 border border-[#22c55e]/30 rounded-none">
            <Smartphone className="w-5 h-5 text-[#22c55e]" />
          </div>
          <div>
            <h1 className="font-mono text-lg">MOBILE CAPTURE</h1>
            <p className="text-xs text-[#71717a] font-mono">Session: {sessionCode}</p>
          </div>
        </div>
        
        <div className={`px-3 py-1 font-mono text-xs ${isConnected ? 'bg-[#22c55e]/20 text-[#22c55e]' : 'bg-[#f59e0b]/20 text-[#f59e0b]'}`}>
          {isConnected ? 'CONNECTED' : 'CONNECTING...'}
        </div>
      </div>
      
      {/* Connection Status */}
      {!isConnected ? (
        <div className="flex flex-col items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-[#3b82f6] mb-4" />
          <p className="font-mono text-sm text-[#71717a]">Connecting to session...</p>
        </div>
      ) : (
        <>
          {/* Settings Panel */}
          <div className="bg-[#0a0a0a] border border-[#27272a] mb-4">
            <button
              onClick={() => setShowSettings(!showSettings)}
              className="w-full flex items-center justify-between p-4 font-mono text-sm"
            >
              <div className="flex items-center gap-2">
                <Settings className="w-4 h-4 text-[#3b82f6]" />
                <span>CAPTURE SETTINGS</span>
              </div>
              {showSettings ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
            
            {showSettings && (
              <div className="p-4 pt-0 space-y-5 border-t border-[#27272a]">
                {/* Scroll Distance */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Move className="w-3 h-3 text-[#71717a]" />
                      <span className="text-xs font-mono text-[#71717a]">SCROLL DISTANCE</span>
                    </div>
                    <span className="text-xs font-mono text-[#3b82f6]">{settings.scroll_distance_percent}%</span>
                  </div>
                  <Slider
                    value={[settings.scroll_distance_percent]}
                    onValueChange={([val]) => updateSettings({ ...settings, scroll_distance_percent: val })}
                    min={50}
                    max={100}
                    step={5}
                    className="w-full"
                  />
                  <p className="text-[10px] text-[#71717a] mt-1">% of screen height to scroll each capture</p>
                </div>
                
                {/* Capture Interval */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Camera className="w-3 h-3 text-[#71717a]" />
                      <span className="text-xs font-mono text-[#71717a]">CAPTURE INTERVAL</span>
                    </div>
                    <span className="text-xs font-mono text-[#3b82f6]">{formatTime(settings.capture_interval_ms)}</span>
                  </div>
                  <Slider
                    value={[settings.capture_interval_ms]}
                    onValueChange={([val]) => updateSettings({ ...settings, capture_interval_ms: val })}
                    min={500}
                    max={5000}
                    step={100}
                    className="w-full"
                  />
                  <p className="text-[10px] text-[#71717a] mt-1">Time between each screenshot</p>
                </div>
                
                {/* Overlap Margin */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Layers className="w-3 h-3 text-[#71717a]" />
                      <span className="text-xs font-mono text-[#71717a]">OVERLAP MARGIN</span>
                    </div>
                    <span className="text-xs font-mono text-[#3b82f6]">{settings.overlap_margin_percent}%</span>
                  </div>
                  <Slider
                    value={[settings.overlap_margin_percent]}
                    onValueChange={([val]) => updateSettings({ ...settings, overlap_margin_percent: val })}
                    min={0}
                    max={30}
                    step={5}
                    className="w-full"
                  />
                  <p className="text-[10px] text-[#71717a] mt-1">% overlap to avoid missing content</p>
                </div>
                
                {/* Auto-detect Height */}
                <div className="flex items-center justify-between py-2">
                  <div className="flex items-center gap-2">
                    <Ruler className="w-3 h-3 text-[#71717a]" />
                    <span className="text-xs font-mono text-[#71717a]">AUTO-DETECT HEIGHT</span>
                  </div>
                  <Switch
                    checked={settings.auto_detect_height}
                    onCheckedChange={(val) => updateSettings({ ...settings, auto_detect_height: val })}
                  />
                </div>
                
                {/* Screen Info */}
                <div className="p-3 bg-[#050505] border border-[#27272a]">
                  <div className="text-[10px] text-[#71717a] font-mono mb-2">DETECTED SCREEN</div>
                  <div className="font-mono text-sm">
                    {settings.screen_width} × {settings.screen_height} px
                  </div>
                </div>
              </div>
            )}
          </div>
          
          {/* Capture Instructions */}
          <div className="bg-[#0a0a0a] border border-[#27272a] p-4 mb-4">
            <h3 className="font-mono text-sm mb-3 flex items-center gap-2">
              <Scan className="w-4 h-4 text-[#22c55e]" />
              CAPTURE INSTRUCTIONS
            </h3>
            
            <div className="space-y-3 text-xs text-[#a1a1aa]">
              <div className="flex gap-3">
                <span className="w-5 h-5 flex items-center justify-center bg-[#3b82f6]/20 text-[#3b82f6] font-mono text-[10px]">1</span>
                <p>Open the app/content you want to capture (e.g., ChatGPT, messages)</p>
              </div>
              <div className="flex gap-3">
                <span className="w-5 h-5 flex items-center justify-center bg-[#3b82f6]/20 text-[#3b82f6] font-mono text-[10px]">2</span>
                <p>Use Android's built-in screen recorder or screenshot tool</p>
              </div>
              <div className="flex gap-3">
                <span className="w-5 h-5 flex items-center justify-center bg-[#3b82f6]/20 text-[#3b82f6] font-mono text-[10px]">3</span>
                <p>Scroll down by ~{settings.scroll_distance_percent}% ({Math.round(settings.screen_height * settings.scroll_distance_percent / 100)}px) between each capture</p>
              </div>
              <div className="flex gap-3">
                <span className="w-5 h-5 flex items-center justify-center bg-[#3b82f6]/20 text-[#3b82f6] font-mono text-[10px]">4</span>
                <p>Upload all screenshots below when done</p>
              </div>
            </div>
          </div>
          
          {/* ADB Automation Guide */}
          <div className="bg-[#0a0a0a] border border-[#27272a] p-4 mb-4">
            <h3 className="font-mono text-sm mb-3 flex items-center gap-2">
              <span className="text-[#f59e0b]">⚡</span>
              ADB AUTO-CAPTURE (Advanced)
            </h3>
            
            <div className="bg-[#050505] p-3 font-mono text-[10px] text-[#a1a1aa] overflow-x-auto">
              <pre>{`# Connect phone via USB with ADB debugging enabled
# Run this script on your computer:

SCROLL_PX=${Math.round(settings.screen_height * settings.scroll_distance_percent / 100)}
INTERVAL=${settings.capture_interval_ms / 1000}
CAPTURES=10  # Adjust based on content length

for i in $(seq 1 $CAPTURES); do
  adb exec-out screencap -p > frame_$i.png
  adb shell input swipe 500 1500 500 $((1500-SCROLL_PX)) 300
  sleep $INTERVAL
done`}</pre>
            </div>
            
            <p className="text-[10px] text-[#71717a] mt-2">
              Works with any Android app including ChatGPT, WhatsApp, etc.
            </p>
          </div>
          
          {/* Upload Section */}
          <div className="bg-[#0a0a0a] border border-[#27272a] p-4">
            <h3 className="font-mono text-sm mb-4 flex items-center gap-2">
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
              className={`block w-full p-6 border-2 border-dashed border-[#27272a] text-center cursor-pointer transition-colors ${
                isCapturing ? 'opacity-50 cursor-not-allowed' : 'hover:border-[#3b82f6]/50 hover:bg-[#3b82f6]/5'
              }`}
            >
              {isCapturing ? (
                <div className="flex flex-col items-center gap-2">
                  <Loader2 className="w-8 h-8 animate-spin text-[#3b82f6]" />
                  <span className="font-mono text-sm">Uploading...</span>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2">
                  <Camera className="w-8 h-8 text-[#71717a]" />
                  <span className="font-mono text-sm">TAP TO SELECT SCREENSHOTS</span>
                  <span className="text-[10px] text-[#71717a]">Select multiple images in order</span>
                </div>
              )}
            </label>
            
            {uploadProgress > 0 && uploadProgress < 100 && (
              <div className="mt-4">
                <div className="flex justify-between mb-2">
                  <span className="text-xs font-mono text-[#71717a]">Uploading...</span>
                  <span className="text-xs font-mono text-[#3b82f6]">{uploadProgress}%</span>
                </div>
                <Progress value={uploadProgress} className="h-1" />
              </div>
            )}
            
            {capturedFrames.length > 0 && (
              <div className="mt-4 p-3 bg-[#22c55e]/10 border border-[#22c55e]/20">
                <div className="flex items-center gap-2">
                  <Check className="w-4 h-4 text-[#22c55e]" />
                  <span className="font-mono text-xs text-[#22c55e]">
                    {capturedFrames.length} FRAMES UPLOADED - PROCESSING
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
