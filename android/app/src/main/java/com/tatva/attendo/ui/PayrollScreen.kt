package com.tatva.attendo.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.tatva.attendo.R
import com.tatva.attendo.data.remote.PayslipDto
import com.tatva.attendo.domain.MyMoney
import com.tatva.attendo.domain.PayslipFormat

@Composable
fun PayrollScreen(vm: PayrollViewModel, onBack: () -> Unit) {
    val ui by vm.ui.collectAsState()
    val ctx = LocalContext.current
    BackHandler(onBack = onBack)
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(24.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
            Text(stringResource(R.string.pay_title), style = MaterialTheme.typography.titleLarge)
            TextButton(onClick = onBack) { Text(stringResource(R.string.btn_back)) }
        }
        ui.message?.let { Text(messageText(it), color = MaterialTheme.colorScheme.error) }
        if (ui.loading && ui.data == null) CircularProgressIndicator()
        ui.data?.let { d ->
            Summary(d)
            Text(stringResource(R.string.pay_payslips), style = MaterialTheme.typography.titleMedium)
            if (d.payslips.isEmpty()) Text(stringResource(R.string.pay_none), style = MaterialTheme.typography.bodySmall)
            d.payslips.forEach { p -> SlipCard(p, d, onShare = { runCatching { PayslipPdf.share(ctx, p, d.employeeName, d.employeeCode, d.companyName) } }, onPrint = { runCatching { PayslipPdf.print(ctx, p, d.employeeName, d.employeeCode, d.companyName) } }) }
            Text(stringResource(R.string.pay_advances), style = MaterialTheme.typography.titleMedium)
            if (d.advances.isEmpty()) Text(stringResource(R.string.pay_no_advances), style = MaterialTheme.typography.bodySmall)
            d.advances.forEach { a ->
                Card(Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        Text("${a.givenOn} · ${PayslipFormat.rupees(a.amount)}", style = MaterialTheme.typography.titleSmall)
                        Text(stringResource(R.string.pay_adv_line, PayslipFormat.rupees(a.recovered), PayslipFormat.rupees(a.remaining)), style = MaterialTheme.typography.bodySmall)
                        a.monthlyDeduction?.let { Text(stringResource(R.string.pay_adv_installment, PayslipFormat.rupees(it)), style = MaterialTheme.typography.bodySmall) }
                        a.reason?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
                        if (a.voided) Text(stringResource(R.string.pay_voided), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
                    }
                }
            }
            Text(stringResource(R.string.pay_transactions), style = MaterialTheme.typography.titleMedium)
            if (d.ledger.isEmpty()) Text(stringResource(R.string.pay_no_tx), style = MaterialTheme.typography.bodySmall)
            d.ledger.forEach { l ->
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    Column(Modifier.weight(1f)) {
                        Text(stringResource(when (l.kind) { "advance_given" -> R.string.pay_tx_advance_given; "advance_recovered" -> R.string.pay_tx_advance_recovered; "advance_voided" -> R.string.pay_tx_advance_voided; "advance_reversed" -> R.string.pay_tx_advance_reversed; else -> R.string.pay_tx_salary_paid }), style = MaterialTheme.typography.bodyMedium)
                        Text(l.entryDate, style = MaterialTheme.typography.bodySmall)
                    }
                    Text(PayslipFormat.rupees(l.amount), style = MaterialTheme.typography.bodyMedium)
                }
            }
        }
        OutlinedButton(onClick = vm::refresh, enabled = !ui.loading, modifier = Modifier.fillMaxWidth()) { Text(stringResource(R.string.btn_refresh)) }
    }
}

@Composable
private fun Summary(d: MyMoney) {
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(stringResource(R.string.pay_outstanding, PayslipFormat.rupees(d.outstanding)), style = MaterialTheme.typography.titleSmall)
            Text(stringResource(R.string.pay_unpaid, PayslipFormat.rupees(d.unpaidSalary)), style = MaterialTheme.typography.bodySmall)
        }
    }
}

@Composable
private fun SlipCard(p: PayslipDto, d: MyMoney, onShare: () -> Unit, onPrint: () -> Unit) {
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text("${PayslipFormat.monthLabel(p.month)} · ${PayslipFormat.rupees(p.net)}", style = MaterialTheme.typography.titleSmall)
            Text(stringResource(R.string.pay_slip_days, PayslipFormat.days(p.presentDays + p.holidayDays + p.paidLeaveDays), PayslipFormat.days(p.workingDays)), style = MaterialTheme.typography.bodySmall)
            Text(stringResource(R.string.pay_slip_split, PayslipFormat.rupees(p.gross), PayslipFormat.rupees(p.bonus), PayslipFormat.rupees(p.advanceDeduction + p.otherDeduction)), style = MaterialTheme.typography.bodySmall)
            Text(if (p.paidOn != null) stringResource(R.string.pay_paid_on, p.paidOn) else stringResource(R.string.pay_pending), style = MaterialTheme.typography.bodySmall)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(onClick = onShare) { Text(stringResource(R.string.pay_download)) }
                OutlinedButton(onClick = onPrint) { Text(stringResource(R.string.pay_print)) }
            }
        }
    }
}
