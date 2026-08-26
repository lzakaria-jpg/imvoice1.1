/**
 * أدوات رقمية — كل عمليات التقريب في المشروع تمر من هنا.
 * السبب: Math.round(1.005 * 100) / 100 = 1 وليس 1.01 بسبب تمثيل الفاصلة العائمة.
 */

const EPS = 1e-9;

/** تقريب نصف-بعيد-عن-الصفر مع تعويض خطأ التمثيل الثنائي */
export function round(value, decimals = 2) {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  const f = Math.pow(10, decimals);
  const scaled = value * f;
  const sign = scaled < 0 ? -1 : 1;
  return (sign * Math.round(Math.abs(scaled) + EPS)) / f;
}

/** مقارنة نقدية: هل الرقمان متساويان ضمن تفاوت مسموح */
export function moneyEq(a, b, tolerance = 0.011) {
  return Math.abs((a ?? 0) - (b ?? 0)) <= tolerance;
}

/** تحويل أي مدخل إلى رقم، مع إرجاع null للفارغ بدل 0 — الفرق جوهري في التحقق */
export function toNum(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = String(v).trim();
  if (s === '') return null;
  // إزالة فواصل الآلاف والمسافات غير القابلة للكسر والأرقام العربية
  const normalized = s
    .replace(/[\u0660-\u0669]/g, d => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06F0-\u06F9]/g, d => String(d.charCodeAt(0) - 0x06F0))
    .replace(/[,\u00A0\s]/g, '')
    .replace(/[٫]/g, '.');
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

/** نص منظَّف — يوحّد المسافات ويزيل المحارف الخفية */
export function toStr(v) {
  if (v === null || v === undefined) return '';
  return String(v)
    .replace(/[\u200B-\u200F\u202A-\u202E\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** تطبيع نص للمطابقة: إزالة التشكيل، توحيد الألف والياء والتاء المربوطة */
export function normalizeAr(v) {
  return toStr(v)
    .replace(/[\u064B-\u0652\u0670]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/[ـ]/g, '')
    .toLowerCase();
}

/** تطبيع رمز منتج: SKU/باركود — حساس للأرقام، غير حساس لحالة الأحرف والمسافات */
export function normalizeCode(v) {
  return toStr(v).replace(/\s+/g, '').toUpperCase();
}

const MONTHS = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

/**
 * تحليل تاريخ من صيغ متعددة إلى {y,m,d}.
 * يتعامل مع: Date، رقم تسلسلي إكسل، "August 19, 2026 07:45 PM"، DD/MM/YYYY، YYYY-MM-DD.
 * يُرجع null عند الفشل — لا يخمّن أبداً.
 */
export function parseDate(v) {
  if (v === null || v === undefined || v === '') return null;

  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return { y: v.getUTCFullYear(), m: v.getUTCMonth() + 1, d: v.getUTCDate() };
  }

  if (typeof v === 'number' && Number.isFinite(v)) {
    // رقم إكسل التسلسلي — المرجع 1899-12-30 (مع مراعاة خلل 1900 المعروف)
    const ms = Math.round(v * 86400000);
    const dt = new Date(Date.UTC(1899, 11, 30) + ms);
    if (Number.isNaN(dt.getTime())) return null;
    return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
  }

  const s = toStr(v);
  if (!s) return null;

  // DD/MM/YYYY أو DD-MM-YYYY
  let m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})/);
  if (m) return validate(+m[3], +m[2], +m[1]);

  // YYYY-MM-DD
  m = s.match(/^(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})/);
  if (m) return validate(+m[1], +m[2], +m[3]);

  // "August 19, 2026 07:45 PM"
  m = s.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})/);
  if (m) {
    const mo = MONTHS[m[1].toLowerCase()];
    if (mo) return validate(+m[3], mo, +m[2]);
  }

  // "19 August 2026"
  m = s.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/);
  if (m) {
    const mo = MONTHS[m[2].toLowerCase()];
    if (mo) return validate(+m[3], mo, +m[1]);
  }

  return null;
}

function validate(y, m, d) {
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1900 || y > 2200) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() + 1 !== m || dt.getUTCDate() !== d) return null;
  return { y, m, d };
}

/** {y,m,d} → "DD/MM/YYYY" */
export function formatDate(p) {
  if (!p) return '';
  return `${String(p.d).padStart(2, '0')}/${String(p.m).padStart(2, '0')}/${p.y}`;
}

/** {y,m,d} → عدد صحيح قابل للمقارنة */
export function dateKey(p) {
  return p ? p.y * 10000 + p.m * 100 + p.d : null;
}
