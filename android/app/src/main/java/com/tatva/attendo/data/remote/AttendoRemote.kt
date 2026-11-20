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
}
