package com.tatva.attendo.domain

import com.tatva.attendo.data.remote.AdvanceDto
import com.tatva.attendo.data.remote.ApiException
import com.tatva.attendo.data.remote.AttendoRemote
import com.tatva.attendo.data.remote.LedgerDto
import com.tatva.attendo.data.remote.PayslipDto
import com.tatva.attendo.data.session.SessionManager
import java.time.LocalDate
import java.time.format.TextStyle
import java.util.Locale

data class MyMoney(
    val employeeName: String,
    val employeeCode: String,
    val companyName: String?,
    val payslips: List<PayslipDto>,
    val advances: List<AdvanceDto>,
    val ledger: List<LedgerDto>,
) {
    /** What the employee still owes the company across all advances. */
    val outstanding: Double get() = advances.sumOf { it.remaining }
    /** Finalized salary the company has not yet marked as paid. */
    val unpaidSalary: Double get() = payslips.filter { it.paidOn == null }.sumOf { it.net }
}

/** Localized words used on the payslip PDF, filled from string resources so the PDF follows the app language. */
data class PdfLabels(
    val payslipFor: String, val employee: String, val working: String, val present: String, val holidays: String, val paidLeave: String,
    val unpaidLeave: String, val absent: String, val earnings: String, val deductions: String, val salary: String, val wages: String,
    val bonus: String, val advance: String, val other: String, val none: String, val net: String, val paidOn: (String, String) -> String,
    val pending: String, val note: String, val modes: Map<String, String>,
) {
    /** English row names produced by PayslipFormat → localized text. */
    fun row(key: String) = when (key) {
        "Salary for days paid" -> salary; "Wages for days paid" -> wages; "Bonus / other earnings" -> bonus
        "Advance recovery" -> advance; "Other deductions" -> other; "None" -> none; else -> key
    }
}

object PayslipFormat {
    fun rupees(v: Double): String {
        val neg = v < 0
        val cents = Math.round(Math.abs(v) * 100)
        val whole = (cents / 100).toString()
        // Indian digit grouping: last three digits, then pairs.
        val grouped = if (whole.length <= 3) whole else {
            val head = whole.dropLast(3).reversed().chunked(2).joinToString(",").reversed()
            "$head,${whole.takeLast(3)}"
        }
        return (if (neg) "-" else "") + "Rs. $grouped." + (cents % 100).toString().padStart(2, '0')
    }

    fun days(v: Double): String = if (v % 1.0 == 0.0) v.toInt().toString() else v.toString()

    fun monthLabel(m: String, locale: Locale = Locale.ENGLISH): String = runCatching {
        val d = LocalDate.parse(m)
        "${d.month.getDisplayName(TextStyle.FULL, locale)} ${d.year}"
    }.getOrDefault(m)

    /** Rows for the PDF: (label, amount) earnings and deductions, zero extras omitted. Net = earnings − deductions. */
    fun earnings(p: PayslipDto): List<Pair<String, Double>> = buildList {
        add((if (p.payType == "daily") "Wages for days paid" else "Salary for days paid") to p.gross)
        if (p.bonus > 0) add("Bonus / other earnings" to p.bonus)
    }

    fun deductions(p: PayslipDto): List<Pair<String, Double>> = buildList {
        if (p.advanceDeduction > 0) add("Advance recovery" to p.advanceDeduction)
        if (p.otherDeduction > 0) add("Other deductions" to p.otherDeduction)
    }

    fun fileName(code: String, p: PayslipDto) = "payslip-$code-${p.month.take(7)}.pdf"
    fun kindKey(kind: String) = when (kind) { "advance_given" -> 0; "advance_recovered" -> 1; else -> 2 }
}

class PayrollRepository(
    private val session: SessionManager,
    private val remote: AttendoRemote,
) {
    suspend fun load(): MyMoney {
        val me = session.authed { remote.profile(it) }
        val id = me?.id ?: throw ApiException.Server("EMPLOYEE_NOT_FOUND", "no employee record", 404)
        val slips = session.authed { remote.myPayslips(it, id) }
        val adv = session.authed { remote.myAdvances(it, id) }
        val ledger = session.authed { remote.myLedger(it, id) }
        return MyMoney(me.fullName, me.employeeCode, me.companies?.name, slips, adv, ledger)
    }
}
