/**
 * تفكيك ملف مصدر نقاط البيع/سلة إلى فواتير مهيكلة.
 *
 * البنية المتوقعة: كل فاتورة = صف رأس (Sale) + صفوف بنود (Sale Line) + صفوف دفع (Payment)،
 * مربوطة بعمود رقم الفاتورة. المرتجعات تُفصل ولا تُستورد كفواتير مبيعات.
 */

import { toNum, toStr, round, parseDate, dateKey } from './num.js';

/** أسماء الأعمدة المعروفة في تصدير نقاط البيع — تُستخدم للكشف التلقائي فقط */
export const SOURCE_FIELD_ALIASES = {
  date:          ['date', 'التاريخ', 'invoice date'],
  invoiceNumber: ['invoice number', 'invoice no', 'رقم الفاتورة', 'order number'],
  lineType:      ['line type', 'نوع السطر', 'type'],
  sellType:      ['sell type', 'نوع البيع', 'transaction type'],
  customerName:  ['customer name', 'customer', 'اسم العميل', 'العميل'],
  location:      ['location', 'branch', 'الموقع', 'الفرع'],
  channel:       ['channel name', 'channel', 'القناة'],
  details:       ['details', 'description', 'product', 'الوصف', 'المنتج'],
  quantity:      ['quantity', 'qty', 'الكمية'],
  subtotalEx:    ['subtotal (tax exclusive)', 'subtotal', 'المجموع قبل الضريبة'],
  discount:      ['discount', 'الخصم'],
  vat:           ['vat', 'ضريبة القيمة المضافة'],
  otherTaxes:    ['other taxes', 'ضرائب أخرى'],
  totalTax:      ['total tax', 'إجمالي الضريبة'],
  totalInc:      ['total (tax inclusive)', 'total', 'الإجمالي شامل الضريبة'],
  paidAmount:    ['paid amount', 'المبلغ المدفوع'],
  paymentMethod: ['payment method', 'طريقة الدفع', 'وسيلة الدفع'],
  sku:           ['sku', 'barcode', 'الباركود', 'رمز المنتج'],
};

/** قيم عمود نوع السطر */
const LINE_TYPE = { HEADER: 'sale', LINE: 'sale line', PAYMENT: 'payment' };
const RETURN_MARKERS = ['return', 'refund', 'مرتجع', 'ارتجاع'];

/**
 * يكتشف تعيين الأعمدة تلقائياً من رؤوس الملف.
 * يُرجع تعييناً مبدئياً يستطيع المستخدم تعديله في شاشة الربط.
 */
export function detectMapping(headers) {
  const norm = headers.map(h => toStr(h).toLowerCase());
  const mapping = {};
  for (const [field, aliases] of Object.entries(SOURCE_FIELD_ALIASES)) {
    const i = norm.findIndex(h => aliases.includes(h));
    if (i >= 0) { mapping[field] = headers[i]; continue; }
    const j = norm.findIndex(h => h && aliases.some(a => h.includes(a) || a.includes(h)));
    if (j >= 0) mapping[field] = headers[j];
  }
  return mapping;
}

function isReturn(v) {
  const s = toStr(v).toLowerCase();
  return RETURN_MARKERS.some(m => s.includes(m));
}

/**
 * @param {object[]} records صفوف الملف ككائنات مفاتيحها رؤوس الأعمدة
 * @param {object} mapping تعيين الحقول → أسماء الأعمدة
 * @param {object} opts
 * @returns {{sales:object[], returns:object[], stats:object, issues:object[]}}
 */
export function parseSource(records, mapping, opts = {}) {
  const get = (rec, field) => (mapping[field] ? rec[mapping[field]] : undefined);
  const issues = [];
  const groups = new Map();

  records.forEach((rec, i) => {
    const sourceRow = i + 2; // صف 1 رؤوس
    const invNo = toStr(get(rec, 'invoiceNumber'));
    if (!invNo) {
      issues.push({
        severity: 'fatal', scope: 'row', sourceRow,
        code: 'NO_INVOICE_NUMBER',
        message: 'صف بلا رقم فاتورة — لا يمكن ربطه بأي فاتورة',
      });
      return;
    }

    if (!groups.has(invNo)) {
      groups.set(invNo, { invoiceNumber: invNo, header: null, lines: [], payments: [], rows: [] });
    }
    const g = groups.get(invNo);
    g.rows.push(sourceRow);

    const lt = toStr(get(rec, 'lineType')).toLowerCase();

    if (lt === LINE_TYPE.HEADER) {
      if (g.header) {
        issues.push({
          severity: 'fatal', scope: 'invoice', invoiceRef: invNo, sourceRow,
          code: 'DUPLICATE_HEADER',
          message: `رقم الفاتورة ${invNo} له أكثر من صف رأس — تعارض في المصدر`,
        });
        return;
      }
      g.header = {
        sourceRow,
        date: parseDate(get(rec, 'date')),
        rawDate: toStr(get(rec, 'date')),
        customerName: toStr(get(rec, 'customerName')),
        location: toStr(get(rec, 'location')),
        channel: toStr(get(rec, 'channel')),
        isReturn: isReturn(get(rec, 'sellType')),
        totalInc: toNum(get(rec, 'totalInc')),
        subtotalEx: toNum(get(rec, 'subtotalEx')),
        totalTax: toNum(get(rec, 'totalTax')),
      };
    } else if (lt === LINE_TYPE.LINE) {
      const qty = toNum(get(rec, 'quantity'));
      const subtotalEx = toNum(get(rec, 'subtotalEx'));
      const discount = toNum(get(rec, 'discount')) || 0;
      // الضريبة الفعلية = إجمالي الضريبة، لأن VAT و Other taxes خانتان لنفس المبلغ
      const totalTax = toNum(get(rec, 'totalTax')) || 0;
      const totalInc = toNum(get(rec, 'totalInc'));

      g.lines.push({
        sourceRow,
        sku: toStr(get(rec, 'sku')),
        details: toStr(get(rec, 'details')),
        quantity: qty,
        subtotalEx,
        discount,
        totalTax,
        totalInc,
        isReturn: isReturn(get(rec, 'sellType')),
        location: toStr(get(rec, 'location')),
      });
    } else if (lt === LINE_TYPE.PAYMENT) {
      g.payments.push({
        sourceRow,
        method: toStr(get(rec, 'paymentMethod')),
        amount: toNum(get(rec, 'paidAmount')),
      });
    } else {
      issues.push({
        severity: 'warn', scope: 'row', sourceRow, invoiceRef: invNo,
        code: 'UNKNOWN_LINE_TYPE',
        message: `نوع سطر غير معروف: «${lt || 'فارغ'}» — تم تجاهل الصف`,
      });
    }
  });

  const sales = [];
  const returns = [];

  for (const g of groups.values()) {
    const built = buildInvoice(g, issues);
    if (!built) continue;
    (built.isReturn ? returns : sales).push(built);
  }

  // ترتيب زمني تصاعدي — أنسب للاستيراد المتسلسل
  const byDate = (a, b) => (dateKey(a.issueDateParts) ?? 0) - (dateKey(b.issueDateParts) ?? 0);
  sales.sort(byDate);
  returns.sort(byDate);

  return {
    sales,
    returns,
    issues,
    stats: {
      totalRows: records.length,
      invoices: groups.size,
      salesInvoices: sales.length,
      returnInvoices: returns.length,
      salesLines: sales.reduce((s, i) => s + i.lines.length, 0),
      returnLines: returns.reduce((s, i) => s + i.lines.length, 0),
    },
  };
}

function buildInvoice(g, issues) {
  const invNo = g.invoiceNumber;

  if (!g.header) {
    issues.push({
      severity: 'fatal', scope: 'invoice', invoiceRef: invNo, sourceRow: g.rows[0],
      code: 'NO_HEADER_ROW',
      message: `الفاتورة ${invNo} بلا صف رأس — لا يمكن استخراج العميل والتاريخ والموقع`,
    });
    return null;
  }
  if (g.lines.length === 0) {
    issues.push({
      severity: 'fatal', scope: 'invoice', invoiceRef: invNo, sourceRow: g.header.sourceRow,
      code: 'NO_LINES',
      message: `الفاتورة ${invNo} بلا بنود`,
    });
    return null;
  }

  const isReturn = g.header.isReturn || g.lines.every(l => l.isReturn);

  // تناسق: هل جميع البنود من نفس النوع
  const mixed = g.lines.some(l => l.isReturn) && g.lines.some(l => !l.isReturn);
  if (mixed) {
    issues.push({
      severity: 'fatal', scope: 'invoice', invoiceRef: invNo, sourceRow: g.header.sourceRow,
      code: 'MIXED_SELL_RETURN',
      message: `الفاتورة ${invNo} تخلط بنود بيع وبنود مرتجع`,
    });
  }

  const lines = g.lines.map(l => {
    const grossExclusive = l.subtotalEx ?? 0;
    const base = grossExclusive - (l.discount || 0);
    // اشتقاق نسبة الضريبة من البند نفسه بدل افتراضها
    const rate = base !== 0 ? (l.totalTax || 0) / base : null;
    return {
      sourceRow: l.sourceRow,
      sourceSku: l.sku,
      sourceName: l.details,
      quantity: l.quantity,
      grossExclusive,
      discountExclusive: l.discount || 0,
      taxAmount: l.totalTax || 0,
      taxRateRaw: rate,
      sourceTotalInclusive: l.totalInc ?? 0,
    };
  });

  const linesSum = round(lines.reduce((s, l) => s + l.sourceTotalInclusive, 0), 2);
  const headerTotal = round(g.header.totalInc ?? 0, 2);

  const headerDiff = round(headerTotal - linesSum, 2);
  if (Math.abs(headerDiff) > 0.011) {
    // فرق بحدود القروش أصله تقريب داخلي في نظام المصدر، ولا يدل على خلل بيانات.
    // الفرق الأكبر يعني أن رأس الفاتورة لا يمثّل بنودها — بيانات معطوبة تُوقف الاستيراد.
    const isRounding = Math.abs(headerDiff) <= 0.05;
    issues.push({
      severity: isRounding ? 'warn' : 'fatal',
      scope: 'invoice', invoiceRef: invNo, sourceRow: g.header.sourceRow,
      code: isRounding ? 'HEADER_LINES_ROUNDING' : 'HEADER_LINES_MISMATCH',
      message: isRounding
        ? `فرق تقريب ${headerDiff} بين رأس الفاتورة ${headerTotal} ومجموع بنودها ${linesSum} — مصدره نظام العميل`
        : `إجمالي رأس الفاتورة ${headerTotal} لا يساوي مجموع بنودها ${linesSum} — فرق ${headerDiff}`,
    });
  }

  const paidSum = round(g.payments.reduce((s, p) => s + (p.amount ?? 0), 0), 2);
  const methods = [...new Set(g.payments.map(p => p.method).filter(Boolean))];

  if (g.payments.length > 1 && Math.abs(paidSum - headerTotal * g.payments.length) < 0.011) {
    issues.push({
      severity: 'warn', scope: 'invoice', invoiceRef: invNo, sourceRow: g.header.sourceRow,
      code: 'DUPLICATE_PAYMENT_ROWS',
      message: `صفوف الدفع مكررة (${g.payments.length} صفوف بنفس المبلغ) — لا يؤثر على الاستيراد`,
    });
  }

  return {
    invoiceRef: invNo,
    isReturn,
    issueDateParts: g.header.date,
    rawDate: g.header.rawDate,
    sourceCustomerName: g.header.customerName,
    sourceLocation: g.header.location,
    channel: g.header.channel,
    sourcePaymentMethods: methods,
    paidAmount: paidSum,
    sourceTotalInclusive: headerTotal,
    lines,
    headerRow: g.header.sourceRow,
    rows: g.rows,
  };
}
