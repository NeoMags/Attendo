package com.tatva.attendo.domain

/** Failures that originate on the device (not the server). */
sealed class DomainError(message: String) : Exception(message) {
    class PermissionMissing : DomainError("PERMISSION_MISSING")
    class LocationUnavailable : DomainError("LOCATION_UNAVAILABLE")
    class MockLocation : DomainError("MOCK_LOCATION")
    class AccuracyTooLow(val actualM: Int, val maxM: Int) : DomainError("ACCURACY_TOO_LOW")
}

enum class PasswordCheck { OK, TOO_WEAK }

object PasswordRules {
    const val MIN_LENGTH = 8
    const val MAX_LENGTH = 72

    /** Client-side pre-check only; the server remains the authority. */
    fun check(pw: String): PasswordCheck =
        if (pw.length in MIN_LENGTH..MAX_LENGTH && pw.any { it.isLetter() } && pw.any { it.isDigit() }) PasswordCheck.OK
        else PasswordCheck.TOO_WEAK
}
