package com.framereader.capture

import android.Manifest
import android.app.Activity
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.util.DisplayMetrics
import android.util.Log
import android.view.View
import android.view.WindowManager
import android.widget.SeekBar
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
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

    private var deviceRefreshRate = 60f
    private var autoScrollEnabled = false

    companion object {
        private const val TAG = "FrameReader"
        private const val REQUEST_CODE_SCREEN_CAPTURE = 1001
        private const val REQUEST_CODE_NOTIFICATIONS = 1004
    }

    private val captureCompleteReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            if (intent?.action == "com.framereader.CAPTURE_COMPLETE") {
                val count = intent.getIntExtra("capturedCount", 0)
                val total = intent.getIntExtra("totalCaptures", 0)
                onCaptureComplete(count, total)
            }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        try {
            binding = ActivityMainBinding.inflate(layoutInflater)
            setContentView(binding.root)

            window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                deviceRefreshRate = display?.refreshRate ?: 60f
            }

            requestNotificationPermission()
            setupUI()
            detectScreenSize()
            handleDeepLink(intent)
            registerCaptureReceiver()

            Log.d(TAG, "App started successfully")
        } catch (e: Exception) {
            Log.e(TAG, "Error in onCreate: ${e.message}", e)
            Toast.makeText(this, "Error starting app: ${e.message}", Toast.LENGTH_LONG).show()
        }
    }

    override fun onResume() {
        super.onResume()
        updateAutoScrollStatus()

        // Check if capture finished while in background
        if (!CaptureService.isRunning && binding.startButton.text == "STOP CAPTURE") {
            val count = CaptureService.capturedCount
            val total = CaptureService.totalToCapture
            if (count > 0) {
                onCaptureComplete(count, total)
            } else {
                val error = CaptureService.lastError
                if (error != null) {
                    binding.statusText.text = "Error: $error"
                    binding.statusText.setTextColor(ContextCompat.getColor(this, android.R.color.holo_red_light))
                }
                resetUI()
            }
        }
    }

    private fun registerCaptureReceiver() {
        val filter = IntentFilter("com.framereader.CAPTURE_COMPLETE")
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(captureCompleteReceiver, filter, RECEIVER_NOT_EXPORTED)
        } else {
            registerReceiver(captureCompleteReceiver, filter)
        }
    }

    private fun requestNotificationPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED) {
                ActivityCompat.requestPermissions(
                    this, arrayOf(Manifest.permission.POST_NOTIFICATIONS), REQUEST_CODE_NOTIFICATIONS
                )
            }
        }
    }

    override fun onNewIntent(intent: Intent?) {
        super.onNewIntent(intent)
        intent?.let { handleDeepLink(it) }
    }

    private fun handleDeepLink(intent: Intent) {
        intent.data?.let { uri ->
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
        binding.connectButton.setOnClickListener {
            val code = binding.sessionCodeInput.text.toString().trim()
            if (code.length == 6) {
                FrameReaderApp.sessionCode = code
                connectToSession()
            } else {
                Toast.makeText(this, "Enter 6-digit session code", Toast.LENGTH_SHORT).show()
            }
        }

        // Auto-scroll toggle
        binding.autoScrollSwitch.setOnCheckedChangeListener { _, isChecked ->
            if (isChecked && !isAccessibilityServiceEnabled()) {
                binding.autoScrollSwitch.isChecked = false
                showAccessibilitySetupDialog()
            } else {
                autoScrollEnabled = isChecked
                binding.scrollLabel.text = if (isChecked) {
                    val scrollPx = (FrameReaderApp.screenHeight * FrameReaderApp.scrollDistancePercent / 100)
                    "Auto-scroll: ${FrameReaderApp.scrollDistancePercent}% (${scrollPx}px)"
                } else {
                    "Scroll: manual"
                }
            }
        }

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

        binding.startButton.setOnClickListener {
            if (CaptureService.isRunning) {
                stopCapture()
            } else {
                startCaptureFlow()
            }
        }

        updateAllLabels()
    }

    private fun updateAutoScrollStatus() {
        val enabled = isAccessibilityServiceEnabled()
        if (autoScrollEnabled && !enabled) {
            autoScrollEnabled = false
            binding.autoScrollSwitch.isChecked = false
        }
        binding.autoScrollStatus.text = if (enabled) "Service: ON" else "Service: OFF"
        binding.autoScrollStatus.setTextColor(
            ContextCompat.getColor(this, if (enabled) android.R.color.holo_green_light else android.R.color.holo_red_light)
        )
    }

    private fun showAccessibilitySetupDialog() {
        AlertDialog.Builder(this, android.R.style.Theme_DeviceDefault_Dialog_Alert)
            .setTitle("Enable Auto-Scroll")
            .setMessage(
                "To auto-scroll in other apps, FrameReader needs the Accessibility Service enabled.\n\n" +
                "Steps:\n" +
                "1. Tap 'Open Settings' below\n" +
                "2. Find 'FrameReader' in the list\n" +
                "3. Toggle it ON\n" +
                "4. Confirm the permission\n" +
                "5. Come back to this app"
            )
            .setPositiveButton("Open Settings") { _, _ ->
                startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
            }
            .setNegativeButton("Cancel", null)
            .show()
    }

    private fun detectScreenSize() {
        try {
            val wm = getSystemService(WINDOW_SERVICE) as WindowManager
            val bounds = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                wm.currentWindowMetrics.bounds
            } else {
                val metrics = DisplayMetrics()
                @Suppress("DEPRECATION")
                wm.defaultDisplay.getRealMetrics(metrics)
                android.graphics.Rect(0, 0, metrics.widthPixels, metrics.heightPixels)
            }

            FrameReaderApp.screenWidth = bounds.width()
            FrameReaderApp.screenHeight = bounds.height()
            val isSamsung = Build.MANUFACTURER.equals("samsung", ignoreCase = true)

            val screenInfo = buildString {
                append("${bounds.width()} x ${bounds.height()}px")
                if (isSamsung) append(" | Samsung")
                if (deviceRefreshRate > 60) append(" | ${deviceRefreshRate.toInt()}Hz")
            }
            binding.screenInfoText.text = screenInfo
            updateScrollLabel()
        } catch (e: Exception) {
            Log.e(TAG, "Screen detect error: ${e.message}", e)
            binding.screenInfoText.text = "Screen: unknown"
        }
    }

    private fun updateAllLabels() {
        updateScrollLabel()
        updateIntervalLabel()
        updateCapturesLabel()
    }

    private fun updateScrollLabel() {
        val scrollPx = (FrameReaderApp.screenHeight * FrameReaderApp.scrollDistancePercent / 100)
        binding.scrollLabel.text = if (autoScrollEnabled) {
            "Auto-scroll: ${FrameReaderApp.scrollDistancePercent}% (${scrollPx}px)"
        } else {
            "Scroll distance: ${FrameReaderApp.scrollDistancePercent}% (${scrollPx}px)"
        }
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

                val deviceInfo = JSONObject().apply {
                    put("userAgent", "FrameReader-Android-App")
                    put("screenWidth", FrameReaderApp.screenWidth)
                    put("screenHeight", FrameReaderApp.screenHeight)
                    put("pixelRatio", resources.displayMetrics.density)
                    put("platform", "Android ${Build.VERSION.RELEASE}")
                    put("model", Build.MODEL)
                    put("manufacturer", Build.MANUFACTURER)
                    put("refreshRate", deviceRefreshRate)
                }

                val request = Request.Builder()
                    .url("${FrameReaderApp.apiUrl}/mobile/connect/${FrameReaderApp.sessionCode}")
                    .post(deviceInfo.toString().toRequestBody("application/json".toMediaType()))
                    .build()

                withContext(Dispatchers.IO) {
                    client.newCall(request).execute().use { response ->
                        if (response.isSuccessful) {
                            runOnUiThread {
                                binding.statusText.text = "Connected"
                                binding.statusText.setTextColor(ContextCompat.getColor(this@MainActivity, android.R.color.holo_green_light))
                                binding.startButton.isEnabled = true
                            }
                        } else {
                            runOnUiThread {
                                binding.statusText.text = "Failed (${response.code})"
                                binding.statusText.setTextColor(ContextCompat.getColor(this@MainActivity, android.R.color.holo_red_light))
                            }
                        }
                    }
                }
            } catch (e: Exception) {
                Log.e(TAG, "Connect error: ${e.message}", e)
                binding.statusText.text = "Error: ${e.message}"
                binding.statusText.setTextColor(ContextCompat.getColor(this@MainActivity, android.R.color.holo_red_light))
            }
        }
    }

    private fun startCaptureFlow() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED) {
                ActivityCompat.requestPermissions(
                    this, arrayOf(Manifest.permission.POST_NOTIFICATIONS), REQUEST_CODE_NOTIFICATIONS
                )
                Toast.makeText(this, "Notification permission needed", Toast.LENGTH_SHORT).show()
                return
            }
        }

        // Verify auto-scroll service if enabled
        if (autoScrollEnabled && AutoScrollService.instance == null) {
            autoScrollEnabled = false
            binding.autoScrollSwitch.isChecked = false
            Toast.makeText(this, "Accessibility service not running. Capturing without auto-scroll.", Toast.LENGTH_LONG).show()
        }

        val projectionManager = getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        startActivityForResult(projectionManager.createScreenCaptureIntent(), REQUEST_CODE_SCREEN_CAPTURE)
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == REQUEST_CODE_NOTIFICATIONS) {
            Log.d(TAG, "Notification permission: ${grantResults.firstOrNull()}")
        }
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == REQUEST_CODE_SCREEN_CAPTURE) {
            if (resultCode == Activity.RESULT_OK && data != null) {
                launchCaptureService(resultCode, data)
            } else {
                Toast.makeText(this, "Screen capture permission denied", Toast.LENGTH_SHORT).show()
            }
        }
    }

    private fun launchCaptureService(resultCode: Int, data: Intent) {
        binding.startButton.text = "STOP CAPTURE"
        binding.startButton.setBackgroundColor(ContextCompat.getColor(this, android.R.color.holo_red_dark))
        binding.progressBar.visibility = View.VISIBLE
        binding.progressBar.max = FrameReaderApp.totalCaptures
        binding.progressBar.progress = 0

        val mode = if (autoScrollEnabled) "auto-scroll + capture" else "capture (manual scroll)"
        binding.statusText.text = "Starting $mode..."
        binding.statusText.setTextColor(ContextCompat.getColor(this, android.R.color.holo_orange_light))

        val serviceIntent = Intent(this, CaptureService::class.java).apply {
            putExtra("resultCode", resultCode)
            putExtra("data", data)
            putExtra("intervalMs", FrameReaderApp.captureIntervalMs)
            putExtra("totalCaptures", FrameReaderApp.totalCaptures)
            putExtra("sessionCode", FrameReaderApp.sessionCode)
            putExtra("apiUrl", FrameReaderApp.apiUrl)
            putExtra("scrollPercent", FrameReaderApp.scrollDistancePercent)
            putExtra("autoScroll", autoScrollEnabled)
        }

        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                startForegroundService(serviceIntent)
            } else {
                startService(serviceIntent)
            }
            startProgressPolling()
        } catch (e: Exception) {
            Log.e(TAG, "Service start failed: ${e.message}", e)
            Toast.makeText(this, "Failed: ${e.message}", Toast.LENGTH_LONG).show()
            resetUI()
        }
    }

    private fun startProgressPolling() {
        scope.launch {
            while (CaptureService.isRunning) {
                binding.progressBar.progress = CaptureService.capturedCount
                val mode = if (autoScrollEnabled) "auto" else "scroll manually"
                binding.statusText.text = "${CaptureService.capturedCount}/${CaptureService.totalToCapture} ($mode)"
                delay(500)
            }
        }
    }

    private fun onCaptureComplete(count: Int, total: Int) {
        binding.progressBar.progress = count
        binding.statusText.text = "Done! $count/$total frames captured"
        binding.statusText.setTextColor(ContextCompat.getColor(this, android.R.color.holo_green_light))
        resetUI()
        Toast.makeText(this, "Capture complete! $count frames uploaded.", Toast.LENGTH_LONG).show()
    }

    private fun stopCapture() {
        stopService(Intent(this, CaptureService::class.java))
        binding.statusText.text = "Stopped"
        resetUI()
    }

    private fun resetUI() {
        binding.startButton.text = "START CAPTURE"
        binding.startButton.setBackgroundColor(ContextCompat.getColor(this, android.R.color.holo_green_dark))
        binding.progressBar.visibility = View.GONE
    }

    private fun isAccessibilityServiceEnabled(): Boolean {
        val enabledServices = Settings.Secure.getString(
            contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES
        ) ?: return false
        return enabledServices.contains("${packageName}/${AutoScrollService::class.java.canonicalName}")
    }

    override fun onDestroy() {
        super.onDestroy()
        try { unregisterReceiver(captureCompleteReceiver) } catch (_: Exception) {}
        scope.cancel()
    }
}
