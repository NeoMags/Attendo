package com.tatva.attendo

import android.os.Bundle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.appcompat.app.AppCompatActivity
import com.tatva.attendo.ui.AttendoRoot
import com.tatva.attendo.tracking.SyncScheduler
import com.tatva.attendo.tracking.TrackingService
import com.tatva.attendo.ui.theme.AttendoTheme

class MainActivity : AppCompatActivity() {
    override fun onStart() {
        super.onStart()
        (application as AttendoApp).container.registerPush()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        val container = (application as AttendoApp).container
        SyncScheduler.ensurePeriodic(this)
        // Resume the foreground service if a shift is open but the process was killed (app is visible now,
        // so Android allows the start).
        if (container.trackingStore.active() != null && !TrackingService.running) TrackingService.start(this)
        container.registerPush()
        setContent { AttendoTheme { AttendoRoot(container) } }
    }
}
