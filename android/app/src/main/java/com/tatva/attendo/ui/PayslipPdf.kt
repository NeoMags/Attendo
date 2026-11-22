package com.tatva.attendo.ui

import android.content.Context
import android.content.Intent
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Typeface
import android.graphics.pdf.PdfDocument
import android.os.Bundle
import android.os.CancellationSignal
import android.os.ParcelFileDescriptor
import android.print.PageRange
import android.print.PrintAttributes
import android.print.PrintDocumentAdapter
import android.print.PrintDocumentInfo
import android.print.PrintManager
import androidx.core.content.FileProvider
import com.tatva.attendo.R
import com.tatva.attendo.data.remote.PayslipDto
import com.tatva.attendo.domain.PayslipFormat
import com.tatva.attendo.domain.PdfLabels
import java.util.Locale
import java.io.File
import java.io.FileOutputStream

/** Draws one payslip as an A4 PDF with Android's own PdfDocument (no extra dependency). */
object PayslipPdf {
    private const val W = 595
    private const val H = 842
    private const val LEFT = 40f
    private const val RIGHT = W - 40f

    fun render(p: PayslipDto, employeeName: String, employeeCode: String, company: String?, L: PdfLabels, locale: Locale, out: File) {
        val doc = PdfDocument()
        val page = doc.startPage(PdfDocument.PageInfo.Builder(W, H, 1).create())
        draw(page.canvas, p, employeeName, employeeCode, company, L, locale)
        doc.finishPage(page)
        FileOutputStream(out).use { doc.writeTo(it) }
        doc.close()
    }

    private fun paint(size: Float, bold: Boolean = false, color: Int = Color.rgb(30, 30, 30)) =
        Paint(Paint.ANTI_ALIAS_FLAG).apply { textSize = size; this.color = color; typeface = if (bold) Typeface.DEFAULT_BOLD else Typeface.DEFAULT }

    private fun draw(c: Canvas, p: PayslipDto, name: String, code: String, company: String?, L: PdfLabels, locale: Locale) {
        var y = 56f
        c.drawText(company?.takeIf { it.isNotBlank() } ?: L.payslipFor, LEFT, y, paint(18f, true, Color.rgb(15, 23, 42)))
        y += 22; c.drawText("${L.payslipFor} ${PayslipFormat.monthLabel(p.month, locale)}", LEFT, y, paint(12f))
        y += 18; c.drawText("${L.employee}: $name ($code)", LEFT, y, paint(11f))
        y += 26
        val small = paint(10f)
        c.drawText("${L.working} ${PayslipFormat.days(p.workingDays)}  ·  ${L.present} ${PayslipFormat.days(p.presentDays)}  ·  ${L.holidays} ${PayslipFormat.days(p.holidayDays)}  ·  ${L.paidLeave} ${PayslipFormat.days(p.paidLeaveDays)}", LEFT, y, small)
        y += 14; c.drawText("${L.unpaidLeave} ${PayslipFormat.days(p.unpaidLeaveDays)}  ·  ${L.absent} ${PayslipFormat.days(p.absentDays)}", LEFT, y, small)
        y += 28
        y = section(c, y, L.earnings, PayslipFormat.earnings(p), L)
        y = section(c, y + 10, L.deductions, PayslipFormat.deductions(p).ifEmpty { listOf("None" to 0.0) }, L)
        y += 20
        c.drawLine(LEFT, y, RIGHT, y, paint(1f))
        y += 22
        val bold = paint(14f, true)
        c.drawText(L.net, LEFT, y, bold)
        val net = PayslipFormat.rupees(p.net); c.drawText(net, RIGHT - bold.measureText(net), y, bold)
        if (!p.adjustmentNote.isNullOrBlank()) { y += 24; c.drawText("${L.note}: ${p.adjustmentNote}".take(110), LEFT, y, small) }
        y += 24
        c.drawText(if (p.paidOn != null) L.paidOn(p.paidOn, L.modes[p.paymentMode] ?: (p.paymentMode ?: "")) else L.pending, LEFT, y, small)
    }

    private fun section(c: Canvas, y0: Float, title: String, rows: List<Pair<String, Double>>, L: PdfLabels): Float {
        var y = y0
        c.drawText(title, LEFT, y, paint(12f, true)); y += 6
        c.drawLine(LEFT, y, RIGHT, y, paint(1f)); y += 18
        val row = paint(11f)
        rows.forEach { (label, amt) ->
            c.drawText(L.row(label), LEFT, y, row)
            if (!(label == "None" && amt == 0.0)) { val s = PayslipFormat.rupees(amt); c.drawText(s, RIGHT - row.measureText(s), y, row) }
            y += 18
        }
        return y
    }

    private fun labels(ctx: Context) = PdfLabels(
        payslipFor = ctx.getString(R.string.pdf_payslip_for), employee = ctx.getString(R.string.pdf_employee), working = ctx.getString(R.string.pdf_working),
        present = ctx.getString(R.string.pdf_present), holidays = ctx.getString(R.string.pdf_holidays), paidLeave = ctx.getString(R.string.pdf_paid_leave),
        unpaidLeave = ctx.getString(R.string.pdf_unpaid_leave), absent = ctx.getString(R.string.pdf_absent), earnings = ctx.getString(R.string.pdf_earnings),
        deductions = ctx.getString(R.string.pdf_deductions), salary = ctx.getString(R.string.pdf_salary), wages = ctx.getString(R.string.pdf_wages),
        bonus = ctx.getString(R.string.pdf_bonus), advance = ctx.getString(R.string.pdf_advance), other = ctx.getString(R.string.pdf_other),
        none = ctx.getString(R.string.pdf_none), net = ctx.getString(R.string.pdf_net), paidOn = { d, m -> ctx.getString(R.string.pdf_paid_on, d, m) },
        pending = ctx.getString(R.string.pdf_pending), note = ctx.getString(R.string.pdf_note),
        modes = mapOf("bank" to ctx.getString(R.string.pdf_mode_bank), "cash" to ctx.getString(R.string.pdf_mode_cash), "upi" to ctx.getString(R.string.pdf_mode_upi), "cheque" to ctx.getString(R.string.pdf_mode_cheque), "other" to ctx.getString(R.string.pdf_mode_other)),
    )

    private fun file(ctx: Context, p: PayslipDto, name: String, code: String, company: String?): File {
        val dir = File(ctx.cacheDir, "payslips").apply { mkdirs() }
        return File(dir, PayslipFormat.fileName(code, p)).also { render(p, name, code, company, labels(ctx), ctx.resources.configuration.locales[0], it) }
    }

    /** Opens the share sheet so the PDF can be saved to Downloads/Drive or sent. */
    fun share(ctx: Context, p: PayslipDto, name: String, code: String, company: String?) {
        val f = file(ctx, p, name, code, company)
        val uri = FileProvider.getUriForFile(ctx, "${ctx.packageName}.files", f)
        val send = Intent(Intent.ACTION_SEND).setType("application/pdf").putExtra(Intent.EXTRA_STREAM, uri).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        ctx.startActivity(Intent.createChooser(send, f.name).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }

    /** Hands the PDF to Android's print framework (printers or "Save as PDF"). */
    fun print(ctx: Context, p: PayslipDto, name: String, code: String, company: String?) {
        val f = file(ctx, p, name, code, company)
        val pm = ctx.getSystemService(Context.PRINT_SERVICE) as PrintManager
        pm.print(f.name, object : PrintDocumentAdapter() {
            override fun onLayout(o: PrintAttributes?, n: PrintAttributes?, s: CancellationSignal?, cb: LayoutResultCallback, e: Bundle?) {
                if (s?.isCanceled == true) cb.onLayoutCancelled() else cb.onLayoutFinished(PrintDocumentInfo.Builder(f.name).setContentType(PrintDocumentInfo.CONTENT_TYPE_DOCUMENT).setPageCount(1).build(), true)
            }
            override fun onWrite(pages: Array<out PageRange>?, dest: ParcelFileDescriptor, s: CancellationSignal?, cb: WriteResultCallback) {
                try { f.inputStream().use { i -> FileOutputStream(dest.fileDescriptor).use { o -> i.copyTo(o) } }; cb.onWriteFinished(arrayOf(PageRange.ALL_PAGES)) } catch (e: Exception) { cb.onWriteFailed(e.message) }
            }
        }, null)
    }
}
