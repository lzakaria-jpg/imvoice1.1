/**
 * خط المعالجة — يجمع التفكيك والمطابقة والتحويل في مسار واحد.
 *
 * يفصل بين «ما نعرفه» و«ما نحتاج قرار المستخدم فيه»: كل قيمة تعذّرت مطابقتها
 * تُعاد في قائمة قرارات معلّقة بدل أن تُخمَّن أو تُسقط بصمت.
 */

import { buildCustomerIndex, buildProductIndex, matchCustomer, matchProduct, matchListValue, resolveInvoiceTaxes, checkStock } from './resolve.js';
import { transformAll } from './transform.js';
import { validateAll } from './validate.js';
import { ENGINE_DEFAULTS } from './constants.js';
import { toStr, round } from './num.js';

/**
 * يجمع كل القيم التي تحتاج قراراً من المستخدم.
 * تُستدعى قبل التحويل لعرض شاشات المطابقة.
 */
export function collectDecisions({ sales, references, decisions, template }) {
  const customerIndex = buildCustomerIndex(references.customers || []);
  const productIndex = buildProductIndex(references.products || []);
  const lists = template?.lists || {};

  const customers = new Map();
  const products = new Map();
  const payments = new Map();
  const locations = new Map();

  for (const inv of sales) {
    // العملاء
    const name = toStr(inv.sourceCustomerName);
    const cm = matchCustomer(name, customerIndex, decisions.customers || {});
    if (cm.status !== 'matched') {
      const key = name;
      if (!customers.has(key)) {
        customers.set(key, {
          key, label: name || '(بلا اسم عميل)', status: cm.status,
          reason: cm.reason || (cm.status === 'empty' ? 'الفاتورة بلا عميل في المصدر' : 'الاسم غير موجود في ملف عملاء قيود'),
          invoices: [], count: 0,
        });
      }
      const e = customers.get(key);
      e.count++;
      if (e.invoices.length < 20) e.invoices.push(inv.invoiceRef);
    }

    // الموقع
    const loc = toStr(inv.sourceLocation);
    const lm = matchListValue(loc, lists.locations || [], decisions.locations || {}, decisions.defaultLocation);
    if (lm.status !== 'matched') {
      const key = loc;
      if (!locations.has(key)) {
        locations.set(key, {
          key, label: loc || '(بلا موقع)', status: lm.status,
          reason: lm.status === 'empty' ? 'الفاتورة بلا موقع في المصدر' : 'القيمة غير موجودة في قائمة مواقع القالب',
          invoices: [], count: 0,
        });
      }
      const e = locations.get(key);
      e.count++;
      if (e.invoices.length < 20) e.invoices.push(inv.invoiceRef);
    }

    // طريقة الدفع
    const pm = toStr(inv.sourcePaymentMethods[0] || '');
    const mm = matchListValue(pm, lists.paymentMethods || [], decisions.payments || {}, decisions.defaultPayment);
    if (mm.status !== 'matched' && pm) {
      const key = pm;
      if (!payments.has(key)) {
        payments.set(key, { key, label: pm, status: mm.status, reason: 'القيمة غير موجودة في قائمة طرق الدفع بالقالب', invoices: [], count: 0 });
      }
      const e = payments.get(key);
      e.count++;
      if (e.invoices.length < 20) e.invoices.push(inv.invoiceRef);
    }

    // المنتجات
    for (const l of inv.lines) {
      const m = matchProduct(l.sourceSku, l.sourceName, productIndex, decisions.products || {});
      if (m.status !== 'matched') {
        const key = toStr(l.sourceSku) || toStr(l.sourceName);
        if (!products.has(key)) {
          products.set(key, {
            key,
            label: toStr(l.sourceName) || key,
            sku: toStr(l.sourceSku),
            status: m.status, reason: m.reason || 'لا يطابق أي منتج في قيود',
            invoices: [], count: 0,
          });
        }
        const e = products.get(key);
        e.count++;
        if (e.invoices.length < 20) e.invoices.push(inv.invoiceRef);
      }
    }
  }

  const sortByCount = (a, b) => b.count - a.count;
  return {
    customers: [...customers.values()].sort(sortByCount),
    products: [...products.values()].sort(sortByCount),
    payments: [...payments.values()].sort(sortByCount),
    locations: [...locations.values()].sort(sortByCount),
    indexes: { customerIndex, productIndex },
  };
}

/**
 * ينفّذ التحويل الكامل بعد استقرار القرارات.
 * @returns {{rows, reconciliation, validation, stock, notes, unresolved}}
 */
export function runPipeline({ sales, references, decisions, template, options }) {
  const opts = { ...ENGINE_DEFAULTS, ...(options || {}) };
  const customerIndex = buildCustomerIndex(references.customers || []);
  const productIndex = buildProductIndex(references.products || []);
  const lists = template?.lists || {};
  const taxLabels = lists.taxes || [];
  const defaultTax = decisions.defaultTax || taxLabels.find(t => t.includes('15')) || taxLabels[0];

  const notes = [];
  const unresolved = [];
  const stockDemands = [];
  const invoices = [];

  for (const inv of sales) {
    const cm = matchCustomer(inv.sourceCustomerName, customerIndex, decisions.customers || {});
    const lm = matchListValue(inv.sourceLocation, lists.locations || [], decisions.locations || {}, decisions.defaultLocation);
    const pmRaw = toStr(inv.sourcePaymentMethods[0] || '');
    const mm = matchListValue(pmRaw, lists.paymentMethods || [], decisions.payments || {}, decisions.defaultPayment);

    if (cm.status !== 'matched') {
      unresolved.push({ kind: 'customer', invoiceRef: inv.invoiceRef, value: toStr(inv.sourceCustomerName) });
    }
    if (lm.status !== 'matched') {
      unresolved.push({ kind: 'location', invoiceRef: inv.invoiceRef, value: toStr(inv.sourceLocation) });
    }

    const { resolved, notes: taxNotes } = resolveInvoiceTaxes(inv, taxLabels, defaultTax);
    notes.push(...taxNotes);

    const lines = inv.lines.map((l, i) => {
      const pmatch = matchProduct(l.sourceSku, l.sourceName, productIndex, decisions.products || {});
      if (pmatch.status !== 'matched') {
        unresolved.push({ kind: 'product', invoiceRef: inv.invoiceRef, sourceRow: l.sourceRow, value: toStr(l.sourceSku) || toStr(l.sourceName) });
      }
      const code = pmatch.status === 'matched' ? pmatch.code : '';
      if (code) {
        stockDemands.push({ code, quantity: l.quantity, invoiceRef: inv.invoiceRef, sourceRow: l.sourceRow });
      }
      return {
        sourceRow: l.sourceRow,
        productCode: code,
        // وصف المنتج يُكتب فقط عند غياب الرمز — قيود يقبل أحدهما
        productDesc: code ? '' : toStr(l.sourceName),
        quantity: l.quantity,
        unitOfConv: '',
        grossExclusive: l.grossExclusive,
        discountExclusive: l.discountExclusive,
        taxRate: resolved[i].pct,
        taxLabel: resolved[i].label,
        sourceTotalInclusive: l.sourceTotalInclusive,
      };
    });

    invoices.push({
      invoiceRef: inv.invoiceRef,
      customerRef: cm.status === 'matched' ? cm.ref : '',
      issueDate: inv.issueDateParts,
      dueDate: inv.issueDateParts, // المصدر بلا تاريخ استحقاق — يساوي تاريخ الإصدار
      supplyDate: null,             // فارغ = قيود يعتمد تاريخ الإصدار
      location: lm.status === 'matched' ? lm.value : '',
      paymentMethod: mm.status === 'matched' ? mm.value : '',
      description: '',
      terms: decisions.terms || '',
      notes: decisions.notes || '',
      sourceTotalInclusive: inv.sourceTotalInclusive,
      channel: inv.channel,
      lines,
    });
  }

  const out = transformAll(invoices, opts);
  const stock = opts.enforceStock ? checkStock(stockDemands, productIndex) : [];

  const validation = validateAll({
    rows: out.rows, template, reconciliation: out.reconciliation, opts,
  });

  // نقص الكميات يمنع قيود من إنشاء الفاتورة، فيُعامَل كخطأ فادح
  const stockIssues = stock
    .filter(s => s.status === 'insufficient')
    .map(s => ({
      severity: 'fatal', scope: 'stock', code: 'INSUFFICIENT_STOCK',
      message: `المنتج ${s.code} (${s.name}) مطلوب ${s.required} والمتاح ${s.available} — نقص ${s.shortage} يؤثر على ${s.invoiceCount} فاتورة`,
    }));

  const allFatal = [...validation.fatal, ...stockIssues];

  return {
    rows: out.rows,
    reconciliation: out.reconciliation,
    summary: out.summary,
    stock,
    notes,
    unresolved,
    validation: {
      ...validation,
      issues: [...validation.issues, ...stockIssues],
      fatal: allFatal,
      canExport: allFatal.length === 0,
    },
  };
}
