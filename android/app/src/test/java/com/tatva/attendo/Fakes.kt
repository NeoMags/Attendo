package com.tatva.attendo

import com.tatva.attendo.data.remote.*
import com.tatva.attendo.data.store.*
import com.tatva.attendo.location.Fix
import com.tatva.attendo.location.LocationProvider
import com.tatva.attendo.tracking.*
import kotlinx.serialization.json.JsonObject

class MemTokenStore(var s: StoredSession? = null) : TokenStore {
    override fun load() = s
    override fun save(session: StoredSession) { s = session }
    override fun clear() { s = null }
}

class MemPendingStore : PendingStore {
    var inn: PendingCheckIn? = null
    var out: PendingCheckOut? = null
    override fun checkIn() = inn
    override fun saveCheckIn(p: PendingCheckIn) { inn = p }
    override fun clearCheckIn() { inn = null }
    override fun checkOut() = out
    override fun saveCheckOut(p: PendingCheckOut) { out = p }
    override fun clearCheckOut() { out = null }
}

fun token(access: String = "a1", refresh: String = "r1", expiresIn: Long = 3600, mustChange: Boolean? = null) =
    TokenResponse(access, refresh, expiresIn, mustChange)

fun att(id: String = "att-1", status: String = "open") =
    AttendanceDto(id, "2026-11-20", status, "2026-11-20T04:00:00Z")

class FakeRemote : AttendoRemote {
    var loginResult: () -> TokenResponse = { token() }
    var refreshResult: (String) -> TokenResponse = { token("a2", "r2") }
    var checkInResult: (CheckInRequest) -> AttendanceDto = { att(it.attendanceId) }
    var checkOutResult: (CheckOutRequest) -> AttendanceDto = { att(it.attendanceId, "closed") }
    var open: AttendanceDto? = null
    var config: Map<String, Double> = emptyMap()
    var changePasswordResult: () -> Unit = {}

    val refreshCalls = mutableListOf<String>()
    val checkInCalls = mutableListOf<CheckInRequest>()
    val checkOutCalls = mutableListOf<CheckOutRequest>()
    var registerCalls = 0
    val tokensSeen = mutableListOf<String>()

    override suspend fun login(company: String, employeeCode: String, password: String) = loginResult()
    override suspend fun refresh(refreshToken: String): TokenResponse {
        refreshCalls += refreshToken
        kotlinx.coroutines.yield()
        return refreshResult(refreshToken)
    }
    override suspend fun changePassword(accessToken: String, newPassword: String) { tokensSeen += accessToken; changePasswordResult() }
    override suspend fun registerDevice(accessToken: String, deviceUid: String, model: String?, osVersion: String?, appVersion: String?): String {
        registerCalls++; return "dev-1"
    }
    override suspend fun checkIn(accessToken: String, req: CheckInRequest): AttendanceDto {
        tokensSeen += accessToken; checkInCalls += req; return checkInResult(req)
    }
    override suspend fun checkOut(accessToken: String, req: CheckOutRequest): AttendanceDto {
        tokensSeen += accessToken; checkOutCalls += req; return checkOutResult(req)
    }
    override suspend fun trackingConfig(accessToken: String) = TrackingConfig("2026-11-20T04:00:00Z", config)
    override suspend fun openAttendance(accessToken: String): AttendanceDto? { tokensSeen += accessToken; return open }
    var profileResult: EmployeeProfile? = null
    override suspend fun profile(accessToken: String): EmployeeProfile? = profileResult

    var leaveTypesResult: List<LeaveTypeDto> = emptyList()
    var balancesResult: List<LeaveBalanceDto> = emptyList()
    var requestsResult: List<LeaveRequestDto> = emptyList()
    var applyResult: (String, String, String, Boolean, String?) -> LeaveRequestDto = { _, s, e, h, r -> leaveReq("new", s, e, if (h) 0.5 else 1.0, "pending", r) }
    var cancelResult: (String) -> LeaveRequestDto = { leaveReq(it, "2026-12-01", "2026-12-01", 1.0, "cancelled") }
    val applyCalls = mutableListOf<List<Any?>>()
    val cancelCalls = mutableListOf<String>()
    val leaveBalanceCalls = mutableListOf<Pair<String, Int>>()
    var notifsResult: List<NotificationDto> = emptyList()
    var seenResult: String? = null
    val seenMarks = mutableListOf<String>()
    override suspend fun myNotifications(accessToken: String, employeeId: String) = notifsResult
    override suspend fun notifSeenAt(accessToken: String) = seenResult
    override suspend fun markNotificationsSeen(accessToken: String, isoNow: String) { seenMarks += isoNow; seenResult = isoNow }
    var myProfileResult: MyProfileDto? = null
    var myPayResult: MyPayDto? = null
    var myAttendanceResult: List<AttendanceDto> = emptyList()
    var documentResult: ByteArray? = null
    var usageResult: LeaveUsageDto? = null
    val attendanceFromDates = mutableListOf<String>()
    override suspend fun myProfileDetails(accessToken: String, employeeId: String) = myProfileResult
    override suspend fun myPayInfo(accessToken: String, employeeId: String) = myPayResult
    override suspend fun myAttendance(accessToken: String, employeeId: String, fromDate: String): List<AttendanceDto> { attendanceFromDates += fromDate; return myAttendanceResult }
    override suspend fun documentBytes(accessToken: String, path: String) = documentResult
    override suspend fun leaveUsage(accessToken: String, year: Int, month: Int) = usageResult
    override suspend fun leaveTypes(accessToken: String) = leaveTypesResult
    override suspend fun leaveBalances(accessToken: String, employeeId: String, year: Int): List<LeaveBalanceDto> {
        leaveBalanceCalls += employeeId to year; return balancesResult
    }
    override suspend fun myLeaveRequests(accessToken: String, employeeId: String) = requestsResult
    override suspend fun applyLeave(accessToken: String, leaveTypeId: String, startDate: String, endDate: String, halfDay: Boolean, reason: String?): LeaveRequestDto {
        applyCalls += listOf(leaveTypeId, startDate, endDate, halfDay, reason); return applyResult(leaveTypeId, startDate, endDate, halfDay, reason)
    }
    override suspend fun cancelLeave(accessToken: String, requestId: String): LeaveRequestDto { cancelCalls += requestId; return cancelResult(requestId) }

    var tasksResult: List<TaskDto> = emptyList()
    var taskTitlesResult: List<TaskTitleDto> = emptyList()
    var taskTitlesFails = false
    val progressCalls = mutableListOf<Triple<String, String, String?>>()
    var progressError: Throwable? = null
    override suspend fun myTasks(accessToken: String, employeeId: String) = tasksResult
    override suspend fun taskTitles(accessToken: String, ids: List<String>): List<TaskTitleDto> { if (taskTitlesFails) throw ApiException.Network(java.io.IOException("x")); return taskTitlesResult }
    override suspend fun setTaskProgress(accessToken: String, taskId: String, status: String, note: String?): TaskDto {
        progressCalls += Triple(taskId, status, note); progressError?.let { throw it }
        return TaskDto(taskId, null, "t", status = status)
    }

    var payslipsResult: List<PayslipDto> = emptyList()
    var advancesResult: List<AdvanceDto> = emptyList()
    var ledgerResult: List<LedgerDto> = emptyList()
    override suspend fun myPayslips(accessToken: String, employeeId: String) = payslipsResult
    override suspend fun myAdvances(accessToken: String, employeeId: String) = advancesResult
    override suspend fun myLedger(accessToken: String, employeeId: String) = ledgerResult

    var sessionLookup: String? = null
    var ingestResult: (String, List<LocationRecordDto>) -> IngestResult = { _, r -> IngestResult(accepted = r.size) }
    val ingestCalls = mutableListOf<Pair<String, List<LocationRecordDto>>>()
    val heartbeats = mutableListOf<JsonObject>()
    var heartbeatResult: () -> Unit = {}
    val interruptions = mutableListOf<String>()

    override suspend fun activeSessionId(accessToken: String, attendanceId: String) = sessionLookup
    override suspend fun ingestLocations(accessToken: String, sessionId: String, records: List<LocationRecordDto>): IngestResult {
        ingestCalls += sessionId to records
        return ingestResult(sessionId, records)
    }
    override suspend fun heartbeat(accessToken: String, payload: JsonObject) { heartbeats += payload; heartbeatResult() }
    override suspend fun reportInterruption(accessToken: String, id: String, sessionId: String, startedIso: String, endedIso: String?, reason: String, detail: String?) {
        interruptions += reason
    }
}

class MemQueue : LocationQueue {
    val rows = mutableListOf<QueuedPoint>()
    override suspend fun add(p: QueuedPoint) { if (rows.none { it.id == p.id }) rows += p }
    override suspend fun next(ownerKey: String, limit: Int) = rows.filter { it.ownerKey == ownerKey }.sortedBy { it.recordedAtMs }.take(limit)
    override suspend fun remove(ids: List<String>) { rows.removeAll { it.id in ids } }
    override suspend fun removeSession(sessionId: String) { rows.removeAll { it.sessionId == sessionId } }
    override suspend fun count(ownerKey: String) = rows.count { it.ownerKey == ownerKey }
    override suspend fun oldestMs(ownerKey: String) = rows.filter { it.ownerKey == ownerKey }.minOfOrNull { it.recordedAtMs }
}

class MemTrackingStore : TrackingStore {
    var a: ActiveTracking? = null
    override fun active() = a
    override fun start(a: ActiveTracking) { this.a = a }
    override fun stop() { a = null }
    override var lastFixMs = 0L
}

/** Mirrors the Android controller: persists state and records calls. */
class FakeTracking(private val store: TrackingStore) : TrackingController {
    val events = mutableListOf<String>()
    override fun start(a: ActiveTracking) { events += "start:${a.sessionId}"; store.start(a) }
    override fun stop() { events += "stop"; store.stop() }
}

fun pt(id: String, t: Long, session: String = "s1", owner: String = "acme:e001") =
    QueuedPoint(id, owner, session, 12.0, 77.0, 10f, null, null, null, 80, "fused", "wifi", false, t)

class FakeLocation(var next: () -> Fix = { Fix(12.97, 77.59, 15f, false) }) : LocationProvider {
    var calls = 0
    override suspend fun current(): Fix { calls++; return next() }
}

fun leaveReq(id: String, start: String, end: String, days: Double, status: String, reason: String? = null) =
    LeaveRequestDto(id = id, startDate = start, endDate = end, days = days, status = status, reason = reason)
