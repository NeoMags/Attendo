package com.tatva.attendo.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.tatva.attendo.data.remote.NotificationDto
import com.tatva.attendo.domain.NotificationRepository
import com.tatva.attendo.domain.NotificationRules
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class NotificationsUi(
    val items: List<NotificationDto> = emptyList(),
    val seenAt: String? = null,
    val unread: Int = 0,
    val loading: Boolean = false,
    val message: UiMessage? = null,
)

class NotificationsViewModel(
    private val repo: NotificationRepository,
    private val nowMs: () -> Long = { System.currentTimeMillis() },
) : ViewModel() {
    private val _ui = MutableStateFlow(NotificationsUi())
    val ui: StateFlow<NotificationsUi> = _ui.asStateFlow()

    fun refresh() {
        _ui.update { it.copy(loading = true) }
        viewModelScope.launch {
            try {
                val o = repo.load()
                _ui.update { it.copy(items = o.items, seenAt = o.seenAt, unread = NotificationRules.unread(o.items, o.seenAt, nowMs()), loading = false, message = null) }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                // Keep what we had; a failed background refresh must not wipe the list or the badge.
                _ui.update { it.copy(loading = false, message = e.toUiMessage()) }
            }
        }
    }

    fun markAllRead() {
        if (_ui.value.unread == 0) return
        viewModelScope.launch {
            try {
                val iso = repo.markSeen()
                _ui.update { it.copy(seenAt = iso, unread = 0) }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                _ui.update { it.copy(message = e.toUiMessage()) }
            }
        }
    }
}
