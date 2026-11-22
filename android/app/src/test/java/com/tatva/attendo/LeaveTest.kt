package com.tatva.attendo

import com.tatva.attendo.data.remote.ApiException
import com.tatva.attendo.data.remote.AttendoApi
import com.tatva.attendo.data.remote.EmployeeProfile
import com.tatva.attendo.data.remote.LeaveBalanceDto
import com.tatva.attendo.data.remote.LeaveTypeDto
import com.tatva.attendo.data.session.SessionManager
import com.tatva.attendo.data.store.StoredSession
import com.tatva.attendo.domain.LeaveFormError
import com.tatva.attendo.domain.LeaveRepository
import com.tatva.attendo.domain.LeaveRules
import com.tatva.attendo.ui.MsgKind
import com.tatva.attendo.ui.toUiMessage
import java.time.LocalDate
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test

class LeaveRulesTest {
    private val today = LocalDate.of(2026, 11, 22)
    private fun v(type: String? = "t", s: LocalDate? = today, e: LocalDate? = today, half: Boolean = false) = LeaveRules.validate(type, s, e, half, today)

    @Test fun valid_single_and_range() {
        assertNull(v()); assertNull(v(e = today.plusDays(3)))
    }
    @Test fun requires_type_and_dates() {
        assertEquals(LeaveFormError.TYPE_REQUIRED, v(type = null))
        assertEquals(LeaveFormError.DATES_REQUIRED, v(s = null)); assertEquals(LeaveFormError.DATES_REQUIRED, v(e = null))
    }
    @Test fun rejects_end_before_start_year_span_long_span_and_multi_day_half() {
        assertEquals(LeaveFormError.INVALID_DATES, v(e = today.minusDays(1)))
        assertEquals(LeaveFormError.INVALID_DATES, v(s = LocalDate.of(2026, 12, 30), e = LocalDate.of(2027, 1, 2)))
        assertEquals(LeaveFormError.INVALID_DATES, v(s = LocalDate.of(2026, 1, 1), e = LocalDate.of(2026, 1, 1).plusDays(93)))
        assertEquals(LeaveFormError.INVALID_DATES, v(e = today.plusDays(1), half = true))
        assertNull(v(half = true))
    }
    @Test fun past_and_future_bounds() {
        assertNull(v(s = today.minusDays(30), e = today.minusDays(30)))
        assertEquals(LeaveFormError.DATE_TOO_OLD, v(s = today.minusDays(31), e = today.minusDays(31)))
        assertEquals(LeaveFormError.DATE_TOO_FAR, v(s = today.plusDays(367), e = today.plusDays(367)))
    }
    @Test fun can_cancel_rules() {
        assertTrue(LeaveRules.canCancel("pending", today, today))
        assertTrue(LeaveRules.canCancel("manager_approved", today.minusDays(1), today))
        assertTrue(LeaveRules.canCancel("approved", today.plusDays(1), today))
        assertFalse(LeaveRules.canCancel("approved", today, today))
        assertFalse(LeaveRules.canCancel("rejected", today.plusDays(5), today))
        assertFalse(LeaveRules.canCancel("cancelled", today.plusDays(5), today))
    }
    @Test fun format_days() {
        assertEquals("2", LeaveRules.formatDays(2.0)); assertEquals("0.5", LeaveRules.formatDays(0.5)); assertEquals("12.5", LeaveRules.formatDays(12.5))
    }
    @Test fun server_codes_map_to_messages() {
        fun k(code: String) = ApiException.Server(code, "x", 400).toUiMessage().kind
        assertEquals(MsgKind.LEAVE_OVERLAP, k("LEAVE_OVERLAP"))
        assertEquals(MsgKind.LEAVE_INSUFFICIENT_BALANCE, k("INSUFFICIENT_BALANCE"))
        assertEquals(MsgKind.LEAVE_NO_WORKING_DAYS, k("NO_WORKING_DAYS"))
        assertEquals(MsgKind.LEAVE_NOT_CANCELLABLE, k("INVALID_STATE"))
        assertEquals(MsgKind.EMPLOYEE_NOT_FOUND, k("NO_EMPLOYEE"))
        assertEquals(MsgKind.GENERIC, k("SOMETHING_ELSE"))
    }
}

class LeaveRepositoryTest {
    private val remote = FakeRemote().apply { profileResult = EmployeeProfile(id = "emp-1", employeeCode = "E001", fullName = "A") }
    private val session = SessionManager(MemTokenStore(StoredSession("a1", "r1", Long.MAX_VALUE / 2, false, "acme:e001")), remote)
    private val repo = LeaveRepository(session, remote) { LocalDate.of(2026, 11, 22) }

    @Test fun load_uses_profile_employee_id_and_current_year() = runBlocking<Unit> {
        remote.leaveTypesResult = listOf(LeaveTypeDto("t1", "Casual", 12.0))
        remote.balancesResult = listOf(LeaveBalanceDto("t1", "Casual", 12.0, 1.0, 0.5, 10.5))
        remote.requestsResult = listOf(leaveReq("r1", "2026-12-01", "2026-12-02", 2.0, "pending"))
        val o = repo.load()
        assertEquals(listOf("emp-1" to 2026), remote.leaveBalanceCalls)
        assertEquals(1, o.types.size); assertEquals(10.5, o.balances.single().remainingDays!!, 0.0); assertEquals("r1", o.requests.single().id)
    }
    @Test fun load_without_employee_record_fails_with_employee_not_found() {
        remote.profileResult = null
        val e = assertThrows(ApiException.Server::class.java) { runBlocking { repo.load() } }
        assertEquals(MsgKind.EMPLOYEE_NOT_FOUND, e.toUiMessage().kind)
    }
    @Test fun apply_trims_reason_and_sends_iso_dates() = runBlocking<Unit> {
        repo.apply("t1", LocalDate.of(2026, 12, 1), LocalDate.of(2026, 12, 3), false, "  trip  ")
        assertEquals(listOf<Any?>("t1", "2026-12-01", "2026-12-03", false, "trip"), remote.applyCalls.single())
        repo.apply("t1", LocalDate.of(2026, 12, 1), LocalDate.of(2026, 12, 1), true, "   ")
        assertNull(remote.applyCalls.last()[4])
    }
    @Test fun cancel_delegates() = runBlocking<Unit> {
        assertEquals("cancelled", repo.cancel("r9").status); assertEquals(listOf("r9"), remote.cancelCalls)
    }
}

class LeaveApiTest {
    private lateinit var server: MockWebServer
    private lateinit var api: AttendoApi
    private val json = Json { ignoreUnknownKeys = true }

    @Before fun up() { server = MockWebServer().apply { start() }; api = AttendoApi(server.url("/").toString(), "pub", OkHttpClient(), json) }
    @After fun down() = server.shutdown()
    private fun reply(code: Int, body: String) = server.enqueue(MockResponse().setResponseCode(code).setBody(body))

    @Test fun leave_types_query_and_parse() = runBlocking<Unit> {
        reply(200, """[{"id":"t1","name":"Casual","annual_quota_days":12,"is_paid":true,"x":1},{"id":"t2","name":"Unpaid","annual_quota_days":null,"is_paid":false}]""")
        val r = api.leaveTypes("TOK")
        assertEquals(12.0, r[0].annualQuotaDays!!, 0.0); assertNull(r[1].annualQuotaDays); assertFalse(r[1].isPaid)
        val rec = server.takeRequest()
        assertTrue(rec.path!!.startsWith("/rest/v1/leave_types?is_active=eq.true")); assertEquals("Bearer TOK", rec.getHeader("Authorization"))
    }
    @Test fun balances_rpc_params() = runBlocking<Unit> {
        reply(200, """[{"leave_type_id":"t1","name":"Casual","annual_quota_days":12,"approved_days":2,"pending_days":1.5,"remaining_days":8.5}]""")
        val r = api.leaveBalances("TOK", "emp-1", 2026)
        assertEquals(8.5, r.single().remainingDays!!, 0.0)
        val rec = server.takeRequest(); assertEquals("/rest/v1/rpc/leave_balances", rec.path)
        val b = json.parseToJsonElement(rec.body.readUtf8()).jsonObject
        assertEquals("emp-1", b["p_employee_id"]!!.jsonPrimitive.content); assertEquals("2026", b["p_year"]!!.jsonPrimitive.content)
    }
    @Test fun my_requests_filters_by_employee_and_parses_embed() = runBlocking<Unit> {
        reply(200, """[{"id":"r1","start_date":"2026-12-01","end_date":"2026-12-02","days":2,"is_half_day":false,"reason":null,"status":"manager_approved","manager_note":"ok","decision_note":null,"leave_types":{"name":"Casual"}}]""")
        val r = api.myLeaveRequests("TOK", "emp-1")
        assertEquals("Casual", r.single().leaveType!!.name); assertEquals("ok", r.single().managerNote)
        assertTrue(server.takeRequest().path!!.contains("employee_id=eq.emp-1"))
    }
    @Test fun apply_rpc_sends_params_and_parses_row() = runBlocking<Unit> {
        reply(200, """{"id":"r2","start_date":"2026-12-01","end_date":"2026-12-01","days":0.5,"is_half_day":true,"status":"pending","employee_id":"e"}""")
        val r = api.applyLeave("TOK", "t1", "2026-12-01", "2026-12-01", true, "dentist")
        assertEquals(0.5, r.days, 0.0); assertEquals("pending", r.status)
        val rec = server.takeRequest(); assertEquals("/rest/v1/rpc/apply_leave", rec.path)
        val b = json.parseToJsonElement(rec.body.readUtf8()).jsonObject
        assertEquals("t1", b["p_leave_type_id"]!!.jsonPrimitive.content); assertEquals("2026-12-01", b["p_start"]!!.jsonPrimitive.content)
        assertEquals("2026-12-01", b["p_end"]!!.jsonPrimitive.content); assertTrue(b["p_half_day"]!!.jsonPrimitive.boolean)
        assertEquals("dentist", b["p_reason"]!!.jsonPrimitive.content)
    }
    @Test fun apply_server_error_code_is_extracted() = runBlocking<Unit> {
        reply(400, """{"code":"P0001","message":"LEAVE_OVERLAP: dates overlap an existing request","details":null,"hint":null}""")
        val e = assertThrows(ApiException.Server::class.java) { runBlocking { api.applyLeave("TOK", "t1", "2026-12-01", "2026-12-01", false, null) } }
        assertEquals("LEAVE_OVERLAP", e.code)
    }
    @Test fun cancel_rpc_param() = runBlocking<Unit> {
        reply(200, """{"id":"r2","start_date":"2026-12-01","end_date":"2026-12-01","days":1,"status":"cancelled"}""")
        assertEquals("cancelled", api.cancelLeave("TOK", "r2").status)
        val rec = server.takeRequest(); assertEquals("/rest/v1/rpc/cancel_leave", rec.path)
        assertEquals("r2", json.parseToJsonElement(rec.body.readUtf8()).jsonObject["p_request_id"]!!.jsonPrimitive.content)
    }
}

class NotificationsTest {
    private fun n(t: String) = com.tatva.attendo.data.remote.NotificationDto(id = t, title = "x", createdAt = t)
    private val now = java.time.Instant.parse("2026-11-23T12:00:00Z").toEpochMilli()
    @Test fun unread_counts_only_newer_than_seen() {
        val l = listOf(n("2026-11-23T10:00:00Z"), n("2026-11-23T08:00:00Z"))
        assertEquals(1, com.tatva.attendo.domain.NotificationRules.unread(l, "2026-11-23T09:00:00Z", now))
        assertEquals(0, com.tatva.attendo.domain.NotificationRules.unread(l, "2026-11-23T11:00:00Z", now))
    }
    @Test fun no_seen_time_limits_to_last_week() {
        val l = listOf(n("2026-11-20T00:00:00Z"), n("2026-10-01T00:00:00Z"), n("bad-date"))
        assertEquals(1, com.tatva.attendo.domain.NotificationRules.unread(l, null, now))
    }
    @Test fun repository_loads_for_profile_employee_and_marks_seen() = runBlocking<Unit> {
        val remote = FakeRemote().apply {
            profileResult = com.tatva.attendo.data.remote.EmployeeProfile(id = "emp-1", employeeCode = "E1", fullName = "A")
            notifsResult = listOf(n("2026-11-23T10:00:00Z"))
        }
        val session = SessionManager(MemTokenStore(StoredSession("a1", "r1", Long.MAX_VALUE / 2, false, "acme:e001")), remote)
        val repo = com.tatva.attendo.domain.NotificationRepository(session, remote) { java.time.Instant.parse("2026-11-23T12:00:00Z") }
        assertEquals(1, repo.load().items.size)
        assertEquals("2026-11-23T12:00:00Z", repo.markSeen()); assertEquals(listOf("2026-11-23T12:00:00Z"), remote.seenMarks)
    }
}

class NotificationsApiTest {
    private lateinit var server: MockWebServer
    private lateinit var api: AttendoApi
    private val json = Json { ignoreUnknownKeys = true }
    @Before fun up() { server = MockWebServer().apply { start() }; api = AttendoApi(server.url("/").toString(), "pub", OkHttpClient(), json) }
    @After fun down() = server.shutdown()

    @Test fun notifications_filter_by_employee() = runBlocking<Unit> {
        server.enqueue(MockResponse().setBody("""[{"id":"n1","kind":"leave","title":"Approved","body":null,"created_at":"2026-11-23T10:00:00+00:00","x":1}]"""))
        val r = api.myNotifications("TOK", "emp-1")
        assertEquals("Approved", r.single().title)
        assertTrue(server.takeRequest().path!!.contains("employee_id=eq.emp-1"))
    }
    @Test fun seen_at_reads_first_row_or_null() = runBlocking<Unit> {
        server.enqueue(MockResponse().setBody("""[{"notif_seen_at":"2026-11-23T09:00:00+00:00"}]"""))
        assertEquals("2026-11-23T09:00:00+00:00", api.notifSeenAt("TOK"))
        server.enqueue(MockResponse().setBody("[]"))
        assertNull(api.notifSeenAt("TOK"))
    }
    @Test fun mark_seen_upserts_with_merge_header() = runBlocking<Unit> {
        server.enqueue(MockResponse().setResponseCode(201))
        api.markNotificationsSeen("TOK", "2026-11-23T12:00:00Z")
        val rec = server.takeRequest()
        assertEquals("POST", rec.method); assertTrue(rec.path!!.contains("on_conflict=user_id"))
        assertTrue(rec.getHeader("Prefer")!!.contains("merge-duplicates"))
        assertEquals("2026-11-23T12:00:00Z", json.parseToJsonElement(rec.body.readUtf8()).jsonObject["notif_seen_at"]!!.jsonPrimitive.content)
    }
}

class MyDetailsTest {
    private val remote = FakeRemote().apply { profileResult = EmployeeProfile(id = "emp-1", employeeCode = "E1", fullName = "Asha") }
    private val session = SessionManager(MemTokenStore(StoredSession("a1", "r1", Long.MAX_VALUE / 2, false, "acme:e001")), remote)
    private val repo = com.tatva.attendo.domain.MyDetailsRepository(session, remote) { LocalDate.of(2026, 11, 23) }
    private fun att(d: String, late: Int) = com.tatva.attendo.data.remote.AttendanceDto("a$d", d, "closed", "${d}T04:00:00Z", null, late, null)

    @Test fun loads_profile_pay_attendance_from_30_days_back_and_photo() = runBlocking<Unit> {
        remote.myProfileResult = com.tatva.attendo.data.remote.MyProfileDto(photoPath = "c/e/photo.jpg", phone = "+919876543210")
        remote.myPayResult = com.tatva.attendo.data.remote.MyPayDto(payType = "monthly", monthlySalary = 18000.0, aadhaarLast4 = "1234")
        remote.myAttendanceResult = listOf(att("2026-11-20", 10), att("2026-11-19", 0), att("2026-11-19", 5))
        remote.documentResult = byteArrayOf(1, 2, 3)
        val d = repo.load()
        assertEquals("Asha", d.employee.fullName); assertEquals("+919876543210", d.profile!!.phone); assertEquals(18000.0, d.pay!!.monthlySalary!!, 0.0)
        assertArrayEquals(byteArrayOf(1, 2, 3), d.photo)
        assertEquals(listOf("2026-10-24"), remote.attendanceFromDates)
        assertEquals(2, com.tatva.attendo.domain.AttendanceSummary.present(d.attendance))   // distinct days
        assertEquals(2, com.tatva.attendo.domain.AttendanceSummary.lateDays(d.attendance))
    }
    @Test fun missing_profile_and_pay_are_null_not_errors() = runBlocking<Unit> {
        val d = repo.load(); assertNull(d.profile); assertNull(d.pay); assertNull(d.photo)
    }
    @Test fun photo_failure_does_not_hide_details() = runBlocking<Unit> {
        remote.myProfileResult = com.tatva.attendo.data.remote.MyProfileDto(photoPath = "c/e/photo.jpg")
        val failing = object : com.tatva.attendo.data.remote.AttendoRemote by remote {
            override suspend fun documentBytes(accessToken: String, path: String): ByteArray? = throw ApiException.Network(java.io.IOException("x"))
        }
        val d = com.tatva.attendo.domain.MyDetailsRepository(SessionManager(MemTokenStore(StoredSession("a1", "r1", Long.MAX_VALUE / 2, false, "k")), failing), failing).load()
        assertNull(d.photo); assertNotNull(d.profile)
    }
    @Test fun leave_limit_error_maps_and_usage_loads() = runBlocking<Unit> {
        assertEquals(MsgKind.LEAVE_LIMIT_REACHED, ApiException.Server("LEAVE_LIMIT_REACHED", "x", 400).toUiMessage().kind)
        remote.usageResult = com.tatva.attendo.data.remote.LeaveUsageDto(limitPerMonth = 2, used = 1)
        val o = LeaveRepository(session, remote) { LocalDate.of(2026, 11, 23) }.load()
        assertEquals(2, o.usage!!.limitPerMonth); assertEquals(1, o.usage!!.used)
    }
}

class MyDetailsApiTest {
    private lateinit var server: MockWebServer
    private lateinit var api: AttendoApi
    private val json = Json { ignoreUnknownKeys = true }
    @Before fun up() { server = MockWebServer().apply { start() }; api = AttendoApi(server.url("/").toString(), "pub", OkHttpClient(), json) }
    @After fun down() = server.shutdown()

    @Test fun profile_pay_and_attendance_queries() = runBlocking<Unit> {
        server.enqueue(MockResponse().setBody("""[{"photo_path":"c/e/photo.jpg","address":"MG Road","phone":"+919876543210","extra":1}]"""))
        assertEquals("MG Road", api.myProfileDetails("T", "emp-1")!!.address)
        assertTrue(server.takeRequest().path!!.contains("employee_id=eq.emp-1"))
        server.enqueue(MockResponse().setBody("""[{"pay_type":"daily","daily_wage":650,"pf_eligible":true,"esi_eligible":false,"aadhaar_last4":"1234"}]"""))
        val pay = api.myPayInfo("T", "emp-1")!!
        assertEquals("daily", pay.payType); assertEquals(650.0, pay.dailyWage!!, 0.0); assertTrue(pay.pfEligible)
        server.takeRequest()
        server.enqueue(MockResponse().setBody("[]"))
        assertNull(api.myProfileDetails("T", "emp-1"))
        server.takeRequest()
        server.enqueue(MockResponse().setBody("""[{"id":"a","work_date":"2026-11-20","status":"closed","check_in_at":"2026-11-20T04:00:00+00:00","late_minutes":3}]"""))
        assertEquals(3, api.myAttendance("T", "emp-1", "2026-10-24").single().lateMinutes)
        assertTrue(server.takeRequest().path!!.contains("work_date=gte.2026-10-24"))
    }
    @Test fun document_download_uses_authenticated_endpoint_and_handles_missing() = runBlocking<Unit> {
        server.enqueue(MockResponse().setBody(okio.Buffer().write(byteArrayOf(9, 8, 7))))
        assertArrayEquals(byteArrayOf(9, 8, 7), api.documentBytes("TOK", "c-1/e-1/photo.jpg"))
        val rec = server.takeRequest()
        assertEquals("/storage/v1/object/authenticated/employee-docs/c-1/e-1/photo.jpg", rec.path); assertEquals("Bearer TOK", rec.getHeader("Authorization"))
        server.enqueue(MockResponse().setResponseCode(404).setBody("""{"error":"not_found"}"""))
        assertNull(api.documentBytes("TOK", "c-1/e-1/photo.jpg"))
    }
    @Test fun leave_usage_rpc() = runBlocking<Unit> {
        server.enqueue(MockResponse().setBody("""[{"limit_per_month":null,"used":2}]"""))
        val u = api.leaveUsage("T", 2026, 11)!!
        assertNull(u.limitPerMonth); assertEquals(2, u.used)
        val rec = server.takeRequest(); assertEquals("/rest/v1/rpc/leave_request_usage", rec.path)
    }
}
