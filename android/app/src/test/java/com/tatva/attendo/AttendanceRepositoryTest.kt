package com.tatva.attendo

import com.tatva.attendo.data.remote.ApiException
import com.tatva.attendo.data.session.SessionManager
import com.tatva.attendo.data.store.PendingCheckIn
import com.tatva.attendo.data.store.StoredSession
import com.tatva.attendo.domain.AttendanceRepository
import com.tatva.attendo.domain.DeviceDescriptor
import com.tatva.attendo.domain.DomainError
import com.tatva.attendo.location.Fix
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlinx.coroutines.runBlocking
import java.io.IOException

class AttendanceRepositoryTest {
    private val remote = FakeRemote()
    private val pending = MemPendingStore()
    private val loc = FakeLocation()
    private val tokens = MemTokenStore(StoredSession("a1", "r1", Long.MAX_VALUE / 2, false, "acme:e001"))
    private val session = SessionManager(tokens, remote)
    private val queue = MemQueue()
    private val trackStore = MemTrackingStore()
    private val tracking = FakeTracking(trackStore)
    private var idN = 0
    private val repo = AttendanceRepository(
        session, remote, pending, loc,
        DeviceDescriptor("dev-uid", "Pixel", "15", "0.3.0"), tracking, trackStore, queue,
        nowIso = { "2026-11-20T04:00:00Z" },
        newId = { "id-${++idN}" },
    )

    @Test fun check_in_success_clears_pending_and_sends_ids_and_device() = runTest {
        val r = repo.checkIn()
        assertEquals("id-1", r.id)
        assertNull(pending.inn)
        val req = remote.checkInCalls.single()
        assertEquals("id-1", req.attendanceId); assertEquals("id-2", req.sessionId)
        assertEquals("dev-uid", req.deviceUid)
        assertEquals(1, remote.registerCalls)
    }

    @Test fun network_failure_keeps_pending_and_retry_reuses_same_ids_and_time() = runTest {
        remote.checkInResult = { throw ApiException.Network(IOException("timeout")) }
        assertThrows(ApiException.Network::class.java) { runBlocking { repo.checkIn() } }
        val saved = pending.inn!!
        remote.checkInResult = { att(it.attendanceId) }
        repo.checkIn()
        assertEquals(2, remote.checkInCalls.size)
        assertEquals(remote.checkInCalls[0], remote.checkInCalls[1]) // identical => server dedupes
        assertEquals(1, loc.calls) // no second GPS read
        assertEquals(saved.attendanceId, remote.checkInCalls[1].attendanceId)
        assertNull(pending.inn)
    }

    @Test fun server_rejection_is_definitive_and_clears_pending() = runTest {
        remote.checkInResult = { throw ApiException.Server("DUPLICATE_CHECKIN", "x", 400) }
        val e = assertThrows(ApiException.Server::class.java) { runBlocking { repo.checkIn() } }
        assertEquals("DUPLICATE_CHECKIN", e.code)
        assertNull(pending.inn)
    }

    @Test fun mock_location_is_blocked_before_any_network_call() = runTest {
        loc.next = { Fix(1.0, 1.0, 5f, true) }
        assertThrows(DomainError.MockLocation::class.java) { runBlocking { repo.checkIn() } }
        assertTrue(remote.checkInCalls.isEmpty()); assertNull(pending.inn)
    }

    @Test fun accuracy_above_limit_is_blocked_using_server_setting() = runTest {
        remote.config = mapOf("checkin.max_accuracy_m" to 50.0)
        loc.next = { Fix(1.0, 1.0, 120f, false) }
        val e = assertThrows(DomainError.AccuracyTooLow::class.java) { runBlocking { repo.checkIn() } }
        assertEquals(120, e.actualM); assertEquals(50, e.maxM)
        assertTrue(remote.checkInCalls.isEmpty())
    }

    @Test fun default_accuracy_limit_is_200() = runTest {
        loc.next = { Fix(1.0, 1.0, 199f, false) }
        repo.checkIn(); assertEquals(1, remote.checkInCalls.size)
        loc.next = { Fix(1.0, 1.0, 201f, false) }
        pending.clearCheckIn()
        assertThrows(DomainError.AccuracyTooLow::class.java) { runBlocking { repo.checkIn() } }
    }

    @Test fun permission_missing_propagates() = runTest {
        loc.next = { throw DomainError.PermissionMissing() }
        assertThrows(DomainError.PermissionMissing::class.java) { runBlocking { repo.checkIn() } }
        assertNull(pending.inn)
    }

    @Test fun pending_from_another_employee_is_discarded() = runTest {
        pending.inn = PendingCheckIn("other:e999", "x", "y", "t", 1.0, 1.0, 5f)
        val s = repo.loadToday()
        assertNull(s.pendingCheckIn); assertNull(pending.inn)
        assertTrue(remote.checkInCalls.isEmpty())
    }

    @Test fun load_today_flushes_own_pending_check_in() = runTest {
        pending.inn = PendingCheckIn("acme:e001", "att-9", "s-9", "2026-11-20T03:00:00Z", 1.0, 2.0, 5f)
        remote.open = att("att-9")
        val s = repo.loadToday()
        assertEquals("att-9", remote.checkInCalls.single().attendanceId)
        assertEquals("2026-11-20T03:00:00Z", remote.checkInCalls.single().recordedAtIso) // original time, not "now"
        assertNull(s.pendingCheckIn); assertEquals("att-9", s.open!!.id)
    }

    @Test fun load_today_survives_offline_flush_and_shows_pending() = runTest {
        pending.inn = PendingCheckIn("acme:e001", "att-9", "s-9", "t", 1.0, 2.0, 5f)
        remote.checkInResult = { throw ApiException.Network(IOException("off")) }
        val s = repo.loadToday()
        assertNotNull(s.pendingCheckIn); assertNull(s.open)
    }

    @Test fun check_out_works_without_location() = runTest {
        loc.next = { throw DomainError.LocationUnavailable() }
        repo.checkOut("att-1")
        val req = remote.checkOutCalls.single()
        assertEquals("att-1", req.attendanceId); assertNull(req.lat); assertNull(req.accuracyM)
        assertNull(pending.out)
    }

    @Test fun check_out_drops_mock_location_but_still_checks_out() = runTest {
        loc.next = { Fix(1.0, 1.0, 5f, true) }
        repo.checkOut("att-1")
        assertNull(remote.checkOutCalls.single().lat)
    }

    @Test fun check_out_network_failure_retry_is_identical() = runTest {
        remote.checkOutResult = { throw ApiException.Network(IOException("x")) }
        assertThrows(ApiException.Network::class.java) { runBlocking { repo.checkOut("att-1") } }
        remote.checkOutResult = { att(it.attendanceId, "closed") }
        repo.checkOut("att-1")
        assertEquals(remote.checkOutCalls[0], remote.checkOutCalls[1])
    }

    // ---- Phase 4: tracking integration
    @Test fun check_in_starts_tracking_with_the_checkin_session_id() = runTest {
        repo.checkIn()
        assertEquals(listOf("start:id-2"), tracking.events)
        assertEquals("id-1", trackStore.a!!.attendanceId); assertEquals("acme:e001", trackStore.a!!.ownerKey)
    }

    @Test fun tracking_starts_even_when_check_in_is_offline() = runTest {
        remote.checkInResult = { throw ApiException.Network(IOException("off")) }
        assertThrows(ApiException.Network::class.java) { runBlocking { repo.checkIn() } }
        assertNotNull(trackStore.a)
    }

    @Test fun rejected_check_in_stops_tracking_and_drops_its_points() = runTest {
        remote.checkInResult = { throw ApiException.Server("DEVICE_BLOCKED", "x", 400) }
        queue.add(pt("p1", 1, session = "id-2"))
        assertThrows(ApiException.Server::class.java) { runBlocking { repo.checkIn() } }
        assertNull(trackStore.a); assertTrue(queue.rows.isEmpty())
    }

    @Test fun check_out_stops_tracking_but_keeps_queued_points() = runTest {
        trackStore.a = com.tatva.attendo.tracking.ActiveTracking("s1", "att-1", "acme:e001")
        queue.add(pt("p1", 1))
        repo.checkOut("att-1")
        assertNull(trackStore.a); assertEquals(1, queue.rows.size)
    }

    @Test fun load_today_resumes_tracking_for_open_shift_using_server_session() = runTest {
        remote.open = att("att-7"); remote.sessionLookup = "sess-7"
        repo.loadToday()
        assertEquals("sess-7", trackStore.a!!.sessionId)
    }

    @Test fun load_today_does_not_resume_while_check_out_is_pending() = runTest {
        remote.open = att("att-7"); remote.sessionLookup = "sess-7"
        remote.checkOutResult = { throw ApiException.Network(IOException("off")) }
        assertThrows(ApiException.Network::class.java) { runBlocking { repo.checkOut("att-7") } }
        repo.loadToday()
        assertNull(trackStore.a)
    }

    @Test fun load_today_stops_tracking_when_server_has_no_open_shift() = runTest {
        trackStore.a = com.tatva.attendo.tracking.ActiveTracking("s1", "att-1", "acme:e001")
        remote.open = null
        repo.loadToday()
        assertNull(trackStore.a)
    }

    @Test fun load_today_keeps_tracking_when_check_in_is_still_pending() = runTest {
        remote.checkInResult = { throw ApiException.Network(IOException("off")) }
        assertThrows(ApiException.Network::class.java) { runBlocking { repo.checkIn() } }
        repo.loadToday()
        assertNotNull(trackStore.a)
    }
}
