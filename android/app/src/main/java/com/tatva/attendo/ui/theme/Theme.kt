package com.tatva.attendo.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

private val Light = lightColorScheme(primary = Color(0xFF0F5FA8), secondary = Color(0xFF2E7D32))
private val Dark = darkColorScheme(primary = Color(0xFF7DB7F0), secondary = Color(0xFF81C784))

@Composable
fun AttendoTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = if (isSystemInDarkTheme()) Dark else Light, content = content)
}
