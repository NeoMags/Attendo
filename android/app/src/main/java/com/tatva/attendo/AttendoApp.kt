package com.tatva.attendo

import android.app.Application

class AttendoApp : Application() {
    val container: AppContainer by lazy { AppContainer(this) }
}
