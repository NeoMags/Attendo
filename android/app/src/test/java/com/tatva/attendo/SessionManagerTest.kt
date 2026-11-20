package com.tatva.attendo

import com.tatva.attendo.data.remote.ApiException
import com.tatva.attendo.data.session.SessionManager
import com.tatva.attendo.data.session.SessionState
import com.tatva.attendo.data.store.StoredSession
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.Assert.assertThrows

class SessionManagerTest {
    private var clock = 1_000_000L
    private val remote = FakeRemote()
    private val store = MemTokenStore()
    private fun mgr() = SessionManager(store, remote) { clock }

    private fun stored(expiresAt: Long = clock + 3_600_000, access: String = "a1", refresh: String = "r1") =
        StoredSession(access, refresh, expiresAt, false, "acme:e001")

    @Test fun login_stores_session_and_normalises_owner_key() = runTest {
        val m = mgr()
        m.login(" ACME ", "E001 ", "pw")
        assertEquals(SessionState.LoggedIn, m.state.value)
        assertEquals("acme:e001", m.ownerKey())
        assertEquals(clock + 3_600_000, store.s!!.expiresAtMs)
    }

    @Test fun login_with_must_change_flag_routes_to_change_password() = runTest {
        remote.loginResult = { token(mustChange = true) }
        val m = mgr(); m.login("acme", "e001", "pw")
        assertEquals(SessionState.MustChangePassword, m.state.value)
    }

    @Test fun failed_login_leaves_logged_out() = runTest {
        remote.loginResult = { throw ApiException.InvalidCredentials() }
        val m = mgr()
        assertThrows(ApiException.InvalidCredentials::class.java) { kotlinx.coroutines.runBlocking { m.login("a", "b", "c") } }
        assertEquals(SessionState.LoggedOut, m.state.value)
        assertNull(store.s)
    }

    @Test fun expired_token_is_refreshed_before_use_and_rotation_saved() = runTest {
        store.s = stored(expiresAt = clock + 10_000) // inside the 60s margin
        val m = mgr()
        m.authed { assertEquals("a2", it) }
        assertEquals(listOf("r1"), remote.refreshCalls)
        assertEquals("r2", store.s!!.refreshToken)
    }

    @Test fun valid_token_is_not_refreshed() = runTest {
        store.s = stored()
        mgr().authed { assertEquals("a1", it) }
        assertTrue(remote.refreshCalls.isEmpty())
    }

    @Test fun unauthorized_triggers_one_refresh_and_retry() = runTest {
        store.s = stored()
        var n = 0
        val r = mgr().authed { tok -> if (n++ == 0) throw ApiException.Unauthorized() else tok }
        assertEquals("a2", r)
        assertEquals(1, remote.refreshCalls.size)
    }

    @Test fun second_unauthorized_ends_the_session() = runTest {
        store.s = stored()
        val m = mgr()
        assertThrows(ApiException.SessionExpired::class.java) {
            kotlinx.coroutines.runBlocking { m.authed<Unit> { throw ApiException.Unauthorized() } }
        }
        assertEquals(SessionState.LoggedOut, m.state.value)
        assertNull(store.s)
    }

    @Test fun refresh_token_rejected_logs_out() = runTest {
        store.s = stored(expiresAt = clock)
        remote.refreshResult = { throw ApiException.SessionExpired() }
        val m = mgr()
        assertThrows(ApiException.SessionExpired::class.java) { kotlinx.coroutines.runBlocking { m.authed { } } }
        assertEquals(SessionState.LoggedOut, m.state.value)
    }

    @Test fun network_failure_during_refresh_keeps_session() = runTest {
        store.s = stored(expiresAt = clock)
        remote.refreshResult = { throw ApiException.Network(java.io.IOException("down")) }
        val m = mgr()
        assertThrows(ApiException.Network::class.java) { kotlinx.coroutines.runBlocking { m.authed { } } }
        assertEquals("r1", store.s!!.refreshToken)
        assertEquals(SessionState.LoggedIn, m.state.value)
    }

    @Test fun concurrent_calls_share_a_single_refresh() = runTest {
        store.s = stored(expiresAt = clock)
        val m = mgr()
        val tokens = (1..6).map { async { m.authed { it } } }.awaitAll()
        assertEquals(1, remote.refreshCalls.size)
        assertTrue(tokens.all { it == "a2" })
    }

    @Test fun change_password_clears_must_change_flag() = runTest {
        remote.loginResult = { token(mustChange = true) }
        val m = mgr(); m.login("acme", "e001", "pw")
        m.changePassword("NewPass123")
        assertEquals(SessionState.LoggedIn, m.state.value)
        assertEquals(false, store.s!!.mustChangePassword)
    }

    @Test fun logout_clears_store() = runTest {
        store.s = stored()
        val m = mgr(); m.logout()
        assertNull(store.s)
        assertEquals(SessionState.LoggedOut, m.state.value)
    }
}
