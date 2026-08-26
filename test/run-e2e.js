/**
 * اختبار المسار الكامل — يحاكي ما تفعله الواجهة بالضبط:
 * قراءة القالب ← تفكيك المصدر ← جمع القرارات ← تطبيق قرارات المستخدم ← التحويل ← التحقق.
 */

import ExcelJS from 'exceljs';
import fs from 'fs';
import { readTemplate, buildTemplateFile } from '../src/engine/template.js';
import { detectMapping, parseSource } from '../src/engine/parseSource.js';
import { collectDecisions, runPipeline } from '../src/engine/pipeline.js';
import { ENGINE_DEFAULTS } from '../src/engine/constants.js';
import { toStr, round } from '../src/engine/num.js';

const UP = '/mnt/user-data/uploads';
const OUT = '/home/claude/out';
fs.mkdirSync(OUT, { recursive: true });

async function read(path) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path);
  const ws = wb.worksheets[0];
  const headers = [];
  ws.getRow(1).eachCell({ includeEmpty: true }, (c, i) => { headers[i - 1] = toStr(c.value); });
  const records = [];
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r); const rec = {}; let any = false;
    headers.forEach((h, i) => {
      let v = row.getCell(i + 1).value;
      if (v && typeof v === 'object' && 'result' in v) v = v.result;
      rec[h] = v; if (v !== null && v !== undefined && v !== '') any = true;
    });
    if (any) records.push(rec);
  }
  return { headers, records };
}

const template = await readTemplate(fs.readFileSync(`${UP}/invoice_import_template.xlsx`));
const src = await read(`${UP}/order_invoices_export_01M0QFYVMP5VZB4VW2HNTVSASW.xlsx`);
const parsed = parseSource(src.records, detectMapping(src.headers));

console.log('١. التفكيك');
console.log('   ', parsed.stats);

/* بلا مراجع: كل شيء معلّق — هذا سلوك مقصود، لا فشل */
let decisions = { customers: {}, products: {}, payments: {}, locations: {}, defaultPayment: '', defaultLocation: '' };
let pending = collectDecisions({ sales: parsed.sales, references: { customers: [], products: [] }, decisions, template });
console.log('\n٢. القرارات المعلّقة بلا مراجع');
console.log(`    عملاء ${pending.customers.length} · منتجات ${pending.products.length} · دفع ${pending.payments.length} · مواقع ${pending.locations.length}`);

let r = runPipeline({ sales: parsed.sales, references: { customers: [], products: [] }, decisions, template, options: ENGINE_DEFAULTS });
console.log(`    أخطاء فادحة ${r.validation.fatal.length} · قابل للتصدير ${r.validation.canExport}`);
console.log('    (متوقع: مرتفع — لا مراجع مرفوعة بعد)');

/* ── بناء مراجع اصطناعية من المصدر نفسه لمحاكاة ملفي قيود ── */
const custNames = [...new Set(parsed.sales.map(i => toStr(i.sourceCustomerName)).filter(Boolean))];
const customers = custNames.map((name, i) => ({ ref: `C-${String(i + 1).padStart(4, '0')}`, name }));

const prodMap = new Map();
for (const inv of [...parsed.sales, ...parsed.returns]) {
  for (const l of inv.lines) {
    const code = toStr(l.sourceSku) || toStr(l.sourceName);
    if (!prodMap.has(code)) prodMap.set(code, { code, name: toStr(l.sourceName), demand: 0 });
    prodMap.get(code).demand += Math.abs(l.quantity);
  }
}
// كمية متاحة سخية عدا منتجاً واحداً نتعمّد نقصه لاختبار الحاجز
const products = [...prodMap.values()].map((p, idx) => ({
  code: p.code, name: p.name,
  stock: idx === 0 ? 1 : Math.ceil(p.demand) + 50,
  tracked: true,
}));

const references = { customers, products };
console.log(`\n٣. مراجع اصطناعية: ${customers.length} عميل · ${products.length} منتج`);

pending = collectDecisions({ sales: parsed.sales, references, decisions, template });
console.log('\n٤. القرارات المعلّقة بعد رفع المراجع');
console.log(`    عملاء ${pending.customers.length} · منتجات ${pending.products.length} · دفع ${pending.payments.length} · مواقع ${pending.locations.length}`);
console.log('    عينة طرق دفع:', pending.payments.slice(0, 5).map(p => p.label).join(' · '));
console.log('    عينة عملاء  :', pending.customers.slice(0, 3).map(p => `${p.label}(${p.count})`).join(' · '));
console.log('    عينة مواقع  :', pending.locations.map(p => `${p.label}(${p.count})`).join(' · '));

/* ── محاكاة قرارات المستخدم ── */
decisions = {
  ...decisions,
  customers: { '': 'C-CASH' },
  payments: {
    'Card': 'بطاقة بنك', 'نقاط بيع - هلا': 'بطاقة بنك', 'حساب بنك ساب': 'دفعة لحساب البنك',
    'بطاقة الصراف': 'بطاقة بنك', 'Post Pay': 'بالأجل', 'كاش': 'نقدي', 'Cash': 'نقدي',
    'Debit': 'بطاقة بنك', 'Mada (Salla)': 'بطاقة بنك', 'HALA POS': 'بطاقة بنك',
    'Tamara (Salla)': 'بالأجل', 'Credit Card (Salla)': 'بطاقة بنك',
  },
  defaultLocation: template.lists.locations[0],
  defaultPayment: 'غير محدد',
  // اسم الفرع في نظام العميل يختلف عن اسم الموقع في قيود — قرار مطابقة صريح
  locations: { 'الفرع الرئيسي': template.lists.locations[0] },
};

pending = collectDecisions({ sales: parsed.sales, references, decisions, template });
console.log('\n٥. بعد قرارات المستخدم');
console.log(`    عملاء ${pending.customers.length} · منتجات ${pending.products.length} · دفع ${pending.payments.length} · مواقع ${pending.locations.length}`);

r = runPipeline({ sales: parsed.sales, references, decisions, template, options: ENGINE_DEFAULTS });
console.log('\n٦. التحويل والتحقق');
console.log(`    فواتير ${r.summary.invoices} · صفوف ${r.summary.rows}`);
console.log(`    إجمالي المصدر ${r.summary.sourceGrandTotal} → قيود ${r.summary.expectedGrandTotal} · الفرق ${round(r.summary.expectedGrandTotal - r.summary.sourceGrandTotal, 2)}`);
console.log(`    فادح ${r.validation.fatal.length} · تحذير ${r.validation.warn.length} · توريث ضريبة ${r.notes.length}`);
const codes = {};
for (const x of r.validation.issues) codes[x.code] = (codes[x.code] || 0) + 1;
console.log('    التوزيع:', codes);
console.log(`    قابل للتصدير: ${r.validation.canExport}  (متوقع false — نقص كمية متعمَّد)`);
console.log('    سبب المنع:', r.validation.fatal.filter(f => f.code === 'INSUFFICIENT_STOCK').map(f => f.message)[0]);

/* ── إصلاح النقص ثم إعادة التشغيل ── */
products[0].stock = 99999;
r = runPipeline({ sales: parsed.sales, references, decisions, template, options: ENGINE_DEFAULTS });
console.log('\n٧. بعد رفع كمية المنتج الناقص');
console.log(`    فادح ${r.validation.fatal.length} · قابل للتصدير ${r.validation.canExport}`);

/* ── التصدير والتحقق من الملف ── */
const buf = await buildTemplateFile(r.rows, template);
fs.writeFileSync(`${OUT}/e2e.xlsx`, Buffer.from(buf));

const wb2 = new ExcelJS.Workbook();
await wb2.xlsx.readFile(`${OUT}/e2e.xlsx`);
const ws2 = wb2.getWorksheet('Invoice Upload Template');

let emptyCustomer = 0, emptyProduct = 0, emptyLoc = 0, emptyPay = 0, emptyDue = 0;
const totals = new Map();
for (let row = 3; row <= ws2.rowCount; row++) {
  const g = c => ws2.getRow(row).getCell(c).value;
  if (!toStr(g(3))) emptyCustomer++;
  if (!toStr(g(11)) && !toStr(g(12))) emptyProduct++;
  if (!toStr(g(7))) emptyLoc++;
  if (!toStr(g(8))) emptyPay++;
  if (!toStr(g(5))) emptyDue++;
  const ref = toStr(g(1));
  const qty = Number(g(13)), price = Number(g(15));
  const pct = g(17) === null ? 0 : Number(g(17));
  const total = round(price * qty * (1 - pct / 100), 2);
  totals.set(ref, round((totals.get(ref) || 0) + total, 2));
}
const grand = round([...totals.values()].reduce((a, b) => a + b, 0), 2);

console.log('\n٨. فحص الملف المُصدَّر');
console.log(`    صفوف ${ws2.rowCount - 2} · فواتير ${totals.size}`);
console.log(`    خانات إلزامية فارغة → عميل ${emptyCustomer} · منتج ${emptyProduct} · موقع ${emptyLoc} · استحقاق ${emptyDue} · دفع ${emptyPay}`);
console.log(`    إجمالي محسوب من الملف ${grand} مقابل المصدر ${r.summary.sourceGrandTotal} · الفرق ${round(grand - r.summary.sourceGrandTotal, 2)}`);

const ok = emptyCustomer === 0 && emptyProduct === 0 && emptyLoc === 0 && emptyDue === 0
  && Math.abs(grand - r.summary.sourceGrandTotal) < 1 && r.validation.canExport;
console.log(`\n${ok ? '✓ المسار الكامل سليم' : '✗ يوجد خلل'}`);
process.exit(ok ? 0 : 1);
