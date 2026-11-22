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
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.tatva.attendo.R
import com.tatva.attendo.domain.NotificationRules
import java.time.Instant
import java.time.ZoneId
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import kotlinx.coroutines.delay

private val fullDate: DateTimeFormatter = DateTimeFormatter.ofLocalizedDate(FormatStyle.FULL)
private val clock: DateTimeFormatter = DateTimeFormatter.ofPattern("HH:mm:ss")
private val stamp: DateTimeFormatter = DateTimeFormatter.ofLocalizedDateTime(FormatStyle.MEDIUM, FormatStyle.SHORT)

/** Live day, date and time (device time zone) with a notification bell showing the unread count. */
@Composable
fun NowHeader(unread: Int, onBell: () -> Unit) {
    var now by remember { mutableStateOf(ZonedDateTime.now()) }
    LaunchedEffect(Unit) { while (true) { now = ZonedDateTime.now(); delay(1000) } }
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
        Column {
            Text(clock.format(now), style = MaterialTheme.typography.titleMedium)
            Text(fullDate.format(now), style = MaterialTheme.typography.bodySmall)
        }
        val desc = stringResource(R.string.notif_title) + if (unread > 0) ", $unread" else ""
        TextButton(onClick = onBell, modifier = Modifier.semantics { contentDescription = desc }) {
            BadgedBox(badge = { if (unread > 0) Badge { Text(if (unread > 9) "9+" else unread.toString()) } }) {
                Text("🔔", style = MaterialTheme.typography.titleLarge)
            }
        }
    }
}

@Composable
fun NotificationsScreen(vm: NotificationsViewModel, onBack: () -> Unit) {
    val ui by vm.ui.collectAsState()
    val leave = { vm.markAllRead(); onBack() }
    BackHandler(onBack = leave)
    LaunchedEffect(Unit) { vm.refresh() }
    val seenAt = ui.seenAt
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(24.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
            Text(stringResource(R.string.notif_title), style = MaterialTheme.typography.titleLarge)
            TextButton(onClick = leave) { Text(stringResource(R.string.btn_back)) }
        }
        ui.message?.let { Text(messageText(it), color = MaterialTheme.colorScheme.error) }
        if (ui.loading && ui.items.isEmpty()) CircularProgressIndicator()
        if (!ui.loading && ui.items.isEmpty()) Text(stringResource(R.string.notif_none))
        ui.items.forEach { n ->
            val isNew = NotificationRules.unread(listOf(n), seenAt, System.currentTimeMillis()) > 0
            Card(
                Modifier.fillMaxWidth(),
                colors = if (isNew) CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.secondaryContainer) else CardDefaults.cardColors(),
            ) {
                Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text(n.title, style = MaterialTheme.typography.titleSmall)
                    n.body?.let { Text(it, style = MaterialTheme.typography.bodyMedium) }
                    Text(
                        runCatching { stamp.format(Instant.parse(n.createdAt).atZone(ZoneId.systemDefault())) }.getOrDefault(n.createdAt),
                        style = MaterialTheme.typography.bodySmall,
                    )
                }
            }
        }
    }
}
