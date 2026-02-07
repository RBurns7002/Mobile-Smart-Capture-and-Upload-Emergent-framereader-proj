package com.framereader.capture

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.graphics.Path
import android.os.Build
import android.util.DisplayMetrics
import android.view.WindowManager
import android.view.accessibility.AccessibilityEvent

class AutoScrollService : AccessibilityService() {
    
    private val scrollReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            when (intent?.action) {
                "com.framereader.SCROLL" -> {
                    val scrollPx = intent.getIntExtra("scrollPx", 800)
                    performScroll(scrollPx)
                }
            }
        }
    }
    
    override fun onServiceConnected() {
        super.onServiceConnected()
        
        val filter = IntentFilter().apply {
            addAction("com.framereader.SCROLL")
        }
        
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(scrollReceiver, filter, RECEIVER_NOT_EXPORTED)
        } else {
            registerReceiver(scrollReceiver, filter)
        }
    }
    
    private fun performScroll(scrollPx: Int) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) return
        
        val wm = getSystemService(WINDOW_SERVICE) as WindowManager
        val metrics = DisplayMetrics()
        wm.defaultDisplay.getRealMetrics(metrics)
        
        val screenWidth = metrics.widthPixels
        val screenHeight = metrics.heightPixels
        
        // Calculate swipe coordinates
        val startX = screenWidth / 2f
        val startY = screenHeight * 0.8f
        val endY = startY - scrollPx
        
        val path = Path().apply {
            moveTo(startX, startY)
            lineTo(startX, endY.coerceAtLeast(screenHeight * 0.1f))
        }
        
        val gesture = GestureDescription.Builder()
            .addStroke(GestureDescription.StrokeDescription(path, 0, 300))
            .build()
        
        dispatchGesture(gesture, object : GestureResultCallback() {
            override fun onCompleted(gestureDescription: GestureDescription?) {
                super.onCompleted(gestureDescription)
            }
            
            override fun onCancelled(gestureDescription: GestureDescription?) {
                super.onCancelled(gestureDescription)
            }
        }, null)
    }
    
    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        // Not needed for our use case
    }
    
    override fun onInterrupt() {
        // Handle interruption
    }
    
    override fun onDestroy() {
        super.onDestroy()
        try {
            unregisterReceiver(scrollReceiver)
        } catch (e: Exception) {
            // Receiver not registered
        }
    }
}
