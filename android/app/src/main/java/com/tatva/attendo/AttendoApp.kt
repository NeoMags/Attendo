package com.tatva.attendo

import android.app.Application

class AttendoApp : Application() {
    val container: AppContainer by lazy { AppContainer(this) }

    override fun onCreate() {
        super.onCreate()
        com.tatva.attendo.push.PushToken.onToken = { container.registerPush() }
        com.tatva.attendo.push.PushToken.refresh(this)
    }
}
