package com.tatva.attendo.ui

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import androidx.compose.foundation.layout.Box
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatDelegate
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.core.os.LocaleListCompat
import androidx.lifecycle.viewmodel.compose.viewModel
import com.tatva.attendo.AppContainer
import com.tatva.attendo.R
import com.tatva.attendo.data.remote.AttendanceDto
import com.tatva.attendo.data.session.SessionState
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle

@Composable
fun AttendoRoot(container: AppContainer) {
    val factory = VmFactory(container)
    val state by container.session.state.collectAsState()
    Scaffold { padding ->
        Column(Modifier.fillMaxSize().padding(padding)) {
            when (state) {
                SessionState.LoggedOut -> LoginScreen(viewModel(factory = factory))
                SessionState.MustChangePassword -> ChangePasswordScreen(viewModel(factory = factory))
                SessionState.LoggedIn ->
                    HomeScreen(viewModel(key = container.session.ownerKey(), factory = factory))
            }
        }
    }
}

@Composable
fun messageText(m: UiMessage): String {
    val id = when (m.kind) {
        MsgKind.INVALID_CREDENTIALS -> R.string.msg_invalid_credentials
        MsgKind.TOO_MANY_ATTEMPTS -> R.string.msg_too_many_attempts
        MsgKind.NETWORK -> R.string.msg_network
        MsgKind.SESSION_EXPIRED -> R.string.msg_session_expired
        MsgKind.REQUIRED -> R.string.msg_required
        MsgKind.PASSWORD_WEAK -> R.string.msg_password_weak
        MsgKind.PASSWORD_MISMATCH -> R.string.msg_password_mismatch
        MsgKind.PASSWORD_SAME -> R.string.msg_password_same
        MsgKind.PERMISSION_NEEDED -> R.string.msg_permission_needed
        MsgKind.LOCATION_UNAVAILABLE -> R.string.msg_location_unavailable
        MsgKind.MOCK_LOCATION -> R.string.msg_mock_location
        MsgKind.ACCURACY_TOO_LOW -> R.string.msg_accuracy_too_low
        MsgKind.DUPLICATE_CHECKIN -> R.string.msg_duplicate_checkin
        MsgKind.DEVICE_LIMIT -> R.string.msg_device_limit
        MsgKind.DEVICE_BLOCKED -> R.string.msg_device_blocked
        MsgKind.BAD_TIMESTAMP -> R.string.msg_bad_timestamp
        MsgKind.COMPANY_INACTIVE -> R.string.msg_company_inactive
        MsgKind.EMPLOYEE_NOT_FOUND -> R.string.msg_employee_not_found
        MsgKind.GENERIC -> R.string.msg_generic
        MsgKind.CHECKED_IN -> R.string.msg_checked_in
        MsgKind.CHECKED_OUT -> R.string.msg_checked_out
    }
    return stringResource(id, *m.args.toTypedArray())
}

@Composable
private fun LanguagePicker() {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End, verticalAlignment = Alignment.CenterVertically) {
        listOf("en" to "EN", "kn" to "ಕನ್ನಡ", "hi" to "हिन्दी").forEach { (tag, label) ->
            TextButton(onClick = {
                AppCompatDelegate.setApplicationLocales(LocaleListCompat.forLanguageTags(tag))
            }) { Text(label) }
        }
    }
}

@Composable
fun LoginScreen(vm: LoginViewModel) {
    val ui by vm.ui.collectAsState()
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        LanguagePicker()
        Text(stringResource(R.string.app_name), style = MaterialTheme.typography.displaySmall)
        Text(stringResource(R.string.login_title), style = MaterialTheme.typography.titleLarge)
        Field(ui.company, vm::onCompany, R.string.login_company, "company" in ui.missing)
        Field(ui.employeeId, vm::onEmployeeId, R.string.login_employee_id, "employeeId" in ui.missing)
        Field(ui.password, vm::onPassword, R.string.login_password, "password" in ui.missing, password = true)
        ui.error?.let { Text(messageText(it), color = MaterialTheme.colorScheme.error) }
        Button(onClick = vm::submit, enabled = !ui.loading, modifier = Modifier.fillMaxWidth()) {
            if (ui.loading) CircularProgressIndicator(Modifier.height(20.dp)) else Text(stringResource(R.string.login_button))
        }
    }
}

@Composable
fun ChangePasswordScreen(vm: ChangePasswordViewModel) {
    val ui by vm.ui.collectAsState()
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(stringResource(R.string.change_pw_title), style = MaterialTheme.typography.titleLarge)
        Text(stringResource(R.string.change_pw_intro))
        Field(ui.password, vm::onPassword, R.string.new_password, false, password = true)
        Field(ui.confirm, vm::onConfirm, R.string.confirm_password, false, password = true)
        ui.error?.let { Text(messageText(it), color = MaterialTheme.colorScheme.error) }
        Button(onClick = vm::submit, enabled = !ui.loading, modifier = Modifier.fillMaxWidth()) {
            if (ui.loading) CircularProgressIndicator(Modifier.height(20.dp)) else Text(stringResource(R.string.change_pw_button))
        }
        TextButton(onClick = { vm.signOut() }) { Text(stringResource(R.string.btn_sign_out)) }
    }
}

@Composable
fun HomeScreen(vm: HomeViewModel) {
    val ui by vm.ui.collectAsState()
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { result ->
        // Notifications are optional (tracking still runs); precise location is required to check in.
        if (result[Manifest.permission.ACCESS_FINE_LOCATION] == true) vm.checkIn() else vm.onPermissionDenied()
    }
    val ctx = LocalContext.current
    var resumes by remember { mutableIntStateOf(0) }
    val owner = LocalLifecycleOwner.current
    DisposableEffect(owner) {
        val obs = LifecycleEventObserver { _, e -> if (e == Lifecycle.Event.ON_RESUME) resumes++ }
        owner.lifecycle.addObserver(obs)
        onDispose { owner.lifecycle.removeObserver(obs) }
    }
    val health = remember(resumes) { DeviceSettingsState.read(ctx) }
    val today = ui.today
    val open = today?.open

    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        ui.profile?.let { Text(stringResource(R.string.home_welcome, it.fullName), style = MaterialTheme.typography.titleLarge) }
        ui.profile?.companies?.let { Text(it.name) }
        Spacer(Modifier.height(8.dp))

        if (ui.loading && today == null) CircularProgressIndicator()

        when {
            open != null -> {
                Text(stringResource(R.string.status_checked_in_since, formatTime(open.checkInAt)), style = MaterialTheme.typography.titleMedium)
                if (open.lateMinutes > 0) Text(stringResource(R.string.status_late, open.lateMinutes), color = MaterialTheme.colorScheme.error)
            }
            today?.pendingCheckIn != null -> Text(stringResource(R.string.status_pending_sync))
            today != null -> Text(stringResource(R.string.status_not_checked_in), style = MaterialTheme.typography.titleMedium)
        }
        if (today?.pendingCheckOut != null) Text(stringResource(R.string.status_pending_sync))

        ui.message?.let { Text(messageText(it), color = MaterialTheme.colorScheme.primary) }

        if (today != null) {
            when {
                today.pendingCheckIn != null -> Button(onClick = vm::checkIn, enabled = !ui.busy, modifier = Modifier.fillMaxWidth()) {
                    Text(stringResource(R.string.btn_retry_sync))
                }
                open == null -> Button(
                    onClick = {
                        val perms = buildList {
                            add(Manifest.permission.ACCESS_FINE_LOCATION)
                            add(Manifest.permission.ACCESS_COARSE_LOCATION)
                            if (Build.VERSION.SDK_INT >= 33) add(Manifest.permission.POST_NOTIFICATIONS)
                        }
                        permission.launch(perms.toTypedArray())
                    },
                    enabled = !ui.busy,
                    modifier = Modifier.fillMaxWidth(),
                ) { Text(stringResource(R.string.btn_check_in)) }
                else -> Button(onClick = vm::checkOut, enabled = !ui.busy, modifier = Modifier.fillMaxWidth()) {
                    Text(stringResource(R.string.btn_check_out))
                }
            }
        }
        if (ui.busy) CircularProgressIndicator()

        if (open != null) {
            Text(stringResource(R.string.status_tracking_on), style = MaterialTheme.typography.bodyMedium)
            if (!health.backgroundLocation) SettingsBanner(R.string.banner_bg_location) { openAppSettings(ctx) }
            if (!health.notifications) SettingsBanner(R.string.banner_notifications) { openAppSettings(ctx) }
            if (!health.batteryUnrestricted) SettingsBanner(R.string.banner_battery) {
                ctx.startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            }
        }
        if (ui.queued > 0) Text(stringResource(R.string.status_queued_points, ui.queued), style = MaterialTheme.typography.bodySmall)

        OutlinedButton(onClick = vm::refresh, enabled = !ui.loading && !ui.busy, modifier = Modifier.fillMaxWidth()) {
            Text(stringResource(R.string.btn_refresh))
        }
        TextButton(onClick = { vm.signOut() }) { Text(stringResource(R.string.btn_sign_out)) }
    }
}

@Composable
private fun Field(value: String, onChange: (String) -> Unit, label: Int, missing: Boolean, password: Boolean = false) {
    OutlinedTextField(
        value = value,
        onValueChange = onChange,
        label = { Text(stringResource(label)) },
        singleLine = true,
        isError = missing,
        supportingText = if (missing) ({ Text(stringResource(R.string.msg_required)) }) else null,
        visualTransformation = if (password) PasswordVisualTransformation() else androidx.compose.ui.text.input.VisualTransformation.None,
        keyboardOptions = KeyboardOptions(keyboardType = if (password) KeyboardType.Password else KeyboardType.Text),
        modifier = Modifier.fillMaxWidth(),
    )
}

private val timeFmt = DateTimeFormatter.ofLocalizedTime(FormatStyle.SHORT).withZone(ZoneId.systemDefault())

private fun formatTime(iso: String): String = runCatching { timeFmt.format(Instant.parse(iso)) }.getOrDefault(iso)

@Suppress("unused")
private fun worked(a: AttendanceDto): String = a.workedSeconds?.let { "%dh %02dm".format(it / 3600, it % 3600 / 60) }.orEmpty()

@Composable
private fun SettingsBanner(text: Int, onClick: () -> Unit) {
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(stringResource(text), color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
        TextButton(onClick = onClick) { Text(stringResource(R.string.btn_open_settings)) }
    }
}

private fun openAppSettings(ctx: android.content.Context) {
    ctx.startActivity(
        Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", ctx.packageName, null))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
    )
}

/** Device settings that decide whether background tracking survives. Re-read whenever the screen resumes. */
data class DeviceSettingsState(val backgroundLocation: Boolean, val notifications: Boolean, val batteryUnrestricted: Boolean) {
    companion object {
        fun read(ctx: android.content.Context) = DeviceSettingsState(
            backgroundLocation = Build.VERSION.SDK_INT < 29 || ContextCompat.checkSelfPermission(
                ctx, Manifest.permission.ACCESS_BACKGROUND_LOCATION,
            ) == PackageManager.PERMISSION_GRANTED,
            notifications = NotificationManagerCompat.from(ctx).areNotificationsEnabled(),
            batteryUnrestricted = (ctx.getSystemService(android.content.Context.POWER_SERVICE) as PowerManager)
                .isIgnoringBatteryOptimizations(ctx.packageName),
        )
    }
}
