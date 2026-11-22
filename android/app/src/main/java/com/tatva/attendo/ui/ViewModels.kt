package com.tatva.attendo.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.tatva.attendo.AppContainer
import com.tatva.attendo.data.remote.ApiException
import com.tatva.attendo.data.remote.EmployeeProfile
import com.tatva.attendo.data.session.SessionManager
import com.tatva.attendo.domain.AttendanceRepository
import com.tatva.attendo.domain.PasswordCheck
import com.tatva.attendo.domain.PasswordRules
import com.tatva.attendo.domain.TodayState
import com.tatva.attendo.tracking.TrackingController
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

// ------------------------------------------------------------------ login
data class LoginUi(
    val company: String = "",
    val employeeId: String = "",
    val password: String = "",
    val loading: Boolean = false,
    val error: UiMessage? = null,
    val missing: Set<String> = emptySet(), // "company" | "employeeId" | "password"
)

class LoginViewModel(private val session: SessionManager) : ViewModel() {
    private val _ui = MutableStateFlow(LoginUi())
    val ui: StateFlow<LoginUi> = _ui.asStateFlow()

    fun onCompany(v: String) = _ui.update { it.copy(company = v, error = null, missing = it.missing - "company") }
    fun onEmployeeId(v: String) = _ui.update { it.copy(employeeId = v, error = null, missing = it.missing - "employeeId") }
    fun onPassword(v: String) = _ui.update { it.copy(password = v, error = null, missing = it.missing - "password") }

    fun submit() {
        val s = _ui.value
        if (s.loading) return
        val missing = buildSet {
            if (s.company.isBlank()) add("company")
            if (s.employeeId.isBlank()) add("employeeId")
            if (s.password.isEmpty()) add("password")
        }
        if (missing.isNotEmpty()) {
            _ui.update { it.copy(missing = missing) }
            return
        }
        _ui.update { it.copy(loading = true, error = null) }
        viewModelScope.launch {
            try {
                session.login(s.company, s.employeeId, s.password)
                _ui.update { it.copy(loading = false, password = "") }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                _ui.update { it.copy(loading = false, error = e.toUiMessage()) }
            }
        }
    }
}

// -------------------------------------------------------- change password
data class ChangePasswordUi(
    val password: String = "",
    val confirm: String = "",
    val loading: Boolean = false,
    val error: UiMessage? = null,
)

class ChangePasswordViewModel(private val session: SessionManager) : ViewModel() {
    private val _ui = MutableStateFlow(ChangePasswordUi())
    val ui: StateFlow<ChangePasswordUi> = _ui.asStateFlow()

    fun onPassword(v: String) = _ui.update { it.copy(password = v, error = null) }
    fun onConfirm(v: String) = _ui.update { it.copy(confirm = v, error = null) }

    fun submit() {
        val s = _ui.value
        if (s.loading) return
        validate(s.password, s.confirm)?.let { err -> _ui.update { it.copy(error = err) }; return }
        _ui.update { it.copy(loading = true, error = null) }
        viewModelScope.launch {
            try {
                session.changePassword(s.password)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                _ui.update { it.copy(loading = false, error = e.toUiMessage()) }
            }
        }
    }

    fun signOut() = viewModelScope.launch { session.logout() }

    companion object {
        fun validate(password: String, confirm: String): UiMessage? = when {
            PasswordRules.check(password) != PasswordCheck.OK -> UiMessage(MsgKind.PASSWORD_WEAK)
            password != confirm -> UiMessage(MsgKind.PASSWORD_MISMATCH)
            else -> null
        }
    }
}

// ------------------------------------------------------------------- home
data class HomeUi(
    val loading: Boolean = true,
    val busy: Boolean = false,
    val profile: EmployeeProfile? = null,
    val today: TodayState? = null,
    val message: UiMessage? = null,
    val queued: Int = 0,
)

class HomeViewModel(
    private val repo: AttendanceRepository,
    private val session: SessionManager,
    private val tracking: TrackingController,
    private val queuedCount: suspend () -> Int,
    private val loadProfile: suspend () -> EmployeeProfile?,
) : ViewModel() {
    private val _ui = MutableStateFlow(HomeUi())
    val ui: StateFlow<HomeUi> = _ui.asStateFlow()

    init { refresh() }

    fun refresh() {
        _ui.update { it.copy(loading = true) }
        viewModelScope.launch {
            val profile = runCatching { loadProfile() }.getOrNull()
            try {
                val today = repo.loadToday()
                val q = queuedOrZero()
                _ui.update { it.copy(loading = false, today = today, profile = profile ?: it.profile, queued = q) }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                _ui.update { it.copy(loading = false, profile = profile ?: it.profile, message = e.toUiMessage()) }
            }
        }
    }

    fun checkIn() = act(MsgKind.CHECKED_IN) { repo.checkIn() }

    fun checkOut() {
        val open = _ui.value.today?.open ?: return
        act(MsgKind.CHECKED_OUT) { repo.checkOut(open.id) }
    }

    private suspend fun queuedOrZero(): Int = try {
        queuedCount()
    } catch (e: CancellationException) {
        throw e
    } catch (e: Exception) {
        0
    }

    fun onPermissionDenied() = _ui.update { it.copy(message = UiMessage(MsgKind.PERMISSION_NEEDED)) }
    fun consumeMessage() = _ui.update { it.copy(message = null) }
    fun signOut() = viewModelScope.launch {
        tracking.stop() // can't upload without a session; sign-in resumes tracking from the server's open shift
        session.logout()
    }

    private fun act(success: MsgKind, block: suspend () -> Unit) {
        if (_ui.value.busy) return
        _ui.update { it.copy(busy = true, message = null) }
        viewModelScope.launch {
            var msg: UiMessage? = UiMessage(success)
            try {
                block()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                msg = e.toUiMessage()
            }
            // Always re-read: after a network failure the pending item must show; after success the new state.
            val today = try {
                repo.loadToday()
            } catch (e: CancellationException) {
                throw e
            } catch (e: ApiException) {
                _ui.value.today
            }
            val q = queuedOrZero()
            _ui.update { it.copy(busy = false, today = today, message = msg, queued = q) }
        }
    }
}

// ---------------------------------------------------------------- factory
@Suppress("UNCHECKED_CAST")
class VmFactory(private val c: AppContainer) : ViewModelProvider.Factory {
    override fun <T : ViewModel> create(modelClass: Class<T>): T = when (modelClass) {
        LoginViewModel::class.java -> LoginViewModel(c.session)
        ChangePasswordViewModel::class.java -> ChangePasswordViewModel(c.session)
        HomeViewModel::class.java -> HomeViewModel(
            c.attendance, c.session, c.tracking,
            { c.session.ownerKey()?.let { o -> c.locationQueue.count(o) } ?: 0 },
        ) { c.session.authed { c.remote.profile(it) } }
        LeaveViewModel::class.java -> LeaveViewModel(c.leave)
        TasksViewModel::class.java -> TasksViewModel(c.tasks)
        PayrollViewModel::class.java -> PayrollViewModel(c.payroll)
        TaxViewModel::class.java -> TaxViewModel(c.tax)
        MyDetailsViewModel::class.java -> MyDetailsViewModel(c.myDetails)
        NotificationsViewModel::class.java -> NotificationsViewModel(c.notifications)
        else -> error("Unknown ViewModel ${modelClass.name}")
    } as T
}
