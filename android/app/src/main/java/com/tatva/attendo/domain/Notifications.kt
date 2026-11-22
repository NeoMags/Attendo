package com.tatva.attendo.domain

import com.tatva.attendo.data.remote.AttendoRemote
import com.tatva.attendo.data.remote.ApiException
import com.tatva.attendo.data.remote.NotificationDto
import com.tatva.attendo.data.session.SessionManager
import java.time.Instant

object NotificationRules {
    private const val WEEK_MS = 7L * 24 * 3600 * 1000

    /** Unread = newer than the saved "seen" time; with none saved only the last 7 days count. */
    fun unread(list: List<NotificationDto>, seenAt: String?, nowMs: Long): Int {
        val since = seenAt?.let { runCatching { Instant.parse(it).toEpochMilli() }.getOrNull() } ?: (nowMs - WEEK_MS)
        return list.count { n -> runCatching { Instant.parse(n.createdAt).toEpochMilli() }.getOrDefault(0L) > since }
    }
}

data class NotificationsOverview(val items: List<NotificationDto>, val seenAt: String?)

class NotificationRepository(
    private val session: SessionManager,
    private val remote: AttendoRemote,
    private val now: () -> Instant = { Instant.now() },
) {
    suspend fun load(): NotificationsOverview {
        val id = session.authed { remote.profile(it) }?.id ?: throw ApiException.Server("EMPLOYEE_NOT_FOUND", "no employee record", 404)
        val items = session.authed { remote.myNotifications(it, id) }
        val seen = session.authed { remote.notifSeenAt(it) }
        return NotificationsOverview(items, seen)
    }

    /** Returns the saved time so the caller can update its state without another round trip. */
    suspend fun markSeen(): String {
        val iso = now().toString()
        session.authed { remote.markNotificationsSeen(it, iso) }
        return iso
    }
}
