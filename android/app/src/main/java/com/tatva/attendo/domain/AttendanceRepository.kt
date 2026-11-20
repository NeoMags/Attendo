package com.tatva.attendo.domain

import com.tatva.attendo.data.remote.ApiException
import com.tatva.attendo.data.remote.AttendanceDto
import com.tatva.attendo.data.remote.AttendoRemote
import com.tatva.attendo.data.remote.CheckInRequest
import com.tatva.attendo.data.remote.CheckOutRequest
import com.tatva.attendo.data.session.SessionManager
import com.tatva.attendo.data.store.PendingCheckIn
import com.tatva.attendo.data.store.PendingCheckOut
import com.tatva.attendo.data.store.PendingStore
import com.tatva.attendo.location.LocationProvider
import com.tatva.attendo.tracking.ActiveTracking
import com.tatva.attendo.tracking.LocationQueue
import com.tatva.attendo.tracking.TrackingController
import com.tatva.attendo.tracking.TrackingStore
import java.time.Instant
import java.util.UUID

data class DeviceDescriptor(val uid: String, val model: String?, val osVersion: String?, val appVersion: String?)

/** What the home screen shows. [open] is the server's open record; pending_* are unsent local actions. */
data class TodayState(
    val open: AttendanceDto?,
    val pendingCheckIn: PendingCheckIn?,
    val pendingCheckOut: PendingCheckOut?,
) {
    val hasPending get() = pendingCheckIn != null || pendingCheckOut != null
}

class AttendanceRepository(
    private val session: SessionManager,
    private val remote: AttendoRemote,
    private val pending: PendingStore,
    private val location: LocationProvider,
    private val device: DeviceDescriptor,
    private val tracking: TrackingController,
    private val trackingStore: TrackingStore,
    private val queue: LocationQueue,
    private val nowIso: () -> String = { Instant.now().toString() },
    private val newId: () -> String = { UUID.randomUUID().toString() },
) {
    /** Re-sends any pending action (same ids => idempotent), then reads the server's view. */
    suspend fun loadToday(): TodayState {
        runCatching { flushPending() }.onFailure { if (it is ApiException.SessionExpired) throw it }
        val open = session.authed { remote.openAttendance(it) }
        val state = TodayState(open, ownPendingCheckIn(), ownPendingCheckOut())
        reconcileTracking(state)
        return state
    }

    suspend fun checkIn(): AttendanceDto {
        ownPendingCheckIn()?.let { return submitCheckIn(it) } // retry the same action, never create a second one
        val owner = session.ownerKey() ?: throw ApiException.SessionExpired()

        val fix = location.current()
        if (fix.isMock) throw DomainError.MockLocation()
        val maxM = maxAccuracy()
        if (fix.accuracyM > maxM) throw DomainError.AccuracyTooLow(fix.accuracyM.toInt(), maxM.toInt())

        val p = PendingCheckIn(owner, newId(), newId(), nowIso(), fix.lat, fix.lng, fix.accuracyM)
        pending.saveCheckIn(p)
        tracking.start(ActiveTracking(p.sessionId, p.attendanceId, owner)) // record the track even if offline
        return submitCheckIn(p)
    }

    suspend fun checkOut(openId: String): AttendanceDto {
        ownPendingCheckOut()?.let { return submitCheckOut(it) }
        val owner = session.ownerKey() ?: throw ApiException.SessionExpired()

        // A location is useful on check-out but must never block going home.
        val fix = runCatching { location.current() }.getOrNull()?.takeUnless { it.isMock }
        val p = PendingCheckOut(owner, openId, nowIso(), fix?.lat, fix?.lng, fix?.accuracyM)
        pending.saveCheckOut(p)
        tracking.stop() // stop recording at the moment of check-out; queued points still upload
        return submitCheckOut(p)
    }

    /** Re-sends pending check-in/out (idempotent). Used by the tracking service and the sync worker. */
    suspend fun syncPending() = flushPending()

    /**
     * Keeps the foreground service consistent with the server's view: resume after reinstall/sign-in
     * (look up the open shift's session), stop if the shift is gone (e.g. closed by an admin).
     */
    private suspend fun reconcileTracking(s: TodayState) {
        val owner = session.ownerKey() ?: return
        val active = trackingStore.active()?.takeIf { it.ownerKey == owner }
        when {
            s.pendingCheckOut != null -> Unit // check-out in flight; tracking already stopped
            s.open != null && (active == null || active.attendanceId != s.open.id) -> {
                val sid = runCatching { session.authed { remote.activeSessionId(it, s.open.id) } }.getOrNull()
                if (sid != null) tracking.start(ActiveTracking(sid, s.open.id, owner))
            }
            s.open == null && s.pendingCheckIn == null && active != null -> tracking.stop()
        }
    }

    private suspend fun flushPending() {
        ownPendingCheckIn()?.let { submitCheckIn(it) }
        ownPendingCheckOut()?.let { submitCheckOut(it) }
    }

    private suspend fun submitCheckIn(p: PendingCheckIn): AttendanceDto = try {
        val r = session.authed { token ->
            remote.registerDevice(token, device.uid, device.model, device.osVersion, device.appVersion)
            remote.checkIn(
                token,
                CheckInRequest(p.attendanceId, p.sessionId, device.uid, p.recordedAtIso, p.lat, p.lng, p.accuracyM),
            )
        }
        pending.clearCheckIn()
        r
    } catch (e: ApiException.Server) {
        pending.clearCheckIn() // definitive rejection: nothing happened server-side
        tracking.stop()
        queue.removeSession(p.sessionId)
        throw e
    }

    private suspend fun submitCheckOut(p: PendingCheckOut): AttendanceDto = try {
        val r = session.authed { token ->
            remote.checkOut(token, CheckOutRequest(p.attendanceId, p.recordedAtIso, p.lat, p.lng, p.accuracyM))
        }
        pending.clearCheckOut()
        r
    } catch (e: ApiException.Server) {
        pending.clearCheckOut()
        throw e
    }

    private suspend fun maxAccuracy(): Double =
        runCatching { session.authed { remote.trackingConfig(it) } }
            .getOrNull()?.settings?.get("checkin.max_accuracy_m") ?: DEFAULT_MAX_ACCURACY_M

    /** Pending items belong to one employee; a different employee signing in must not inherit them. */
    private fun ownPendingCheckIn(): PendingCheckIn? {
        val owner = session.ownerKey()
        val p = pending.checkIn() ?: return null
        return if (p.ownerKey == owner) p else null.also { pending.clearCheckIn() }
    }

    private fun ownPendingCheckOut(): PendingCheckOut? {
        val owner = session.ownerKey()
        val p = pending.checkOut() ?: return null
        return if (p.ownerKey == owner) p else null.also { pending.clearCheckOut() }
    }

    private companion object { const val DEFAULT_MAX_ACCURACY_M = 200.0 }
}
