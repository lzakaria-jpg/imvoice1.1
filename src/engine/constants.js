/**
 * مواصفات قالب استيراد فواتير المبيعات — قيود
 * مستخرجة حرفياً من الملف الرسمي: invoice_import_template.xlsx
 * لا تُعدّل بالتخمين. أي تغيير هنا يجب أن يكون مأخوذاً من قالب رسمي جديد.
 */

export const TEMPLATE_SHEET = 'Invoice Upload Template';
export const LOOKUP_SHEET = 'do_not_edit';

export const HEADER_ROW = 2;
export const FIRST_DATA_ROW = 3;
export const MAX_DATA_ROWS = 5000; // 5002 - 2

/** رؤوس صف 2 حرفياً بالترتيب A..S — تُطابق نصياً للكشف عن نموذج قديم */
export const COLUMNS = [
  { key: 'invoiceRef',   col: 'A', header: 'مرجع الفاتورة / التسلسل *',      scope: 'invoice', required: true,  maxLen: 191 },
  { key: 'description',  col: 'B', header: 'الوصف',                          scope: 'invoice', required: false },
  { key: 'customerRef',  col: 'C', header: 'الرقم المرجعي للعميل *',         scope: 'invoice', required: true,  maxLen: 191 },
  { key: 'issueDate',    col: 'D', header: 'تاريخ الإصدار * (DD/MM/YYYY)',   scope: 'invoice', required: true,  type: 'date' },
  { key: 'dueDate',      col: 'E', header: 'تاريخ الاستحقاق (DD/MM/YYYY)',   scope: 'invoice', required: true,  type: 'date' },
  { key: 'supplyDate',   col: 'F', header: 'تاريخ التوريد (DD/MM/YYYY)',     scope: 'invoice', required: false, type: 'date' },
  { key: 'location',     col: 'G', header: 'الموقع *',                       scope: 'invoice', required: true,  list: 'locations' },
  { key: 'paymentMethod',col: 'H', header: 'طريقة الدفع',                    scope: 'invoice', required: false, list: 'paymentMethods' },
  { key: 'terms',        col: 'I', header: 'الشروط والأحكام',                scope: 'invoice', required: false },
  { key: 'notes',        col: 'J', header: 'الملاحظات',                      scope: 'invoice', required: false },
  { key: 'productCode',  col: 'K', header: 'الرقم التسلسلي/الباركود للمنتج *',scope: 'line',   required: 'conditional' },
  { key: 'productDesc',  col: 'L', header: 'وصف المنتج',                     scope: 'line',    required: 'conditional' },
  { key: 'quantity',     col: 'M', header: 'الكمية (بالوحدة الأساسية) *',    scope: 'line',    required: true,  type: 'number', gt: 0 },
  { key: 'unitOfConv',   col: 'N', header: 'وحدة التحويل',                   scope: 'line',    required: false },
  { key: 'unitPrice',    col: 'O', header: 'سعر الوحدة *',                   scope: 'line',    required: true,  type: 'number', gte: 0 },
  { key: 'taxInclusive', col: 'P', header: 'شامل الضريبة؟ *',                scope: 'line',    required: true,  list: 'yesNo' },
  { key: 'discountPct',  col: 'Q', header: 'نسبة الخصم',                     scope: 'line',    required: false, type: 'number', between: [0, 100] },
  { key: 'discountVal',  col: 'R', header: 'قيمة الخصم',                     scope: 'line',    required: false, type: 'number', gte: 0 },
  { key: 'taxRate',      col: 'S', header: 'الضريبة% *',                     scope: 'line',    required: true,  list: 'taxes' },
];

export const COL_INDEX = Object.fromEntries(COLUMNS.map((c, i) => [c.key, i + 1]));
export const INVOICE_SCOPE_KEYS = COLUMNS.filter(c => c.scope === 'invoice').map(c => c.key);
export const LINE_SCOPE_KEYS = COLUMNS.filter(c => c.scope === 'line').map(c => c.key);

/** نطاقات ورقة do_not_edit — الترتيب ثابت في القالب الرسمي */
export const LOOKUP_RANGES = {
  locations:      { from: 1, to: 1 },  // A1
  taxes:          { from: 2, to: 4 },  // A2:A4
  yesNo:          { from: 5, to: 6 },  // A5:A6
  paymentMethods: { from: 7, to: 11 }, // A7:A11
};

export const YES = 'نعم';
export const NO = 'لا';

/** ألوان وتنسيقات القالب الرسمي — مستخرجة من الملف، لا تُغيَّر */
export const STYLE = {
  fontName: 'Arial',
  headerFontSize: 12,
  dataFontSize: 11,
  groupInvoiceFill: 'FF122664', // A1:J1
  groupLineFill:    'FF00DAF9', // K1:S1
  headerFill:       'FF004586', // A2:S2
  headerFontColor:  'FFFFFFFF',
  dateFormat: 'dd/mm/yyyy',
  columnWidths: {
    A: 50.4, B: 25, C: 45, D: 55.8, E: 55.8, F: 52.2, G: 19.8, H: 25.2, I: 32.4,
    J: 25, K: 63, L: 25, M: 54, N: 27, O: 27, P: 32.4, Q: 23.4, R: 23.4, S: 23.4,
  },
  groupHeaders: { invoice: 'معلومات الفاتورة', line: 'معلومات بنود الفاتورة' },
};

/**
 * قرارات التحويل المعتمدة — موثّقة بأسبابها.
 * أي تغيير هنا يغيّر أرقام المخرج، لذلك كل خيار مبرَّر.
 */
export const ENGINE_DEFAULTS = {
  /**
   * تكرار بيانات الفاتورة في كل صف.
   * المصدر: توثيق قيود يذكر التكرار صراحةً، ويدرج عدمه ضمن أسباب فشل الصفوف.
   * (نص الـ Data Validation داخل القالب يقول العكس — يُعتبر بقايا نسخة أقدم.)
   */
  repeatInvoiceData: true,

  /**
   * التسعير شامل الضريبة.
   * السبب: مصدر البيانات نقاط بيع مسعّرة شاملاً — 1079 بند من 1159 يعطي سعر وحدة
   * نظيف بالأساس الشامل مقابل 1012 بالأساس غير الشامل.
   */
  priceMode: 'inclusive',

  /**
   * عدد الخانات العشرية لسعر الوحدة.
   * 4 خانات: انحراف إجمالي 0.61 ر.س على 219 فاتورة.
   * 2 خانة:  انحراف إجمالي 1.26 ر.س. يُستخدم إن رفض المحرك الدقة الأعلى.
   */
  unitPriceDecimals: 4,

  /**
   * الخصم بالنسبة المئوية دائماً، وقيمة الخصم تبقى فارغة.
   * السبب الحاسم: النسبة محايدة تجاه أساس الاحتساب — 10% هي 10% سواء حُسبت على
   * مبلغ شامل أو غير شامل. هذا يلغي الغموض في تفسير «قيمة الخصم» مع «شامل = نعم»،
   * وهو غموض كلفته المقاسة تصل إلى 9091 ر.س انحرافاً في هذا الملف.
   * كما يضمن عدم مخالفة قاعدة قيود: لا يُقبل الخصم بالنسبة والقيمة معاً.
   */
  discountMode: 'percent',
  discountPctDecimals: 4,

  /** تاريخ الاستحقاق غير موجود في مصدر نقاط البيع → يساوي تاريخ الإصدار */
  dueDateFallback: 'issueDate',

  /** الفوترة الإلكترونية المرحلة الثانية تجعل طريقة الدفع إلزامية */
  phase2Einvoicing: false,

  /** تحقق توفر الكميات مقابل قائمة المنتجات المرفوعة */
  enforceStock: true,
};

export const ROUNDING = { money: 2 };
