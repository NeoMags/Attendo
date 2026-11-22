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
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
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
import androidx.compose.ui.unit.dp
import com.tatva.attendo.R
import com.tatva.attendo.data.remote.TaskDto
import com.tatva.attendo.domain.MyTask
import com.tatva.attendo.domain.TaskRules
import java.time.LocalDate

@Composable
private fun statusLabel(s: String): String = stringResource(
    when (s) {
        "todo" -> R.string.task_status_todo
        "in_progress" -> R.string.task_status_in_progress
        "submitted" -> R.string.task_status_submitted
        "rework" -> R.string.task_status_rework
        "approved" -> R.string.task_status_approved
        else -> R.string.task_status_cancelled
    },
)

@Composable
fun TasksScreen(vm: TasksViewModel, onBack: () -> Unit) {
    val ui by vm.ui.collectAsState()
    BackHandler(onBack = onBack)
    var submitting by remember { mutableStateOf<TaskDto?>(null) }
    var note by remember { mutableStateOf("") }

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(24.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
            Text(stringResource(R.string.tasks_title), style = MaterialTheme.typography.titleLarge)
            TextButton(onClick = onBack) { Text(stringResource(R.string.btn_back)) }
        }
        ui.message?.let { Text(messageText(it), color = MaterialTheme.colorScheme.primary) }
        if (ui.loading) CircularProgressIndicator()
        if (!ui.loading && ui.tasks.isEmpty()) Text(stringResource(R.string.tasks_empty))
        val today = LocalDate.now()
        ui.tasks.forEach { mt -> TaskCard(mt, today, ui.busy, onStart = { vm.start(mt.task.id) }, onSubmit = { note = ""; submitting = mt.task }) }
        OutlinedButton(onClick = vm::refresh, enabled = !ui.busy, modifier = Modifier.fillMaxWidth()) { Text(stringResource(R.string.btn_refresh)) }
    }
    submitting?.let { t ->
        AlertDialog(
            onDismissRequest = { submitting = null },
            title = { Text(stringResource(R.string.task_submit_title, t.title)) },
            text = {
                OutlinedTextField(
                    value = note, onValueChange = { note = it.take(TaskRules.NOTE_MAX) }, label = { Text(stringResource(R.string.task_submit_note)) },
                    modifier = Modifier.fillMaxWidth(),
                )
            },
            confirmButton = { TextButton(onClick = { vm.submit(t.id, note); submitting = null }) { Text(stringResource(R.string.task_submit)) } },
            dismissButton = { TextButton(onClick = { submitting = null }) { Text(stringResource(R.string.btn_cancel)) } },
        )
    }
}

@Composable
private fun TaskCard(mt: MyTask, today: LocalDate, busy: Boolean, onStart: () -> Unit, onSubmit: () -> Unit) {
    val t = mt.task
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(t.title, style = MaterialTheme.typography.titleMedium)
            mt.parentTitle?.let { Text(stringResource(R.string.task_subtask_of, it), style = MaterialTheme.typography.bodySmall) }
            Text(statusLabel(t.status) + if (t.priority == "high") " · " + stringResource(R.string.task_priority_high) else "", style = MaterialTheme.typography.bodyMedium)
            t.dueDate?.let {
                val over = TaskRules.isOverdue(t, today)
                Text(stringResource(R.string.task_due, it) + if (over) " · " + stringResource(R.string.task_overdue) else "",
                    color = if (over) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurface, style = MaterialTheme.typography.bodySmall)
            }
            t.description?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
            if (t.status == "rework") t.reviewNote?.let { Text(stringResource(R.string.task_sent_back, it), color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
            if (TaskRules.canSubmit(t.status)) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (TaskRules.canStart(t.status)) OutlinedButton(onClick = onStart, enabled = !busy) { Text(stringResource(R.string.task_start)) }
                    Button(onClick = onSubmit, enabled = !busy) { Text(stringResource(R.string.task_submit)) }
                }
            }
        }
    }
}
