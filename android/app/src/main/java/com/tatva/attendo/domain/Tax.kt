package com.tatva.attendo.domain

import com.tatva.attendo.data.remote.ApiException
import com.tatva.attendo.data.remote.AttendoRemote
import com.tatva.attendo.data.remote.TaxDeclarationDto
import com.tatva.attendo.data.remote.TaxProjectionDto
import com.tatva.attendo.data.session.SessionManager
import java.time.LocalDate

data class TaxData(val employeeId: String, val year: Int, val projection: TaxProjectionDto, val declaration: TaxDeclarationDto)

object TaxRules {
    /** Tax year is named by the calendar year it starts in (2026 = 1 Apr 2026 - 31 Mar 2027). */
    fun taxYearOf(d: LocalDate) = if (d.monthValue >= 4) d.year else d.year - 1
    fun label(year: Int) = "$year-${((year + 1) % 100).toString().padStart(2, '0')}"

    /** Empty text is 0; anything that is not a non-negative number is null (invalid). */
    fun parseAmount(text: String): Double? {
        val t = text.trim().replace(",", "")
        if (t.isEmpty()) return 0.0
        val v = t.toDoubleOrNull() ?: return null
        return if (v.isFinite() && v >= 0 && v <= 100_000_000.0) v else null
    }

    fun amountText(v: Double) = if (v == 0.0) "" else if (v % 1.0 == 0.0) v.toLong().toString() else v.toString()
}

class TaxRepository(private val session: SessionManager, private val remote: AttendoRemote) {
    private suspend fun employeeId(): String {
        val me = session.authed { remote.profile(it) }
        return me?.id ?: throw ApiException.Server("EMPLOYEE_NOT_FOUND", "no employee record", 404)
    }

    suspend fun load(year: Int = TaxRules.taxYearOf(LocalDate.now())): TaxData {
        val id = employeeId()
        val decl = session.authed { remote.myTaxDeclaration(it, id, year) } ?: TaxDeclarationDto()
        val proj = session.authed { remote.taxProjection(it, id, year) }
        return TaxData(id, year, proj, decl)
    }

    /** Saves, then reloads the projection so the screen shows the new figures. */
    suspend fun save(year: Int, d: TaxDeclarationDto): TaxData {
        val id = employeeId()
        session.authed { remote.saveTaxDeclaration(it, id, year, d) }
        val proj = session.authed { remote.taxProjection(it, id, year) }
        return TaxData(id, year, proj, d)
    }
}
