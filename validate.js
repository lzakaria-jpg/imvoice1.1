/**
 * طبقات التحقق — تُطبَّق على صفوف القالب النهائية قبل التصدير.
 *
 * التصنيف:
 *   fatal → يمنع التصدير، لأن قيود سيرفض الصف أو سينشئ فاتورة خاطئة.
 *   warn  → لا يمنع التصدير، لكنه يحتاج قرار المستخدم.
 */

import { COLUMNS, MAX_DATA_ROWS, YES, NO } from './constants.js';
import { toStr, toNum, round, dateKey } from './num.js';

/**
 * الطبقة 0 — سلامة القالب المرفوع.
 * تكشف «النموذج القديم» الذي يوقف الاستيراد في قيود.
 */
export function validateTemplate(template) {
  const issues = [];

  if (!template || !template.headers) {
    issues.push({ severity: 'fatal', code: 'TEMPLATE_UNREADABLE', message: 'تعذّر قراءة قالب قيود' });
    return issues;
  }

  COLUMNS.forEach((spec, i) => {
    const actual = toStr(template.headers[i]);
    if (actual !== spec.header) {
      issues.push({
        severity: 'fatal', code: 'TEMPLATE_HEADER_MISMATCH',
        message: `العمود ${spec.col}: متوقع «${spec.header}» والموجود «${actual || 'فارغ'}» — القالب غير مطابق للنسخة الرسمية`,
      });
    }
  });

  if (template.headers.length !== COLUMNS.length) {
    issues.push({
      severity: 'fatal', code: 'TEMPLATE_COLUMN_COUNT',
      message: `عدد الأعمدة ${template.headers.length} بدل ${COLUMNS.length}`,
    });
  }

  for (const [name, values] of Object.entries(template.lists || {})) {
    if (!values || values.length === 0) {
      issues.push({
        severity: 'fatal', code: 'TEMPLATE_EMPTY_LIST',
        message: `قائمة «${name}» فارغة في ورقة do_not_edit — نزّل القالب من حساب العميل`,
      });
    }
  }

  return issues;
}

/** الطبقة 1 — التحقق على مستوى الصف الواحد */
export function validateRow(row, ctx) {
  const issues = [];
  const { lists, opts } = ctx;
  const at = { severity: 'fatal', scope: 'row', sourceRow: row._meta?.sourceRow, invoiceRef: row.invoiceRef };

  const req = (key, label) => {
    const v = row[key];
    const empty = v === null || v === undefined || toStr(v) === '';
    if (empty) issues.push({ ...at, code: 'REQUIRED_EMPTY', field: key, message: `${label} مطلوب وفارغ` });
    return !empty;
  };

  // الحقول على مستوى الفاتورة — تُفحص فقط حيث يُفترض أن تُكتب
  if (row._meta?.carriesInvoiceScope !== false) {
    req('invoiceRef', 'مرجع الفاتورة / التسلسل');
    req('customerRef', 'الرقم المرجعي للعميل');
    req('issueDate', 'تاريخ الإصدار');
    req('dueDate', 'تاريخ الاستحقاق');
    req('location', 'الموقع');

    if (opts.phase2Einvoicing) {
      req('paymentMethod', 'طريقة الدفع (إلزامية في المرحلة الثانية من الفوترة الإلكترونية)');
    }

    for (const key of ['invoiceRef', 'customerRef']) {
      const v = toStr(row[key]);
      if (v.length > 191) {
        issues.push({ ...at, code: 'TOO_LONG', field: key, message: `${key} يتجاوز 191 حرفاً (${v.length})` });
      }
    }

    const d = row.issueDate ? dateKey(row.issueDate) : null;
    const e = row.dueDate ? dateKey(row.dueDate) : null;
    if (d && e && e < d) {
      issues.push({ ...at, code: 'DUE_BEFORE_ISSUE', message: 'تاريخ الاستحقاق قبل تاريخ الإصدار' });
    }

    for (const [key, list, label] of [
      ['location', 'locations', 'الموقع'],
      ['paymentMethod', 'paymentMethods', 'طريقة الدفع'],
    ]) {
      const v = toStr(row[key]);
      if (v && !(lists[list] || []).includes(v)) {
        issues.push({ ...at, code: 'NOT_IN_LIST', field: key, message: `${label} «${v}» غير موجود في القائمة المعتمدة بالقالب` });
      }
    }
  }

  // الحقول على مستوى البند
  const code = toStr(row.productCode);
  const desc = toStr(row.productDesc);
  if (!code && !desc) {
    issues.push({ ...at, code: 'NO_PRODUCT', message: 'رمز المنتج ووصف المنتج فارغان معاً — يجب توفر أحدهما' });
  }

  const qty = toNum(row.quantity);
  if (qty === null) issues.push({ ...at, code: 'REQUIRED_EMPTY', field: 'quantity', message: 'الكمية مطلوبة' });
  else if (qty <= 0) issues.push({ ...at, code: 'QTY_NOT_POSITIVE', message: `الكمية يجب أن تكون أكبر من صفر (${qty})` });

  const price = toNum(row.unitPrice);
  if (price === null) issues.push({ ...at, code: 'REQUIRED_EMPTY', field: 'unitPrice', message: 'سعر الوحدة مطلوب' });
  else if (price < 0) issues.push({ ...at, code: 'PRICE_NEGATIVE', message: `سعر الوحدة سالب (${price})` });

  const inc = toStr(row.taxInclusive);
  if (!inc) issues.push({ ...at, code: 'REQUIRED_EMPTY', field: 'taxInclusive', message: '«شامل الضريبة؟» مطلوب' });
  else if (inc !== YES && inc !== NO) {
    issues.push({ ...at, code: 'NOT_IN_LIST', field: 'taxInclusive', message: `«شامل الضريبة؟» يجب أن تكون ${YES} أو ${NO}` });
  }

  const tax = toStr(row.taxRate);
  if (!tax) issues.push({ ...at, code: 'REQUIRED_EMPTY', field: 'taxRate', message: 'الضريبة مطلوبة' });
  else if (!(lists.taxes || []).includes(tax)) {
    issues.push({ ...at, code: 'NOT_IN_LIST', field: 'taxRate', message: `الضريبة «${tax}» غير موجودة في القائمة المعتمدة بالقالب` });
  }

  const pct = toNum(row.discountPct);
  const val = toNum(row.discountVal);

  // قاعدة قيود الصريحة: لا يُقبل الخصم بالنسبة والقيمة معاً في نفس البند
  if (pct !== null && pct !== 0 && val !== null && val !== 0) {
    issues.push({ ...at, code: 'DOUBLE_DISCOUNT', message: 'لا يُقبل إدخال الخصم بالنسبة والقيمة معاً في نفس البند' });
  }
  if (pct !== null && (pct < 0 || pct > 100)) {
    issues.push({ ...at, code: 'DISCOUNT_PCT_RANGE', message: `نسبة الخصم يجب أن تكون بين 0 و 100 (${pct})` });
  }
  if (val !== null && val < 0) {
    issues.push({ ...at, code: 'DISCOUNT_VAL_NEGATIVE', message: `قيمة الخصم سالبة (${val})` });
  }

  return issues;
}

/** الطبقة 2 — التحقق على مستوى الفاتورة */
export function validateInvoiceGroups(rows, opts) {
  const issues = [];
  const groups = new Map();

  rows.forEach((r, i) => {
    const ref = toStr(r.invoiceRef) || `__row${i}`;
    if (!groups.has(ref)) groups.set(ref, []);
    groups.get(ref).push(r);
  });

  const scopeKeys = ['customerRef', 'location', 'paymentMethod', 'description', 'terms', 'notes'];

  for (const [ref, grp] of groups) {
    if (!opts.repeatInvoiceData) continue;

    const first = grp[0];
    for (const r of grp.slice(1)) {
      for (const k of scopeKeys) {
        if (toStr(r[k]) !== toStr(first[k])) {
          issues.push({
            severity: 'fatal', scope: 'invoice', invoiceRef: ref, sourceRow: r._meta?.sourceRow,
            code: 'INVOICE_SCOPE_INCONSISTENT',
            message: `الحقل «${k}» يختلف بين صفوف الفاتورة ${ref} — بيانات الفاتورة يجب أن تتطابق في كل صف`,
          });
        }
      }
      for (const k of ['issueDate', 'dueDate', 'supplyDate']) {
        if (dateKey(r[k]) !== dateKey(first[k])) {
          issues.push({
            severity: 'fatal', scope: 'invoice', invoiceRef: ref, sourceRow: r._meta?.sourceRow,
            code: 'INVOICE_DATE_INCONSISTENT',
            message: `التاريخ «${k}» يختلف بين صفوف الفاتورة ${ref}`,
          });
        }
      }
    }
  }

  return issues;
}

/** الطبقة 3 — حدود الملف */
export function validateFileLimits(rows) {
  const issues = [];
  if (rows.length === 0) {
    issues.push({ severity: 'fatal', code: 'EMPTY_FILE', message: 'لا توجد صفوف للتصدير — قيود يرفض الملف الفارغ' });
  }
  if (rows.length > MAX_DATA_ROWS) {
    issues.push({
      severity: 'fatal', code: 'TOO_MANY_ROWS',
      message: `عدد الصفوف ${rows.length} يتجاوز الحد ${MAX_DATA_ROWS} — قسّم الملف على دفعات`,
    });
  }
  return issues;
}

/** الطبقة 4 — انحراف المطابقة الحسابية */
export function validateReconciliation(reconciliation, tolerance = 0.011) {
  return reconciliation
    .filter(t => Math.abs(t.drift) > tolerance)
    .map(t => ({
      severity: 'warn', scope: 'invoice', invoiceRef: t.invoiceRef,
      code: 'TOTAL_DRIFT',
      message: `إجمالي قيود المحسوب ${t.expectedTotal} مقابل إجمالي المصدر ${t.sourceTotal} — فرق ${t.drift}`,
    }));
}

/** تشغيل كل الطبقات */
export function validateAll({ rows, template, reconciliation, opts }) {
  const lists = template?.lists || {};
  const issues = [];

  issues.push(...validateTemplate(template));
  issues.push(...validateFileLimits(rows));
  for (const r of rows) issues.push(...validateRow(r, { lists, opts }));
  issues.push(...validateInvoiceGroups(rows, opts));
  issues.push(...validateReconciliation(reconciliation || []));

  const fatal = issues.filter(i => i.severity === 'fatal');
  const warn = issues.filter(i => i.severity === 'warn');

  return { issues, fatal, warn, canExport: fatal.length === 0 };
}
