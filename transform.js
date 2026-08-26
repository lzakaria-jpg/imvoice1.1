/**
 * نواة التحويل — من فاتورة مصدر إلى صفوف قالب قيود.
 *
 * المنطق الحسابي بالكامل هنا، ودوالّه نقية (بلا أي أثر جانبي) ليكون قابلاً للاختبار
 * وحدةً دون واجهة ولا ملفات.
 *
 * أساس الحساب المعتمد في المصدر (تم التحقق منه رقمياً على 1159 بنداً):
 *   الوعاء الضريبي = المبلغ قبل الخصم − الخصم
 *   الضريبة        = الوعاء × النسبة
 *   الإجمالي       = الوعاء + الضريبة
 * أي أن الخصم يُطبَّق قبل الضريبة — وهو نفس مبدأ قيود.
 */

import { round, toNum } from './num.js';
import { ENGINE_DEFAULTS, YES, NO } from './constants.js';

/**
 * يحسب حقول البند الثلاثة التي تذهب إلى القالب: سعر الوحدة، شامل الضريبة؟، الخصم.
 *
 * @param {object} line      بند المصدر بعد التطبيع
 * @param {number} line.quantity          الكمية (> 0)
 * @param {number} line.grossExclusive    المبلغ قبل الخصم، غير شامل الضريبة
 * @param {number} line.discountExclusive قيمة الخصم على الأساس غير الشامل (0 إن لا يوجد)
 * @param {number} line.taxRate           نسبة الضريبة كسراً (0.15)
 * @param {object} opts
 * @returns {{unitPrice:number, taxInclusive:string, discountPct:number|null,
 *            discountVal:number|null, expectedTotal:number, sourceTotal:number, drift:number}}
 */
export function computeLineFields(line, opts = ENGINE_DEFAULTS) {
  const qty = line.quantity;
  const grossEx = line.grossExclusive;
  const discEx = line.discountExclusive || 0;
  const rate = line.taxRate;

  if (!qty || qty === 0) {
    throw new Error('الكمية صفر أو مفقودة — لا يمكن اشتقاق سعر الوحدة');
  }

  const inclusive = opts.priceMode === 'inclusive';
  const dp = opts.unitPriceDecimals;

  // المبلغ قبل الخصم على الأساس المختار
  const grossBasis = inclusive ? grossEx * (1 + rate) : grossEx;
  const unitPrice = round(grossBasis / qty, dp);

  // نسبة الخصم — محايدة تجاه أساس الاحتساب، ولذلك اعتُمدت
  let discountPct = null;
  let discountVal = null;

  if (discEx !== 0) {
    if (opts.discountMode === 'percent') {
      if (grossEx === 0) {
        // خصم على مبلغ صفر: حالة شاذة، تُبلَّغ ولا تُخمَّن
        discountPct = null;
      } else {
        discountPct = round((discEx / grossEx) * 100, opts.discountPctDecimals);
      }
    } else {
      // وضع القيمة — متاح لكنه غير مُفعَّل افتراضياً بسبب غموض الأساس
      discountVal = round(inclusive ? discEx * (1 + rate) : discEx, 2);
    }
  }

  // الإجمالي كما سيحسبه قيود من هذه المدخلات بالضبط
  const gross = unitPrice * qty;
  let net;
  if (discountPct !== null) net = gross * (1 - discountPct / 100);
  else if (discountVal !== null) net = gross - discountVal;
  else net = gross;

  const expectedTotal = round(inclusive ? net : net * (1 + rate), 2);
  const sourceTotal = round(line.sourceTotalInclusive, 2);

  return {
    unitPrice,
    taxInclusive: inclusive ? YES : NO,
    discountPct,
    discountVal,
    expectedTotal,
    sourceTotal,
    drift: round(expectedTotal - sourceTotal, 2),
  };
}

/**
 * يبني صفوف القالب لفاتورة واحدة.
 *
 * @param {object} invoice فاتورة المصدر بعد المطابقة (عميل/منتج/موقع/دفع مُحلّة)
 * @param {object} opts
 * @returns {{rows: object[], totals: object, issues: object[]}}
 */
export function buildInvoiceRows(invoice, opts = ENGINE_DEFAULTS) {
  const rows = [];
  const issues = [];
  let expectedSum = 0;

  invoice.lines.forEach((line, idx) => {
    let calc;
    try {
      calc = computeLineFields(line, opts);
    } catch (e) {
      issues.push({
        severity: 'fatal',
        scope: 'line',
        invoiceRef: invoice.invoiceRef,
        sourceRow: line.sourceRow,
        code: 'LINE_CALC_FAILED',
        message: e.message,
      });
      return;
    }

    if (calc.discountPct === null && (line.discountExclusive || 0) !== 0) {
      issues.push({
        severity: 'fatal',
        scope: 'line',
        invoiceRef: invoice.invoiceRef,
        sourceRow: line.sourceRow,
        code: 'DISCOUNT_ON_ZERO_BASE',
        message: 'يوجد خصم على مبلغ أساسه صفر — لا يمكن اشتقاق نسبة خصم صحيحة',
      });
    }

    expectedSum = round(expectedSum + calc.expectedTotal, 2);

    // الحقول على مستوى الفاتورة: تُكرَّر في كل صف أو تُكتب في الأول فقط
    const isFirst = idx === 0;
    const writeInvoiceScope = opts.repeatInvoiceData || isFirst;

    rows.push({
      invoiceRef:   writeInvoiceScope ? invoice.invoiceRef : '',
      description:  writeInvoiceScope ? (invoice.description || '') : '',
      customerRef:  writeInvoiceScope ? invoice.customerRef : '',
      issueDate:    writeInvoiceScope ? invoice.issueDate : null,
      dueDate:      writeInvoiceScope ? invoice.dueDate : null,
      supplyDate:   writeInvoiceScope ? (invoice.supplyDate || null) : null,
      location:     writeInvoiceScope ? invoice.location : '',
      paymentMethod:writeInvoiceScope ? (invoice.paymentMethod || '') : '',
      terms:        writeInvoiceScope ? (invoice.terms || '') : '',
      notes:        writeInvoiceScope ? (invoice.notes || '') : '',

      productCode:  line.productCode || '',
      productDesc:  line.productDesc || '',
      quantity:     line.quantity,
      unitOfConv:   line.unitOfConv || '',
      unitPrice:    calc.unitPrice,
      taxInclusive: calc.taxInclusive,
      discountPct:  calc.discountPct,
      discountVal:  calc.discountVal,
      taxRate:      line.taxLabel,

      _meta: {
        sourceRow: line.sourceRow,
        expectedTotal: calc.expectedTotal,
        sourceTotal: calc.sourceTotal,
        drift: calc.drift,
      },
    });
  });

  const sourceSum = round(invoice.sourceTotalInclusive, 2);

  return {
    rows,
    issues,
    totals: {
      invoiceRef: invoice.invoiceRef,
      lineCount: invoice.lines.length,
      expectedTotal: expectedSum,
      sourceTotal: sourceSum,
      drift: round(expectedSum - sourceSum, 2),
    },
  };
}

/**
 * يحوّل كل الفواتير ويعيد صفوف القالب + تقرير المطابقة الحسابية.
 */
export function transformAll(invoices, opts = ENGINE_DEFAULTS) {
  const rows = [];
  const reconciliation = [];
  const issues = [];

  for (const inv of invoices) {
    const r = buildInvoiceRows(inv, opts);
    rows.push(...r.rows);
    reconciliation.push(r.totals);
    issues.push(...r.issues);
  }

  const summary = {
    invoices: reconciliation.length,
    rows: rows.length,
    driftedInvoices: reconciliation.filter(t => Math.abs(t.drift) > 0.011).length,
    maxDrift: reconciliation.reduce((m, t) => Math.max(m, Math.abs(t.drift)), 0),
    totalAbsDrift: round(reconciliation.reduce((s, t) => s + Math.abs(t.drift), 0), 2),
    sourceGrandTotal: round(reconciliation.reduce((s, t) => s + t.sourceTotal, 0), 2),
    expectedGrandTotal: round(reconciliation.reduce((s, t) => s + t.expectedTotal, 0), 2),
  };

  return { rows, reconciliation, issues, summary };
}
