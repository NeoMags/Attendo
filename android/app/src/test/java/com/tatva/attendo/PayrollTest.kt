package com.tatva.attendo

import com.tatva.attendo.data.remote.AdvanceDto
import com.tatva.attendo.data.remote.ApiException
import com.tatva.attendo.data.remote.EmployeeProfile
import com.tatva.attendo.data.remote.CompanyRef
import com.tatva.attendo.data.remote.LedgerDto
import com.tatva.attendo.data.remote.PayslipDto
import com.tatva.attendo.data.session.SessionManager
import com.tatva.attendo.data.store.StoredSession
import com.tatva.attendo.domain.PayslipFormat
import com.tatva.attendo.domain.PayrollRepository
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class PayrollTest {
    @Test fun rupeesUseIndianGrouping() {
        assertEquals("Rs. 0.00", PayslipFormat.rupees(0.0))
        assertEquals("Rs. 999.50", PayslipFormat.rupees(999.5))
        assertEquals("Rs. 1,000.00", PayslipFormat.rupees(1000.0))
        assertEquals("Rs. 1,23,456.78", PayslipFormat.rupees(123456.78))
        assertEquals("Rs. 12,34,56,789.00", PayslipFormat.rupees(123456789.0))
        assertEquals("-Rs. 25.00", PayslipFormat.rupees(-25.0))
    }

    @Test fun daysAndMonthLabels() {
        assertEquals("24", PayslipFormat.days(24.0))
        assertEquals("2.5", PayslipFormat.days(2.5))
        assertEquals("February 2026", PayslipFormat.monthLabel("2026-02-01"))
        assertEquals("junk", PayslipFormat.monthLabel("junk"))
    }

    @Test fun pdfRowsOmitZeroExtrasAndBalance() {
        val p = PayslipDto(id = "p", month = "2026-02-01", gross = 5000.0, bonus = 200.0, advanceDeduction = 1000.0, net = 4200.0)
        val e = PayslipFormat.earnings(p); val d = PayslipFormat.deductions(p)
        assertEquals(listOf("Salary for days paid" to 5000.0, "Bonus / other earnings" to 200.0), e)
        assertEquals(listOf("Advance recovery" to 1000.0), d)
        assertEquals(p.net, e.sumOf { it.second } - d.sumOf { it.second }, 0.001)
        assertEquals("Wages for days paid", PayslipFormat.earnings(p.copy(payType = "daily", bonus = 0.0)).single().first)
        assertTrue(PayslipFormat.deductions(p.copy(advanceDeduction = 0.0)).isEmpty())
        assertEquals("payslip-E001-2026-02.pdf", PayslipFormat.fileName("E001", p))
    }

    @Test fun repositoryTotalsOutstandingAndUnpaid() = runTest {
        val remote = FakeRemote().apply { profileResult = EmployeeProfile(id = "emp", employeeCode = "E001", fullName = "Asha", companies = CompanyRef("Tatva")) }
        val session = SessionManager(MemTokenStore(StoredSession("a1", "r1", Long.MAX_VALUE / 2, false, "k")), remote)
        remote.payslipsResult = listOf(
            PayslipDto(id = "a", month = "2026-02-01", net = 4200.0, paidOn = "2026-03-02", paymentMode = "bank"),
            PayslipDto(id = "b", month = "2026-03-01", net = 3000.0),
        )
        remote.advancesResult = listOf(AdvanceDto("x", 3000.0, "2026-02-10", monthlyDeduction = 1000.0, recovered = 1000.0, remaining = 2000.0), AdvanceDto("y", 500.0, "2026-03-01", remaining = 500.0))
        remote.ledgerResult = listOf(LedgerDto("l", "2026-03-02", "salary_paid", 4200.0, "to_employee"))
        val m = PayrollRepository(session, remote).load()
        assertEquals(2500.0, m.outstanding, 0.001)
        assertEquals(3000.0, m.unpaidSalary, 0.001)
        assertEquals("Tatva", m.companyName)
        assertEquals("Asha", m.employeeName)
    }

    @Test fun missingEmployeeIsReported() = runTest {
        val remote = FakeRemote().apply { profileResult = null }
        val session = SessionManager(MemTokenStore(StoredSession("a1", "r1", Long.MAX_VALUE / 2, false, "k")), remote)
        try { PayrollRepository(session, remote).load(); fail() } catch (e: ApiException.Server) { assertEquals("EMPLOYEE_NOT_FOUND", e.code) }
    }

    @Test fun pdfLabelsTranslateRowKeysAndMonthFollowsLocale() {
        val l = com.tatva.attendo.domain.PdfLabels("a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "SAL", "WAGE", "BON", "ADV", "OTH", "NONE", "net", { d, m -> "$d/$m" }, "pend", "note", emptyMap())
        assertEquals("SAL", l.row("Salary for days paid")); assertEquals("ADV", l.row("Advance recovery")); assertEquals("NONE", l.row("None")); assertEquals("x", l.row("x"))
        assertEquals("February 2026", PayslipFormat.monthLabel("2026-02-01", java.util.Locale.ENGLISH))
        assertTrue(PayslipFormat.monthLabel("2026-02-01", java.util.Locale("hi")) != "February 2026")
    }
}
