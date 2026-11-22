package com.tatva.attendo.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.tatva.attendo.R
import com.tatva.attendo.data.remote.TaxDeclarationDto
import com.tatva.attendo.domain.PayslipFormat
import com.tatva.attendo.domain.TaxData
import com.tatva.attendo.domain.TaxRules

@Composable
fun TaxScreen(vm: TaxViewModel, onBack: () -> Unit) {
    val ui by vm.ui.collectAsState()
    BackHandler(onBack = onBack)
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(24.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
            Text(stringResource(R.string.tax_title), style = MaterialTheme.typography.titleLarge)
            TextButton(onClick = onBack) { Text(stringResource(R.string.btn_back)) }
        }
        ui.message?.let { Text(messageText(it), color = MaterialTheme.colorScheme.error) }
        if (ui.loading && ui.data == null) CircularProgressIndicator()
        ui.data?.let { d -> TaxBody(d, ui.saving, ui.saved, vm::save) }
    }
}

@Composable
private fun TaxBody(d: TaxData, saving: Boolean, saved: Boolean, onSave: (TaxDeclarationDto) -> Unit) {
    val p = d.projection
    Text(stringResource(R.string.tax_note), style = MaterialTheme.typography.bodySmall)
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(stringResource(R.string.tax_year, TaxRules.label(d.year)), style = MaterialTheme.typography.titleSmall)
            Text(stringResource(R.string.tax_annual_income) + ": " + PayslipFormat.rupees(p.annualGross))
            Text(stringResource(R.string.tax_new, PayslipFormat.rupees(p.new.total)))
            Text(stringResource(R.string.tax_old, PayslipFormat.rupees(p.old.total)))
            Text(stringResource(R.string.tax_monthly, PayslipFormat.rupees(p.monthlyTds)), style = MaterialTheme.typography.titleSmall)
        }
    }
    var regime by remember(d) { mutableStateOf(d.declaration.regime) }
    var senior by remember(d) { mutableStateOf(d.declaration.parentsSenior) }
    val x = d.declaration
    val texts = remember(d) {
        mutableStateOf(listOf(x.sec80c, x.sec80ccd1b, x.sec80dSelf, x.sec80dParents, x.hraExemption, x.homeLoanInterest, x.otherDeductions, x.prevEmployerIncome, x.prevEmployerTds).map { TaxRules.amountText(it) })
    }
    var invalid by remember(d) { mutableStateOf(false) }
    val labels = listOf(R.string.tax_f_80c, R.string.tax_f_nps, R.string.tax_f_80d_self, R.string.tax_f_80d_parents, R.string.tax_f_hra, R.string.tax_f_home, R.string.tax_f_other, R.string.tax_f_prev_income, R.string.tax_f_prev_tds)
    val oldOnly = 7 // the first seven fields only matter in the old regime
    Text(stringResource(R.string.tax_regime), style = MaterialTheme.typography.titleSmall)
    listOf("new" to R.string.tax_regime_new, "old" to R.string.tax_regime_old).forEach { (k, l) ->
        Row(verticalAlignment = Alignment.CenterVertically) { RadioButton(selected = regime == k, onClick = { regime = k }); Text(stringResource(l)) }
    }
    labels.forEachIndexed { i, l ->
        if (i >= oldOnly || regime == "old") {
            OutlinedTextField(
                value = texts.value[i], onValueChange = { v -> texts.value = texts.value.toMutableList().also { it[i] = v }; invalid = false },
                label = { Text(stringResource(l)) }, singleLine = true, modifier = Modifier.fillMaxWidth(),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
            )
        }
    }
    if (regime == "old") Row(verticalAlignment = Alignment.CenterVertically) { Checkbox(checked = senior, onCheckedChange = { senior = it }); Text(stringResource(R.string.tax_f_senior)) }
    if (invalid) Text(stringResource(R.string.tax_invalid), color = MaterialTheme.colorScheme.error)
    if (saved) Text(stringResource(R.string.tax_saved))
    Button(enabled = !saving, modifier = Modifier.fillMaxWidth(), onClick = {
        val v = texts.value.map { TaxRules.parseAmount(it) }
        if (v.any { it == null }) invalid = true else {
            val n = v.map { it ?: 0.0 }
            onSave(TaxDeclarationDto(regime, n[0], n[1], n[2], n[3], senior, n[4], n[5], n[6], n[7], n[8]))
        }
    }) { Text(stringResource(R.string.tax_save)) }
}
