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
import android.os.IBinder
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

    private val client = OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .writeTimeout(60, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .build()

    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

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

        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                startForeground(NOTIFICATION_ID, createNotification("Starting capture..."),
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION)
            } else {
                startForeground(NOTIFICATION_ID, createNotification("Starting capture..."))
            }
        } catch (e: Exception) {
            Log.e(TAG, "Failed to start foreground: ${e.message}", e)
            lastError = "Foreground service failed: ${e.message}"
            stopSelf()
            return START_NOT_STICKY
        }

        val resultCode = intent?.getIntExtra("resultCode", Activity.RESULT_CANCELED)
            ?: return START_NOT_STICKY

        val data: Intent? = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            intent.getParcelableExtra("data", Intent::class.java)
        } else {
            @Suppress("DEPRECATION")
            intent.getParcelableExtra("data")
        }
        if (data == null) {
            Log.e(TAG, "No projection data received")
            stopSelf()
            return START_NOT_STICKY
        }

        val intervalMs = intent.getLongExtra("intervalMs", 2000L)
        val totalCaptures = intent.getIntExtra("totalCaptures", 10)
        val sessionCode = intent.getStringExtra("sessionCode") ?: ""
        val apiUrl = intent.getStringExtra("apiUrl") ?: ""

        Log.d(TAG, "Starting capture: interval=${intervalMs}ms, total=$totalCaptures, session=$sessionCode")

        if (!setupMediaProjection(resultCode, data)) {
            stopSelf()
            return START_NOT_STICKY
        }

        startCaptureLoop(intervalMs, totalCaptures, sessionCode, apiUrl)

        return START_STICKY
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
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.notify(NOTIFICATION_ID, createNotification(text))
    }

    private fun setupMediaProjection(resultCode: Int, data: Intent): Boolean {
        return try {
            val projectionManager = getSystemService(MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
            mediaProjection = projectionManager.getMediaProjection(resultCode, data)

            if (mediaProjection == null) {
                Log.e(TAG, "MediaProjection is null")
                lastError = "Screen capture permission not granted"
                return false
            }

            val width = FrameReaderApp.screenWidth
            val height = FrameReaderApp.screenHeight
            val density = resources.displayMetrics.densityDpi
            val captureDensity = minOf(density, 320)

            Log.d(TAG, "Setting up virtual display: ${width}x${height} @ $captureDensity dpi")

            imageReader = ImageReader.newInstance(width, height, PixelFormat.RGBA_8888, 2)

            virtualDisplay = mediaProjection?.createVirtualDisplay(
                "FrameReader",
                width, height, captureDensity,
                DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
                imageReader?.surface, null, null
            )

            Log.d(TAG, "Virtual display created successfully")
            true
        } catch (e: Exception) {
            Log.e(TAG, "setupMediaProjection failed: ${e.message}", e)
            lastError = "Capture setup failed: ${e.message}"
            false
        }
    }

    private fun startCaptureLoop(intervalMs: Long, totalCaptures: Int, sessionCode: String, apiUrl: String) {
        isRunning = true
        capturedCount = 0
        totalToCapture = totalCaptures
        lastError = null

        captureJob = scope.launch {
            // Initial delay to let user switch to target app
            Log.d(TAG, "Waiting 3s for user to switch apps...")
            updateNotification("Switch to your target app now! Starting in 3s...")
            delay(3000)

            for (i in 1..totalCaptures) {
                if (!isActive) break

                Log.d(TAG, "Capturing frame $i/$totalCaptures")
                updateNotification("Capturing $i/$totalCaptures - scroll now")

                try {
                    val bitmap = captureScreen()
                    if (bitmap != null) {
                        capturedCount = i
                        val base64 = bitmapToBase64(bitmap)
                        bitmap.recycle()

                        if (sessionCode.isNotEmpty() && apiUrl.isNotEmpty()) {
                            uploadFrame(apiUrl, sessionCode, i, base64)
                        }

                        Log.d(TAG, "Frame $i captured and uploaded")
                    } else {
                        Log.w(TAG, "Frame $i: null bitmap")
                    }
                } catch (e: Exception) {
                    Log.e(TAG, "Frame $i capture error: ${e.message}", e)
                }

                if (i < totalCaptures) {
                    delay(intervalMs)
                }
            }

            // Complete
            Log.d(TAG, "Capture complete: $capturedCount/$totalCaptures frames")
            updateNotification("Done! $capturedCount/$totalCaptures frames captured")

            if (sessionCode.isNotEmpty() && apiUrl.isNotEmpty()) {
                completeSession(apiUrl, sessionCode)
            }

            // Notify MainActivity
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
        // Allow the ImageReader buffer to fill
        Thread.sleep(200)

        val image = imageReader?.acquireLatestImage() ?: return null
        return try {
            imageToBitmap(image)
        } finally {
            image.close()
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
                    Log.d(TAG, "Complete session response: ${response.code}")
                }
            } catch (e: Exception) {
                Log.e(TAG, "Complete session error: ${e.message}", e)
            }
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        super.onDestroy()
        Log.d(TAG, "CaptureService destroying")
        isRunning = false
        captureJob?.cancel()
        scope.cancel()
        virtualDisplay?.release()
        imageReader?.close()
        mediaProjection?.stop()
    }
}
