package com.tatva.attendo.domain

import com.tatva.attendo.data.remote.ApiException
import com.tatva.attendo.data.remote.AttendoRemote
import com.tatva.attendo.data.remote.LeaveBalanceDto
import com.tatva.attendo.data.remote.LeaveRequestDto
import com.tatva.attendo.data.remote.LeaveTypeDto
import com.tatva.attendo.data.session.SessionManager
import java.time.LocalDate
import java.time.temporal.ChronoUnit

enum class LeaveFormError { TYPE_REQUIRED, DATES_REQUIRED, INVALID_DATES, DATE_TOO_OLD, DATE_TOO_FAR }

/** Client-side pre-checks that mirror the server rules. The server (apply_leave) stays the authority. */
object LeaveRules {
    const val MAX_SPAN_DAYS = 92L
    const val PAST_DAYS = 30L
    const val FUTURE_DAYS = 366L
    const val REASON_MAX = 500

    fun validate(typeId: String?, start: LocalDate?, end: LocalDate?, half: Boolean, today: LocalDate): LeaveFormError? = when {
        typeId == null -> LeaveFormError.TYPE_REQUIRED
        start == null || end == null -> LeaveFormError.DATES_REQUIRED
        end.isBefore(start) || ChronoUnit.DAYS.between(start, end) > MAX_SPAN_DAYS ||
            start.year != end.year || (half && start != end) -> LeaveFormError.INVALID_DATES
        start.isBefore(today.minusDays(PAST_DAYS)) -> LeaveFormError.DATE_TOO_OLD
        end.isAfter(today.plusDays(FUTURE_DAYS)) -> LeaveFormError.DATE_TOO_FAR
        else -> null
    }

    /** Pending or manager-approved requests, or approved ones that have not started. Server decides with the company's date. */
    fun canCancel(status: String, start: LocalDate, today: LocalDate): Boolean = when (status) {
        "pending", "manager_approved" -> true
        "approved" -> start.isAfter(today)
        else -> false
    }

    fun formatDays(d: Double): String = if (d % 1.0 == 0.0) d.toLong().toString() else "%.1f".format(java.util.Locale.ROOT, d)
}

data class LeaveOverview(val types: List<LeaveTypeDto>, val balances: List<LeaveBalanceDto>, val requests: List<LeaveRequestDto>)

class LeaveRepository(
    private val session: SessionManager,
    private val remote: AttendoRemote,
    private val today: () -> LocalDate = { LocalDate.now() },
) {
    suspend fun load(): LeaveOverview {
        val year = today().year
        val employeeId = session.authed { remote.profile(it) }?.id
            ?: throw ApiException.Server("EMPLOYEE_NOT_FOUND", "no employee record", 404)
        val types = session.authed { remote.leaveTypes(it) }
        val balances = session.authed { remote.leaveBalances(it, employeeId, year) }
        val requests = session.authed { remote.myLeaveRequests(it, employeeId) }
        return LeaveOverview(types, balances, requests)
    }

    suspend fun apply(typeId: String, start: LocalDate, end: LocalDate, half: Boolean, reason: String?): LeaveRequestDto =
        session.authed { remote.applyLeave(it, typeId, start.toString(), end.toString(), half, reason?.trim()?.takeIf { r -> r.isNotEmpty() }) }

    suspend fun cancel(requestId: String): LeaveRequestDto = session.authed { remote.cancelLeave(it, requestId) }
}
