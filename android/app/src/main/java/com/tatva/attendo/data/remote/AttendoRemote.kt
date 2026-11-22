package com.tatva.attendo.data.remote

import kotlinx.serialization.json.JsonObject

/** Everything the app needs from the backend. Faked in unit tests. */
interface AttendoRemote {
    suspend fun login(company: String, employeeCode: String, password: String): TokenResponse
    suspend fun refresh(refreshToken: String): TokenResponse
    suspend fun changePassword(accessToken: String, newPassword: String)
    suspend fun registerDevice(
        accessToken: String, deviceUid: String, model: String?, osVersion: String?, appVersion: String?,
    ): String

    suspend fun checkIn(accessToken: String, req: CheckInRequest): AttendanceDto
    suspend fun checkOut(accessToken: String, req: CheckOutRequest): AttendanceDto
    suspend fun trackingConfig(accessToken: String): TrackingConfig
    suspend fun openAttendance(accessToken: String): AttendanceDto?
    suspend fun profile(accessToken: String): EmployeeProfile?

    suspend fun activeSessionId(accessToken: String, attendanceId: String): String?
    suspend fun ingestLocations(accessToken: String, sessionId: String, records: List<LocationRecordDto>): IngestResult
    suspend fun heartbeat(accessToken: String, payload: JsonObject)
    suspend fun reportInterruption(
        accessToken: String, id: String, sessionId: String, startedIso: String, endedIso: String?, reason: String, detail: String?,
    )

    // Leave: reads are filtered by RLS; every write goes through a server-side rule-checking RPC.
    suspend fun leaveTypes(accessToken: String): List<LeaveTypeDto>
    suspend fun leaveBalances(accessToken: String, employeeId: String, year: Int): List<LeaveBalanceDto>
    suspend fun myLeaveRequests(accessToken: String, employeeId: String): List<LeaveRequestDto>
    suspend fun applyLeave(
        accessToken: String, leaveTypeId: String, startDate: String, endDate: String, halfDay: Boolean, reason: String?,
    ): LeaveRequestDto
    suspend fun cancelLeave(accessToken: String, requestId: String): LeaveRequestDto

    suspend fun myNotifications(accessToken: String, employeeId: String): List<NotificationDto>
    suspend fun notifSeenAt(accessToken: String): String?
    suspend fun markNotificationsSeen(accessToken: String, isoNow: String)

    suspend fun myProfileDetails(accessToken: String, employeeId: String): MyProfileDto?
    suspend fun myPayInfo(accessToken: String, employeeId: String): MyPayDto?
    suspend fun myAttendance(accessToken: String, employeeId: String, fromDate: String): List<AttendanceDto>
    suspend fun documentBytes(accessToken: String, path: String): ByteArray?
    suspend fun leaveUsage(accessToken: String, year: Int, month: Int): LeaveUsageDto?

    // Tasks: reads filtered by RLS; progress changes go through set_task_progress (assignee only).
    suspend fun myTasks(accessToken: String, employeeId: String): List<TaskDto>
    suspend fun taskTitles(accessToken: String, ids: List<String>): List<TaskTitleDto>
    suspend fun setTaskProgress(accessToken: String, taskId: String, status: String, note: String?): TaskDto

    // Payroll: employees can read only their own finalized payslips, advances and ledger (RLS).
    suspend fun myPayslips(accessToken: String, employeeId: String): List<PayslipDto>
    suspend fun myAdvances(accessToken: String, employeeId: String): List<AdvanceDto>
    suspend fun myLedger(accessToken: String, employeeId: String): List<LedgerDto>
}
