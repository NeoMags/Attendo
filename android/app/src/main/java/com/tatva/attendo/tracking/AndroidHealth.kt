package com.tatva.attendo.tracking

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.SharedPreferences
import android.content.pm.PackageManager
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.BatteryManager
import android.os.Build
import android.os.PowerManager
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.core.content.edit
import androidx.core.location.LocationManagerCompat

class PrefsTrackingStore(context: Context) : TrackingStore {
    private val p: SharedPreferences = context.getSharedPreferences("attendo_tracking", Context.MODE_PRIVATE)

    override fun active(): ActiveTracking? {
        val s = p.getString("session", null) ?: return null
        val a = p.getString("attendance", null) ?: return null
        val o = p.getString("owner", null) ?: return null
        return ActiveTracking(s, a, o)
    }

    override fun start(a: ActiveTracking) = p.edit(commit = true) {
        putString("session", a.sessionId); putString("attendance", a.attendanceId); putString("owner", a.ownerKey)
    }

    override fun stop() = p.edit(commit = true) { remove("session"); remove("attendance"); remove("owner") }

    override var lastFixMs: Long
        get() = p.getLong("last_fix", 0L)
        set(v) = p.edit { putLong("last_fix", v) }
}

/** Reads real device state. Needs a device; not covered by JVM tests. */
class AndroidHealthSource(
    private val context: Context,
    private val queue: LocationQueue,
    private val store: TrackingStore,
) : HealthSource {
    override suspend fun snapshot(ownerKey: String): HealthSnapshot {
        val bm = context.getSystemService(Context.BATTERY_SERVICE) as BatteryManager
        val pm = context.getSystemService(Context.POWER_SERVICE) as PowerManager
        val sticky = context.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
        val status = sticky?.getIntExtra(BatteryManager.EXTRA_STATUS, -1) ?: -1
        val charging = status == BatteryManager.BATTERY_STATUS_CHARGING || status == BatteryManager.BATTERY_STATUS_FULL
        val pct = bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY).takeIf { it in 0..100 }

        val fine = granted(Manifest.permission.ACCESS_FINE_LOCATION)
        val coarse = granted(Manifest.permission.ACCESS_COARSE_LOCATION)
        val bg = if (Build.VERSION.SDK_INT >= 29) granted(Manifest.permission.ACCESS_BACKGROUND_LOCATION) else fine
        val lm = context.getSystemService(Context.LOCATION_SERVICE) as android.location.LocationManager

        val last = store.lastFixMs.takeIf { it > 0 }
        return HealthSnapshot(
            capturedAtMs = System.currentTimeMillis(),
            batteryPct = pct,
            charging = charging,
            powerSave = pm.isPowerSaveMode,
            locationPermission = when { fine -> "fine"; coarse -> "coarse"; else -> "denied" },
            backgroundLocationGranted = bg,
            locationServicesEnabled = LocationManagerCompat.isLocationEnabled(lm),
            locationProvider = null,
            notificationsEnabled = NotificationManagerCompat.from(context).areNotificationsEnabled(),
            batteryOptimizationExempt = pm.isIgnoringBatteryOptimizations(context.packageName),
            networkType = networkType(),
            queuePending = queue.count(ownerKey),
            oldestUnsyncedMs = queue.oldestMs(ownerKey),
            mockLocationDetected = false,
            foregroundServiceAlive = TrackingService.running,
            lastFixMs = last,
        )
    }

    private fun granted(perm: String) = ContextCompat.checkSelfPermission(context, perm) == PackageManager.PERMISSION_GRANTED

    private fun networkType(): String {
        val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val caps = cm.getNetworkCapabilities(cm.activeNetwork) ?: return "none"
        return networkTypeOf(caps)
    }

    companion object {
        fun networkTypeOf(caps: NetworkCapabilities): String = when {
            !caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) -> "none"
            caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> "wifi"
            caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> "cellular"
            else -> "other"
        }
    }
}
