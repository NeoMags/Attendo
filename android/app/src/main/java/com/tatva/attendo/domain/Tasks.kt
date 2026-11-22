package com.tatva.attendo.domain

import com.tatva.attendo.data.remote.ApiException
import com.tatva.attendo.data.remote.AttendoRemote
import com.tatva.attendo.data.remote.TaskDto
import com.tatva.attendo.data.session.SessionManager
import java.time.LocalDate

data class MyTask(val task: TaskDto, val parentTitle: String?)

object TaskRules {
    /** Sort key: work needing action first (sent back, in progress, to do), then waiting, then done. */
    private fun rank(s: String) = when (s) { "rework" -> 0; "in_progress" -> 1; "todo" -> 2; "submitted" -> 3; else -> 4 }
    fun sort(list: List<MyTask>): List<MyTask> =
        list.sortedWith(compareBy<MyTask> { rank(it.task.status) }.thenBy { it.task.dueDate ?: "9999-12-31" }.thenBy { it.task.title })

    fun canStart(status: String) = status == "todo" || status == "rework"
    fun canSubmit(status: String) = status == "todo" || status == "in_progress" || status == "rework"
    fun isOverdue(t: TaskDto, today: LocalDate): Boolean =
        t.dueDate != null && t.status != "approved" && t.status != "cancelled" && runCatching { LocalDate.parse(t.dueDate).isBefore(today) }.getOrDefault(false)
    const val NOTE_MAX = 500
}

class TasksRepository(
    private val session: SessionManager,
    private val remote: AttendoRemote,
) {
    suspend fun load(): List<MyTask> {
        val id = session.authed { remote.profile(it) }?.id ?: throw ApiException.Server("EMPLOYEE_NOT_FOUND", "no employee record", 404)
        val tasks = session.authed { remote.myTasks(it, id) }
        val parentIds = tasks.mapNotNull { it.parentId }.distinct()
        // The parent title is context only: a failed lookup must not hide the tasks.
        val titles = runCatching { session.authed { remote.taskTitles(it, parentIds) } }.getOrDefault(emptyList()).associate { it.id to it.title }
        return TaskRules.sort(tasks.map { MyTask(it, it.parentId?.let(titles::get)) })
    }

    suspend fun start(taskId: String) { session.authed { remote.setTaskProgress(it, taskId, "in_progress", null) } }
    suspend fun submit(taskId: String, note: String?) { session.authed { remote.setTaskProgress(it, taskId, "submitted", note?.trim()?.takeIf { n -> n.isNotEmpty() }) } }
}
