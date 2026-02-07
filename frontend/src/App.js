import { useState, useCallback, useEffect, useRef } from "react";
import "@/App.css";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import axios from "axios";
import { Toaster, toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import {
  Upload,
  Play,
  Copy,
  Download,
  FileText,
  Clock,
  Trash2,
  RefreshCw,
  Video,
  Settings,
  FileVideo,
  Loader2,
  Check,
  AlertCircle,
  Crop,
  ChevronDown,
  ChevronUp,
  FlaskConical,
  BarChart3,
  Percent,
  Type,
  Diff,
  Timer,
  Columns,
  Smartphone,
  QrCode,
  X,
} from "lucide-react";
import MobileCapturePage from "@/MobileCapture";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

function App() {
  const [videoFile, setVideoFile] = useState(null);
  const [videoPreview, setVideoPreview] = useState(null);
  const [uploadedFile, setUploadedFile] = useState(null);
  const [frameInterval, setFrameInterval] = useState("1.0");
  const [cropSettings, setCropSettings] = useState({ top: 0, bottom: 0, left: 0, right: 0 });
  const [showCropSettings, setShowCropSettings] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [currentJob, setCurrentJob] = useState(null);
  const [benchmarkJob, setBenchmarkJob] = useState(null);
  const [isBenchmarking, setIsBenchmarking] = useState(false);
  const [showBenchmarkResults, setShowBenchmarkResults] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [showMobileCapture, setShowMobileCapture] = useState(false);
  const [mobileSession, setMobileSession] = useState(null);
  const [mobileSessionStatus, setMobileSessionStatus] = useState(null);
  const fileInputRef = useRef(null);
  const pollIntervalRef = useRef(null);
  const benchmarkPollRef = useRef(null);
  const mobilePollRef = useRef(null);

  // Poll for job status
  useEffect(() => {
    if (currentJob && (currentJob.status === "queued" || currentJob.status === "processing" || currentJob.status === "extracting_frames")) {
      pollIntervalRef.current = setInterval(async () => {
        try {
          const response = await axios.get(`${API}/job/${currentJob.id}`);
          setCurrentJob(response.data);
          
          if (response.data.status === "completed") {
            setIsProcessing(false);
            toast.success("Processing complete!", { description: `Extracted text from ${response.data.transcripts.length} frames` });
            clearInterval(pollIntervalRef.current);
          } else if (response.data.status === "failed") {
            setIsProcessing(false);
            toast.error("Processing failed", { description: response.data.error });
            clearInterval(pollIntervalRef.current);
          }
        } catch (error) {
          console.error("Failed to poll job status:", error);
        }
      }, 1500);
    }
    
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, [currentJob?.id, currentJob?.status]);

  // Poll for benchmark job status
  useEffect(() => {
    if (benchmarkJob && (benchmarkJob.status === "queued" || benchmarkJob.status === "processing" || benchmarkJob.status === "extracting_frames")) {
      benchmarkPollRef.current = setInterval(async () => {
        try {
          const response = await axios.get(`${API}/benchmark/${benchmarkJob.id}`);
          setBenchmarkJob(response.data);
          
          if (response.data.status === "completed") {
            setIsBenchmarking(false);
            setShowBenchmarkResults(true);
            toast.success("Benchmark complete!", { description: "Compare results below" });
            clearInterval(benchmarkPollRef.current);
          } else if (response.data.status === "failed") {
            setIsBenchmarking(false);
            toast.error("Benchmark failed", { description: response.data.error });
            clearInterval(benchmarkPollRef.current);
          }
        } catch (error) {
          console.error("Failed to poll benchmark status:", error);
        }
      }, 1500);
    }
    
    return () => {
      if (benchmarkPollRef.current) {
        clearInterval(benchmarkPollRef.current);
      }
    };
  }, [benchmarkJob?.id, benchmarkJob?.status]);

  // Poll for mobile session status
  useEffect(() => {
    if (mobileSession && mobileSessionStatus !== 'completed' && mobileSessionStatus !== 'failed') {
      mobilePollRef.current = setInterval(async () => {
        try {
          const response = await axios.get(`${API}/mobile/session/${mobileSession.session_id}`);
          setMobileSessionStatus(response.data.status);
          
          if (response.data.status === 'completed') {
            toast.success("Mobile capture processed!", { 
              description: `${response.data.deduplicated_count || 0} unique text blocks extracted` 
            });
            // Load transcripts into current job view
            if (response.data.processed_transcripts?.length > 0) {
              setCurrentJob({
                id: mobileSession.session_id,
                status: 'completed',
                transcripts: response.data.processed_transcripts.map((t, i) => ({
                  ...t,
                  timestamp: i * 2, // Approximate timestamps
                })),
                source: 'mobile'
              });
            }
            clearInterval(mobilePollRef.current);
          } else if (response.data.status === 'failed') {
            toast.error("Processing failed", { description: response.data.error });
            clearInterval(mobilePollRef.current);
          }
        } catch (error) {
          console.error("Failed to poll mobile session:", error);
        }
      }, 2000);
    }
    
    return () => {
      if (mobilePollRef.current) {
        clearInterval(mobilePollRef.current);
      }
    };
  }, [mobileSession?.session_id, mobileSessionStatus]);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setIsDragging(false);
    
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleFileSelect(files[0]);
    }
  }, []);

  const handleFileSelect = (file) => {
    const allowedTypes = ['video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/x-matroska', 'video/webm', 'video/x-m4v'];
    
    if (!allowedTypes.includes(file.type) && !file.name.match(/\.(mp4|mov|avi|mkv|webm|m4v)$/i)) {
      toast.error("Invalid file type", { description: "Please upload MP4, MOV, AVI, MKV, or WebM video" });
      return;
    }
    
    setVideoFile(file);
    setVideoPreview(URL.createObjectURL(file));
    setUploadedFile(null);
    setCurrentJob(null);
  };

  const handleFileInputChange = (e) => {
    if (e.target.files && e.target.files[0]) {
      handleFileSelect(e.target.files[0]);
    }
  };

  const uploadVideo = async () => {
    if (!videoFile) return;
    
    setIsUploading(true);
    
    try {
      const formData = new FormData();
      formData.append('file', videoFile);
      
      const response = await axios.post(`${API}/upload-video`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      
      setUploadedFile(response.data);
      toast.success("Video uploaded", { description: "Ready to process" });
    } catch (error) {
      toast.error("Upload failed", { description: error.response?.data?.detail || "Failed to upload video" });
    } finally {
      setIsUploading(false);
    }
  };

  const processVideo = async () => {
    if (!uploadedFile) {
      await uploadVideo();
      return;
    }
    
    setIsProcessing(true);
    
    try {
      const response = await axios.post(`${API}/process-video`, null, {
        params: {
          file_id: uploadedFile.file_id,
          filename: uploadedFile.filename,
          frame_interval: parseFloat(frameInterval),
          crop_top: cropSettings.top,
          crop_bottom: cropSettings.bottom,
          crop_left: cropSettings.left,
          crop_right: cropSettings.right
        }
      });
      
      setCurrentJob({ id: response.data.job_id, status: "queued", progress: 0, transcripts: [] });
      toast.info("Processing started", { description: "Extracting frames and running OCR..." });
    } catch (error) {
      setIsProcessing(false);
      toast.error("Processing failed", { description: error.response?.data?.detail || "Failed to start processing" });
    }
  };

  const handleProcess = async () => {
    if (!uploadedFile) {
      setIsUploading(true);
      try {
        const formData = new FormData();
        formData.append('file', videoFile);
        
        const uploadResponse = await axios.post(`${API}/upload-video`, formData, {
          headers: { 'Content-Type': 'multipart/form-data' }
        });
        
        setUploadedFile(uploadResponse.data);
        
        // Start processing immediately
        setIsProcessing(true);
        const processResponse = await axios.post(`${API}/process-video`, null, {
          params: {
            file_id: uploadResponse.data.file_id,
            filename: uploadResponse.data.filename,
            frame_interval: parseFloat(frameInterval),
            crop_top: cropSettings.top,
            crop_bottom: cropSettings.bottom,
            crop_left: cropSettings.left,
            crop_right: cropSettings.right
          }
        });
        
        setCurrentJob({ id: processResponse.data.job_id, status: "queued", progress: 0, transcripts: [] });
        toast.info("Processing started", { description: "Extracting frames and running OCR..." });
      } catch (error) {
        toast.error("Failed", { description: error.response?.data?.detail || "Operation failed" });
      } finally {
        setIsUploading(false);
      }
    } else {
      await processVideo();
    }
  };

  const copyToClipboard = () => {
    if (!currentJob?.transcripts?.length) return;
    
    const text = currentJob.transcripts
      .map(t => `[${formatTimestamp(t.timestamp)}]\n${t.text}`)
      .join('\n\n');
    
    navigator.clipboard.writeText(text);
    toast.success("Copied to clipboard");
  };

  const exportToFile = () => {
    if (!currentJob?.transcripts?.length) return;
    
    const text = currentJob.transcripts
      .map(t => `[${formatTimestamp(t.timestamp)}]\n${t.text}`)
      .join('\n\n');
    
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `transcript-${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("File downloaded");
  };

  const resetAll = () => {
    setVideoFile(null);
    setVideoPreview(null);
    setUploadedFile(null);
    setCurrentJob(null);
    setBenchmarkJob(null);
    setIsBenchmarking(false);
    setShowBenchmarkResults(false);
    setIsProcessing(false);
    setIsUploading(false);
    setCropSettings({ top: 0, bottom: 0, left: 0, right: 0 });
    setShowCropSettings(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleBenchmark = async () => {
    // Check if crop is set
    if (cropSettings.top === 0 && cropSettings.bottom === 0 && cropSettings.left === 0 && cropSettings.right === 0) {
      toast.error("Set crop values first", { description: "Benchmark compares cropped vs uncropped - please set crop margins" });
      setShowCropSettings(true);
      return;
    }

    let fileData = uploadedFile;
    
    if (!fileData) {
      setIsUploading(true);
      try {
        const formData = new FormData();
        formData.append('file', videoFile);
        
        const uploadResponse = await axios.post(`${API}/upload-video`, formData, {
          headers: { 'Content-Type': 'multipart/form-data' }
        });
        
        fileData = uploadResponse.data;
        setUploadedFile(fileData);
      } catch (error) {
        toast.error("Upload failed", { description: error.response?.data?.detail || "Failed to upload video" });
        setIsUploading(false);
        return;
      }
      setIsUploading(false);
    }
    
    setIsBenchmarking(true);
    setShowBenchmarkResults(false);
    
    try {
      const response = await axios.post(`${API}/benchmark-video`, null, {
        params: {
          file_id: fileData.file_id,
          filename: fileData.filename,
          frame_interval: parseFloat(frameInterval),
          crop_top: cropSettings.top,
          crop_bottom: cropSettings.bottom,
          crop_left: cropSettings.left,
          crop_right: cropSettings.right
        }
      });
      
      setBenchmarkJob({ id: response.data.job_id, status: "queued", progress: 0 });
      toast.info("Benchmark started", { description: "Processing uncropped and cropped versions..." });
    } catch (error) {
      setIsBenchmarking(false);
      toast.error("Benchmark failed", { description: error.response?.data?.detail || "Failed to start benchmark" });
    }
  };

  const createMobileSession = async () => {
    try {
      const response = await axios.post(`${API}/mobile/create-session`, {
        scroll_distance_percent: 80,
        capture_interval_ms: 1500,
        overlap_margin_percent: 10,
        auto_detect_height: true,
      });
      
      setMobileSession(response.data);
      setMobileSessionStatus('waiting');
      setShowMobileCapture(true);
      toast.success("Mobile session created", { description: "Scan QR or enter code on your phone" });
    } catch (error) {
      toast.error("Failed to create session", { description: error.response?.data?.detail || "Server error" });
    }
  };

  const closeMobileCapture = () => {
    setShowMobileCapture(false);
    if (mobilePollRef.current) {
      clearInterval(mobilePollRef.current);
    }
  };

  const formatTimestamp = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const getStatusText = () => {
    if (!currentJob) return null;
    switch (currentJob.status) {
      case 'queued': return 'Queued...';
      case 'extracting_frames': return 'Extracting frames...';
      case 'processing': return `Processing frames (${currentJob.progress}%)`;
      case 'completed': return 'Completed';
      case 'failed': return 'Failed';
      default: return currentJob.status;
    }
  };

  return (
    <div className="app-container min-h-screen">
      <Toaster 
        position="top-right" 
        toastOptions={{
          style: {
            background: '#0a0a0a',
            border: '1px solid #27272a',
            color: '#fafafa',
            fontFamily: 'JetBrains Mono, monospace',
          }
        }}
      />
      
      {/* Scanline effect */}
      <div className="scanline" />
      
      {/* Header */}
      <header className="app-header px-6 py-4" data-testid="app-header">
        <div className="flex items-center justify-between max-w-7xl mx-auto">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-[#3b82f6]/20 border border-[#3b82f6]/30">
              <FileVideo className="w-5 h-5 text-[#3b82f6]" />
            </div>
            <div>
              <h1 className="font-mono text-lg font-medium tracking-tight">FRAME_READER</h1>
              <p className="text-xs text-[#71717a] font-mono">VIDEO OCR TRANSCRIPT EXTRACTOR</p>
            </div>
          </div>
          
          {videoFile && (
            <Button
              variant="ghost"
              size="sm"
              onClick={resetAll}
              className="font-mono text-xs text-[#71717a] hover:text-white hover:bg-white/5"
              data-testid="reset-button"
            >
              <RefreshCw className="w-4 h-4 mr-2" />
              RESET
            </Button>
          )}
          
          {/* Mobile Capture Button */}
          <Button
            variant="outline"
            size="sm"
            onClick={createMobileSession}
            className="font-mono text-xs border-[#22c55e]/50 text-[#22c55e] hover:bg-[#22c55e]/10 hover:border-[#22c55e] ml-2"
            data-testid="mobile-capture-button"
          >
            <Smartphone className="w-4 h-4 mr-2" />
            MOBILE CAPTURE
          </Button>
        </div>
      </header>
      
      {/* Mobile Capture Modal */}
      {showMobileCapture && mobileSession && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
          <div className="bg-[#0a0a0a] border border-[#27272a] w-full max-w-md">
            <div className="flex items-center justify-between p-4 border-b border-[#27272a]">
              <div className="flex items-center gap-2">
                <Smartphone className="w-5 h-5 text-[#22c55e]" />
                <span className="font-mono text-sm">MOBILE CAPTURE SESSION</span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={closeMobileCapture}
                className="h-8 w-8 p-0 text-[#71717a] hover:text-white"
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
            
            <div className="p-6">
              {/* Session Code */}
              <div className="text-center mb-6">
                <p className="text-xs text-[#71717a] font-mono mb-2">ENTER THIS CODE ON YOUR PHONE</p>
                <div className="text-4xl font-mono font-bold tracking-[0.5em] text-[#22c55e]">
                  {mobileSession.session_code}
                </div>
              </div>
              
              {/* QR Code placeholder */}
              <div className="flex justify-center mb-6">
                <div className="p-4 bg-white rounded-none">
                  <div className="w-32 h-32 flex items-center justify-center">
                    <QrCode className="w-24 h-24 text-black" />
                  </div>
                </div>
              </div>
              
              {/* Mobile URL */}
              <div className="bg-[#050505] p-3 border border-[#27272a] mb-4">
                <p className="text-[10px] text-[#71717a] font-mono mb-1">OR OPEN THIS URL ON YOUR PHONE:</p>
                <p className="text-xs font-mono text-[#3b82f6] break-all">
                  {window.location.origin}/mobile/capture/{mobileSession.session_code}
                </p>
              </div>
              
              {/* Status */}
              <div className="flex items-center justify-center gap-2 p-3 bg-[#050505] border border-[#27272a]">
                {mobileSessionStatus === 'waiting' && (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin text-[#f59e0b]" />
                    <span className="font-mono text-xs text-[#f59e0b]">WAITING FOR DEVICE...</span>
                  </>
                )}
                {mobileSessionStatus === 'connected' && (
                  <>
                    <Check className="w-4 h-4 text-[#22c55e]" />
                    <span className="font-mono text-xs text-[#22c55e]">DEVICE CONNECTED</span>
                  </>
                )}
                {mobileSessionStatus === 'capturing' && (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin text-[#3b82f6]" />
                    <span className="font-mono text-xs text-[#3b82f6]">RECEIVING FRAMES...</span>
                  </>
                )}
                {mobileSessionStatus === 'processing' && (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin text-[#3b82f6]" />
                    <span className="font-mono text-xs text-[#3b82f6]">PROCESSING OCR...</span>
                  </>
                )}
                {mobileSessionStatus === 'completed' && (
                  <>
                    <Check className="w-4 h-4 text-[#22c55e]" />
                    <span className="font-mono text-xs text-[#22c55e]">COMPLETE - VIEW TRANSCRIPTS</span>
                  </>
                )}
              </div>
              
              {/* Instructions */}
              <div className="mt-4 space-y-2 text-[10px] text-[#71717a]">
                <p>1. Open the URL on your Android phone</p>
                <p>2. Follow the capture instructions</p>
                <p>3. Upload screenshots when done</p>
                <p className="text-[#f59e0b]">💡 For non-browser apps, use ADB automation</p>
              </div>
            </div>
          </div>
        </div>
      )}
      
      {/* Main Content */}
      <main className="p-6 max-w-7xl mx-auto">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6" style={{ minHeight: 'calc(100vh - 120px)' }}>
          
          {/* Left Panel - Upload & Preview */}
          <div className="lg:col-span-7 flex flex-col gap-4">
            
            {/* Upload Zone */}
            <div className="panel flex-1 flex flex-col">
              <div className="panel-header flex items-center gap-2">
                <Upload className="w-4 h-4 text-[#3b82f6]" />
                <span className="font-mono text-sm">VIDEO INPUT</span>
              </div>
              
              <div className="flex-1 p-4">
                {!videoPreview ? (
                  <div
                    className={`upload-zone h-full min-h-[300px] flex flex-col items-center justify-center gap-4 ${isDragging ? 'dragging' : ''}`}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                    onClick={() => fileInputRef.current?.click()}
                    data-testid="upload-dropzone"
                  >
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".mp4,.mov,.avi,.mkv,.webm,.m4v,video/*"
                      onChange={handleFileInputChange}
                      className="hidden"
                      data-testid="file-input"
                    />
                    
                    <div className="p-4 border border-dashed border-[#27272a] group-hover:border-[#3b82f6]/50">
                      <Video className="w-10 h-10 text-[#71717a]" />
                    </div>
                    
                    <div className="text-center">
                      <p className="font-mono text-sm text-white mb-1">DROP VIDEO FILE HERE</p>
                      <p className="text-xs text-[#71717a]">or click to browse</p>
                    </div>
                    
                    <p className="text-xs text-[#71717a] font-mono">
                      MP4 / MOV / AVI / MKV / WebM
                    </p>
                  </div>
                ) : (
                  <div className="h-full flex flex-col gap-4">
                    {/* Video with crop overlay */}
                    <div className="relative flex-1 bg-black">
                      <video
                        src={videoPreview}
                        controls
                        className="video-preview w-full h-full object-contain"
                        data-testid="video-preview"
                      />
                      {/* Crop overlay visualization */}
                      {(cropSettings.top > 0 || cropSettings.bottom > 0 || cropSettings.left > 0 || cropSettings.right > 0) && (
                        <div className="absolute inset-0 pointer-events-none">
                          {/* Top crop overlay */}
                          {cropSettings.top > 0 && (
                            <div 
                              className="absolute top-0 left-0 right-0 bg-black/70 border-b border-[#ef4444]/50"
                              style={{ height: `${cropSettings.top}%` }}
                            />
                          )}
                          {/* Bottom crop overlay */}
                          {cropSettings.bottom > 0 && (
                            <div 
                              className="absolute bottom-0 left-0 right-0 bg-black/70 border-t border-[#ef4444]/50"
                              style={{ height: `${cropSettings.bottom}%` }}
                            />
                          )}
                          {/* Left crop overlay */}
                          {cropSettings.left > 0 && (
                            <div 
                              className="absolute left-0 bg-black/70 border-r border-[#ef4444]/50"
                              style={{ 
                                width: `${cropSettings.left}%`,
                                top: `${cropSettings.top}%`,
                                bottom: `${cropSettings.bottom}%`
                              }}
                            />
                          )}
                          {/* Right crop overlay */}
                          {cropSettings.right > 0 && (
                            <div 
                              className="absolute right-0 bg-black/70 border-l border-[#ef4444]/50"
                              style={{ 
                                width: `${cropSettings.right}%`,
                                top: `${cropSettings.top}%`,
                                bottom: `${cropSettings.bottom}%`
                              }}
                            />
                          )}
                        </div>
                      )}
                    </div>
                    
                    <div className="flex items-center justify-between text-xs text-[#71717a] font-mono px-1">
                      <span>{videoFile?.name}</span>
                      <span>{(videoFile?.size / (1024 * 1024)).toFixed(2)} MB</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
            
            {/* Settings & Process */}
            <div className="panel">
              <div className="panel-header flex items-center gap-2">
                <Settings className="w-4 h-4 text-[#3b82f6]" />
                <span className="font-mono text-sm">SETTINGS</span>
              </div>
              
              <div className="p-4">
                <div className="flex items-center justify-between gap-4 mb-4">
                  <div className="flex items-center gap-2">
                    <Clock className="w-4 h-4 text-[#71717a]" />
                    <span className="font-mono text-sm">Frame Interval</span>
                  </div>
                  
                  <Select value={frameInterval} onValueChange={setFrameInterval} data-testid="frame-interval-select">
                    <SelectTrigger className="w-32 bg-[#0a0a0a] border-[#27272a] font-mono text-sm rounded-none" data-testid="frame-interval-trigger">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-[#0a0a0a] border-[#27272a] font-mono rounded-none">
                      <SelectItem value="0.5" className="font-mono">0.5 sec</SelectItem>
                      <SelectItem value="1.0" className="font-mono">1.0 sec</SelectItem>
                      <SelectItem value="2.0" className="font-mono">2.0 sec</SelectItem>
                      <SelectItem value="3.0" className="font-mono">3.0 sec</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                
                {/* Crop Settings Toggle */}
                <button
                  onClick={() => setShowCropSettings(!showCropSettings)}
                  className="w-full flex items-center justify-between py-3 mb-4 border-y border-[#27272a] text-sm font-mono text-[#71717a] hover:text-white transition-colors"
                  data-testid="crop-settings-toggle"
                >
                  <div className="flex items-center gap-2">
                    <Crop className="w-4 h-4" />
                    <span>Frame Crop</span>
                    {(cropSettings.top > 0 || cropSettings.bottom > 0 || cropSettings.left > 0 || cropSettings.right > 0) && (
                      <span className="text-[10px] px-2 py-0.5 bg-[#3b82f6]/20 text-[#3b82f6] border border-[#3b82f6]/30">
                        ACTIVE
                      </span>
                    )}
                  </div>
                  {showCropSettings ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </button>
                
                {/* Crop Controls */}
                {showCropSettings && (
                  <div className="mb-4 p-4 bg-[#050505] border border-[#27272a] space-y-4" data-testid="crop-controls">
                    <p className="text-xs text-[#71717a] font-mono mb-3">Adjust margins to crop the observable frame area (0-45%)</p>
                    
                    {/* Top Crop */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-mono text-[#71717a]">TOP</span>
                        <span className="text-xs font-mono text-[#3b82f6]">{cropSettings.top}%</span>
                      </div>
                      <Slider
                        value={[cropSettings.top]}
                        onValueChange={([val]) => setCropSettings(prev => ({ ...prev, top: val }))}
                        max={45}
                        step={1}
                        className="w-full"
                        data-testid="crop-top-slider"
                      />
                    </div>
                    
                    {/* Bottom Crop */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-mono text-[#71717a]">BOTTOM</span>
                        <span className="text-xs font-mono text-[#3b82f6]">{cropSettings.bottom}%</span>
                      </div>
                      <Slider
                        value={[cropSettings.bottom]}
                        onValueChange={([val]) => setCropSettings(prev => ({ ...prev, bottom: val }))}
                        max={45}
                        step={1}
                        className="w-full"
                        data-testid="crop-bottom-slider"
                      />
                    </div>
                    
                    {/* Left Crop */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-mono text-[#71717a]">LEFT</span>
                        <span className="text-xs font-mono text-[#3b82f6]">{cropSettings.left}%</span>
                      </div>
                      <Slider
                        value={[cropSettings.left]}
                        onValueChange={([val]) => setCropSettings(prev => ({ ...prev, left: val }))}
                        max={45}
                        step={1}
                        className="w-full"
                        data-testid="crop-left-slider"
                      />
                    </div>
                    
                    {/* Right Crop */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-mono text-[#71717a]">RIGHT</span>
                        <span className="text-xs font-mono text-[#3b82f6]">{cropSettings.right}%</span>
                      </div>
                      <Slider
                        value={[cropSettings.right]}
                        onValueChange={([val]) => setCropSettings(prev => ({ ...prev, right: val }))}
                        max={45}
                        step={1}
                        className="w-full"
                        data-testid="crop-right-slider"
                      />
                    </div>
                    
                    {/* Reset Crop */}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setCropSettings({ top: 0, bottom: 0, left: 0, right: 0 })}
                      className="w-full mt-2 text-xs font-mono text-[#71717a] hover:text-white hover:bg-white/5"
                      data-testid="reset-crop-button"
                    >
                      RESET CROP
                    </Button>
                  </div>
                )}
                
                <Button
                  className="w-full btn-primary py-5 rounded-none"
                  onClick={handleProcess}
                  disabled={!videoFile || isUploading || isProcessing || isBenchmarking}
                  data-testid="process-button"
                >
                  {isUploading ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      UPLOADING...
                    </>
                  ) : isProcessing ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      PROCESSING...
                    </>
                  ) : (
                    <>
                      <Play className="w-4 h-4 mr-2" />
                      EXTRACT TEXT
                    </>
                  )}
                </Button>
                
                {/* Benchmark Button */}
                <Button
                  variant="outline"
                  className="w-full mt-2 py-4 rounded-none border-[#27272a] bg-transparent hover:bg-[#22c55e]/10 hover:border-[#22c55e]/50 font-mono text-xs"
                  onClick={handleBenchmark}
                  disabled={!videoFile || isUploading || isProcessing || isBenchmarking}
                  data-testid="benchmark-button"
                >
                  {isBenchmarking ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      BENCHMARKING...
                    </>
                  ) : (
                    <>
                      <FlaskConical className="w-4 h-4 mr-2" />
                      RUN BENCHMARK (CROP VS UNCROP)
                    </>
                  )}
                </Button>
                
                {/* Progress */}
                {currentJob && (currentJob.status === 'processing' || currentJob.status === 'extracting_frames') && (
                  <div className="mt-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-mono text-[#71717a]">{getStatusText()}</span>
                      <span className="text-xs font-mono text-[#3b82f6]">{currentJob.progress}%</span>
                    </div>
                    <Progress value={currentJob.progress} className="h-1 rounded-none bg-[#27272a]" data-testid="progress-bar" />
                  </div>
                )}
                
                {/* Benchmark Progress */}
                {benchmarkJob && (benchmarkJob.status === 'processing' || benchmarkJob.status === 'extracting_frames' || benchmarkJob.status === 'queued') && (
                  <div className="mt-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-mono text-[#71717a]">
                        <FlaskConical className="w-3 h-3 inline mr-1" />
                        {benchmarkJob.status === 'queued' ? 'Queued...' : 
                         benchmarkJob.status === 'extracting_frames' ? 'Extracting frames...' : 
                         `Benchmarking (${benchmarkJob.progress}%)`}
                      </span>
                      <span className="text-xs font-mono text-[#22c55e]">{benchmarkJob.progress}%</span>
                    </div>
                    <Progress value={benchmarkJob.progress} className="h-1 rounded-none bg-[#27272a]" data-testid="benchmark-progress-bar" />
                  </div>
                )}
              </div>
            </div>
          </div>
          
          {/* Right Panel - Transcript Output */}
          <div className="lg:col-span-5 flex flex-col lg:border-l lg:border-[#27272a]/50 lg:pl-6">
            
            {/* Benchmark Mode - Side by Side Transcripts */}
            {benchmarkJob && (benchmarkJob.status === 'completed' || benchmarkJob.uncropped_transcripts?.length > 0 || benchmarkJob.cropped_transcripts?.length > 0) ? (
              <div className="flex flex-col h-full gap-4">
                {/* Benchmark Metrics Summary */}
                {benchmarkJob.comparison && (
                  <div className="panel" data-testid="benchmark-metrics">
                    <div className="panel-header flex items-center gap-2">
                      <BarChart3 className="w-4 h-4 text-[#22c55e]" />
                      <span className="font-mono text-sm">BENCHMARK METRICS</span>
                    </div>
                    <div className="p-3 grid grid-cols-4 gap-2">
                      {/* Similarity */}
                      <div className="p-2 bg-[#050505] border border-[#27272a] text-center">
                        <div className="text-[10px] text-[#71717a] font-mono">SIMILARITY</div>
                        <div className={`font-mono text-lg font-medium ${
                          benchmarkJob.comparison.similarity_percentage >= 90 ? 'text-[#22c55e]' :
                          benchmarkJob.comparison.similarity_percentage >= 70 ? 'text-[#f59e0b]' :
                          'text-[#ef4444]'
                        }`}>
                          {benchmarkJob.comparison.similarity_percentage}%
                        </div>
                      </div>
                      {/* Uncropped Time */}
                      <div className="p-2 bg-[#050505] border border-[#27272a] text-center">
                        <div className="text-[10px] text-[#71717a] font-mono">UNCROP TIME</div>
                        <div className="font-mono text-lg text-white">{benchmarkJob.comparison.uncropped_processing_time || benchmarkJob.uncropped_processing_time || '—'}s</div>
                      </div>
                      {/* Cropped Time */}
                      <div className="p-2 bg-[#050505] border border-[#27272a] text-center">
                        <div className="text-[10px] text-[#71717a] font-mono">CROP TIME</div>
                        <div className="font-mono text-lg text-white">{benchmarkJob.comparison.cropped_processing_time || benchmarkJob.cropped_processing_time || '—'}s</div>
                      </div>
                      {/* Extra Artifacts */}
                      <div className="p-2 bg-[#050505] border border-[#27272a] text-center">
                        <div className="text-[10px] text-[#71717a] font-mono">ARTIFACTS</div>
                        <div className="font-mono text-lg text-[#f59e0b]">+{benchmarkJob.comparison.extra_words_in_uncropped || 0}</div>
                      </div>
                    </div>
                    {/* Extra artifacts list */}
                    {benchmarkJob.comparison.extra_artifacts?.length > 0 && (
                      <div className="px-3 pb-3">
                        <div className="text-[10px] text-[#71717a] font-mono mb-1">EXTRA WORDS IN UNCROPPED:</div>
                        <div className="flex flex-wrap gap-1 max-h-16 overflow-y-auto custom-scrollbar">
                          {benchmarkJob.comparison.extra_artifacts.slice(0, 30).map((word, idx) => (
                            <span key={idx} className="text-[9px] px-1 py-0.5 bg-[#f59e0b]/10 text-[#f59e0b] border border-[#f59e0b]/20 font-mono">
                              {word}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
                
                {/* Side by Side Transcript Panels */}
                <div className="grid grid-cols-2 gap-3 flex-1 min-h-0">
                  {/* Uncropped Transcript */}
                  <div className="panel flex flex-col min-h-0" data-testid="uncropped-transcript-panel">
                    <div className="panel-header flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Columns className="w-3 h-3 text-[#ef4444]" />
                        <span className="font-mono text-xs">UNCROPPED</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {benchmarkJob.uncropped_processing_time && (
                          <span className="text-[10px] font-mono text-[#71717a]">
                            <Timer className="w-3 h-3 inline mr-1" />
                            {benchmarkJob.uncropped_processing_time}s
                          </span>
                        )}
                        <span className="text-[10px] px-1.5 py-0.5 bg-[#ef4444]/10 text-[#ef4444] font-mono">
                          {benchmarkJob.uncropped_transcripts?.length || 0} frames
                        </span>
                      </div>
                    </div>
                    <ScrollArea className="flex-1" data-testid="uncropped-scroll">
                      {benchmarkJob.uncropped_transcripts?.length > 0 ? (
                        <div className="divide-y divide-[#27272a]">
                          {benchmarkJob.uncropped_transcripts.map((entry, index) => (
                            <div key={index} className="p-2" data-testid={`uncropped-entry-${index}`}>
                              <div className="flex items-center gap-1 mb-1">
                                <span className="text-[9px] px-1 py-0.5 bg-[#ef4444]/20 text-[#ef4444] font-mono">
                                  {formatTimestamp(entry.timestamp)}
                                </span>
                              </div>
                              <p className="text-[11px] text-[#e4e4e7] whitespace-pre-wrap leading-relaxed font-mono">
                                {entry.text}
                              </p>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="flex items-center justify-center h-32 text-[#71717a]">
                          <Loader2 className="w-5 h-5 animate-spin" />
                        </div>
                      )}
                    </ScrollArea>
                  </div>
                  
                  {/* Cropped Transcript */}
                  <div className="panel flex flex-col min-h-0" data-testid="cropped-transcript-panel">
                    <div className="panel-header flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Crop className="w-3 h-3 text-[#22c55e]" />
                        <span className="font-mono text-xs">CROPPED</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {benchmarkJob.cropped_processing_time && (
                          <span className="text-[10px] font-mono text-[#71717a]">
                            <Timer className="w-3 h-3 inline mr-1" />
                            {benchmarkJob.cropped_processing_time}s
                          </span>
                        )}
                        <span className="text-[10px] px-1.5 py-0.5 bg-[#22c55e]/10 text-[#22c55e] font-mono">
                          {benchmarkJob.cropped_transcripts?.length || 0} frames
                        </span>
                      </div>
                    </div>
                    <ScrollArea className="flex-1" data-testid="cropped-scroll">
                      {benchmarkJob.cropped_transcripts?.length > 0 ? (
                        <div className="divide-y divide-[#27272a]">
                          {benchmarkJob.cropped_transcripts.map((entry, index) => (
                            <div key={index} className="p-2" data-testid={`cropped-entry-${index}`}>
                              <div className="flex items-center gap-1 mb-1">
                                <span className="text-[9px] px-1 py-0.5 bg-[#22c55e]/20 text-[#22c55e] font-mono">
                                  {formatTimestamp(entry.timestamp)}
                                </span>
                              </div>
                              <p className="text-[11px] text-[#e4e4e7] whitespace-pre-wrap leading-relaxed font-mono">
                                {entry.text}
                              </p>
                            </div>
                          ))}
                        </div>
                      ) : benchmarkJob.uncropped_transcripts?.length > 0 ? (
                        <div className="flex items-center justify-center h-32 text-[#71717a]">
                          <Loader2 className="w-5 h-5 animate-spin" />
                        </div>
                      ) : (
                        <div className="flex items-center justify-center h-32 text-[#71717a] text-xs font-mono">
                          Waiting...
                        </div>
                      )}
                    </ScrollArea>
                  </div>
                </div>
                
                {/* Back to single view button */}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => { setBenchmarkJob(null); setShowBenchmarkResults(false); }}
                  className="w-full text-xs font-mono text-[#71717a] hover:text-white hover:bg-white/5"
                  data-testid="clear-benchmark-button"
                >
                  CLEAR BENCHMARK RESULTS
                </Button>
              </div>
            ) : (
              /* Standard Single Transcript View */
              <>
                {/* Benchmark Results Panel - Legacy metrics only */}
                {showBenchmarkResults && benchmarkJob?.comparison && (
                  <div className="panel mb-4" data-testid="benchmark-results">
                    <div className="panel-header flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <BarChart3 className="w-4 h-4 text-[#22c55e]" />
                        <span className="font-mono text-sm">BENCHMARK RESULTS</span>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setShowBenchmarkResults(false)}
                        className="h-6 px-2 text-[#71717a] hover:text-white hover:bg-white/5 text-xs"
                      >
                        HIDE
                      </Button>
                    </div>
                    
                    <div className="p-4 space-y-4">
                      {/* Similarity Score */}
                      <div className="flex items-center justify-between p-3 bg-[#050505] border border-[#27272a]">
                        <div className="flex items-center gap-2">
                          <Percent className="w-4 h-4 text-[#3b82f6]" />
                          <span className="font-mono text-sm">Similarity</span>
                        </div>
                        <span className={`font-mono text-lg font-medium ${
                          benchmarkJob.comparison.similarity_percentage >= 90 ? 'text-[#22c55e]' :
                          benchmarkJob.comparison.similarity_percentage >= 70 ? 'text-[#f59e0b]' :
                          'text-[#ef4444]'
                        }`}>
                          {benchmarkJob.comparison.similarity_percentage}%
                        </span>
                      </div>
                      
                      {/* Character Counts */}
                      <div className="grid grid-cols-2 gap-2">
                        <div className="p-3 bg-[#050505] border border-[#27272a]">
                          <div className="text-[10px] text-[#71717a] font-mono mb-1">UNCROPPED CHARS</div>
                          <div className="font-mono text-sm text-white">{benchmarkJob.comparison.uncropped_char_count.toLocaleString()}</div>
                        </div>
                        <div className="p-3 bg-[#050505] border border-[#27272a]">
                          <div className="text-[10px] text-[#71717a] font-mono mb-1">CROPPED CHARS</div>
                          <div className="font-mono text-sm text-white">{benchmarkJob.comparison.cropped_char_count.toLocaleString()}</div>
                        </div>
                      </div>
                      
                      {/* Extra Artifacts */}
                      <div className="p-3 bg-[#050505] border border-[#27272a]">
                        <div className="flex items-center gap-2 mb-2">
                          <Type className="w-3 h-3 text-[#f59e0b]" />
                          <span className="text-[10px] text-[#71717a] font-mono">EXTRA WORDS IN UNCROPPED (ARTIFACTS)</span>
                        </div>
                        <div className="font-mono text-lg text-[#f59e0b] mb-2">
                          +{benchmarkJob.comparison.extra_words_in_uncropped} words
                        </div>
                        {benchmarkJob.comparison.extra_artifacts?.length > 0 && (
                          <div className="flex flex-wrap gap-1 max-h-20 overflow-y-auto custom-scrollbar">
                            {benchmarkJob.comparison.extra_artifacts.slice(0, 20).map((word, idx) => (
                              <span key={idx} className="text-[10px] px-1.5 py-0.5 bg-[#f59e0b]/10 text-[#f59e0b] border border-[#f59e0b]/20 font-mono">
                                {word}
                              </span>
                            ))}
                            {benchmarkJob.comparison.extra_artifacts.length > 20 && (
                              <span className="text-[10px] text-[#71717a] font-mono">+{benchmarkJob.comparison.extra_artifacts.length - 20} more</span>
                            )}
                          </div>
                        )}
                      </div>
                      
                      {/* Lines only in uncropped */}
                      {benchmarkJob.comparison.lines_only_in_uncropped?.length > 0 && (
                        <div className="p-3 bg-[#050505] border border-[#27272a]">
                          <div className="flex items-center gap-2 mb-2">
                            <Diff className="w-3 h-3 text-[#ef4444]" />
                            <span className="text-[10px] text-[#71717a] font-mono">LINES ONLY IN UNCROPPED</span>
                          </div>
                          <div className="max-h-32 overflow-y-auto custom-scrollbar space-y-1">
                            {benchmarkJob.comparison.lines_only_in_uncropped.slice(0, 10).map((line, idx) => (
                              <div key={idx} className="text-xs font-mono text-[#ef4444]/80 bg-[#ef4444]/5 px-2 py-1 border-l-2 border-[#ef4444]/30">
                                {line || '(empty line)'}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      
                      {/* Summary */}
                      <div className="p-3 bg-[#22c55e]/10 border border-[#22c55e]/20">
                        <div className="text-xs font-mono text-[#22c55e]">
                          {benchmarkJob.comparison.char_difference > 0 ? (
                            <>Cropping removed {benchmarkJob.comparison.char_difference.toLocaleString()} characters of potential noise</>
                          ) : benchmarkJob.comparison.char_difference < 0 ? (
                            <>Cropping captured {Math.abs(benchmarkJob.comparison.char_difference).toLocaleString()} more characters</>
                          ) : (
                            <>Both versions captured the same amount of text</>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
                
                <div className="panel flex-1 flex flex-col">
              <div className="panel-header flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4 text-[#22c55e]" />
                  <span className="font-mono text-sm">TRANSCRIPT OUTPUT</span>
                </div>
                
                {currentJob?.transcripts?.length > 0 && (
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={copyToClipboard}
                      className="h-7 px-2 text-[#71717a] hover:text-white hover:bg-white/5"
                      data-testid="copy-button"
                    >
                      <Copy className="w-3.5 h-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={exportToFile}
                      className="h-7 px-2 text-[#71717a] hover:text-white hover:bg-white/5"
                      data-testid="export-button"
                    >
                      <Download className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                )}
              </div>
              
              <ScrollArea className="flex-1" data-testid="transcript-scroll-area">
                {!currentJob ? (
                  <div className="empty-state h-full min-h-[400px]">
                    <FileText className="w-12 h-12 mb-4 opacity-30" />
                    <p className="font-mono text-sm">NO TRANSCRIPT YET</p>
                    <p className="text-xs mt-2">Upload a video and click Extract Text</p>
                  </div>
                ) : currentJob.status === 'failed' ? (
                  <div className="empty-state h-full min-h-[400px]">
                    <AlertCircle className="w-12 h-12 mb-4 text-[#ef4444] opacity-70" />
                    <p className="font-mono text-sm text-[#ef4444]">PROCESSING FAILED</p>
                    <p className="text-xs mt-2 text-[#71717a] max-w-xs text-center">{currentJob.error}</p>
                  </div>
                ) : currentJob.transcripts?.length === 0 && currentJob.status !== 'completed' ? (
                  <div className="empty-state h-full min-h-[400px]">
                    <Loader2 className="w-12 h-12 mb-4 animate-spin text-[#3b82f6]" />
                    <p className="font-mono text-sm">{getStatusText()}</p>
                    <p className="text-xs mt-2">This may take a few minutes...</p>
                  </div>
                ) : currentJob.transcripts?.length === 0 && currentJob.status === 'completed' ? (
                  <div className="empty-state h-full min-h-[400px]">
                    <Check className="w-12 h-12 mb-4 text-[#22c55e]" />
                    <p className="font-mono text-sm">PROCESSING COMPLETE</p>
                    <p className="text-xs mt-2 text-[#71717a]">No text was detected in the video frames</p>
                  </div>
                ) : (
                  <div className="divide-y divide-[#27272a]" data-testid="transcript-list">
                    {currentJob.transcripts.map((entry, index) => (
                      <div key={index} className="transcript-entry" data-testid={`transcript-entry-${index}`}>
                        <div className="flex items-center gap-2 mb-2">
                          <span className="timestamp-badge">
                            {formatTimestamp(entry.timestamp)}
                          </span>
                          <span className="text-[10px] text-[#71717a] font-mono">
                            FRAME #{entry.frame_index}
                          </span>
                        </div>
                        <p className="text-sm text-[#e4e4e7] whitespace-pre-wrap leading-relaxed font-mono">
                          {entry.text}
                        </p>
                      </div>
                    ))}
                    
                    {currentJob.status === 'completed' && (
                      <div className="p-4 bg-[#22c55e]/10 border-t border-[#22c55e]/20">
                        <div className="flex items-center gap-2">
                          <Check className="w-4 h-4 text-[#22c55e]" />
                          <span className="font-mono text-xs text-[#22c55e]">
                            EXTRACTION COMPLETE - {currentJob.transcripts.length} FRAMES WITH TEXT
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </ScrollArea>
            </div>
              </>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/mobile/capture/:sessionCode" element={<MobileCapturePage />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
