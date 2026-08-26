/**
 * اختبارات وحدة للمنطق الحسابي.
 * الغرض: تثبيت السلوك المُثبَت على البيانات الحقيقية حتى لا ينكسر بتعديل لاحق.
 */

import { computeLineFields } from '../src/engine/transform.js';
import { round, parseDate, formatDate, toNum, normalizeAr, normalizeCode } from '../src/engine/num.js';
import { ENGINE_DEFAULTS, YES } from '../src/engine/constants.js';
import { matchTaxByRate, matchListValue, checkStock, buildProductIndex } from '../src/engine/resolve.js';

let pass = 0, fail = 0;
const eq = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  ok ? pass++ : fail++;
  if (!ok) console.log(`  ✗ ${name}\n      متوقع: ${JSON.stringify(expected)}\n      فعلي : ${JSON.stringify(actual)}`);
};
const near = (name, actual, expected, tol = 0.011) => {
  const ok = Math.abs(actual - expected) <= tol;
  ok ? pass++ : fail++;
  if (!ok) console.log(`  ✗ ${name}  متوقع ${expected} فعلي ${actual}`);
};

console.log('— التقريب —');
eq('نصف لأعلى', round(1.005, 2), 1.01);
eq('نصف لأعلى سالب', round(-1.005, 2), -1.01);
eq('لا تغيير', round(2.5, 0), 3);
eq('أربع خانات', round(4.60875, 4), 4.6088);

console.log('— التواريخ —');
eq('صيغة نقاط البيع', formatDate(parseDate('August 19, 2026 07:45 PM')), '19/08/2026');
eq('صيغة القالب', formatDate(parseDate('19/08/2026')), '19/08/2026');
eq('صيغة ISO', formatDate(parseDate('2026-08-19')), '19/08/2026');
eq('تاريخ غير صالح', parseDate('31/02/2026'), null);
eq('نص فارغ', parseDate(''), null);

console.log('— الأرقام العربية —');
eq('أرقام هندية', toNum('١٢٣٫٥'), 123.5);
eq('فاصلة آلاف', toNum('1,234.56'), 1234.56);
eq('فارغ يعطي null', toNum(''), null);
eq('صفر ليس null', toNum('0'), 0);

console.log('— التطبيع —');
eq('همزات وتاء مربوطة', normalizeAr('أحمد العوّامة'), normalizeAr('احمد العوامه'));
eq('رمز منتج', normalizeCode(' cem-a3-m8 '), 'CEM-A3-M8');

console.log('— حساب البند: بند بسيط بلا خصم —');
{
  // من الملف الحقيقي، صف 2: كمية 8، قبل الضريبة 36.87، إجمالي شامل 42.40
  const r = computeLineFields({
    quantity: 8, grossExclusive: 36.87, discountExclusive: 0,
    taxRate: 0.15, sourceTotalInclusive: 42.40,
  }, ENGINE_DEFAULTS);
  eq('شامل الضريبة', r.taxInclusive, YES);
  eq('لا نسبة خصم', r.discountPct, null);
  eq('لا قيمة خصم', r.discountVal, null);
  near('سعر الوحدة', r.unitPrice, 5.3, 0.0002);
  near('الإجمالي', r.expectedTotal, 42.40);
  near('الانحراف صفر', r.drift, 0);
}

console.log('— حساب البند: خصم 10% —');
{
  // من الملف الحقيقي، صف 40: كمية 2، قبل الضريبة 95.65، خصم 9.57، إجمالي 99.00
  const r = computeLineFields({
    quantity: 2, grossExclusive: 95.65, discountExclusive: 9.57,
    taxRate: 0.15, sourceTotalInclusive: 99.0,
  }, ENGINE_DEFAULTS);
  near('نسبة الخصم ≈ 10%', r.discountPct, 10.0052, 0.001);
  eq('قيمة الخصم فارغة', r.discountVal, null);
  near('الإجمالي', r.expectedTotal, 99.0);
}

console.log('— حساب البند: النسبة محايدة تجاه الأساس —');
{
  const line = { quantity: 4, grossExclusive: 400, discountExclusive: 40, taxRate: 0.15, sourceTotalInclusive: 414 };
  const inc = computeLineFields(line, { ...ENGINE_DEFAULTS, priceMode: 'inclusive' });
  const exc = computeLineFields(line, { ...ENGINE_DEFAULTS, priceMode: 'exclusive' });
  eq('نفس النسبة في الوضعين', inc.discountPct, exc.discountPct);
  near('نفس الإجمالي في الوضعين', inc.expectedTotal, exc.expectedTotal);
  near('مطابق للمصدر', inc.expectedTotal, 414);
}

console.log('— حساب البند: خصم 100% —');
{
  const r = computeLineFields({
    quantity: 1, grossExclusive: 40, discountExclusive: 40,
    taxRate: 0.15, sourceTotalInclusive: 0,
  }, ENGINE_DEFAULTS);
  eq('نسبة 100', r.discountPct, 100);
  near('الإجمالي صفر', r.expectedTotal, 0);
}

console.log('— حساب البند: كمية صفر ترفض —');
{
  let threw = false;
  try {
    computeLineFields({ quantity: 0, grossExclusive: 10, discountExclusive: 0, taxRate: 0.15, sourceTotalInclusive: 11.5 }, ENGINE_DEFAULTS);
  } catch { threw = true; }
  eq('رمي استثناء', threw, true);
}

console.log('— مطابقة الضريبة —');
{
  const labels = ['الضريبة الصفرية - 0.0%', 'معفاة من الضريبة - 0.0%', 'ضريبة القيمة المضافة - 15.0%'];
  eq('15% تام', matchTaxByRate(0.15, labels).value, 'ضريبة القيمة المضافة - 15.0%');
  eq('15.1% ضمن التفاوت', matchTaxByRate(0.1501, labels).value, 'ضريبة القيمة المضافة - 15.0%');
  eq('null يعطي empty', matchTaxByRate(null, labels).status, 'empty');
  eq('نسبة غير موجودة', matchTaxByRate(0.05, labels).status, 'unmatched');
}

console.log('— مطابقة القوائم —');
{
  const allowed = ['نقدي', 'بالأجل', 'دفعة لحساب البنك', 'بطاقة بنك', 'غير محدد'];
  eq('مطابقة تامة', matchListValue('نقدي', allowed).value, 'نقدي');
  eq('قيمة غريبة', matchListValue('Mada (Salla)', allowed).status, 'unmatched');
  eq('قرار يدوي', matchListValue('Mada (Salla)', allowed, { 'Mada (Salla)': 'بطاقة بنك' }).value, 'بطاقة بنك');
  eq('قرار يدوي خارج القائمة', matchListValue('X', allowed, { X: 'شيك' }).status, 'invalid');
  eq('فارغ مع افتراضي', matchListValue('', allowed, {}, 'غير محدد').value, 'غير محدد');
}

console.log('— فحص الكميات —');
{
  const idx = buildProductIndex([
    { code: 'A1', name: 'منتج أ', stock: 5, tracked: true },
    { code: 'B2', name: 'منتج ب', stock: 100, tracked: true },
    { code: 'S1', name: 'خدمة', stock: null, tracked: false },
  ]);
  const res = checkStock([
    { code: 'A1', quantity: 3, invoiceRef: 'INV1', sourceRow: 2 },
    { code: 'A1', quantity: 4, invoiceRef: 'INV2', sourceRow: 3 },
    { code: 'B2', quantity: 10, invoiceRef: 'INV1', sourceRow: 4 },
    { code: 'S1', quantity: 1, invoiceRef: 'INV1', sourceRow: 5 },
    { code: 'ZZ', quantity: 1, invoiceRef: 'INV3', sourceRow: 6 },
  ], idx);
  const byCode = Object.fromEntries(res.map(r => [r.code, r]));
  eq('نقص متراكم عبر فاتورتين', byCode.A1.status, 'insufficient');
  eq('مقدار النقص', byCode.A1.shortage, 2);
  eq('عدد الفواتير المتأثرة', byCode.A1.invoiceCount, 2);
  eq('كمية كافية', byCode.B2.status, 'ok');
  eq('خدمة غير مخزَّنة', byCode.S1.status, 'not_tracked');
  eq('منتج غير موجود', byCode.ZZ.status, 'unknown_product');
}

console.log(`\nالنتيجة: ${pass} ناجح · ${fail} فاشل`);
process.exit(fail ? 1 : 0);
