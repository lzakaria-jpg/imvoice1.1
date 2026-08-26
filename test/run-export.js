import ExcelJS from 'exceljs';
import fs from 'fs';
import { detectMapping, parseSource } from '../src/engine/parseSource.js';
import { transformAll } from '../src/engine/transform.js';
import { readTemplate, buildTemplateFile } from '../src/engine/template.js';
import { resolveInvoiceTaxes } from '../src/engine/resolve.js';
import { validateAll } from '../src/engine/validate.js';
import { ENGINE_DEFAULTS, COLUMNS, STYLE } from '../src/engine/constants.js';
import { toStr, round } from '../src/engine/num.js';

const UP = '/mnt/user-data/uploads';
const OUT = '/home/claude/out';
fs.mkdirSync(OUT, { recursive: true });

const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(`${UP}/order_invoices_export_01M0QFYVMP5VZB4VW2HNTVSASW.xlsx`);
const sheet = wb.worksheets[0];
const headers = [];
sheet.getRow(1).eachCell({ includeEmpty: true }, (c, i) => { headers[i - 1] = toStr(c.value); });
const records = [];
for (let r = 2; r <= sheet.rowCount; r++) {
  const row = sheet.getRow(r); const rec = {}; let any = false;
  headers.forEach((h, i) => {
    let v = row.getCell(i + 1).value;
    if (v && typeof v === 'object' && 'result' in v) v = v.result;
    rec[h] = v; if (v !== null && v !== undefined && v !== '') any = true;
  });
  if (any) records.push(rec);
}

const parsed = parseSource(records, detectMapping(headers));
const tpl = await readTemplate(fs.readFileSync(`${UP}/invoice_import_template.xlsx`));
const taxLabels = tpl.lists.taxes;
const defaultTax = taxLabels.find(t => t.includes('15')) || taxLabels[0];

const invoices = parsed.sales.map(inv => {
  const { resolved } = resolveInvoiceTaxes(inv, taxLabels, defaultTax);
  return {
    invoiceRef: inv.invoiceRef,
    customerRef: 'C-DEFAULT',
    issueDate: inv.issueDateParts,
    dueDate: inv.issueDateParts,
    supplyDate: null,
    location: tpl.lists.locations[0],
    paymentMethod: 'نقدي',
    description: '', terms: '', notes: '',
    sourceTotalInclusive: inv.sourceTotalInclusive,
    lines: inv.lines.map((l, i) => ({
      sourceRow: l.sourceRow,
      productCode: l.sourceSku || '',
      productDesc: l.sourceSku ? '' : l.sourceName,
      quantity: l.quantity, unitOfConv: '',
      grossExclusive: l.grossExclusive,
      discountExclusive: l.discountExclusive,
      taxRate: resolved[i].pct, taxLabel: resolved[i].label,
      sourceTotalInclusive: l.sourceTotalInclusive,
    })),
  };
});

const out = transformAll(invoices, ENGINE_DEFAULTS);
const v = validateAll({ rows: out.rows, template: tpl, reconciliation: out.reconciliation, opts: ENGINE_DEFAULTS });

console.log('— التحقق —');
console.log('  أخطاء فادحة:', v.fatal.length, '| تحذيرات:', v.warn.length, '| قابل للتصدير:', v.canExport);
const codes = {};
for (const i of v.issues) codes[i.code] = (codes[i.code] || 0) + 1;
console.log('  التوزيع:', codes);
if (v.fatal.length) console.log('  عينة فادحة:', v.fatal.slice(0, 3).map(f => f.message));

const buf = await buildTemplateFile(out.rows, tpl);
fs.writeFileSync(`${OUT}/qoyod_invoices.xlsx`, Buffer.from(buf));
console.log('\nتم البناء:', round(buf.byteLength / 1024, 1), 'KB');

/* ── التحقق من الملف المُنتَج بإعادة قراءته ── */
const wb2 = new ExcelJS.Workbook();
await wb2.xlsx.readFile(`${OUT}/qoyod_invoices.xlsx`);
const ws2 = wb2.getWorksheet('Invoice Upload Template');
const lk2 = wb2.getWorksheet('do_not_edit');

console.log('\n— فحص المخرج —');
console.log('  الأوراق:', wb2.worksheets.map(w => `${w.name}(${w.state})`).join(', '));

let headerOk = true;
COLUMNS.forEach((s, i) => { if (toStr(ws2.getRow(2).getCell(i + 1).value) !== s.header) headerOk = false; });
console.log('  رؤوس مطابقة للقالب الرسمي:', headerOk);
console.log('  الدمج:', ws2.model.merges);
console.log('  عدد صفوف البيانات:', ws2.rowCount - 2, '| متوقع:', out.rows.length);

const c = ws2.getCell('A1');
console.log('  A1 تعبئة:', c.fill?.fgColor?.argb, '| خط:', c.font?.name, c.font?.size, c.font?.bold);
console.log('  K1 تعبئة:', ws2.getCell('K1').fill?.fgColor?.argb);
console.log('  A2 تعبئة:', ws2.getCell('A2').fill?.fgColor?.argb);
console.log('  عرض A/K/M:', ws2.getColumn('A').width, ws2.getColumn('K').width, ws2.getColumn('M').width);
console.log('  do_not_edit مخفية:', lk2.state, '| صفوف:', lk2.rowCount);
console.log('  تحقق G3:', JSON.stringify(ws2.getCell('G3').dataValidation));
console.log('  تحقق M3:', JSON.stringify(ws2.getCell('M3').dataValidation));

/* ── إعادة حساب الإجماليات من الملف المُنتَج نفسه، لا من الذاكرة ── */
const totals = new Map();
for (let r = 3; r <= ws2.rowCount; r++) {
  const row = ws2.getRow(r);
  const ref = toStr(row.getCell(1).value);
  if (!ref) continue;
  const qty = Number(row.getCell(13).value);
  const price = Number(row.getCell(15).value);
  const inc = toStr(row.getCell(16).value) === 'نعم';
  const pct = row.getCell(17).value === null ? 0 : Number(row.getCell(17).value);
  const label = toStr(row.getCell(19).value);
  const rate = Number((label.match(/(\d+(?:\.\d+)?)\s*%/) || [0, 0])[1]) / 100;
  const gross = price * qty;
  const net = gross * (1 - pct / 100);
  const total = round(inc ? net : net * (1 + rate), 2);
  totals.set(ref, round((totals.get(ref) || 0) + total, 2));
}

let mismatch = 0, maxD = 0, sumAbs = 0, grand = 0;
for (const t of out.reconciliation) {
  const fromFile = totals.get(t.invoiceRef) ?? 0;
  grand = round(grand + fromFile, 2);
  const d = round(fromFile - t.sourceTotal, 2);
  if (Math.abs(d) > 0.011) mismatch++;
  maxD = Math.max(maxD, Math.abs(d));
  sumAbs = round(sumAbs + Math.abs(d), 2);
}
console.log('\n— المطابقة من الملف المُنتَج مباشرة —');
console.log('  فواتير في الملف:', totals.size, '| متوقع:', out.reconciliation.length);
console.log('  إجمالي المصدر :', out.summary.sourceGrandTotal);
console.log('  إجمالي الملف  :', grand);
console.log('  الفرق الكلي   :', round(grand - out.summary.sourceGrandTotal, 2));
console.log('  فواتير منحرفة :', mismatch, '| أقصى انحراف:', round(maxD, 2), '| مجموع الانحراف:', sumAbs);

/* ── ملف المرتجعات ── */
console.log('\n— المرتجعات —');
console.log('  فواتير:', parsed.returns.length, '| بنود:', parsed.returns.reduce((s, i) => s + i.lines.length, 0));
console.log('  إجمالي:', round(parsed.returns.reduce((s, i) => s + i.sourceTotalInclusive, 0), 2));
