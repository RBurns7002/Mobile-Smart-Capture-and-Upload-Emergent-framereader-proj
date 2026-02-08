package com.framereader.capture

import android.app.*
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
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
import android.util.DisplayMetrics
import android.view.WindowManager
import androidx.core.app.NotificationCompat
import kotlinx.coroutines.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.util.concurrent.TimeUnit

class CaptureService : Service() {
    
    private var mediaProjection: MediaProjection? = null
    private var virtualDisplay: VirtualDisplay? = null
    private var imageReader: ImageReader? = null
    
    private val client = OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .writeTimeout(60, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .build()
    
    private val scope = CoroutineScope(Dispatchers.IO + Job())
    
    private val captureReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            when (intent?.action) {
                "com.framereader.CAPTURE_FRAME" -> {
                    val frameIndex = intent.getIntExtra("frameIndex", 0)
                    val scrollPosition = intent.getIntExtra("scrollPosition", 0)
                    captureAndUpload(frameIndex, scrollPosition)
                }
            }
        }
    }
    
    override fun onCreate() {
        super.onCreate()
        
        val filter = IntentFilter().apply {
            addAction("com.framereader.CAPTURE_FRAME")
        }
        
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(captureReceiver, filter, RECEIVER_NOT_EXPORTED)
        } else {
            registerReceiver(captureReceiver, filter)
        }
    }
    
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        startForeground(1, createNotification())
        
        val resultCode = intent?.getIntExtra("resultCode", Activity.RESULT_CANCELED) ?: return START_NOT_STICKY
        val data = intent.getParcelableExtra<Intent>("data") ?: return START_NOT_STICKY
        
        setupMediaProjection(resultCode, data)
        
        return START_STICKY
    }
    
    private fun createNotification(): Notification {
        val pendingIntent = PendingIntent.getActivity(
            this, 0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE
        )
        
        return NotificationCompat.Builder(this, FrameReaderApp.CHANNEL_ID)
            .setContentTitle("FrameReader Capture")
            .setContentText("Screen capture in progress...")
            .setSmallIcon(android.R.drawable.ic_menu_camera)
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .build()
    }
    
    private fun setupMediaProjection(resultCode: Int, data: Intent) {
        val projectionManager = getSystemService(MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        mediaProjection = projectionManager.getMediaProjection(resultCode, data)
        
        // Use stored screen dimensions (already detected in MainActivity)
        val width = FrameReaderApp.screenWidth
        val height = FrameReaderApp.screenHeight
        val density = resources.displayMetrics.densityDpi
        
        // Samsung optimization: Use lower density for smaller file sizes
        // S25 has high DPI (450+), we can reduce to 320 for efficiency
        val captureDensity = minOf(density, 320)
        
        imageReader = ImageReader.newInstance(width, height, PixelFormat.RGBA_8888, 2)
        
        virtualDisplay = mediaProjection?.createVirtualDisplay(
            "FrameReader",
            width, height, captureDensity,
            DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
            imageReader?.surface, null, null
        )
    }
    
    private fun captureAndUpload(frameIndex: Int, scrollPosition: Int) {
        scope.launch {
            try {
                val image = imageReader?.acquireLatestImage() ?: return@launch
                val bitmap = imageToBitmap(image)
                image.close()
                
                val base64 = bitmapToBase64(bitmap)
                bitmap.recycle()
                
                uploadFrame(frameIndex, scrollPosition, base64)
            } catch (e: Exception) {
                e.printStackTrace()
            }
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
        
        // Crop to actual size
        return Bitmap.createBitmap(bitmap, 0, 0, image.width, image.height)
    }
    
    private fun bitmapToBase64(bitmap: Bitmap): String {
        val outputStream = ByteArrayOutputStream()
        // Samsung S25 optimization: Use 70% quality for smaller uploads
        // Still high enough for OCR accuracy
        bitmap.compress(Bitmap.CompressFormat.JPEG, 70, outputStream)
        return Base64.encodeToString(outputStream.toByteArray(), Base64.NO_WRAP)
    }
    
    private suspend fun uploadFrame(frameIndex: Int, scrollPosition: Int, base64: String) {
        withContext(Dispatchers.IO) {
            try {
                val frameData = JSONArray().put(JSONObject().apply {
                    put("frame_index", frameIndex)
                    put("scroll_position", scrollPosition)
                    put("timestamp", System.currentTimeMillis())
                    put("image_base64", base64)
                })
                
                val request = Request.Builder()
                    .url("${FrameReaderApp.apiUrl}/mobile/upload-batch/${FrameReaderApp.sessionCode}")
                    .post(frameData.toString().toRequestBody("application/json".toMediaType()))
                    .build()
                
                client.newCall(request).execute().use { response ->
                    if (!response.isSuccessful) {
                        throw Exception("Upload failed: ${response.code}")
                    }
                }
            } catch (e: Exception) {
                e.printStackTrace()
            }
        }
    }
    
    override fun onBind(intent: Intent?): IBinder? = null
    
    override fun onDestroy() {
        super.onDestroy()
        scope.cancel()
        virtualDisplay?.release()
        imageReader?.close()
        mediaProjection?.stop()
        
        try {
            unregisterReceiver(captureReceiver)
        } catch (e: Exception) {
            // Receiver not registered
        }
    }
}
