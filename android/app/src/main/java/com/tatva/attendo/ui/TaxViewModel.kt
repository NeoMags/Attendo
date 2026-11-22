package com.tatva.attendo.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.tatva.attendo.data.remote.TaxDeclarationDto
import com.tatva.attendo.domain.TaxData
import com.tatva.attendo.domain.TaxRepository
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class TaxUi(val loading: Boolean = true, val data: TaxData? = null, val saving: Boolean = false, val saved: Boolean = false, val message: UiMessage? = null)

class TaxViewModel(private val repo: TaxRepository) : ViewModel() {
    private val _ui = MutableStateFlow(TaxUi())
    val ui: StateFlow<TaxUi> = _ui.asStateFlow()
    init { refresh() }

    fun refresh() {
        _ui.update { it.copy(loading = true, message = null, saved = false) }
        run({ TaxUi(loading = false, data = repo.load()) }) { e -> _ui.update { it.copy(loading = false, message = e.toUiMessage()) } }
    }

    fun save(d: TaxDeclarationDto) {
        val year = _ui.value.data?.year ?: return
        if (_ui.value.saving) return
        _ui.update { it.copy(saving = true, message = null, saved = false) }
        run({ TaxUi(loading = false, data = repo.save(year, d), saved = true) }) { e -> _ui.update { it.copy(saving = false, message = e.toUiMessage()) } }
    }

    private fun run(block: suspend () -> TaxUi, onError: (Exception) -> Unit) {
        viewModelScope.launch {
            try { _ui.value = block() } catch (e: CancellationException) { throw e } catch (e: Exception) { onError(e) }
        }
    }
}
