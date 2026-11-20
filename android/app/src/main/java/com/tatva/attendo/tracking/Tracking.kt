package com.tatva.attendo.tracking

import com.tatva.attendo.data.remote.ApiException
import com.tatva.attendo.data.remote.AttendoRemote
import com.tatva.attendo.data.remote.LocationRecordDto
import com.tatva.attendo.data.session.SessionManager
import com.tatva.attendo.domain.DeviceDescriptor
import java.time.Instant
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.sin
import kotlin.math.sqrt
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** One GPS fix waiting to be uploaded. Same [id] on every retry => server de-duplicates. */
data class QueuedPoint(
    val id: String,
    val ownerKey: String,
    val sessionId: String,
    val latitude: Double,
    val longitude: Double,
    val accuracy: Float?,
    val speed: Float?,
    val bearing: Float?,
    val altitude: Double?,
    val battery: Int?,
    val provider: String?,
    val network: String?,
    val isMock: Boolean,
    val recordedAtMs: Long,
)

interface LocationQueue {
    suspend fun add(p: QueuedPoint)
    /** Oldest first. */
    suspend fun next(ownerKey: String, limit: Int): List<QueuedPoint>
    suspend fun remove(ids: List<String>)
    suspend fun removeSession(sessionId: String)
    suspend fun count(ownerKey: String): Int
    suspend fun oldestMs(ownerKey: String): Long?
}

data class ActiveTracking(val sessionId: String, val attendanceId: String, val ownerKey: String)

interface TrackingStore {
    fun active(): ActiveTracking?
    fun start(a: ActiveTracking)
    fun stop()
    var lastFixMs: Long
}

/** Starts/stops the foreground service. The Android implementation lives in TrackingService. */
interface TrackingController {
    fun start(a: ActiveTracking)
    fun stop()
}

/** Server-driven tracking settings (system_settings via get_tracking_config) with safe defaults. */
data class TrackingSettings(
    val movingIntervalS: Long = 30,
    val stationaryIntervalS: Long = 120,
    val uploadIntervalS: Long = 60,
    val uploadBatchSize: Int = 20,
    val heartbeatIntervalS: Long = 300,
) {
    companion object {
        fun from(m: Map<String, Double>) = TrackingSettings(
            movingIntervalS = m["tracking.moving_interval_s"]?.toLong()?.coerceIn(5, 3600) ?: 30,
            stationaryIntervalS = m["tracking.stationary_interval_s"]?.toLong()?.coerceIn(10, 7200) ?: 120,
            uploadIntervalS = m["tracking.upload_interval_s"]?.toLong()?.coerceIn(10, 3600) ?: 60,
            uploadBatchSize = m["tracking.upload_batch_size"]?.toInt()?.coerceIn(1, 500) ?: 20,
            heartbeatIntervalS = m["health.heartbeat_interval_s"]?.toLong()?.coerceIn(60, 3600) ?: 300,
        )
    }
}

fun haversineM(lat1: Double, lng1: Double, lat2: Double, lng2: Double): Double {
    val r = 6_371_000.0
    val dLat = Math.toRadians(lat2 - lat1)
    val dLng = Math.toRadians(lng2 - lng1)
    val a = sin(dLat / 2).let { it * it } +
        cos(Math.toRadians(lat1)) * cos(Math.toRadians(lat2)) * sin(dLng / 2).let { it * it }
    return 2 * r * atan2(sqrt(a), sqrt(1 - a))
}

/**
 * Chooses the sampling interval: the "moving" interval, or the longer "stationary" interval after
 * [stillCount] consecutive fixes that stayed within [radiusM] of the previous one.
 */
class IntervalPolicy(
    private val s: TrackingSettings,
    private val radiusM: Double = 25.0,
    private val stillCount: Int = 3,
) {
    private var lastLat: Double? = null
    private var lastLng: Double? = null
    private var still = 0

    /** Feed a fix; returns the interval (ms) to use for the next fix. */
    fun onFix(lat: Double, lng: Double, accuracyM: Float?): Long {
        val pl = lastLat
        val pg = lastLng
        if (pl != null && pg != null) {
            // Moves smaller than the GPS error are noise, not movement.
            val threshold = maxOf(radiusM, (accuracyM ?: 0f).toDouble())
            still = if (haversineM(pl, pg, lat, lng) <= threshold) still + 1 else 0
        }
        lastLat = lat; lastLng = lng
        return currentMs()
    }

    fun currentMs(): Long = (if (still >= stillCount) s.stationaryIntervalS else s.movingIntervalS) * 1000
}

data class FlushResult(val sent: Int, val rejected: Int, val remaining: Int, val stoppedBy: Throwable? = null)

/** Uploads queued points in batches. A batch is only removed after the server answered definitively. */
class LocationUploader(
    private val queue: LocationQueue,
    private val remote: AttendoRemote,
    private val session: SessionManager,
) {
    suspend fun flush(ownerKey: String, batchSize: Int = 20, maxBatches: Int = 50): FlushResult {
        var sent = 0
        var rejected = 0
        repeat(maxBatches) {
            val first = queue.next(ownerKey, batchSize).takeIf { it.isNotEmpty() }
                ?: return FlushResult(sent, rejected, 0)
            val batch = first.filter { it.sessionId == first[0].sessionId } // one session per request
            try {
                val r = session.authed { remote.ingestLocations(it, batch[0].sessionId, batch.map(::toDto)) }
                queue.remove(batch.map { it.id })
                sent += r.accepted + r.duplicates
                rejected += r.rejected.size
            } catch (e: ApiException.Server) {
                // SESSION_NOT_FOUND: check-in not on the server yet -> keep points and retry later.
                // Anything else is a definitive rejection of this exact payload; retrying would loop forever.
                if (e.code == "SESSION_NOT_FOUND") return FlushResult(sent, rejected, queue.count(ownerKey), e)
                queue.remove(batch.map { it.id })
                rejected += batch.size
            } catch (e: ApiException) {
                return FlushResult(sent, rejected, queue.count(ownerKey), e) // network / auth: keep everything
            }
        }
        return FlushResult(sent, rejected, queue.count(ownerKey))
    }

    private fun toDto(p: QueuedPoint) = LocationRecordDto(
        id = p.id, latitude = p.latitude, longitude = p.longitude, accuracy = p.accuracy, speed = p.speed,
        bearing = p.bearing, altitude = p.altitude, batteryPercentage = p.battery, provider = p.provider,
        networkStatus = p.network, isMock = p.isMock, recordedAt = Instant.ofEpochMilli(p.recordedAtMs).toString(),
    )
}

/** Device state sent with each heartbeat. Mirrors public.record_heartbeat(p jsonb). */
data class HealthSnapshot(
    val capturedAtMs: Long,
    val batteryPct: Int?,
    val charging: Boolean?,
    val powerSave: Boolean?,
    /** fine | coarse | denied | not_requested */
    val locationPermission: String,
    val backgroundLocationGranted: Boolean,
    val locationServicesEnabled: Boolean,
    val locationProvider: String?,
    val notificationsEnabled: Boolean,
    val batteryOptimizationExempt: Boolean,
    /** wifi | cellular | none | other | unknown */
    val networkType: String,
    val queuePending: Int,
    val oldestUnsyncedMs: Long?,
    val mockLocationDetected: Boolean,
    val foregroundServiceAlive: Boolean,
    val lastFixMs: Long?,
) {
    fun toJson(device: DeviceDescriptor): JsonObject = buildJsonObject {
        put("device_uid", device.uid)
        put("captured_at", Instant.ofEpochMilli(capturedAtMs).toString())
        batteryPct?.let { put("battery_percentage", it) }
        charging?.let { put("is_charging", it) }
        powerSave?.let { put("power_save_mode", it) }
        put("location_permission", locationPermission)
        put("background_location_granted", backgroundLocationGranted)
        put("location_services_enabled", locationServicesEnabled)
        locationProvider?.let { put("location_provider", it) }
        put("notifications_enabled", notificationsEnabled)
        put("battery_optimization_exempt", batteryOptimizationExempt)
        put("network_type", networkType)
        put("queue_pending", queuePending)
        oldestUnsyncedMs?.let { put("oldest_unsynced_at", Instant.ofEpochMilli(it).toString()) }
        device.appVersion?.let { put("app_version", it) }
        device.osVersion?.let { put("os_version", it) }
        device.model?.let { put("device_model", it) }
        put("mock_location_detected", mockLocationDetected)
        put("foreground_service_alive", foregroundServiceAlive)
        lastFixMs?.let { put("last_fix_at", Instant.ofEpochMilli(it).toString()) }
        // captured_at is "now", so the server may compute clock drift from it.
        put("is_realtime", JsonPrimitive(true))
    }
}

interface HealthSource {
    suspend fun snapshot(ownerKey: String): HealthSnapshot
}

class HeartbeatReporter(
    private val source: HealthSource,
    private val remote: AttendoRemote,
    private val session: SessionManager,
    private val device: DeviceDescriptor,
) {
    /** Best effort: returns false on any failure so callers just try again next interval. */
    suspend fun send(ownerKey: String): Boolean {
        val payload = source.snapshot(ownerKey).toJson(device)
        return try {
            try {
                session.authed { remote.heartbeat(it, payload) }
            } catch (e: ApiException.Server) {
                if (e.code != "DEVICE_NOT_REGISTERED") throw e
                session.authed {
                    remote.registerDevice(it, device.uid, device.model, device.osVersion, device.appVersion)
                    remote.heartbeat(it, payload)
                }
            }
            true
        } catch (e: ApiException) {
            false
        }
    }
}
