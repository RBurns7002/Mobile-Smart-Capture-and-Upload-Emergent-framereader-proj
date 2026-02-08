package com.framereader.capture

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.graphics.Path
import android.os.Build
import android.util.Log
import android.view.accessibility.AccessibilityEvent
import kotlinx.coroutines.CompletableDeferred

class AutoScrollService : AccessibilityService() {

    companion object {
        private const val TAG = "FrameReaderScroll"

        // Static reference so CaptureService can call scroll directly
        var instance: AutoScrollService? = null
            private set
    }

    override fun onServiceConnected() {
        super.onServiceConnected()
        instance = this
        Log.d(TAG, "AutoScrollService connected")
    }

    /**
     * Perform a scroll gesture and suspend until it completes.
     * Returns true if the gesture was dispatched successfully.
     */
    suspend fun performScroll(scrollPercent: Int): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) return false

        val dm = resources.displayMetrics
        val screenWidth = dm.widthPixels
        val screenHeight = dm.heightPixels

        // Scroll from ~80% down to (80% - scrollPercent%) up
        val startX = screenWidth / 2f
        val startY = screenHeight * 0.80f
        val scrollPx = screenHeight * scrollPercent / 100f
        val endY = (startY - scrollPx).coerceAtLeast(screenHeight * 0.10f)

        Log.d(TAG, "Scrolling: ($startX, $startY) -> ($startX, $endY) = ${scrollPx}px")

        val path = Path().apply {
            moveTo(startX, startY)
            lineTo(startX, endY)
        }

        // Duration of the swipe gesture (longer = more reliable scroll)
        val gesture = GestureDescription.Builder()
            .addStroke(GestureDescription.StrokeDescription(path, 0, 400))
            .build()

        val result = CompletableDeferred<Boolean>()

        val dispatched = dispatchGesture(gesture, object : GestureResultCallback() {
            override fun onCompleted(gestureDescription: GestureDescription?) {
                Log.d(TAG, "Scroll gesture completed")
                result.complete(true)
            }

            override fun onCancelled(gestureDescription: GestureDescription?) {
                Log.w(TAG, "Scroll gesture cancelled")
                result.complete(false)
            }
        }, null)

        if (!dispatched) {
            Log.e(TAG, "Failed to dispatch scroll gesture")
            return false
        }

        return result.await()
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        // Not needed
    }

    override fun onInterrupt() {
        Log.d(TAG, "AutoScrollService interrupted")
    }

    override fun onDestroy() {
        super.onDestroy()
        instance = null
        Log.d(TAG, "AutoScrollService destroyed")
    }
}
