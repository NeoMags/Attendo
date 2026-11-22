package com.tatva.attendo.data.remote

import java.io.IOException
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import okhttp3.Call
import okhttp3.Callback
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response

/**
 * Thin OkHttp client for Supabase Auth, PostgREST RPC and our Edge Functions.
 * Only the public project URL and the publishable key are used here - never the service-role key.
 */
class AttendoApi(
    baseUrl: String,
    private val apiKey: String,
    private val client: OkHttpClient,
    private val json: Json,
) : AttendoRemote {
    private val base = baseUrl.trimEnd('/')
    private val jsonType = "application/json; charset=utf-8".toMediaType()

    // ------------------------------------------------------------------ auth
    override suspend fun login(company: String, employeeCode: String, password: String): TokenResponse {
        val body = buildJsonObject {
            put("company_code", company)
            put("employee_code", employeeCode)
            put("password", password)
        }
        val (status, text) = send(post("$base/functions/v1/employee-login", body, token = null))
        return when {
            status in 200..299 -> decode(text)
            status == 429 -> throw ApiException.TooManyAttempts(retryMinutes(text))
            status == 400 || status == 401 -> throw ApiException.InvalidCredentials()
            else -> throw errorFor(status, text)
        }
    }

    override suspend fun refresh(refreshToken: String): TokenResponse {
        val body = buildJsonObject { put("refresh_token", refreshToken) }
        val (status, text) = send(post("$base/auth/v1/token?grant_type=refresh_token", body, token = null))
        return when {
            status in 200..299 -> decode(text)
            status in listOf(400, 401, 403, 422) -> throw ApiException.SessionExpired()
            else -> throw errorFor(status, text)
        }
    }

    override suspend fun changePassword(accessToken: String, newPassword: String) {
        val body = buildJsonObject {
            put("password", newPassword)
            put("data", buildJsonObject { put("must_change_password", false) })
        }
        val (status, text) = send(request("$base/auth/v1/user", accessToken).put(body.body()).build())
        if (status !in 200..299) throw errorFor(status, text)
    }

    // ------------------------------------------------------------------- rpc
    override suspend fun registerDevice(
        accessToken: String, deviceUid: String, model: String?, osVersion: String?, appVersion: String?,
    ): String {
        val text = rpc(accessToken, "register_device", buildJsonObject {
            put("p_device_uid", deviceUid)
            put("p_model", model.orNull())
            put("p_os_version", osVersion.orNull())
            put("p_app_version", appVersion.orNull())
            put("p_fcm_token", JsonNull)
        })
        return parse(text).jsonPrimitive.content
    }

    override suspend fun checkIn(accessToken: String, req: CheckInRequest): AttendanceDto {
        val text = rpc(accessToken, "check_in", buildJsonObject {
            put("p_attendance_id", req.attendanceId)
            put("p_session_id", req.sessionId)
            put("p_device_uid", req.deviceUid)
            put("p_recorded_at", req.recordedAtIso)
            put("p_lat", req.lat)
            put("p_lng", req.lng)
            put("p_accuracy", req.accuracyM)
        })
        return decode(text)
    }

    override suspend fun checkOut(accessToken: String, req: CheckOutRequest): AttendanceDto {
        val text = rpc(accessToken, "check_out", buildJsonObject {
            put("p_attendance_id", req.attendanceId)
            put("p_recorded_at", req.recordedAtIso)
            put("p_lat", req.lat.orNull())
            put("p_lng", req.lng.orNull())
            put("p_accuracy", req.accuracyM.orNull())
        })
        return decode(text)
    }

    override suspend fun trackingConfig(accessToken: String): TrackingConfig =
        decode(rpc(accessToken, "get_tracking_config", buildJsonObject { }))

    override suspend fun ingestLocations(accessToken: String, sessionId: String, records: List<LocationRecordDto>): IngestResult {
        val text = rpc(accessToken, "ingest_locations", buildJsonObject {
            put("p_session_id", sessionId)
            put("p_records", json.encodeToJsonElement(ListSerializer(LocationRecordDto.serializer()), records))
        })
        return decode(text)
    }

    override suspend fun heartbeat(accessToken: String, payload: JsonObject) {
        rpc(accessToken, "record_heartbeat", buildJsonObject { put("p", payload) })
    }

    override suspend fun reportInterruption(
        accessToken: String, id: String, sessionId: String, startedIso: String, endedIso: String?, reason: String, detail: String?,
    ) {
        rpc(accessToken, "report_interruption", buildJsonObject {
            put("p_id", id)
            put("p_session_id", sessionId)
            put("p_started_at", startedIso)
            put("p_ended_at", endedIso.orNull())
            put("p_reason", reason)
            put("p_detail", detail.orNull())
        })
    }

    override suspend fun activeSessionId(accessToken: String, attendanceId: String): String? {
        val url = "$base/rest/v1/tracking_sessions?attendance_id=eq.$attendanceId&status=eq.active&select=id&limit=1"
        val (status, text) = send(request(url, accessToken).get().build())
        if (status !in 200..299) throw errorFor(status, text)
        return json.decodeFromString<List<SessionRef>>(text).firstOrNull()?.id
    }

    // ----------------------------------------------------------------- reads
    override suspend fun openAttendance(accessToken: String): AttendanceDto? {
        val url = "$base/rest/v1/attendance?status=eq.open" +
            "&select=id,work_date,status,check_in_at,check_out_at,late_minutes,worked_seconds&limit=1"
        val (status, text) = send(request(url, accessToken).get().build())
        if (status !in 200..299) throw errorFor(status, text)
        return json.decodeFromString<List<AttendanceDto>>(text).firstOrNull()
    }

    override suspend fun profile(accessToken: String): EmployeeProfile? {
        val url = "$base/rest/v1/employees?select=id,employee_code,full_name,preferred_language,companies(name)&limit=1"
        val (status, text) = send(request(url, accessToken).get().build())
        if (status !in 200..299) throw errorFor(status, text)
        return json.decodeFromString<List<EmployeeProfile>>(text).firstOrNull()
    }

    // ----------------------------------------------------------------- leave
    override suspend fun leaveTypes(accessToken: String): List<LeaveTypeDto> {
        val url = "$base/rest/v1/leave_types?is_active=eq.true&select=id,name,annual_quota_days,is_paid&order=name"
        val (status, text) = send(request(url, accessToken).get().build())
        if (status !in 200..299) throw errorFor(status, text)
        return decode(text)
    }

    override suspend fun leaveBalances(accessToken: String, employeeId: String, year: Int): List<LeaveBalanceDto> =
        decode(rpc(accessToken, "leave_balances", buildJsonObject {
            put("p_employee_id", employeeId)
            put("p_year", year)
        }))

    override suspend fun myLeaveRequests(accessToken: String, employeeId: String): List<LeaveRequestDto> {
        // Filter by employee explicitly: a manager signing in on the phone could otherwise also receive their team's rows.
        val url = "$base/rest/v1/leave_requests?employee_id=eq.$employeeId" +
            "&select=id,start_date,end_date,days,is_half_day,reason,status,manager_note,decision_note,leave_types(name)" +
            "&order=start_date.desc&limit=100"
        val (status, text) = send(request(url, accessToken).get().build())
        if (status !in 200..299) throw errorFor(status, text)
        return decode(text)
    }

    override suspend fun applyLeave(
        accessToken: String, leaveTypeId: String, startDate: String, endDate: String, halfDay: Boolean, reason: String?,
    ): LeaveRequestDto = decode(rpc(accessToken, "apply_leave", buildJsonObject {
        put("p_leave_type_id", leaveTypeId)
        put("p_start", startDate)
        put("p_end", endDate)
        put("p_half_day", halfDay)
        put("p_reason", reason.orNull())
    }))

    override suspend fun cancelLeave(accessToken: String, requestId: String): LeaveRequestDto =
        decode(rpc(accessToken, "cancel_leave", buildJsonObject { put("p_request_id", requestId) }))

    // -------------------------------------------------------------- plumbing
    private suspend fun rpc(token: String, fn: String, args: JsonObject): String {
        val (status, text) = send(post("$base/rest/v1/rpc/$fn", args, token))
        if (status !in 200..299) throw errorFor(status, text)
        return text
    }

    private fun request(url: String, token: String?): Request.Builder =
        Request.Builder().url(url)
            .header("apikey", apiKey)
            .header("Accept", "application/json")
            .apply { if (token != null) header("Authorization", "Bearer $token") }

    private fun post(url: String, body: JsonObject, token: String?): Request =
        request(url, token).post(body.body()).build()

    private fun JsonObject.body() = toString().toRequestBody(jsonType)

    private suspend fun send(req: Request): Pair<Int, String> = try {
        client.newCall(req).await().use { it.code to (it.body?.string() ?: "") }
    } catch (e: IOException) {
        throw ApiException.Network(e)
    }

    private fun parse(text: String) = json.parseToJsonElement(text)

    private inline fun <reified T> decode(text: String): T = try {
        json.decodeFromString<T>(text)
    } catch (e: Exception) {
        throw ApiException.Server("BAD_RESPONSE", e.message.orEmpty().take(200), 200)
    }

    private fun retryMinutes(text: String): Int =
        runCatching { parse(text).jsonObject["retry_after_minutes"]?.jsonPrimitive?.int }.getOrNull() ?: 15

    internal fun errorFor(status: Int, text: String): ApiException {
        if (status == 401) return ApiException.Unauthorized()
        val obj = runCatching { parse(text).jsonObject }.getOrNull()
        fun field(name: String) = obj?.get(name)?.let { (it as? JsonPrimitive)?.contentOrNull }
        val message = field("message") ?: field("msg") ?: text.take(200)
        val appCode = message.substringBefore(':').trim().takeIf { APP_CODE.matches(it) }
        val code = appCode ?: field("error_code") ?: field("code") ?: "HTTP_$status"
        return ApiException.Server(code, message, status)
    }

    private fun String?.orNull(): kotlinx.serialization.json.JsonElement = if (this == null) JsonNull else JsonPrimitive(this)
    private fun Double?.orNull(): kotlinx.serialization.json.JsonElement = if (this == null) JsonNull else JsonPrimitive(this)
    private fun Float?.orNull(): kotlinx.serialization.json.JsonElement = if (this == null) JsonNull else JsonPrimitive(this)

    private companion object {
        val APP_CODE = Regex("^[A-Z][A-Z_]+$")
    }
}

private suspend fun Call.await(): Response = suspendCancellableCoroutine { cont ->
    cont.invokeOnCancellation { cancel() }
    enqueue(object : Callback {
        override fun onFailure(call: Call, e: IOException) {
            if (cont.isActive) cont.resumeWithException(e)
        }

        override fun onResponse(call: Call, response: Response) {
            if (cont.isActive) cont.resume(response) else response.close()
        }
    })
}
