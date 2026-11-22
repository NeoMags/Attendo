package com.tatva.attendo

import com.tatva.attendo.data.remote.ApiException
import com.tatva.attendo.data.remote.EmployeeProfile
import com.tatva.attendo.data.remote.TaskDto
import com.tatva.attendo.data.remote.TaskTitleDto
import com.tatva.attendo.data.session.SessionManager
import com.tatva.attendo.data.store.StoredSession
import com.tatva.attendo.domain.MyTask
import com.tatva.attendo.domain.TaskRules
import com.tatva.attendo.domain.TasksRepository
import com.tatva.attendo.ui.MsgKind
import com.tatva.attendo.ui.toTaskMessage
import java.time.LocalDate
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test

private fun task(id: String, status: String, due: String? = null, parent: String? = null, title: String = id) =
    TaskDto(id = id, parentId = parent, title = title, status = status, dueDate = due)

class TaskRulesTest {
    @Test fun sorts_action_needed_first_then_by_due_date() {
        val l = listOf("a" to "approved", "b" to "submitted", "c" to "todo", "d" to "rework", "e" to "in_progress").map { MyTask(task(it.first, it.second), null) }
        assertEquals(listOf("d", "e", "c", "b", "a"), TaskRules.sort(l).map { it.task.id })
        val dated = listOf(MyTask(task("late", "todo", "2026-12-09"), null), MyTask(task("soon", "todo", "2026-12-01"), null), MyTask(task("none", "todo"), null))
        assertEquals(listOf("soon", "late", "none"), TaskRules.sort(dated).map { it.task.id })
    }
    @Test fun allowed_actions_by_status() {
        assertTrue(TaskRules.canStart("todo")); assertTrue(TaskRules.canStart("rework")); assertFalse(TaskRules.canStart("in_progress"))
        assertTrue(TaskRules.canSubmit("in_progress")); assertFalse(TaskRules.canSubmit("submitted")); assertFalse(TaskRules.canSubmit("approved"))
    }
    @Test fun overdue_only_when_open_and_past_due() {
        val today = LocalDate.of(2026, 11, 23)
        assertTrue(TaskRules.isOverdue(task("x", "todo", "2026-11-22"), today))
        assertFalse(TaskRules.isOverdue(task("x", "todo", "2026-11-23"), today))
        assertFalse(TaskRules.isOverdue(task("x", "approved", "2026-11-01"), today))
        assertFalse(TaskRules.isOverdue(task("x", "todo"), today))
    }
    @Test fun server_codes_map_to_task_messages() {
        fun k(c: String) = ApiException.Server(c, "x", 400).toTaskMessage().kind
        assertEquals(MsgKind.TASK_STATE, k("INVALID_STATE")); assertEquals(MsgKind.TASK_SUBTASKS_OPEN, k("SUBTASKS_OPEN"))
        assertEquals(MsgKind.TASK_NOT_FOUND, k("TASK_NOT_FOUND")); assertEquals(MsgKind.GENERIC, k("OTHER"))
    }
}

class TasksRepositoryTest {
    private val remote = FakeRemote().apply { profileResult = EmployeeProfile(id = "emp-1", employeeCode = "E001", fullName = "A") }
    private val session = SessionManager(MemTokenStore(StoredSession("a1", "r1", Long.MAX_VALUE / 2, false, "k")), remote)
    private val repo = TasksRepository(session, remote)

    @Test fun load_attaches_parent_titles_and_sorts() = runBlocking<Unit> {
        remote.tasksResult = listOf(task("s1", "todo", parent = "p1"), task("t2", "rework"))
        remote.taskTitlesResult = listOf(TaskTitleDto("p1", "Survey site"))
        val l = repo.load()
        assertEquals(listOf("t2", "s1"), l.map { it.task.id })
        assertEquals("Survey site", l[1].parentTitle); assertNull(l[0].parentTitle)
    }
    @Test fun failed_parent_lookup_does_not_hide_tasks() = runBlocking<Unit> {
        remote.tasksResult = listOf(task("s1", "todo", parent = "p1")); remote.taskTitlesFails = true
        val l = repo.load()
        assertEquals(1, l.size); assertNull(l[0].parentTitle)
    }
    @Test fun start_and_submit_call_the_server_rpc_and_trim_notes() = runBlocking<Unit> {
        repo.start("t1"); repo.submit("t1", "  done  "); repo.submit("t2", "   ")
        assertEquals(listOf(Triple("t1", "in_progress", null), Triple("t1", "submitted", "done"), Triple("t2", "submitted", null)), remote.progressCalls)
    }
}
