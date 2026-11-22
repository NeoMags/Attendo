package com.tatva.attendo.push

import android.content.Context
import com.google.firebase.FirebaseApp
import com.google.firebase.messaging.FirebaseMessaging

/** Holds the latest FCM token. Sent to the server by device registration (check-in / heartbeat recovery). */
object PushToken {
    private const val PREFS = "push"
    private const val KEY = "fcm_token"

    fun get(context: Context): String? =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, null)

    /** Set by the app so a fresh token is registered with the server right away (when signed in). */
    @Volatile var onToken: ((String) -> Unit)? = null

    fun save(context: Context, token: String) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY, token).apply()
        onToken?.invoke(token)
    }

    fun registered(context: Context): String? = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("registered", null)
    fun markRegistered(context: Context, token: String) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString("registered", token).apply()
    }

    /** No-op when Firebase is not configured (no google-services.json at build time). */
    fun refresh(context: Context) {
        try {
            if (FirebaseApp.getApps(context).isEmpty()) return
            FirebaseMessaging.getInstance().token
                .addOnSuccessListener { if (!it.isNullOrBlank()) save(context, it) }
                .addOnFailureListener { e ->
                    android.util.Log.w("AttendoPush", "FCM token fetch failed", e)
                    if (com.tatva.attendo.BuildConfig.DEBUG) {
                        android.os.Handler(android.os.Looper.getMainLooper()).post {
                            android.widget.Toast.makeText(context, "Push token failed: ${e.message}", android.widget.Toast.LENGTH_LONG).show()
                        }
                    }
                }
        } catch (_: Exception) {
        }
    }
}
