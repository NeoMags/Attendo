package com.tatva.attendo.data.session

import com.tatva.attendo.data.remote.ApiException
import com.tatva.attendo.data.remote.AttendoRemote
import com.tatva.attendo.data.store.StoredSession
import com.tatva.attendo.data.store.TokenStore
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

sealed interface SessionState {
    data object LoggedOut : SessionState
    data object MustChangePassword : SessionState
    data object LoggedIn : SessionState
}

/**
 * Owns the signed-in session: login, proactive + reactive token refresh (single-flight, because
 * refresh tokens rotate), password change and logout.
 */
class SessionManager(
    private val store: TokenStore,
    private val remote: AttendoRemote,
    private val now: () -> Long = System::currentTimeMillis,
) {
    private val mutex = Mutex()
    private val _state = MutableStateFlow(stateOf(store.load()))
    val state: StateFlow<SessionState> = _state.asStateFlow()

    fun ownerKey(): String? = store.load()?.ownerKey

    suspend fun login(company: String, employeeCode: String, password: String) {
        val c = company.trim().lowercase()
        val e = employeeCode.trim()
        val t = remote.login(c, e, password)
        val s = StoredSession(
            accessToken = t.accessToken,
            refreshToken = t.refreshToken,
            expiresAtMs = now() + t.expiresIn * 1000,
            mustChangePassword = t.mustChangePassword ?: false,
            ownerKey = "$c:${e.lowercase()}",
        )
        mutex.withLock { store.save(s) }
        _state.value = stateOf(s)
    }

    /** Runs [block] with a valid access token; on a 401 refreshes once and retries. */
    suspend fun <T> authed(block: suspend (accessToken: String) -> T): T {
        val token = validAccessToken()
        return try {
            block(token)
        } catch (e: ApiException.Unauthorized) {
            val fresh = refreshAfterRejection(token)
            try {
                block(fresh)
            } catch (e2: ApiException.Unauthorized) {
                expire()
                throw ApiException.SessionExpired()
            }
        }
    }

    suspend fun changePassword(newPassword: String) {
        authed { remote.changePassword(it, newPassword) }
        mutex.withLock { store.load()?.let { store.save(it.copy(mustChangePassword = false)) } }
        _state.value = SessionState.LoggedIn
    }

    suspend fun logout() {
        mutex.withLock { store.clear() }
        _state.value = SessionState.LoggedOut
    }

    private suspend fun validAccessToken(): String = mutex.withLock {
        val s = store.load() ?: throw ApiException.SessionExpired()
        if (s.expiresAtMs - now() > REFRESH_MARGIN_MS) s.accessToken else refreshLocked(s)
    }

    /** Another coroutine may already have refreshed after [rejected] failed; reuse that token. */
    private suspend fun refreshAfterRejection(rejected: String): String = mutex.withLock {
        val s = store.load() ?: throw ApiException.SessionExpired()
        if (s.accessToken != rejected) s.accessToken else refreshLocked(s)
    }

    private suspend fun refreshLocked(s: StoredSession): String {
        val t = try {
            remote.refresh(s.refreshToken)
        } catch (e: ApiException.SessionExpired) {
            store.clear()
            _state.value = SessionState.LoggedOut
            throw e
        }
        val updated = s.copy(
            accessToken = t.accessToken,
            refreshToken = t.refreshToken,
            expiresAtMs = now() + t.expiresIn * 1000,
            mustChangePassword = t.mustChangePassword ?: s.mustChangePassword,
        )
        store.save(updated)
        return updated.accessToken
    }

    private suspend fun expire() {
        mutex.withLock { store.clear() }
        _state.value = SessionState.LoggedOut
    }

    private fun stateOf(s: StoredSession?): SessionState = when {
        s == null -> SessionState.LoggedOut
        s.mustChangePassword -> SessionState.MustChangePassword
        else -> SessionState.LoggedIn
    }

    private companion object { const val REFRESH_MARGIN_MS = 60_000L }
}
