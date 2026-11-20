package com.tatva.attendo.tracking

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.tatva.attendo.AttendoApp

/** Resumes tracking after a reboot or app update if a shift is still open. */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED && intent.action != Intent.ACTION_MY_PACKAGE_REPLACED) return
        val c = (context.applicationContext as AttendoApp).container
        SyncScheduler.ensurePeriodic(context)
        if (c.trackingStore.active() != null) TrackingService.start(context)
    }
}
