/**
 * بناء ملفات المخرجات وتنزيلها.
 *
 * ثلاثة ملفات:
 *   1. قالب قيود جاهز للرفع
 *   2. المرتجعات المفصولة — ليست فواتير مبيعات ولا تُرفع بهذا المسار
 *   3. تقرير التحقق والمطابقة الحسابية
 */

import ExcelJS from 'exceljs';
import { buildTemplateFile } from '../engine/template.js';
import { STYLE } from '../engine/constants.js';
import { formatDate, round, toStr } from '../engine/num.js';

export function downloadBlob(data, filename) {
  const blob = data instanceof Blob ? data : new Blob([data], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function exportInvoiceTemplate(rows, template, filename) {
  const buffer = await buildTemplateFile(rows, template);
  downloadBlob(new Blob([buffer]), filename);
}

/** ملف المرتجعات — يحفظ البيانات الأصلية كما هي لمعالجتها كإشعارات دائنة */
export async function exportReturns(returns, filename) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('المرتجعات');

  const headers = ['رقم الفاتورة', 'التاريخ', 'العميل', 'الموقع', 'القناة', 'رمز المنتج', 'وصف المنتج',
    'الكمية', 'المبلغ قبل الضريبة', 'الخصم', 'الضريبة', 'الإجمالي شامل الضريبة', 'صف المصدر'];

  ws.addRow(headers);
  styleHeader(ws.getRow(1), headers.length);

  for (const inv of returns) {
    for (const l of inv.lines) {
      ws.addRow([
        inv.invoiceRef, formatDate(inv.issueDateParts), inv.sourceCustomerName,
        inv.sourceLocation, inv.channel, l.sourceSku, l.sourceName,
        l.quantity, l.grossExclusive, l.discountExclusive, l.taxAmount,
        l.sourceTotalInclusive, l.sourceRow,
      ]);
    }
  }

  ws.columns.forEach((c, i) => { c.width = [18, 14, 24, 18, 16, 22, 44, 10, 18, 12, 12, 20, 12][i] || 16; });
  ws.eachRow((row, n) => { if (n > 1) row.font = { name: STYLE.fontName, size: 11 }; });
  ws.views = [{ state: 'frozen', ySplit: 1 }];

  const buffer = await wb.xlsx.writeBuffer();
  downloadBlob(new Blob([buffer]), filename);
}

/** تقرير التحقق: الملاحظات، المطابقة الحسابية، وحالة الكميات */
export async function exportReport({ validation, reconciliation, summary, stock, notes, stats }, filename) {
  const wb = new ExcelJS.Workbook();

  /* ملخص */
  const s = wb.addWorksheet('الملخص');
  const rows = [
    ['البند', 'القيمة'],
    ['صفوف ملف المصدر', stats?.totalRows ?? ''],
    ['فواتير المبيعات', summary.invoices],
    ['صفوف قالب قيود', summary.rows],
    ['فواتير المرتجعات المفصولة', stats?.returnInvoices ?? ''],
    ['', ''],
    ['إجمالي المصدر', summary.sourceGrandTotal],
    ['إجمالي قيود المحسوب', summary.expectedGrandTotal],
    ['الفرق', round(summary.expectedGrandTotal - summary.sourceGrandTotal, 2)],
    ['فواتير بانحراف', summary.driftedInvoices],
    ['أقصى انحراف لفاتورة', round(summary.maxDrift, 2)],
    ['', ''],
    ['أخطاء فادحة', validation.fatal.length],
    ['تحذيرات', validation.warn.length],
  ];
  rows.forEach(r => s.addRow(r));
  styleHeader(s.getRow(1), 2);
  s.getColumn(1).width = 34;
  s.getColumn(2).width = 20;

  /* الملاحظات */
  const iss = wb.addWorksheet('الملاحظات');
  iss.addRow(['الخطورة', 'الرمز', 'الفاتورة', 'صف المصدر', 'الرسالة']);
  styleHeader(iss.getRow(1), 5);
  const all = [...validation.issues, ...(notes || [])];
  for (const i of all) {
    iss.addRow([
      i.severity === 'fatal' ? 'فادح' : 'تحذير',
      i.code, i.invoiceRef ?? '', i.sourceRow ?? '', i.message,
    ]);
  }
  iss.columns.forEach((c, i) => { c.width = [10, 26, 18, 12, 96][i] || 16; });
  iss.views = [{ state: 'frozen', ySplit: 1 }];

  /* المطابقة الحسابية */
  const rec = wb.addWorksheet('المطابقة الحسابية');
  rec.addRow(['الفاتورة', 'عدد البنود', 'إجمالي المصدر', 'إجمالي قيود', 'الفرق']);
  styleHeader(rec.getRow(1), 5);
  for (const t of reconciliation) {
    rec.addRow([t.invoiceRef, t.lineCount, t.sourceTotal, t.expectedTotal, t.drift]);
  }
  rec.columns.forEach((c, i) => { c.width = [20, 12, 18, 18, 12][i]; });
  rec.views = [{ state: 'frozen', ySplit: 1 }];

  /* الكميات */
  if (stock && stock.length) {
    const st = wb.addWorksheet('الكميات');
    st.addRow(['رمز المنتج', 'الاسم', 'المطلوب', 'المتاح', 'النقص', 'عدد الفواتير', 'الحالة']);
    styleHeader(st.getRow(1), 7);
    const label = {
      ok: 'كافية', insufficient: 'نقص', not_tracked: 'غير مخزَّن', unknown_product: 'غير موجود في قيود',
    };
    for (const p of stock) {
      st.addRow([p.code, p.name, p.required, p.available ?? '', p.shortage || '', p.invoiceCount, label[p.status]]);
    }
    st.columns.forEach((c, i) => { c.width = [22, 44, 12, 12, 12, 14, 20][i]; });
    st.views = [{ state: 'frozen', ySplit: 1 }];
  }

  const buffer = await wb.xlsx.writeBuffer();
  downloadBlob(new Blob([buffer]), filename);
}

function styleHeader(row, count) {
  for (let c = 1; c <= count; c++) {
    const cell = row.getCell(c);
    cell.font = { name: STYLE.fontName, size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: STYLE.headerFill } };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
  }
  row.height = 24;
}
