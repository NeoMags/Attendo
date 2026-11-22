package com.tatva.attendo.domain

import com.tatva.attendo.data.remote.ApiException
import com.tatva.attendo.data.remote.AttendanceDto
import com.tatva.attendo.data.remote.AttendoRemote
import com.tatva.attendo.data.remote.EmployeeProfile
import com.tatva.attendo.data.remote.MyPayDto
import com.tatva.attendo.data.remote.MyProfileDto
import com.tatva.attendo.data.session.SessionManager
import java.time.LocalDate

data class MyDetails(
    val employee: EmployeeProfile,
    val profile: MyProfileDto?,
    val pay: MyPayDto?,
    val photo: ByteArray?,
    val attendance: List<AttendanceDto>,
)

object AttendanceSummary {
    /** Days present (any record) and total late minutes in the list. */
    fun present(list: List<AttendanceDto>) = list.map { it.workDate }.distinct().size
    fun lateDays(list: List<AttendanceDto>) = list.count { it.lateMinutes > 0 }
}

class MyDetailsRepository(
    private val session: SessionManager,
    private val remote: AttendoRemote,
    private val today: () -> LocalDate = { LocalDate.now() },
) {
    suspend fun load(): MyDetails {
        val emp = session.authed { remote.profile(it) }
        val id = emp?.id ?: throw ApiException.Server("EMPLOYEE_NOT_FOUND", "no employee record", 404)
        val profile = session.authed { remote.myProfileDetails(it, id) }
        val pay = session.authed { remote.myPayInfo(it, id) }
        val att = session.authed { remote.myAttendance(it, id, today().minusDays(30).toString()) }
        // The photo is decoration: a failed download must not hide the rest of the screen.
        val photo = profile?.photoPath?.let { path -> runCatching { session.authed { t -> remote.documentBytes(t, path) } }.getOrNull() }
        return MyDetails(emp, profile, pay, photo, att)
    }
}
