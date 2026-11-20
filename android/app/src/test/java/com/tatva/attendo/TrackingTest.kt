package com.tatva.attendo

import com.tatva.attendo.data.remote.ApiException
import com.tatva.attendo.data.remote.IngestResult
import com.tatva.attendo.data.remote.RejectedRecord
import com.tatva.attendo.data.session.SessionManager
import com.tatva.attendo.data.store.StoredSession
import com.tatva.attendo.domain.DeviceDescriptor
import com.tatva.attendo.tracking.*
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.*
import org.junit.Test
import java.io.IOException

class TrackingTest {
    private val remote = FakeRemote()
    private val queue = MemQueue()
    private val session = SessionManager(MemTokenStore(StoredSession("a1", "r1", Long.MAX_VALUE / 2, false, "acme:e001")), remote)
    private val uploader = LocationUploader(queue, remote, session)
    private val owner = "acme:e001"

    // ---- uploader
    @Test fun flush_sends_in_time_order_in_batches_and_empties_queue() = runTest {
        (1..45).reversed().forEach { queue.add(pt("p$it", it.toLong())) }
        val r = uploader.flush(owner, batchSize = 20)
        assertEquals(45, r.sent); assertEquals(0, r.remaining)
        assertEquals(listOf(20, 20, 5), remote.ingestCalls.map { it.second.size })
        assertEquals("p1", remote.ingestCalls[0].second[0].id)
        assertEquals("1970-01-01T00:00:00.001Z", remote.ingestCalls[0].second[0].recordedAt)
        assertTrue(queue.rows.isEmpty())
    }

    @Test fun network_failure_keeps_every_point() = runTest {
        (1..5).forEach { queue.add(pt("p$it", it.toLong())) }
        remote.ingestResult = { _, _ -> throw ApiException.Network(IOException("off")) }
        val r = uploader.flush(owner)
        assertNotNull(r.stoppedBy); assertEquals(5, queue.rows.size); assertEquals(5, r.remaining)
    }

    @Test fun session_not_found_keeps_points_for_later() = runTest {
        queue.add(pt("p1", 1))
        remote.ingestResult = { _, _ -> throw ApiException.Server("SESSION_NOT_FOUND", "", 400) }
        uploader.flush(owner)
        assertEquals(1, queue.rows.size)
    }

    @Test fun other_server_rejections_drop_the_batch_instead_of_looping_forever() = runTest {
        queue.add(pt("p1", 1)); queue.add(pt("p2", 2))
        remote.ingestResult = { _, _ -> throw ApiException.Server("INVALID_PAYLOAD", "", 400) }
        val r = uploader.flush(owner)
        assertTrue(queue.rows.isEmpty()); assertEquals(2, r.rejected)
        assertEquals(1, remote.ingestCalls.size)
    }

    @Test fun per_record_rejections_are_removed_not_retried() = runTest {
        queue.add(pt("p1", 1)); queue.add(pt("p2", 2))
        remote.ingestResult = { _, _ -> IngestResult(accepted = 1, rejected = listOf(RejectedRecord("p2", "TIMESTAMP_IN_FUTURE"))) }
        val r = uploader.flush(owner)
        assertEquals(1, r.rejected); assertTrue(queue.rows.isEmpty())
    }

    @Test fun one_request_never_mixes_sessions() = runTest {
        queue.add(pt("a", 1, "s1")); queue.add(pt("b", 2, "s2")); queue.add(pt("c", 3, "s1"))
        uploader.flush(owner)
        assertEquals(listOf("s1", "s2"), remote.ingestCalls.map { it.first })
        assertEquals(listOf(listOf("a", "c"), listOf("b")), remote.ingestCalls.map { c -> c.second.map { it.id } })
        assertTrue(queue.rows.isEmpty())
    }

    @Test fun other_employees_points_are_never_uploaded() = runTest {
        queue.add(pt("x", 1, owner = "other:e9"))
        uploader.flush(owner)
        assertTrue(remote.ingestCalls.isEmpty()); assertEquals(1, queue.rows.size)
    }

    @Test fun retry_after_lost_response_resends_identical_ids() = runTest {
        queue.add(pt("p1", 1))
        remote.ingestResult = { _, _ -> throw ApiException.Network(IOException("timeout after server commit")) }
        uploader.flush(owner)
        remote.ingestResult = { _, r -> IngestResult(duplicates = r.size) } // server already has it
        val r = uploader.flush(owner)
        assertEquals("p1", remote.ingestCalls[0].second[0].id); assertEquals("p1", remote.ingestCalls[1].second[0].id)
        assertEquals(1, r.sent); assertTrue(queue.rows.isEmpty())
    }

    // ---- interval policy
    private val s = TrackingSettings(movingIntervalS = 30, stationaryIntervalS = 120)

    @Test fun starts_with_moving_interval() { assertEquals(30_000, IntervalPolicy(s).currentMs()) }

    @Test fun switches_to_stationary_after_three_still_fixes_and_back_when_moving() {
        val p = IntervalPolicy(s)
        p.onFix(12.9716, 77.5946, 5f)
        assertEquals(30_000, p.onFix(12.9716, 77.5946, 5f))
        assertEquals(30_000, p.onFix(12.97161, 77.59461, 5f))
        assertEquals(120_000, p.onFix(12.97160, 77.59460, 5f))
        assertEquals(30_000, p.onFix(12.9800, 77.6000, 5f)) // ~1 km jump
    }

    @Test fun gps_jitter_within_accuracy_is_not_movement() {
        val p = IntervalPolicy(s)
        p.onFix(12.9716, 77.5946, 80f)
        repeat(3) { p.onFix(12.9720, 77.5950, 80f) } // ~60 m wander, accuracy 80 m
        assertEquals(120_000, p.currentMs())
    }

    @Test fun haversine_is_accurate_for_known_distance() {
        // 0.001 deg of latitude ~ 111.2 m
        assertEquals(111.2, haversineM(12.0, 77.0, 12.001, 77.0), 0.5)
    }

    @Test fun settings_parse_clamp_and_default() {
        val t = TrackingSettings.from(mapOf("tracking.moving_interval_s" to 1.0, "tracking.upload_batch_size" to 99999.0))
        assertEquals(5, t.movingIntervalS); assertEquals(500, t.uploadBatchSize); assertEquals(120, t.stationaryIntervalS)
        assertEquals(TrackingSettings(), TrackingSettings.from(emptyMap()))
    }

    // ---- heartbeat
    private val dev = DeviceDescriptor("dev-uid", "Pixel", "15", "0.3.0")
    private val snap = HealthSnapshot(1_000, 42, false, true, "fine", true, true, null, true, false, "wifi", 3, 500L, false, true, 900L)
    private val source = object : HealthSource { override suspend fun snapshot(ownerKey: String) = snap }

    @Test fun heartbeat_payload_matches_server_contract() {
        val j = snap.toJson(dev)
        assertEquals("dev-uid", j["device_uid"]!!.jsonPrimitive.content)
        assertEquals("1970-01-01T00:00:01Z", j["captured_at"]!!.jsonPrimitive.content)
        assertEquals(42, j["battery_percentage"]!!.jsonPrimitive.int)
        assertEquals("fine", j["location_permission"]!!.jsonPrimitive.content)
        assertTrue(j["foreground_service_alive"]!!.jsonPrimitive.boolean)
        assertTrue(j["is_realtime"]!!.jsonPrimitive.boolean)
        assertEquals(3, j["queue_pending"]!!.jsonPrimitive.int)
        assertFalse("location_provider" in j.keys) // nulls omitted
    }

    @Test fun heartbeat_sends_and_reports_success() = runTest {
        assertTrue(HeartbeatReporter(source, remote, session, dev).send(owner))
        assertEquals(1, remote.heartbeats.size)
    }

    @Test fun heartbeat_failure_is_swallowed() = runTest {
        remote.heartbeatResult = { throw ApiException.Network(IOException("off")) }
        assertFalse(HeartbeatReporter(source, remote, session, dev).send(owner))
    }

    @Test fun heartbeat_registers_device_once_when_server_does_not_know_it() = runTest {
        var n = 0
        remote.heartbeatResult = { if (n++ == 0) throw ApiException.Server("DEVICE_NOT_REGISTERED", "", 400) }
        assertTrue(HeartbeatReporter(source, remote, session, dev).send(owner))
        assertEquals(1, remote.registerCalls); assertEquals(2, remote.heartbeats.size)
    }
}
