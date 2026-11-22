package com.tatva.attendo.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.tatva.attendo.data.remote.ApiException
import com.tatva.attendo.domain.MyTask
import com.tatva.attendo.domain.TasksRepository
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class TasksUi(val loading: Boolean = true, val busy: Boolean = false, val tasks: List<MyTask> = emptyList(), val message: UiMessage? = null)

fun Throwable.toTaskMessage(): UiMessage = if (this is ApiException.Server) when (code) {
    "INVALID_STATE" -> UiMessage(MsgKind.TASK_STATE)
    "SUBTASKS_OPEN" -> UiMessage(MsgKind.TASK_SUBTASKS_OPEN)
    "TASK_NOT_FOUND" -> UiMessage(MsgKind.TASK_NOT_FOUND)
    else -> toUiMessage()
} else toUiMessage()

class TasksViewModel(private val repo: TasksRepository) : ViewModel() {
    private val _ui = MutableStateFlow(TasksUi())
    val ui: StateFlow<TasksUi> = _ui.asStateFlow()

    init { refresh() }

    fun refresh() {
        _ui.update { it.copy(loading = true) }
        viewModelScope.launch {
            try {
                val list = repo.load()
                _ui.update { it.copy(loading = false, tasks = list) }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                _ui.update { it.copy(loading = false, message = e.toTaskMessage()) }
            }
        }
    }

    fun consumeMessage() = _ui.update { it.copy(message = null) }
    fun start(id: String) = act(UiMessage(MsgKind.TASK_STARTED)) { repo.start(id) }
    fun submit(id: String, note: String) = act(UiMessage(MsgKind.TASK_SUBMITTED)) { repo.submit(id, note) }

    private fun act(ok: UiMessage, block: suspend () -> Unit) {
        if (_ui.value.busy) return
        _ui.update { it.copy(busy = true, message = null) }
        viewModelScope.launch {
            val msg = try { block(); ok } catch (e: CancellationException) { throw e } catch (e: Exception) { e.toTaskMessage() }
            // Re-read even after a failure: the server may hold a newer state.
            val list = try { repo.load() } catch (e: CancellationException) { throw e } catch (_: Exception) { null }
            _ui.update { it.copy(busy = false, message = msg, tasks = list ?: it.tasks) }
        }
    }
}
