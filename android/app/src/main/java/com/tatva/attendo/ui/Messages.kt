package com.tatva.attendo.ui

import com.tatva.attendo.data.remote.ApiException
import com.tatva.attendo.domain.DomainError

enum class MsgKind {
    INVALID_CREDENTIALS, TOO_MANY_ATTEMPTS, NETWORK, SESSION_EXPIRED, REQUIRED,
    PASSWORD_WEAK, PASSWORD_MISMATCH, PASSWORD_SAME,
    PERMISSION_NEEDED, LOCATION_UNAVAILABLE, MOCK_LOCATION, ACCURACY_TOO_LOW,
    DUPLICATE_CHECKIN, DEVICE_LIMIT, DEVICE_BLOCKED, BAD_TIMESTAMP, COMPANY_INACTIVE, EMPLOYEE_NOT_FOUND,
    GENERIC, CHECKED_IN, CHECKED_OUT,
    LEAVE_APPLIED, LEAVE_CANCELLED, LEAVE_PICK_TYPE, LEAVE_PICK_DATES, LEAVE_INVALID_DATES, LEAVE_DATE_TOO_OLD, LEAVE_DATE_TOO_FAR,
    LEAVE_OVERLAP, LEAVE_INSUFFICIENT_BALANCE, LEAVE_NO_WORKING_DAYS, LEAVE_TYPE_UNAVAILABLE, LEAVE_NOT_CANCELLABLE, LEAVE_NOT_FOUND,
}

/** Language-neutral message; the UI maps [kind] to a string resource and fills [args]. */
data class UiMessage(val kind: MsgKind, val args: List<Any> = emptyList())

fun Throwable.toUiMessage(): UiMessage = when (this) {
    is ApiException.Network -> UiMessage(MsgKind.NETWORK)
    is ApiException.InvalidCredentials -> UiMessage(MsgKind.INVALID_CREDENTIALS)
    is ApiException.TooManyAttempts -> UiMessage(MsgKind.TOO_MANY_ATTEMPTS, listOf(retryAfterMinutes))
    is ApiException.SessionExpired, is ApiException.Unauthorized -> UiMessage(MsgKind.SESSION_EXPIRED)
    is ApiException.Server -> when (code) {
        "DUPLICATE_CHECKIN" -> UiMessage(MsgKind.DUPLICATE_CHECKIN)
        "DEVICE_LIMIT_REACHED" -> UiMessage(MsgKind.DEVICE_LIMIT)
        "DEVICE_BLOCKED" -> UiMessage(MsgKind.DEVICE_BLOCKED)
        "TIMESTAMP_IN_FUTURE", "TIMESTAMP_TOO_OLD" -> UiMessage(MsgKind.BAD_TIMESTAMP)
        "COMPANY_INACTIVE" -> UiMessage(MsgKind.COMPANY_INACTIVE)
        "EMPLOYEE_NOT_FOUND", "NO_EMPLOYEE" -> UiMessage(MsgKind.EMPLOYEE_NOT_FOUND)
        "LEAVE_OVERLAP" -> UiMessage(MsgKind.LEAVE_OVERLAP)
        "INSUFFICIENT_BALANCE" -> UiMessage(MsgKind.LEAVE_INSUFFICIENT_BALANCE)
        "NO_WORKING_DAYS" -> UiMessage(MsgKind.LEAVE_NO_WORKING_DAYS)
        "INVALID_DATES" -> UiMessage(MsgKind.LEAVE_INVALID_DATES)
        "DATE_TOO_OLD" -> UiMessage(MsgKind.LEAVE_DATE_TOO_OLD)
        "DATE_TOO_FAR" -> UiMessage(MsgKind.LEAVE_DATE_TOO_FAR)
        "LEAVE_TYPE_NOT_FOUND" -> UiMessage(MsgKind.LEAVE_TYPE_UNAVAILABLE)
        "INVALID_STATE" -> UiMessage(MsgKind.LEAVE_NOT_CANCELLABLE)
        "LEAVE_NOT_FOUND" -> UiMessage(MsgKind.LEAVE_NOT_FOUND)
        "weak_password" -> UiMessage(MsgKind.PASSWORD_WEAK)
        "same_password" -> UiMessage(MsgKind.PASSWORD_SAME)
        "ACCURACY_TOO_LOW" -> UiMessage(MsgKind.ACCURACY_TOO_LOW, listOf(0, 0))
        else -> UiMessage(MsgKind.GENERIC, listOf(code))
    }
    is DomainError.PermissionMissing -> UiMessage(MsgKind.PERMISSION_NEEDED)
    is DomainError.LocationUnavailable -> UiMessage(MsgKind.LOCATION_UNAVAILABLE)
    is DomainError.MockLocation -> UiMessage(MsgKind.MOCK_LOCATION)
    is DomainError.AccuracyTooLow -> UiMessage(MsgKind.ACCURACY_TOO_LOW, listOf(actualM, maxM))
    else -> UiMessage(MsgKind.GENERIC, listOf(javaClass.simpleName))
}
