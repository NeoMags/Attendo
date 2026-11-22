package com.tatva.attendo.push

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import com.tatva.attendo.MainActivity
import com.tatva.attendo.R

/** Receives data-only pushes ({title, body}) and shows them as notifications. */
class AttendoMessagingService : FirebaseMessagingService() {
    override fun onNewToken(token: String) = PushToken.save(this, token)

    override fun onMessageReceived(message: RemoteMessage) {
        val title = message.data["title"]?.takeIf { it.isNotBlank() } ?: return
        val body = message.data["body"].orEmpty()
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL, getString(R.string.push_channel), NotificationManager.IMPORTANCE_DEFAULT),
        )
        val open = PendingIntent.getActivity(
            this, 0, Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val n = NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(title).setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setAutoCancel(true).setContentIntent(open).build()
        nm.notify((System.currentTimeMillis() and 0x7FFFFFFF).toInt(), n)
    }

    private companion object { const val CHANNEL = "attendo_push" }
}
