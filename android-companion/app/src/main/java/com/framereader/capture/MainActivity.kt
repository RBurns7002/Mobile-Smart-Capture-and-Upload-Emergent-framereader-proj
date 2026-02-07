package com.framereader.capture

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.media.projection.MediaProjectionManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.util.DisplayMetrics
import android.view.View
import android.widget.SeekBar
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import com.framereader.capture.databinding.ActivityMainBinding
import kotlinx.coroutines.*
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject

class MainActivity : AppCompatActivity() {
    
    private lateinit var binding: ActivityMainBinding
    private val scope = CoroutineScope(Dispatchers.Main + Job())
    private val client = OkHttpClient()
    
    private var isCapturing = false
    private var captureJob: Job? = null
    
    companion object {
        private const val REQUEST_CODE_SCREEN_CAPTURE = 1001
        private const val REQUEST_CODE_PERMISSIONS = 1002
        private const val REQUEST_CODE_OVERLAY = 1003
    }
    
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)
        
        setupUI()
        detectScreenSize()
        handleDeepLink(intent)
    }
    
    override fun onNewIntent(intent: Intent?) {
        super.onNewIntent(intent)
        intent?.let { handleDeepLink(it) }
    }
    
    private fun handleDeepLink(intent: Intent) {
        intent.data?.let { uri ->
            // Extract session code from URL like /mobile/capture/123456
            val pathSegments = uri.pathSegments
            if (pathSegments.size >= 3 && pathSegments[0] == "mobile" && pathSegments[1] == "capture") {
                val code = pathSegments[2]
                binding.sessionCodeInput.setText(code)
                FrameReaderApp.sessionCode = code
                connectToSession()
            }
        }
    }
    
    private fun setupUI() {
        // Session code input
        binding.connectButton.setOnClickListener {
            val code = binding.sessionCodeInput.text.toString().trim()
            if (code.length == 6) {
                FrameReaderApp.sessionCode = code
                connectToSession()
            } else {
                Toast.makeText(this, "Enter 6-digit session code", Toast.LENGTH_SHORT).show()
            }
        }
        
        // Scroll distance slider
        binding.scrollSlider.apply {
            progress = FrameReaderApp.scrollDistancePercent - 50
            setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
                override fun onProgressChanged(seekBar: SeekBar?, progress: Int, fromUser: Boolean) {
                    FrameReaderApp.scrollDistancePercent = progress + 50
                    updateScrollLabel()
                }
                override fun onStartTrackingTouch(seekBar: SeekBar?) {}
                override fun onStopTrackingTouch(seekBar: SeekBar?) {}
            })
        }
        
        // Interval slider
        binding.intervalSlider.apply {
            progress = ((FrameReaderApp.captureIntervalMs - 500) / 100).toInt()
            setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
                override fun onProgressChanged(seekBar: SeekBar?, progress: Int, fromUser: Boolean) {
                    FrameReaderApp.captureIntervalMs = (progress * 100 + 500).toLong()
                    updateIntervalLabel()
                }
                override fun onStartTrackingTouch(seekBar: SeekBar?) {}
                override fun onStopTrackingTouch(seekBar: SeekBar?) {}
            })
        }
        
        // Total captures slider
        binding.capturesSlider.apply {
            progress = (FrameReaderApp.totalCaptures - 5) / 5
            setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
                override fun onProgressChanged(seekBar: SeekBar?, progress: Int, fromUser: Boolean) {
                    FrameReaderApp.totalCaptures = progress * 5 + 5
                    updateCapturesLabel()
                }
                override fun onStartTrackingTouch(seekBar: SeekBar?) {}
                override fun onStopTrackingTouch(seekBar: SeekBar?) {}
            })
        }
        
        // Start/Stop button
        binding.startButton.setOnClickListener {
            if (isCapturing) {
                stopCapture()
            } else {
                checkPermissionsAndStart()
            }
        }
        
        updateAllLabels()
    }
    
    private fun detectScreenSize() {
        val metrics = DisplayMetrics()
        windowManager.defaultDisplay.getRealMetrics(metrics)
        
        val width = metrics.widthPixels
        val height = metrics.heightPixels
        val density = metrics.density
        
        binding.screenInfoText.text = "Screen: ${width} × ${height}px (${density}x)"
        
        // Calculate scroll pixels
        updateScrollLabel()
    }
    
    private fun updateAllLabels() {
        updateScrollLabel()
        updateIntervalLabel()
        updateCapturesLabel()
    }
    
    private fun updateScrollLabel() {
        val metrics = DisplayMetrics()
        windowManager.defaultDisplay.getRealMetrics(metrics)
        val scrollPx = (metrics.heightPixels * FrameReaderApp.scrollDistancePercent / 100)
        binding.scrollLabel.text = "Scroll: ${FrameReaderApp.scrollDistancePercent}% (${scrollPx}px)"
    }
    
    private fun updateIntervalLabel() {
        binding.intervalLabel.text = "Interval: ${FrameReaderApp.captureIntervalMs / 1000.0}s"
    }
    
    private fun updateCapturesLabel() {
        binding.capturesLabel.text = "Captures: ${FrameReaderApp.totalCaptures}"
    }
    
    private fun connectToSession() {
        scope.launch {
            try {
                binding.statusText.text = "Connecting..."
                binding.statusText.setTextColor(ContextCompat.getColor(this@MainActivity, android.R.color.holo_orange_light))
                
                val metrics = DisplayMetrics()
                windowManager.defaultDisplay.getRealMetrics(metrics)
                
                val deviceInfo = JSONObject().apply {
                    put("userAgent", "FrameReader-Android-App")
                    put("screenWidth", metrics.widthPixels)
                    put("screenHeight", metrics.heightPixels)
                    put("pixelRatio", metrics.density)
                    put("platform", "Android ${Build.VERSION.RELEASE}")
                    put("model", Build.MODEL)
                }
                
                val request = Request.Builder()
                    .url("${FrameReaderApp.apiUrl}/mobile/connect/${FrameReaderApp.sessionCode}")
                    .post(deviceInfo.toString().toRequestBody("application/json".toMediaType()))
                    .build()
                
                withContext(Dispatchers.IO) {
                    client.newCall(request).execute().use { response ->
                        if (response.isSuccessful) {
                            runOnUiThread {
                                binding.statusText.text = "Connected ✓"
                                binding.statusText.setTextColor(ContextCompat.getColor(this@MainActivity, android.R.color.holo_green_light))
                                binding.startButton.isEnabled = true
                            }
                        } else {
                            runOnUiThread {
                                binding.statusText.text = "Connection failed"
                                binding.statusText.setTextColor(ContextCompat.getColor(this@MainActivity, android.R.color.holo_red_light))
                            }
                        }
                    }
                }
            } catch (e: Exception) {
                binding.statusText.text = "Error: ${e.message}"
                binding.statusText.setTextColor(ContextCompat.getColor(this@MainActivity, android.R.color.holo_red_light))
            }
        }
    }
    
    private fun checkPermissionsAndStart() {
        // Check overlay permission
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !Settings.canDrawOverlays(this)) {
            val intent = Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:$packageName"))
            startActivityForResult(intent, REQUEST_CODE_OVERLAY)
            return
        }
        
        // Request screen capture permission
        val projectionManager = getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        startActivityForResult(projectionManager.createScreenCaptureIntent(), REQUEST_CODE_SCREEN_CAPTURE)
    }
    
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        
        when (requestCode) {
            REQUEST_CODE_SCREEN_CAPTURE -> {
                if (resultCode == Activity.RESULT_OK && data != null) {
                    startCapture(resultCode, data)
                } else {
                    Toast.makeText(this, "Screen capture permission denied", Toast.LENGTH_SHORT).show()
                }
            }
            REQUEST_CODE_OVERLAY -> {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && Settings.canDrawOverlays(this)) {
                    checkPermissionsAndStart()
                }
            }
        }
    }
    
    private fun startCapture(resultCode: Int, data: Intent) {
        isCapturing = true
        binding.startButton.text = "STOP CAPTURE"
        binding.startButton.setBackgroundColor(ContextCompat.getColor(this, android.R.color.holo_red_dark))
        binding.progressBar.visibility = View.VISIBLE
        binding.progressBar.max = FrameReaderApp.totalCaptures
        binding.progressBar.progress = 0
        
        // Start capture service
        val serviceIntent = Intent(this, CaptureService::class.java).apply {
            putExtra("resultCode", resultCode)
            putExtra("data", data)
        }
        
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            startForegroundService(serviceIntent)
        } else {
            startService(serviceIntent)
        }
        
        // Start auto-scroll service
        if (isAccessibilityServiceEnabled()) {
            startAutoScrollCapture()
        } else {
            Toast.makeText(this, "Enable Accessibility Service for auto-scroll", Toast.LENGTH_LONG).show()
            openAccessibilitySettings()
        }
    }
    
    private fun startAutoScrollCapture() {
        captureJob = scope.launch {
            val metrics = DisplayMetrics()
            windowManager.defaultDisplay.getRealMetrics(metrics)
            val scrollPx = (metrics.heightPixels * FrameReaderApp.scrollDistancePercent / 100)
            
            for (i in 1..FrameReaderApp.totalCaptures) {
                if (!isCapturing) break
                
                // Trigger screenshot via service
                sendBroadcast(Intent("com.framereader.CAPTURE_FRAME").apply {
                    putExtra("frameIndex", i)
                    putExtra("scrollPosition", i * scrollPx)
                })
                
                binding.progressBar.progress = i
                binding.statusText.text = "Capturing $i/${FrameReaderApp.totalCaptures}"
                
                delay(200) // Wait for screenshot
                
                // Trigger scroll via accessibility service
                sendBroadcast(Intent("com.framereader.SCROLL").apply {
                    putExtra("scrollPx", scrollPx)
                })
                
                delay(FrameReaderApp.captureIntervalMs)
            }
            
            // Complete capture
            completeCapture()
        }
    }
    
    private fun stopCapture() {
        isCapturing = false
        captureJob?.cancel()
        
        stopService(Intent(this, CaptureService::class.java))
        
        binding.startButton.text = "START CAPTURE"
        binding.startButton.setBackgroundColor(ContextCompat.getColor(this, android.R.color.holo_green_dark))
        binding.progressBar.visibility = View.GONE
        binding.statusText.text = "Stopped"
    }
    
    private fun completeCapture() {
        scope.launch {
            try {
                val request = Request.Builder()
                    .url("${FrameReaderApp.apiUrl}/mobile/complete-capture/${FrameReaderApp.sessionCode}")
                    .post("{}".toRequestBody("application/json".toMediaType()))
                    .build()
                
                withContext(Dispatchers.IO) {
                    client.newCall(request).execute()
                }
                
                runOnUiThread {
                    Toast.makeText(this@MainActivity, "Capture complete! Processing...", Toast.LENGTH_LONG).show()
                    stopCapture()
                    binding.statusText.text = "Complete ✓"
                    binding.statusText.setTextColor(ContextCompat.getColor(this@MainActivity, android.R.color.holo_green_light))
                }
            } catch (e: Exception) {
                runOnUiThread {
                    Toast.makeText(this@MainActivity, "Upload failed: ${e.message}", Toast.LENGTH_SHORT).show()
                }
            }
        }
    }
    
    private fun isAccessibilityServiceEnabled(): Boolean {
        val accessibilityEnabled = Settings.Secure.getInt(
            contentResolver,
            Settings.Secure.ACCESSIBILITY_ENABLED, 0
        )
        if (accessibilityEnabled != 1) return false
        
        val enabledServices = Settings.Secure.getString(
            contentResolver,
            Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES
        ) ?: return false
        
        return enabledServices.contains(packageName)
    }
    
    private fun openAccessibilitySettings() {
        startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
    }
    
    override fun onDestroy() {
        super.onDestroy()
        scope.cancel()
    }
}
