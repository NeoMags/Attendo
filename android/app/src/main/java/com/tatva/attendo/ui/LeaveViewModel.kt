package com.tatva.attendo.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.tatva.attendo.data.remote.LeaveBalanceDto
import com.tatva.attendo.data.remote.LeaveRequestDto
import com.tatva.attendo.data.remote.LeaveTypeDto
import com.tatva.attendo.domain.LeaveFormError
import com.tatva.attendo.domain.LeaveRepository
import com.tatva.attendo.domain.LeaveRules
import java.time.LocalDate
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class LeaveUi(
    val loading: Boolean = true,
    val busy: Boolean = false,
    val types: List<LeaveTypeDto> = emptyList(),
    val balances: List<LeaveBalanceDto> = emptyList(),
    val requests: List<LeaveRequestDto> = emptyList(),
    val usage: com.tatva.attendo.data.remote.LeaveUsageDto? = null,
    val typeId: String? = null,
    val start: LocalDate? = null,
    val end: LocalDate? = null,
    val half: Boolean = false,
    val reason: String = "",
    val message: UiMessage? = null,
)

fun LeaveFormError.toUiMessage(): UiMessage = UiMessage(
    when (this) {
        LeaveFormError.TYPE_REQUIRED -> MsgKind.LEAVE_PICK_TYPE
        LeaveFormError.DATES_REQUIRED -> MsgKind.LEAVE_PICK_DATES
        LeaveFormError.INVALID_DATES -> MsgKind.LEAVE_INVALID_DATES
        LeaveFormError.DATE_TOO_OLD -> MsgKind.LEAVE_DATE_TOO_OLD
        LeaveFormError.DATE_TOO_FAR -> MsgKind.LEAVE_DATE_TOO_FAR
    },
)

class LeaveViewModel(
    private val repo: LeaveRepository,
    private val today: () -> LocalDate = { LocalDate.now() },
) : ViewModel() {
    private val _ui = MutableStateFlow(LeaveUi())
    val ui: StateFlow<LeaveUi> = _ui.asStateFlow()

    init { refresh() }

    fun refresh() {
        _ui.update { it.copy(loading = true) }
        viewModelScope.launch {
            try {
                val o = repo.load()
                _ui.update { s ->
                    s.copy(
                        loading = false, types = o.types, balances = o.balances, requests = o.requests, usage = o.usage,
                        typeId = s.typeId?.takeIf { id -> o.types.any { t -> t.id == id } } ?: o.types.singleOrNull()?.id,
                    )
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                _ui.update { it.copy(loading = false, message = e.toUiMessage()) }
            }
        }
    }

    fun onType(id: String) = _ui.update { it.copy(typeId = id, message = null) }
    fun onStart(d: LocalDate) = _ui.update { s ->
        val end = if (s.half || s.end == null || s.end.isBefore(d)) d else s.end
        s.copy(start = d, end = end, message = null)
    }
    fun onEnd(d: LocalDate) = _ui.update { it.copy(end = d, message = null) }
    fun onHalf(v: Boolean) = _ui.update { s -> s.copy(half = v, end = if (v) s.start else s.end, message = null) }
    fun onReason(v: String) = _ui.update { it.copy(reason = v.take(LeaveRules.REASON_MAX)) }
    fun consumeMessage() = _ui.update { it.copy(message = null) }

    fun submit() {
        val s = _ui.value
        if (s.busy) return
        LeaveRules.validate(s.typeId, s.start, s.end, s.half, today())?.let { err ->
            _ui.update { it.copy(message = err.toUiMessage()) }
            return
        }
        _ui.update { it.copy(busy = true, message = null) }
        viewModelScope.launch {
            var msg = UiMessage(MsgKind.LEAVE_APPLIED)
            var applied = true
            try {
                repo.apply(s.typeId!!, s.start!!, s.end!!, s.half, s.reason)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                msg = e.toUiMessage(); applied = false
            }
            _ui.update { it.copy(busy = false, message = msg, start = if (applied) null else it.start, end = if (applied) null else it.end,
                half = if (applied) false else it.half, reason = if (applied) "" else it.reason) }
            reload()
        }
    }

    fun cancel(requestId: String) {
        if (_ui.value.busy) return
        _ui.update { it.copy(busy = true, message = null) }
        viewModelScope.launch {
            val msg = try {
                repo.cancel(requestId); UiMessage(MsgKind.LEAVE_CANCELLED)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                e.toUiMessage()
            }
            _ui.update { it.copy(busy = false, message = msg) }
            reload()
        }
    }

    /** Re-read lists after an action (also after a failure: the server may have a newer state) without clearing the message. */
    private suspend fun reload() {
        try {
            val o = repo.load()
            _ui.update { it.copy(types = o.types, balances = o.balances, requests = o.requests, usage = o.usage) }
        } catch (e: CancellationException) {
            throw e
        } catch (_: Exception) {
            // Keep the previous lists; the action's own message is already shown.
        }
    }
}
