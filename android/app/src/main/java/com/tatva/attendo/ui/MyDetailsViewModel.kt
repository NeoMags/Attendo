package com.tatva.attendo.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.tatva.attendo.domain.MyDetails
import com.tatva.attendo.domain.MyDetailsRepository
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class MyDetailsUi(val loading: Boolean = true, val data: MyDetails? = null, val message: UiMessage? = null)

class MyDetailsViewModel(private val repo: MyDetailsRepository) : ViewModel() {
    private val _ui = MutableStateFlow(MyDetailsUi())
    val ui: StateFlow<MyDetailsUi> = _ui.asStateFlow()
    init { refresh() }

    fun refresh() {
        _ui.update { it.copy(loading = true) }
        viewModelScope.launch {
            try {
                val d = repo.load()
                _ui.update { MyDetailsUi(loading = false, data = d) }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                _ui.update { it.copy(loading = false, message = e.toUiMessage()) }
            }
        }
    }
}
