import ExcelJS from 'exceljs';
import fs from 'fs';
import { detectMapping, parseSource } from '../src/engine/parseSource.js';
import { transformAll } from '../src/engine/transform.js';
import { readTemplate } from '../src/engine/template.js';
import { matchTaxByRate, resolveInvoiceTaxes } from '../src/engine/resolve.js';
import { ENGINE_DEFAULTS } from '../src/engine/constants.js';
import { toStr, round, formatDate } from '../src/engine/num.js';

const UP = '/mnt/user-data/uploads';

async function readSheetAsRecords(path) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path);
  const ws = wb.worksheets[0];
  const headers = [];
  ws.getRow(1).eachCell({ includeEmpty: true }, (c, i) => { headers[i - 1] = toStr(c.value); });
  const records = [];
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const rec = {};
    let any = false;
    headers.forEach((h, i) => {
      let v = row.getCell(i + 1).value;
      if (v && typeof v === 'object' && 'result' in v) v = v.result;
      if (v && typeof v === 'object' && 'text' in v) v = v.text;
      rec[h] = v;
      if (v !== null && v !== undefined && v !== '') any = true;
    });
    if (any) records.push(rec);
  }
  return { headers, records };
}

const { headers, records } = await readSheetAsRecords(`${UP}/order_invoices_export_01M0QFYVMP5VZB4VW2HNTVSASW.xlsx`);
console.log('صفوف المصدر:', records.length);

const mapping = detectMapping(headers);
console.log('\nالتعيين التلقائي:');
for (const [k, v] of Object.entries(mapping)) console.log(`  ${k.padEnd(15)} → ${v}`);
const missing = ['invoiceNumber','lineType','quantity','subtotalEx','totalInc','totalTax'].filter(k => !mapping[k]);
console.log('حقول أساسية غير مكتشفة:', missing.length ? missing.join(', ') : 'لا يوجد');

const parsed = parseSource(records, mapping);
console.log('\n— التفكيك —');
console.log(parsed.stats);

const byCode = {};
for (const i of parsed.issues) byCode[i.code] = (byCode[i.code] || 0) + 1;
console.log('\nملاحظات التفكيك:', byCode);

// قوائم القالب الرسمي
const tpl = await readTemplate(fs.readFileSync(`${UP}/invoice_import_template.xlsx`));
console.log('\n— القالب —');
console.log('رؤوس مطابقة:', tpl.headers.length, '| القوائم:', JSON.stringify(tpl.lists, null, 0));

// تجهيز الفواتير للتحويل: مطابقة الضريبة بالنسبة المشتقة
const taxLabels = tpl.lists.taxes;
const defaultTax = taxLabels.find(t => t.includes('15')) || taxLabels[0];
const taxNotes = [];
const invoices = parsed.sales.map(inv => {
  const { resolved, notes } = resolveInvoiceTaxes(inv, taxLabels, defaultTax);
  taxNotes.push(...notes);
  return {
    invoiceRef: inv.invoiceRef,
    customerRef: 'TEST-CUST',
    issueDate: inv.issueDateParts,
    dueDate: inv.issueDateParts,
    supplyDate: null,
    location: tpl.lists.locations[0],
    paymentMethod: '',
    description: '', terms: '', notes: '',
    sourceTotalInclusive: inv.sourceTotalInclusive,
    lines: inv.lines.map((l, i) => ({
      sourceRow: l.sourceRow,
      productCode: l.sourceSku || '',
      productDesc: l.sourceSku ? '' : l.sourceName,
      quantity: l.quantity,
      unitOfConv: '',
      grossExclusive: l.grossExclusive,
      discountExclusive: l.discountExclusive,
      taxRate: resolved[i].pct,
      taxLabel: resolved[i].label,
      sourceTotalInclusive: l.sourceTotalInclusive,
    })),
  };
});
console.log('بنود ورثت ضريبتها (وعاء صفر):', taxNotes.length);

for (const dp of [4, 2]) {
  const opts = { ...ENGINE_DEFAULTS, unitPriceDecimals: dp };
  const out = transformAll(invoices, opts);
  console.log(`\n— التحويل (سعر الوحدة بـ ${dp} خانات) —`);
  console.log('  فواتير:', out.summary.invoices, '| صفوف القالب:', out.summary.rows);
  console.log('  إجمالي المصدر :', out.summary.sourceGrandTotal);
  console.log('  إجمالي قيود   :', out.summary.expectedGrandTotal);
  console.log('  فواتير منحرفة :', out.summary.driftedInvoices, '| أقصى انحراف:', round(out.summary.maxDrift, 2), '| مجموع الانحراف:', out.summary.totalAbsDrift);
  if (dp === 4) {
    const worst = out.reconciliation.filter(t => Math.abs(t.drift) > 0.011)
      .sort((a, b) => Math.abs(b.drift) - Math.abs(a.drift)).slice(0, 6);
    console.log('  أكبر الانحرافات:');
    for (const w of worst) console.log(`    ${w.invoiceRef.padEnd(16)} مصدر ${String(w.sourceTotal).padStart(10)} → قيود ${String(w.expectedTotal).padStart(10)} = ${w.drift}`);
    globalThis.__out = out;
  }
}

const out = globalThis.__out;
console.log('\n— عينة صفوف القالب —');
for (const r of out.rows.slice(0, 3)) {
  console.log(`  ${r.invoiceRef} | ${formatDate(r.issueDate)} | ${r.productCode || r.productDesc} | كمية ${r.quantity} | سعر ${r.unitPrice} | شامل ${r.taxInclusive} | خصم% ${r.discountPct ?? '-'} | ${r.taxRate}`);
}
console.log('\nصفوف بخصم:', out.rows.filter(r => r.discountPct !== null).length);
console.log('صفوف بقيمة خصم (يجب أن تكون صفراً):', out.rows.filter(r => r.discountVal !== null).length);
console.log('المرتجعات المفصولة:', parsed.returns.length, 'فاتورة /', parsed.stats.returnLines, 'بند');
