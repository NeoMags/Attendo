package com.tatva.attendo.data.remote

/** Typed failures from the Supabase REST / Edge Function layer. */
sealed class ApiException(message: String?, cause: Throwable? = null) : Exception(message, cause) {
    /** No connectivity / timeout. The request may or may not have reached the server. */
    class Network(cause: Throwable) : ApiException(cause.message, cause)

    /** Employee-login: wrong company code / Employee ID / password (uniform on purpose). */
    class InvalidCredentials : ApiException("INVALID_CREDENTIALS")

    class TooManyAttempts(val retryAfterMinutes: Int) : ApiException("TOO_MANY_ATTEMPTS")

    /** The access token was rejected (expired/invalid). Caller may refresh and retry once. */
    class Unauthorized : ApiException("UNAUTHORIZED")

    /** The refresh token is no longer valid; the user must sign in again. */
    class SessionExpired : ApiException("SESSION_EXPIRED")

    /**
     * Server rejected the request. [code] is the stable prefix our RPCs raise
     * (e.g. DUPLICATE_CHECKIN, ACCURACY_TOO_LOW) or an Auth error_code / HTTP_xxx.
     * A Server error is a definitive answer: the operation did not happen.
     */
    class Server(val code: String, val serverMessage: String, val httpStatus: Int) :
        ApiException("$code: $serverMessage")
}
