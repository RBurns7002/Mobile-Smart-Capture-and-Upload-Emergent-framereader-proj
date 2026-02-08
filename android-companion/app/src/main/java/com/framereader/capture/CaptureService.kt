package com.framereader.capture

import android.app.*
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.Bitmap
import android.graphics.PixelFormat
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.Image
import android.media.ImageReader
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.util.Base64
import android.util.Log
import androidx.core.app.NotificationCompat
import kotlinx.coroutines.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.util.concurrent.TimeUnit

class CaptureService : Service() {

    private var mediaProjection: MediaProjection? = null
    private var virtualDisplay: VirtualDisplay? = null
    private var imageReader: ImageReader? = null
    private var captureJob: Job? = null
    private val handler = Handler(Looper.getMainLooper())

    private val client = OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .writeTimeout(60, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .build()

    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    // Callback required by Android 14+ before createVirtualDisplay
    private val projectionCallback = object : MediaProjection.Callback() {
        override fun onStop() {
            Log.d(TAG, "MediaProjection stopped by system")
            cleanupProjection()
            isRunning = false
            stopSelf()
        }
    }

    companion object {
        private const val TAG = "FrameReaderCapture"
        private const val NOTIFICATION_ID = 1

        var isRunning = false
            private set
        var capturedCount = 0
            private set
        var totalToCapture = 0
            private set
        var lastError: String? = null
            private set
    }

    override fun onCreate() {
        super.onCreate()
        Log.d(TAG, "CaptureService created")
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        Log.d(TAG, "onStartCommand called")

        // Start foreground FIRST (required before any projection work)
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                startForeground(NOTIFICATION_ID, createNotification("Preparing capture..."),
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION)
            } else {
                startForeground(NOTIFICATION_ID, createNotification("Preparing capture..."))
            }
            Log.d(TAG, "Foreground service started")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to start foreground: ${e.message}", e)
            lastError = "Foreground service failed: ${e.message}"
            stopSelf()
            return START_NOT_STICKY
        }

        val resultCode = intent?.getIntExtra("resultCode", Activity.RESULT_CANCELED)
            ?: run { stopSelf(); return START_NOT_STICKY }

        val data: Intent? = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            intent.getParcelableExtra("data", Intent::class.java)
        } else {
            @Suppress("DEPRECATION")
            intent.getParcelableExtra("data")
        }
        if (data == null) {
            Log.e(TAG, "No projection data")
            lastError = "No projection data received"
            stopSelf()
            return START_NOT_STICKY
        }

        val intervalMs = intent.getLongExtra("intervalMs", 2000L)
        val totalCaptures = intent.getIntExtra("totalCaptures", 10)
        val sessionCode = intent.getStringExtra("sessionCode") ?: ""
        val apiUrl = intent.getStringExtra("apiUrl") ?: ""
        val scrollPercent = intent.getIntExtra("scrollPercent", 80)
        val autoScroll = intent.getBooleanExtra("autoScroll", false)

        Log.d(TAG, "Config: interval=${intervalMs}ms, total=$totalCaptures, scroll=${scrollPercent}%, autoScroll=$autoScroll, session=$sessionCode")

        try {
            setupProjection(resultCode, data)
            startCaptureLoop(intervalMs, totalCaptures, sessionCode, apiUrl, scrollPercent, autoScroll)
        } catch (e: Exception) {
            Log.e(TAG, "Setup failed: ${e.message}", e)
            lastError = "Setup failed: ${e.message}"
            stopSelf()
        }

        return START_NOT_STICKY
    }

    private fun createNotification(text: String): Notification {
        val pendingIntent = PendingIntent.getActivity(
            this, 0,
            Intent(this, MainActivity::class.java).apply {
                addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
            },
            PendingIntent.FLAG_IMMUTABLE
        )

        return NotificationCompat.Builder(this, FrameReaderApp.CHANNEL_ID)
            .setContentTitle("FrameReader")
            .setContentText(text)
            .setSmallIcon(android.R.drawable.ic_menu_camera)
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .setSilent(true)
            .build()
    }

    private fun updateNotification(text: String) {
        try {
            val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            nm.notify(NOTIFICATION_ID, createNotification(text))
        } catch (e: Exception) {
            Log.w(TAG, "Failed to update notification: ${e.message}")
        }
    }

    private fun setupProjection(resultCode: Int, data: Intent) {
        val projectionManager = getSystemService(MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        mediaProjection = projectionManager.getMediaProjection(resultCode, data)
            ?: throw IllegalStateException("Failed to get MediaProjection")

        Log.d(TAG, "MediaProjection obtained")

        // REQUIRED on Android 14+: register callback BEFORE createVirtualDisplay
        mediaProjection!!.registerCallback(projectionCallback, handler)
        Log.d(TAG, "Projection callback registered")

        val width = FrameReaderApp.screenWidth
        val height = FrameReaderApp.screenHeight
        val density = resources.displayMetrics.densityDpi

        Log.d(TAG, "Screen: ${width}x${height} @ ${density}dpi")

        imageReader = ImageReader.newInstance(width, height, PixelFormat.RGBA_8888, 2)
        Log.d(TAG, "ImageReader created")

        virtualDisplay = mediaProjection!!.createVirtualDisplay(
            "FrameReader",
            width, height, density,
            DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
            imageReader!!.surface, null, handler
        )
        Log.d(TAG, "VirtualDisplay created successfully")
    }

    private fun startCaptureLoop(intervalMs: Long, totalCaptures: Int, sessionCode: String, apiUrl: String, scrollPercent: Int, autoScroll: Boolean) {
        isRunning = true
        capturedCount = 0
        totalToCapture = totalCaptures
        lastError = null

        val scroller = if (autoScroll) AutoScrollService.instance else null
        if (autoScroll && scroller == null) {
            Log.w(TAG, "Auto-scroll requested but AccessibilityService not running. Capturing without scroll.")
        }

        captureJob = scope.launch {
            // Give user time to switch to the target app
            updateNotification("Switch to target app! Capture starts in 4s...")
            delay(4000)

            for (i in 1..totalCaptures) {
                if (!isActive || !isRunning) break

                val mode = if (scroller != null) "auto-scrolling" else "scroll manually"
                updateNotification("Frame $i/$totalCaptures - $mode")
                Log.d(TAG, "Capturing frame $i/$totalCaptures")

                // Capture the current screen
                var bitmap: Bitmap? = null
                for (attempt in 1..3) {
                    delay(300)
                    bitmap = captureScreen()
                    if (bitmap != null) break
                    Log.w(TAG, "Frame $i attempt $attempt: null, retrying...")
                    delay(200)
                }

                if (bitmap != null) {
                    capturedCount = i
                    try {
                        val base64 = bitmapToBase64(bitmap)
                        bitmap.recycle()

                        if (sessionCode.isNotEmpty() && apiUrl.isNotEmpty()) {
                            uploadFrame(apiUrl, sessionCode, i, base64)
                        }
                        Log.d(TAG, "Frame $i captured and uploaded")
                    } catch (e: Exception) {
                        Log.e(TAG, "Frame $i process/upload error: ${e.message}", e)
                        bitmap.recycle()
                    }
                } else {
                    Log.e(TAG, "Frame $i: failed after 3 attempts")
                }

                // Auto-scroll if available, then wait for content to settle
                if (i < totalCaptures && isActive && isRunning) {
                    if (scroller != null) {
                        Log.d(TAG, "Auto-scrolling ${scrollPercent}%...")
                        val scrolled = scroller.performScroll(scrollPercent)
                        if (!scrolled) {
                            Log.w(TAG, "Scroll gesture failed for frame $i")
                        }
                        // Wait for scroll animation to finish + content to render
                        delay(intervalMs.coerceAtLeast(800))
                    } else {
                        delay(intervalMs)
                    }
                }
            }

            Log.d(TAG, "Capture loop done: $capturedCount/$totalCaptures")
            updateNotification("Done! $capturedCount/$totalCaptures frames captured")

            if (sessionCode.isNotEmpty() && apiUrl.isNotEmpty() && capturedCount > 0) {
                completeSession(apiUrl, sessionCode)
            }

            sendBroadcast(Intent("com.framereader.CAPTURE_COMPLETE").apply {
                setPackage(packageName)
                putExtra("capturedCount", capturedCount)
                putExtra("totalCaptures", totalCaptures)
            })

            delay(2000)
            isRunning = false
            stopSelf()
        }
    }

    private fun captureScreen(): Bitmap? {
        return try {
            val image = imageReader?.acquireLatestImage() ?: return null
            val bitmap = imageToBitmap(image)
            image.close()
            bitmap
        } catch (e: Exception) {
            Log.e(TAG, "captureScreen error: ${e.message}", e)
            null
        }
    }

    private fun imageToBitmap(image: Image): Bitmap {
        val planes = image.planes
        val buffer = planes[0].buffer
        val pixelStride = planes[0].pixelStride
        val rowStride = planes[0].rowStride
        val rowPadding = rowStride - pixelStride * image.width

        val bitmap = Bitmap.createBitmap(
            image.width + rowPadding / pixelStride,
            image.height,
            Bitmap.Config.ARGB_8888
        )
        bitmap.copyPixelsFromBuffer(buffer)

        return if (rowPadding > 0) {
            val cropped = Bitmap.createBitmap(bitmap, 0, 0, image.width, image.height)
            bitmap.recycle()
            cropped
        } else {
            bitmap
        }
    }

    private fun bitmapToBase64(bitmap: Bitmap): String {
        val outputStream = ByteArrayOutputStream()
        bitmap.compress(Bitmap.CompressFormat.JPEG, 75, outputStream)
        return Base64.encodeToString(outputStream.toByteArray(), Base64.NO_WRAP)
    }

    private suspend fun uploadFrame(apiUrl: String, sessionCode: String, frameIndex: Int, base64: String) {
        withContext(Dispatchers.IO) {
            try {
                val body = JSONObject().apply {
                    put("frame_index", frameIndex)
                    put("timestamp", System.currentTimeMillis())
                    put("image_base64", base64)
                }

                val request = Request.Builder()
                    .url("$apiUrl/mobile/upload-frame/$sessionCode")
                    .post(body.toString().toRequestBody("application/json".toMediaType()))
                    .build()

                client.newCall(request).execute().use { response ->
                    if (!response.isSuccessful) {
                        Log.w(TAG, "Upload frame $frameIndex failed: ${response.code}")
                    } else {
                        Log.d(TAG, "Upload frame $frameIndex OK")
                    }
                }
            } catch (e: Exception) {
                Log.e(TAG, "Upload error: ${e.message}", e)
            }
        }
    }

    private suspend fun completeSession(apiUrl: String, sessionCode: String) {
        withContext(Dispatchers.IO) {
            try {
                val request = Request.Builder()
                    .url("$apiUrl/mobile/complete-capture/$sessionCode")
                    .post("{}".toRequestBody("application/json".toMediaType()))
                    .build()

                client.newCall(request).execute().use { response ->
                    Log.d(TAG, "Complete session: ${response.code}")
                }
            } catch (e: Exception) {
                Log.e(TAG, "Complete session error: ${e.message}", e)
            }
        }
    }

    private fun cleanupProjection() {
        virtualDisplay?.release()
        virtualDisplay = null
        imageReader?.close()
        imageReader = null
        mediaProjection?.unregisterCallback(projectionCallback)
        mediaProjection?.stop()
        mediaProjection = null
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        super.onDestroy()
        Log.d(TAG, "CaptureService destroying")
        isRunning = false
        captureJob?.cancel()
        scope.cancel()
        cleanupProjection()
    }
}
