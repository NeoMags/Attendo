package com.tatva.attendo

import com.tatva.attendo.data.remote.ApiException
import com.tatva.attendo.data.remote.CompanyRef
import com.tatva.attendo.data.remote.EmployeeProfile
import com.tatva.attendo.data.remote.TaxDeclarationDto
import com.tatva.attendo.data.remote.TaxProjectionDto
import com.tatva.attendo.data.session.SessionManager
import com.tatva.attendo.data.store.StoredSession
import com.tatva.attendo.domain.TaxRepository
import com.tatva.attendo.domain.TaxRules
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.fail
import org.junit.Test
import java.time.LocalDate

class TaxTest {
    @Test fun taxYearStartsInApril() {
        assertEquals(2025, TaxRules.taxYearOf(LocalDate.of(2026, 3, 31)))
        assertEquals(2026, TaxRules.taxYearOf(LocalDate.of(2026, 4, 1)))
        assertEquals(2026, TaxRules.taxYearOf(LocalDate.of(2027, 1, 15)))
        assertEquals("2026-27", TaxRules.label(2026))
        assertEquals("2099-00", TaxRules.label(2099))
    }

    @Test fun amountParsing() {
        assertEquals(0.0, TaxRules.parseAmount("")!!, 0.0)
        assertEquals(150000.0, TaxRules.parseAmount("1,50,000")!!, 0.0)
        assertEquals(12.5, TaxRules.parseAmount(" 12.5 ")!!, 0.0)
        assertNull(TaxRules.parseAmount("abc")); assertNull(TaxRules.parseAmount("-1")); assertNull(TaxRules.parseAmount("1e12")); assertNull(TaxRules.parseAmount("NaN"))
        assertEquals("", TaxRules.amountText(0.0)); assertEquals("200000", TaxRules.amountText(200000.0)); assertEquals("12.5", TaxRules.amountText(12.5))
    }

    private fun repo(remote: FakeRemote): TaxRepository {
        remote.profileResult = EmployeeProfile(id = "e1", employeeCode = "E001", fullName = "Asha", companies = CompanyRef("Tatva"))
        return TaxRepository(SessionManager(MemTokenStore(StoredSession("a1", "r1", Long.MAX_VALUE / 2, false, "k")), remote), remote)
    }

    @Test fun loadsProjectionAndFallsBackToEmptyDeclaration() = runTest {
        val remote = FakeRemote().apply { taxProjectionResult = TaxProjectionDto(taxYear = 2026, annualGross = 1800000.0, monthlyTds = 12567.0) }
        val d = repo(remote).load(2026)
        assertEquals("e1", d.employeeId); assertEquals(12567.0, d.projection.monthlyTds, 0.0); assertEquals("new", d.declaration.regime)
    }

    @Test fun saveSendsDeclarationForOwnEmployeeAndReloadsProjection() = runTest {
        val remote = FakeRemote().apply { taxProjectionResult = TaxProjectionDto(monthlyTds = 700.0) }
        val decl = TaxDeclarationDto(regime = "old", sec80c = 150000.0, parentsSenior = true)
        val d = repo(remote).save(2026, decl)
        assertEquals(listOf(Triple("e1", 2026, decl)), remote.taxSaves); assertEquals(700.0, d.projection.monthlyTds, 0.0); assertEquals(decl, d.declaration)
    }

    @Test fun saveErrorsPropagate() = runTest {
        val remote = FakeRemote().apply { taxSaveError = ApiException.Server("INVALID_AMOUNT", "bad", 400) }
        try { repo(remote).save(2026, TaxDeclarationDto()); fail("expected error") } catch (e: ApiException.Server) { assertEquals("INVALID_AMOUNT", e.code) }
    }
}
