package com.framereader.capture

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.os.Build

class FrameReaderApp : Application() {
    
    companion object {
        const val CHANNEL_ID = "framereader_capture"
        const val CHANNEL_NAME = "Screen Capture"
        
        // API Configuration
        var apiUrl = "https://frame-extract-lab.preview.emergentagent.com/api"
        var sessionCode = ""
        
        // Capture Settings
        var scrollDistancePercent = 80
        var captureIntervalMs = 1500L
        var overlapMarginPercent = 10
        var totalCaptures = 10
        
        // Screen dimensions (detected at runtime)
        var screenWidth = 1080
        var screenHeight = 2340  // Samsung S25 default
    }
    
    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
    }
    
    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                CHANNEL_NAME,
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Screen capture notifications"
                setShowBadge(false)
            }
            
            val notificationManager = getSystemService(NotificationManager::class.java)
            notificationManager.createNotificationChannel(channel)
        }
    }
}
