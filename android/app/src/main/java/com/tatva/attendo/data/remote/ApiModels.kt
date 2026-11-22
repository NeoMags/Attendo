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

@Serializable data class MyProfileDto(
    @SerialName("photo_path") val photoPath: String? = null, val address: String? = null, val phone: String? = null,
    @SerialName("alt_phone") val altPhone: String? = null, @SerialName("referred_by") val referredBy: String? = null,
    @SerialName("date_of_birth") val dateOfBirth: String? = null, val designation: String? = null,
    @SerialName("emergency_name") val emergencyName: String? = null, @SerialName("emergency_phone") val emergencyPhone: String? = null,
)
@Serializable data class MyPayDto(
    @SerialName("pay_type") val payType: String, @SerialName("monthly_salary") val monthlySalary: Double? = null, @SerialName("daily_wage") val dailyWage: Double? = null,
    @SerialName("pf_eligible") val pfEligible: Boolean = false, @SerialName("esi_eligible") val esiEligible: Boolean = false,
    @SerialName("aadhaar_last4") val aadhaarLast4: String? = null, @SerialName("bank_name") val bankName: String? = null,
)
@Serializable data class LeaveUsageDto(@SerialName("limit_per_month") val limitPerMonth: Int? = null, val used: Int = 0)

@Serializable
data class TaskDto(
    val id: String,
    @SerialName("parent_id") val parentId: String? = null,
    val title: String,
    val description: String? = null,
    val priority: String = "normal",
    @SerialName("due_date") val dueDate: String? = null,
    val status: String,
    @SerialName("submit_note") val submitNote: String? = null,
    @SerialName("review_note") val reviewNote: String? = null,
)
@Serializable data class TaskTitleDto(val id: String, val title: String)

@Serializable
data class PayslipDto(
    val id: String,
    val month: String,
    @SerialName("pay_type") val payType: String = "monthly",
    @SerialName("working_days") val workingDays: Double = 0.0,
    @SerialName("present_days") val presentDays: Double = 0.0,
    @SerialName("holiday_days") val holidayDays: Double = 0.0,
    @SerialName("paid_leave_days") val paidLeaveDays: Double = 0.0,
    @SerialName("unpaid_leave_days") val unpaidLeaveDays: Double = 0.0,
    @SerialName("absent_days") val absentDays: Double = 0.0,
    val gross: Double = 0.0,
    val bonus: Double = 0.0,
    @SerialName("other_deduction") val otherDeduction: Double = 0.0,
    @SerialName("advance_deduction") val advanceDeduction: Double = 0.0,
    val net: Double = 0.0,
    @SerialName("adjustment_note") val adjustmentNote: String? = null,
    @SerialName("paid_on") val paidOn: String? = null,
    @SerialName("payment_mode") val paymentMode: String? = null,
)

@Serializable
data class AdvanceDto(
    val id: String,
    val amount: Double,
    @SerialName("given_on") val givenOn: String,
    val reason: String? = null,
    @SerialName("monthly_deduction") val monthlyDeduction: Double? = null,
    val recovered: Double = 0.0,
    val remaining: Double = 0.0,
    val voided: Boolean = false,
)

@Serializable
data class LedgerDto(
    val id: String,
    @SerialName("entry_date") val entryDate: String,
    val kind: String,
    val amount: Double,
    val direction: String,
    val note: String? = null,
)

@Serializable
data class TaxScenarioDto(
    val regime: String = "new",
    val deductions: Double = 0.0,
    val taxable: Double = 0.0,
    val total: Double = 0.0,
)

@Serializable
data class TaxProjectionDto(
    @SerialName("tax_year") val taxYear: Int = 0,
    @SerialName("months_left") val monthsLeft: Int = 0,
    val regime: String = "new",
    @SerialName("annual_gross") val annualGross: Double = 0.0,
    val selected: TaxScenarioDto = TaxScenarioDto(),
    val new: TaxScenarioDto = TaxScenarioDto(),
    val old: TaxScenarioDto = TaxScenarioDto("old"),
    @SerialName("monthly_tds") val monthlyTds: Double = 0.0,
    val warnings: List<String> = emptyList(),
)

@Serializable
data class TaxDeclarationDto(
    val regime: String = "new",
    @SerialName("sec_80c") val sec80c: Double = 0.0,
    @SerialName("sec_80ccd1b") val sec80ccd1b: Double = 0.0,
    @SerialName("sec_80d_self") val sec80dSelf: Double = 0.0,
    @SerialName("sec_80d_parents") val sec80dParents: Double = 0.0,
    @SerialName("parents_senior") val parentsSenior: Boolean = false,
    @SerialName("hra_exemption") val hraExemption: Double = 0.0,
    @SerialName("home_loan_interest") val homeLoanInterest: Double = 0.0,
    @SerialName("other_deductions") val otherDeductions: Double = 0.0,
    @SerialName("prev_employer_income") val prevEmployerIncome: Double = 0.0,
    @SerialName("prev_employer_tds") val prevEmployerTds: Double = 0.0,
)
