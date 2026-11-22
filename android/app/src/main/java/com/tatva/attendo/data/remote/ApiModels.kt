package com.tatva.attendo.data.remote

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull

@Serializable
data class TokenResponse(
    @SerialName("access_token") val accessToken: String,
    @SerialName("refresh_token") val refreshToken: String,
    @SerialName("expires_in") val expiresIn: Long,
    @SerialName("must_change_password") val mustChangePasswordFlag: Boolean? = null,
    val user: AuthUser? = null,
) {
    /** Login returns an explicit flag; refresh returns it in user_metadata. null = not reported. */
    val mustChangePassword: Boolean?
        get() = mustChangePasswordFlag
            ?: (user?.userMetadata?.get("must_change_password") as? JsonPrimitive)?.booleanOrNull
}

@Serializable
data class AuthUser(@SerialName("user_metadata") val userMetadata: JsonObject? = null)

@Serializable
data class AttendanceDto(
    val id: String,
    @SerialName("work_date") val workDate: String,
    val status: String,
    @SerialName("check_in_at") val checkInAt: String,
    @SerialName("check_out_at") val checkOutAt: String? = null,
    @SerialName("late_minutes") val lateMinutes: Int = 0,
    @SerialName("worked_seconds") val workedSeconds: Int? = null,
)

@Serializable
data class CompanyRef(val name: String)

@Serializable
data class EmployeeProfile(
    val id: String? = null,
    @SerialName("employee_code") val employeeCode: String,
    @SerialName("full_name") val fullName: String,
    @SerialName("preferred_language") val preferredLanguage: String = "en",
    val companies: CompanyRef? = null,
)

@Serializable
data class TrackingConfig(
    @SerialName("server_time") val serverTime: String,
    val settings: Map<String, Double> = emptyMap(),
)

data class CheckInRequest(
    val attendanceId: String,
    val sessionId: String,
    val deviceUid: String,
    val recordedAtIso: String,
    val lat: Double,
    val lng: Double,
    val accuracyM: Float,
)

data class CheckOutRequest(
    val attendanceId: String,
    val recordedAtIso: String,
    val lat: Double?,
    val lng: Double?,
    val accuracyM: Float?,
)

@Serializable
data class LocationRecordDto(
    val id: String,
    val latitude: Double,
    val longitude: Double,
    val accuracy: Float? = null,
    val speed: Float? = null,
    val bearing: Float? = null,
    val altitude: Double? = null,
    @SerialName("battery_percentage") val batteryPercentage: Int? = null,
    val provider: String? = null,
    @SerialName("network_status") val networkStatus: String? = null,
    @SerialName("is_mock") val isMock: Boolean = false,
    @SerialName("recorded_at") val recordedAt: String,
)

@Serializable
data class RejectedRecord(val id: String? = null, val reason: String)

@Serializable
data class IngestResult(
    val accepted: Int = 0,
    val duplicates: Int = 0,
    val rejected: List<RejectedRecord> = emptyList(),
)

@Serializable
data class SessionRef(val id: String)

@Serializable
data class LeaveTypeDto(
    val id: String,
    val name: String,
    @SerialName("annual_quota_days") val annualQuotaDays: Double? = null,
    @SerialName("is_paid") val isPaid: Boolean = true,
)

@Serializable
data class LeaveBalanceDto(
    @SerialName("leave_type_id") val leaveTypeId: String,
    val name: String,
    @SerialName("annual_quota_days") val annualQuotaDays: Double? = null,
    @SerialName("approved_days") val approvedDays: Double = 0.0,
    @SerialName("pending_days") val pendingDays: Double = 0.0,
    @SerialName("remaining_days") val remainingDays: Double? = null,
)

@Serializable
data class LeaveTypeRef(val name: String)

@Serializable
data class LeaveRequestDto(
    val id: String,
    @SerialName("start_date") val startDate: String,
    @SerialName("end_date") val endDate: String,
    val days: Double,
    @SerialName("is_half_day") val isHalfDay: Boolean = false,
    val reason: String? = null,
    val status: String,
    @SerialName("manager_note") val managerNote: String? = null,
    @SerialName("decision_note") val decisionNote: String? = null,
    @SerialName("leave_types") val leaveType: LeaveTypeRef? = null,
)

@Serializable data class NotificationDto(val id: String, val kind: String = "", val title: String, val body: String? = null, @SerialName("created_at") val createdAt: String)
@Serializable data class UserPrefsDto(@SerialName("notif_seen_at") val notifSeenAt: String? = null)
