package com.tatva.attendo.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.tatva.attendo.R
import com.tatva.attendo.data.remote.LeaveBalanceDto
import com.tatva.attendo.data.remote.LeaveRequestDto
import com.tatva.attendo.domain.LeaveRules
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle

private val dateFmt: DateTimeFormatter = DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM)
private fun fmt(d: LocalDate?): String? = d?.let { dateFmt.format(it) }
private fun fmtIso(s: String): String = runCatching { dateFmt.format(LocalDate.parse(s)) }.getOrDefault(s)

@Composable
fun LeaveScreen(vm: LeaveViewModel, onBack: () -> Unit) {
    val ui by vm.ui.collectAsState()
    BackHandler(onBack = onBack)
    var pickStart by remember { mutableStateOf(false) }
    var pickEnd by remember { mutableStateOf(false) }
    var confirm by remember { mutableStateOf<LeaveRequestDto?>(null) }

    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
            Text(stringResource(R.string.leave_title), style = MaterialTheme.typography.titleLarge)
            TextButton(onClick = onBack) { Text(stringResource(R.string.btn_back)) }
        }
        ui.message?.let { Text(messageText(it), color = MaterialTheme.colorScheme.primary) }
        if (ui.loading) CircularProgressIndicator()

        Text(stringResource(R.string.leave_balances), style = MaterialTheme.typography.titleMedium)
        if (ui.balances.isEmpty() && !ui.loading) Text(stringResource(R.string.leave_no_types), style = MaterialTheme.typography.bodyMedium)
        ui.balances.forEach { BalanceRow(it) }

        HorizontalDivider()
        Text(stringResource(R.string.leave_apply), style = MaterialTheme.typography.titleMedium)
        ui.types.forEach { t ->
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                RadioButton(selected = ui.typeId == t.id, onClick = { vm.onType(t.id) }, enabled = !ui.busy)
                Text(t.name)
            }
        }
        OutlinedButton(onClick = { pickStart = true }, enabled = !ui.busy, modifier = Modifier.fillMaxWidth()) {
            Text(fmt(ui.start)?.let { stringResource(R.string.leave_start_value, it) } ?: stringResource(R.string.leave_start))
        }
        OutlinedButton(onClick = { pickEnd = true }, enabled = !ui.busy && !ui.half, modifier = Modifier.fillMaxWidth()) {
            Text(fmt(ui.end)?.let { stringResource(R.string.leave_end_value, it) } ?: stringResource(R.string.leave_end))
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Checkbox(checked = ui.half, onCheckedChange = vm::onHalf, enabled = !ui.busy)
            Text(stringResource(R.string.leave_half_day))
        }
        OutlinedTextField(
            value = ui.reason, onValueChange = vm::onReason, enabled = !ui.busy,
            label = { Text(stringResource(R.string.leave_reason)) },
            supportingText = { Text("${ui.reason.length}/${LeaveRules.REASON_MAX}") },
            modifier = Modifier.fillMaxWidth(),
        )
        Button(onClick = vm::submit, enabled = !ui.busy, modifier = Modifier.fillMaxWidth()) { Text(stringResource(R.string.btn_leave_submit)) }

        HorizontalDivider()
        Text(stringResource(R.string.leave_my_requests), style = MaterialTheme.typography.titleMedium)
        if (ui.requests.isEmpty() && !ui.loading) Text(stringResource(R.string.leave_none))
        ui.requests.forEach { r -> RequestCard(r, busy = ui.busy) { confirm = r } }
        OutlinedButton(onClick = vm::refresh, enabled = !ui.loading && !ui.busy, modifier = Modifier.fillMaxWidth()) {
            Text(stringResource(R.string.btn_refresh))
        }
        Spacer(Modifier.height(16.dp))
    }

    if (pickStart) LeaveDatePicker(ui.start, onDismiss = { pickStart = false }) { vm.onStart(it); pickStart = false }
    if (pickEnd) LeaveDatePicker(ui.end ?: ui.start, onDismiss = { pickEnd = false }) { vm.onEnd(it); pickEnd = false }
    confirm?.let { r ->
        AlertDialog(
            onDismissRequest = { confirm = null },
            title = { Text(stringResource(R.string.leave_cancel_title)) },
            text = { Text(stringResource(R.string.leave_cancel_body, fmtIso(r.startDate), fmtIso(r.endDate))) },
            confirmButton = { TextButton(onClick = { vm.cancel(r.id); confirm = null }) { Text(stringResource(R.string.btn_cancel_leave)) } },
            dismissButton = { TextButton(onClick = { confirm = null }) { Text(stringResource(R.string.btn_keep)) } },
        )
    }
}

@Composable
private fun BalanceRow(b: LeaveBalanceDto) {
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(b.name, style = MaterialTheme.typography.titleSmall)
            if (b.annualQuotaDays == null) {
                Text(stringResource(R.string.leave_unlimited))
            } else {
                Text(stringResource(R.string.leave_remaining, LeaveRules.formatDays(b.remainingDays ?: 0.0), LeaveRules.formatDays(b.annualQuotaDays)))
            }
            Text(
                stringResource(R.string.leave_used_pending, LeaveRules.formatDays(b.approvedDays), LeaveRules.formatDays(b.pendingDays)),
                style = MaterialTheme.typography.bodySmall,
            )
        }
    }
}

@Composable
private fun RequestCard(r: LeaveRequestDto, busy: Boolean, onCancel: () -> Unit) {
    val start = runCatching { LocalDate.parse(r.startDate) }.getOrNull()
    val cancellable = start != null && LeaveRules.canCancel(r.status, start, LocalDate.now())
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(r.leaveType?.name.orEmpty(), style = MaterialTheme.typography.titleSmall)
            val range = if (r.startDate == r.endDate) fmtIso(r.startDate) else "${fmtIso(r.startDate)} – ${fmtIso(r.endDate)}"
            Text("$range · " + stringResource(R.string.leave_days, LeaveRules.formatDays(r.days)))
            Text(statusLabel(r.status), style = MaterialTheme.typography.labelLarge)
            r.reason?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
            r.managerNote?.let { Text(stringResource(R.string.leave_manager_note, it), style = MaterialTheme.typography.bodySmall) }
            r.decisionNote?.let { Text(stringResource(R.string.leave_admin_note, it), style = MaterialTheme.typography.bodySmall) }
            if (cancellable) TextButton(onClick = onCancel, enabled = !busy) { Text(stringResource(R.string.btn_cancel_leave)) }
        }
    }
}

@Composable
private fun statusLabel(status: String): String = when (status) {
    "pending" -> stringResource(R.string.leave_status_pending)
    "manager_approved" -> stringResource(R.string.leave_status_manager_approved)
    "approved" -> stringResource(R.string.leave_status_approved)
    "rejected" -> stringResource(R.string.leave_status_rejected)
    "cancelled" -> stringResource(R.string.leave_status_cancelled)
    else -> status
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun LeaveDatePicker(initial: LocalDate?, onDismiss: () -> Unit, onPick: (LocalDate) -> Unit) {
    val state = rememberDatePickerState(initialSelectedDateMillis = initial?.atStartOfDay(ZoneOffset.UTC)?.toInstant()?.toEpochMilli())
    DatePickerDialog(
        onDismissRequest = onDismiss,
        confirmButton = {
            TextButton(
                enabled = state.selectedDateMillis != null,
                onClick = { state.selectedDateMillis?.let { onPick(Instant.ofEpochMilli(it).atZone(ZoneOffset.UTC).toLocalDate()) } },
            ) { Text(stringResource(R.string.btn_ok)) }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.btn_dismiss)) } },
    ) { DatePicker(state = state) }
}
