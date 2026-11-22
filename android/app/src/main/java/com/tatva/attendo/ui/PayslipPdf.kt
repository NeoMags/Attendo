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
import com.tatva.attendo.data.remote.PayslipDto
import com.tatva.attendo.domain.PayslipFormat
import java.io.File
import java.io.FileOutputStream

/** Draws one payslip as an A4 PDF with Android's own PdfDocument (no extra dependency). */
object PayslipPdf {
    private const val W = 595
    private const val H = 842
    private const val LEFT = 40f
    private const val RIGHT = W - 40f

    fun render(p: PayslipDto, employeeName: String, employeeCode: String, company: String?, out: File) {
        val doc = PdfDocument()
        val page = doc.startPage(PdfDocument.PageInfo.Builder(W, H, 1).create())
        draw(page.canvas, p, employeeName, employeeCode, company)
        doc.finishPage(page)
        FileOutputStream(out).use { doc.writeTo(it) }
        doc.close()
    }

    private fun paint(size: Float, bold: Boolean = false, color: Int = Color.rgb(30, 30, 30)) =
        Paint(Paint.ANTI_ALIAS_FLAG).apply { textSize = size; this.color = color; typeface = if (bold) Typeface.DEFAULT_BOLD else Typeface.DEFAULT }

    private fun draw(c: Canvas, p: PayslipDto, name: String, code: String, company: String?) {
        var y = 56f
        c.drawText(company?.takeIf { it.isNotBlank() } ?: "Payslip", LEFT, y, paint(18f, true, Color.rgb(15, 23, 42)))
        y += 22; c.drawText("Payslip for ${PayslipFormat.monthLabel(p.month)}", LEFT, y, paint(12f))
        y += 18; c.drawText("Employee: $name ($code)", LEFT, y, paint(11f))
        y += 26
        val small = paint(10f)
        c.drawText("Working days ${PayslipFormat.days(p.workingDays)}  ·  Present ${PayslipFormat.days(p.presentDays)}  ·  Holidays ${PayslipFormat.days(p.holidayDays)}  ·  Paid leave ${PayslipFormat.days(p.paidLeaveDays)}", LEFT, y, small)
        y += 14; c.drawText("Unpaid leave ${PayslipFormat.days(p.unpaidLeaveDays)}  ·  Absent ${PayslipFormat.days(p.absentDays)}", LEFT, y, small)
        y += 28
        y = section(c, y, "Earnings", PayslipFormat.earnings(p))
        y = section(c, y + 10, "Deductions", PayslipFormat.deductions(p).ifEmpty { listOf("None" to 0.0) })
        y += 20
        c.drawLine(LEFT, y, RIGHT, y, paint(1f))
        y += 22
        val bold = paint(14f, true)
        c.drawText("Net pay", LEFT, y, bold)
        val net = PayslipFormat.rupees(p.net); c.drawText(net, RIGHT - bold.measureText(net), y, bold)
        if (!p.adjustmentNote.isNullOrBlank()) { y += 24; c.drawText("Note: ${p.adjustmentNote}".take(110), LEFT, y, small) }
        y += 24
        c.drawText(if (p.paidOn != null) "Paid on ${p.paidOn} by ${p.paymentMode}" else "Payment pending", LEFT, y, small)
    }

    private fun section(c: Canvas, y0: Float, title: String, rows: List<Pair<String, Double>>): Float {
        var y = y0
        c.drawText(title, LEFT, y, paint(12f, true)); y += 6
        c.drawLine(LEFT, y, RIGHT, y, paint(1f)); y += 18
        val row = paint(11f)
        rows.forEach { (label, amt) ->
            c.drawText(label, LEFT, y, row)
            if (amt != 0.0 || label != "None") { val s = PayslipFormat.rupees(amt); c.drawText(s, RIGHT - row.measureText(s), y, row) }
            y += 18
        }
        return y
    }

    private fun file(ctx: Context, p: PayslipDto, name: String, code: String, company: String?): File {
        val dir = File(ctx.cacheDir, "payslips").apply { mkdirs() }
        return File(dir, PayslipFormat.fileName(code, p)).also { render(p, name, code, company, it) }
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
