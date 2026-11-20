package com.tatva.attendo.tracking

import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.BatteryManager
import android.os.Build
import android.os.IBinder
import android.os.Looper
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import com.tatva.attendo.AttendoApp
import com.tatva.attendo.MainActivity
import com.tatva.attendo.R
import java.util.UUID
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * Foreground service that records GPS fixes into the local queue while a shift is open and uploads
 * them in batches. Started by [AndroidTrackingController]; resumed after reboot by [BootReceiver].
 * Needs a device with Play services; not covered by JVM tests (logic it uses is).
 */
class TrackingService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private var callback: LocationCallback? = null
    private var policy: IntervalPolicy? = null
    private var currentIntervalMs = 0L
    private var active: ActiveTracking? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val container = (application as AttendoApp).container
        val a = container.trackingStore.active()
        // Must call startForeground promptly even if we are about to stop.
        showForeground()
        if (a == null) {
            stopSelf()
            return START_NOT_STICKY
        }
        if (running) return START_STICKY
        running = true
        active = a
        scope.launch { runLoop(a) }
        return START_STICKY
    }

    @SuppressLint("MissingPermission")
    private suspend fun runLoop(a: ActiveTracking) {
        val c = (application as AttendoApp).container
        val settings = try {
            TrackingSettings.from(c.session.authed { c.remote.trackingConfig(it) }.settings)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            TrackingSettings()
        }
        policy = IntervalPolicy(settings)
        reportGapIfAny(a, settings)
        requestUpdates(policy!!.currentMs())

        var lastUpload = 0L
        var lastBeat = 0L
        while (true) {
            val now = System.currentTimeMillis()
            if (now - lastUpload >= settings.uploadIntervalS * 1000) {
                lastUpload = now
                runCatchingNonCancel {
                    c.attendance.syncPending()
                    c.uploader.flush(a.ownerKey, settings.uploadBatchSize)
                }
            }
            if (now - lastBeat >= settings.heartbeatIntervalS * 1000) {
                lastBeat = now
                runCatchingNonCancel { c.heartbeat.send(a.ownerKey) }
            }
            delay(5_000)
        }
    }

    /** If the process was dead for longer than a few intervals, tell the server why the track has a hole. */
    private suspend fun reportGapIfAny(a: ActiveTracking, s: TrackingSettings) {
        val c = (application as AttendoApp).container
        val last = c.trackingStore.lastFixMs
        val now = System.currentTimeMillis()
        if (last > 0 && now - last > s.stationaryIntervalS * 1000 * 3) {
            runCatchingNonCancel {
                c.session.authed {
                    c.remote.reportInterruption(
                        it, UUID.randomUUID().toString(), a.sessionId,
                        java.time.Instant.ofEpochMilli(last).toString(), java.time.Instant.ofEpochMilli(now).toString(),
                        "service_killed", "tracking resumed after ${(now - last) / 1000}s without fixes",
                    )
                }
            }
        }
    }

    @SuppressLint("MissingPermission")
    private fun requestUpdates(intervalMs: Long) {
        val client = LocationServices.getFusedLocationProviderClient(this)
        callback?.let { client.removeLocationUpdates(it) }
        currentIntervalMs = intervalMs
        val req = LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, intervalMs)
            .setMinUpdateIntervalMillis(intervalMs / 2)
            .build()
        val cb = object : LocationCallback() {
            override fun onLocationResult(result: LocationResult) {
                result.locations.forEach { onFix(it) }
            }
        }
        callback = cb
        try {
            client.requestLocationUpdates(req, cb, Looper.getMainLooper())
        } catch (e: SecurityException) {
            stopSelf() // permission revoked; the heartbeat will report it from the worker
        }
    }

    private fun onFix(loc: android.location.Location) {
        val a = active ?: return
        val c = (application as AttendoApp).container
        val mock = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) loc.isMock else @Suppress("DEPRECATION") loc.isFromMockProvider
        val point = QueuedPoint(
            id = UUID.randomUUID().toString(), ownerKey = a.ownerKey, sessionId = a.sessionId,
            latitude = loc.latitude, longitude = loc.longitude,
            accuracy = if (loc.hasAccuracy()) loc.accuracy else null,
            speed = if (loc.hasSpeed()) loc.speed else null,
            bearing = if (loc.hasBearing()) loc.bearing else null,
            altitude = if (loc.hasAltitude()) loc.altitude else null,
            battery = batteryPct(), provider = loc.provider, network = networkNow(),
            isMock = mock, recordedAtMs = loc.time.takeIf { it > 0 } ?: System.currentTimeMillis(),
        )
        c.trackingStore.lastFixMs = point.recordedAtMs
        scope.launch { runCatchingNonCancel { c.locationQueue.add(point) } }
        val next = policy?.onFix(loc.latitude, loc.longitude, point.accuracy) ?: return
        if (next != currentIntervalMs) requestUpdates(next)
    }

    private fun batteryPct(): Int? =
        (getSystemService(Context.BATTERY_SERVICE) as BatteryManager)
            .getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY).takeIf { it in 0..100 }

    private fun networkNow(): String {
        val cm = getSystemService(Context.CONNECTIVITY_SERVICE) as android.net.ConnectivityManager
        val caps = cm.getNetworkCapabilities(cm.activeNetwork) ?: return "none"
        return AndroidHealthSource.networkTypeOf(caps)
    }

    private fun showForeground() {
        val nm = getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= 26) {
            nm.createNotificationChannel(
                NotificationChannel(CHANNEL, getString(R.string.tracking_channel), NotificationManager.IMPORTANCE_LOW),
            )
        }
        val open = PendingIntent.getActivity(
            this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val n: Notification = NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_launcher_foreground)
            .setContentTitle(getString(R.string.tracking_notif_title))
            .setContentText(getString(R.string.tracking_notif_text))
            .setOngoing(true)
            .setContentIntent(open)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .build()
        if (Build.VERSION.SDK_INT >= 29) {
            startForeground(NOTIF_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION)
        } else {
            startForeground(NOTIF_ID, n)
        }
    }

    override fun onDestroy() {
        callback?.let { LocationServices.getFusedLocationProviderClient(this).removeLocationUpdates(it) }
        callback = null
        scope.cancel()
        running = false
        // Upload whatever is still queued (e.g. right after check-out) without needing the service.
        SyncScheduler.kick(this)
        super.onDestroy()
    }

    private suspend fun runCatchingNonCancel(block: suspend () -> Unit) {
        try {
            block()
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            // best effort; next interval retries
        }
    }

    companion object {
        private const val CHANNEL = "tracking"
        private const val NOTIF_ID = 1001

        @Volatile var running = false

        fun start(context: Context) {
            try {
                ContextCompat.startForegroundService(context, Intent(context, TrackingService::class.java))
            } catch (e: Exception) {
                // Android 12+ can refuse a background start; the periodic worker's heartbeat reports "service not running".
            }
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, TrackingService::class.java))
        }
    }
}

class AndroidTrackingController(private val context: Context, private val store: TrackingStore) : TrackingController {
    override fun start(a: ActiveTracking) {
        store.start(a)
        TrackingService.start(context)
    }

    override fun stop() {
        store.stop()
        TrackingService.stop(context)
        SyncScheduler.kick(context)
    }
}
