package com.tatva.attendo.ui

import android.graphics.BitmapFactory
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.tatva.attendo.R
import com.tatva.attendo.data.remote.AttendanceDto
import com.tatva.attendo.domain.AttendanceSummary
import com.tatva.attendo.domain.LeaveRules
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle

private val timeFmt = DateTimeFormatter.ofLocalizedTime(FormatStyle.SHORT).withZone(ZoneId.systemDefault())
private fun t(iso: String?): String = iso?.let { runCatching { timeFmt.format(Instant.parse(it)) }.getOrNull() } ?: "—"

@Composable
fun MyDetailsScreen(vm: MyDetailsViewModel, onBack: () -> Unit) {
    val ui by vm.ui.collectAsState()
    BackHandler(onBack = onBack)
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(24.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
            Text(stringResource(R.string.btn_my_details), style = MaterialTheme.typography.titleLarge)
            TextButton(onClick = onBack) { Text(stringResource(R.string.btn_back)) }
        }
        ui.message?.let { Text(messageText(it), color = MaterialTheme.colorScheme.error) }
        if (ui.loading && ui.data == null) CircularProgressIndicator()
        ui.data?.let { d ->
            val photo = remember(d.photo) { d.photo?.let { runCatching { BitmapFactory.decodeByteArray(it, 0, it.size) }.getOrNull() } }
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                if (photo != null) Image(photo.asImageBitmap(), null, Modifier.size(72.dp).clip(CircleShape), contentScale = ContentScale.Crop)
                Column {
                    Text(d.employee.fullName, style = MaterialTheme.typography.titleMedium)
                    Text(d.employee.employeeCode, style = MaterialTheme.typography.bodySmall)
                    d.profile?.designation?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
                }
            }
            Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text(stringResource(R.string.details_contact), style = MaterialTheme.typography.titleSmall)
                    Line(R.string.details_phone, d.profile?.phone)
                    Line(R.string.details_alt_phone, d.profile?.altPhone)
                    Line(R.string.details_address, d.profile?.address)
                    Line(R.string.details_dob, d.profile?.dateOfBirth)
                    Line(R.string.details_referred_by, d.profile?.referredBy)
                    Line(R.string.details_emergency, listOfNotNull(d.profile?.emergencyName, d.profile?.emergencyPhone).joinToString(" · ").ifBlank { null })
                }
            }
            Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text(stringResource(R.string.details_pay), style = MaterialTheme.typography.titleSmall)
                    val pay = d.pay
                    if (pay == null) Text(stringResource(R.string.details_not_set)) else {
                        val amount = if (pay.payType == "daily") pay.dailyWage else pay.monthlySalary
                        Line(if (pay.payType == "daily") R.string.details_daily_wage else R.string.details_monthly_salary, amount?.let { "₹" + LeaveRules.formatDays(it) })
                        Line(R.string.details_pf, stringResource(if (pay.pfEligible) R.string.yes else R.string.no))
                        Line(R.string.details_esi, stringResource(if (pay.esiEligible) R.string.yes else R.string.no))
                        Line(R.string.details_aadhaar, pay.aadhaarLast4?.let { "XXXX XXXX $it" })
                        Line(R.string.details_bank, pay.bankName)
                    }
                }
            }
            Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text(stringResource(R.string.details_attendance), style = MaterialTheme.typography.titleSmall)
                    Text(stringResource(R.string.details_att_summary, AttendanceSummary.present(d.attendance), AttendanceSummary.lateDays(d.attendance)), style = MaterialTheme.typography.bodySmall)
                    HorizontalDivider()
                    if (d.attendance.isEmpty()) Text(stringResource(R.string.details_no_attendance))
                    d.attendance.forEach { a -> AttendanceLine(a) }
                }
            }
            Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text(stringResource(R.string.details_transactions), style = MaterialTheme.typography.titleSmall)
                    Text(stringResource(R.string.details_transactions_soon), style = MaterialTheme.typography.bodySmall)
                }
            }
        }
        OutlinedButton(onClick = vm::refresh, enabled = !ui.loading, modifier = Modifier.fillMaxWidth()) { Text(stringResource(R.string.btn_refresh)) }
    }
}

@Composable
private fun Line(label: Int, value: String?) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        Text(stringResource(label), style = MaterialTheme.typography.bodySmall)
        Text(value ?: "—", style = MaterialTheme.typography.bodyMedium)
    }
}

@Composable
private fun AttendanceLine(a: AttendanceDto) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        Text(a.workDate)
        Text(
            t(a.checkInAt) + " – " + t(a.checkOutAt) + if (a.lateMinutes > 0) "  (" + stringResource(R.string.status_late, a.lateMinutes) + ")" else "",
            style = MaterialTheme.typography.bodySmall,
        )
    }
}
