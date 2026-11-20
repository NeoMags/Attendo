package com.tatva.attendo

import com.tatva.attendo.data.remote.ApiException
import com.tatva.attendo.data.remote.AttendoApi
import com.tatva.attendo.data.remote.CheckInRequest
import com.tatva.attendo.data.remote.CheckOutRequest
import com.tatva.attendo.domain.DomainError
import com.tatva.attendo.domain.PasswordCheck
import com.tatva.attendo.domain.PasswordRules
import com.tatva.attendo.ui.ChangePasswordViewModel
import com.tatva.attendo.ui.MsgKind
import com.tatva.attendo.ui.toUiMessage
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.JsonNull
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test

class ApiAndRulesTest {
    private lateinit var server: MockWebServer
    private lateinit var api: AttendoApi
    private val json = Json { ignoreUnknownKeys = true }

    @Before fun up() {
        server = MockWebServer().apply { start() }
        api = AttendoApi(server.url("/").toString(), "pub-key", OkHttpClient(), json)
    }
    @After fun down() = server.shutdown()

    private fun reply(code: Int, body: String) = server.enqueue(MockResponse().setResponseCode(code).setBody(body))

    @Test fun login_success_parses_tokens_and_flag() = runBlocking<Unit> {
        reply(200, """{"access_token":"A","refresh_token":"R","expires_in":3600,"token_type":"bearer","must_change_password":true,"user":{"id":"u"}}""")
        val t = api.login("acme", "E1", "pw")
        assertEquals("A", t.accessToken); assertEquals(true, t.mustChangePassword)
        val rec = server.takeRequest()
        assertEquals("/functions/v1/employee-login", rec.path)
        assertEquals("pub-key", rec.getHeader("apikey"))
        assertNull(rec.getHeader("Authorization"))
        val b = json.parseToJsonElement(rec.body.readUtf8()).jsonObject
        assertEquals("acme", b["company_code"]!!.jsonPrimitive.content)
        assertEquals("E1", b["employee_code"]!!.jsonPrimitive.content)
    }

    @Test fun refresh_response_reads_must_change_from_user_metadata() = runBlocking<Unit> {
        reply(200, """{"access_token":"A","refresh_token":"R","expires_in":3600,"user":{"user_metadata":{"must_change_password":true}}}""")
        assertEquals(true, api.refresh("r").mustChangePassword)
    }

    @Test fun login_errors_map_to_typed_exceptions() = runBlocking<Unit> {
        reply(401, """{"error":"invalid_credentials"}""")
        assertThrows(ApiException.InvalidCredentials::class.java) { runBlocking { api.login("a", "b", "c") } }
        reply(429, """{"error":"too_many_attempts","retry_after_minutes":9}""")
        val e = assertThrows(ApiException.TooManyAttempts::class.java) { runBlocking { api.login("a", "b", "c") } }
        assertEquals(9, e.retryAfterMinutes)
    }

    @Test fun refresh_rejection_maps_to_session_expired() = runBlocking<Unit> {
        reply(400, """{"error":"invalid_grant"}""")
        assertThrows(ApiException.SessionExpired::class.java) { runBlocking { api.refresh("bad") } }
    }

    @Test fun check_in_rpc_sends_p_params_with_bearer_and_parses_row() = runBlocking<Unit> {
        reply(200, """{"id":"att-1","work_date":"2026-11-20","status":"open","check_in_at":"2026-11-20T04:00:00+00:00","check_out_at":null,"late_minutes":12,"worked_seconds":null,"extra":"ignored"}""")
        val r = api.checkIn("TOK", CheckInRequest("att-1", "s-1", "dev", "2026-11-20T04:00:00Z", 12.5, 77.5, 9.5f))
        assertEquals(12, r.lateMinutes); assertNull(r.checkOutAt)
        val rec = server.takeRequest()
        assertEquals("/rest/v1/rpc/check_in", rec.path)
        assertEquals("Bearer TOK", rec.getHeader("Authorization"))
        val b = json.parseToJsonElement(rec.body.readUtf8()).jsonObject
        assertEquals(setOf("p_attendance_id", "p_session_id", "p_device_uid", "p_recorded_at", "p_lat", "p_lng", "p_accuracy"), b.keys)
        assertEquals("att-1", b["p_attendance_id"]!!.jsonPrimitive.content)
    }

    @Test fun check_out_sends_json_null_for_missing_location() = runBlocking<Unit> {
        reply(200, """{"id":"att-1","work_date":"2026-11-20","status":"closed","check_in_at":"t","check_out_at":"t2","worked_seconds":60}""")
        api.checkOut("TOK", CheckOutRequest("att-1", "t2", null, null, null))
        val b = json.parseToJsonElement(server.takeRequest().body.readUtf8()).jsonObject
        assertEquals(JsonNull, b["p_lat"]); assertEquals(JsonNull, b["p_accuracy"])
    }

    @Test fun postgrest_app_error_code_is_extracted() = runBlocking<Unit> {
        reply(400, """{"code":"P0001","message":"DUPLICATE_CHECKIN: already checked in","details":null,"hint":null}""")
        val e = assertThrows(ApiException.Server::class.java) {
            runBlocking { api.checkIn("T", CheckInRequest("a", "s", "d", "t", 1.0, 1.0, 1f)) }
        }
        assertEquals("DUPLICATE_CHECKIN", e.code)
    }

    @Test fun http_401_is_unauthorized() = runBlocking<Unit> {
        reply(401, """{"code":"PGRST301","message":"JWT expired"}""")
        assertThrows(ApiException.Unauthorized::class.java) { runBlocking { api.openAttendance("T") } }
    }

    @Test fun auth_error_code_is_used_when_no_app_code() = runBlocking<Unit> {
        reply(422, """{"code":422,"error_code":"same_password","msg":"New password should be different from the old password."}""")
        val e = assertThrows(ApiException.Server::class.java) { runBlocking { api.changePassword("T", "x") } }
        assertEquals("same_password", e.code)
        assertEquals(MsgKind.PASSWORD_SAME, e.toUiMessage().kind)
    }

    @Test fun change_password_request_shape() = runBlocking<Unit> {
        reply(200, """{"id":"u"}""")
        api.changePassword("TOK", "NewPass123")
        val rec = server.takeRequest()
        assertEquals("PUT", rec.method); assertEquals("/auth/v1/user", rec.path)
        val b = json.parseToJsonElement(rec.body.readUtf8()).jsonObject
        assertEquals("NewPass123", b["password"]!!.jsonPrimitive.content)
        assertEquals("false", b["data"]!!.jsonObject["must_change_password"]!!.jsonPrimitive.content)
    }

    @Test fun open_attendance_empty_list_is_null() = runBlocking<Unit> {
        reply(200, "[]")
        assertNull(api.openAttendance("T"))
    }

    @Test fun connection_failure_is_network_error() = runBlocking<Unit> {
        server.shutdown()
        assertThrows(ApiException.Network::class.java) { runBlocking { api.openAttendance("T") } }
        Unit
    }

    @Test fun password_rules() {
        assertEquals(PasswordCheck.OK, PasswordRules.check("abcdef12"))
        assertEquals(PasswordCheck.TOO_WEAK, PasswordRules.check("abc1"))
        assertEquals(PasswordCheck.TOO_WEAK, PasswordRules.check("abcdefgh"))
        assertEquals(PasswordCheck.TOO_WEAK, PasswordRules.check("12345678"))
        assertEquals(PasswordCheck.TOO_WEAK, PasswordRules.check("a1" + "x".repeat(71)))
    }

    @Test fun change_password_validation() {
        assertEquals(MsgKind.PASSWORD_WEAK, ChangePasswordViewModel.validate("short", "short")!!.kind)
        assertEquals(MsgKind.PASSWORD_MISMATCH, ChangePasswordViewModel.validate("abcdef12", "abcdef13")!!.kind)
        assertNull(ChangePasswordViewModel.validate("abcdef12", "abcdef12"))
    }

    @Test fun message_mapping() {
        assertEquals(MsgKind.NETWORK, ApiException.Network(java.io.IOException()).toUiMessage().kind)
        assertEquals(listOf(7), ApiException.TooManyAttempts(7).toUiMessage().args)
        assertEquals(MsgKind.DEVICE_LIMIT, ApiException.Server("DEVICE_LIMIT_REACHED", "", 400).toUiMessage().kind)
        assertEquals(MsgKind.BAD_TIMESTAMP, ApiException.Server("TIMESTAMP_TOO_OLD", "", 400).toUiMessage().kind)
        assertEquals(listOf("WEIRD"), ApiException.Server("WEIRD", "", 500).toUiMessage().args)
        assertEquals(listOf(120, 50), DomainError.AccuracyTooLow(120, 50).toUiMessage().args)
        assertEquals(MsgKind.MOCK_LOCATION, DomainError.MockLocation().toUiMessage().kind)
    }
}
