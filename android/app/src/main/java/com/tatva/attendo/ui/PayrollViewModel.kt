package com.tatva.attendo.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.tatva.attendo.domain.MyMoney
import com.tatva.attendo.domain.PayrollRepository
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class PayrollUi(val loading: Boolean = true, val data: MyMoney? = null, val message: UiMessage? = null)

class PayrollViewModel(private val repo: PayrollRepository) : ViewModel() {
    private val _ui = MutableStateFlow(PayrollUi())
    val ui: StateFlow<PayrollUi> = _ui.asStateFlow()
    init { refresh() }

    fun refresh() {
        _ui.update { it.copy(loading = true, message = null) }
        viewModelScope.launch {
            try {
                val d = repo.load()
                _ui.update { PayrollUi(loading = false, data = d) }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                _ui.update { it.copy(loading = false, message = e.toUiMessage()) }
            }
        }
    }
}
