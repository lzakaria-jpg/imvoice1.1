/**
 * قراءة قالب قيود الرسمي وإعادة بنائه.
 *
 * التنسيق يُعاد إنتاجه حرفياً: الألوان، الخط، الدمج، عرض الأعمدة،
 * ورقة do_not_edit بحالة veryHidden، وكل قيود التحقق (Data Validation).
 * السبب: قيود يرفض الملف المبني على «نموذج قديم»، والالتزام بالنسخة المرفوعة
 * من حساب العميل هو الضمانة الوحيدة.
 */

import ExcelJS from 'exceljs';
import {
  TEMPLATE_SHEET, LOOKUP_SHEET, HEADER_ROW, FIRST_DATA_ROW, MAX_DATA_ROWS,
  COLUMNS, LOOKUP_RANGES, STYLE,
} from './constants.js';
import { toStr, formatDate } from './num.js';

/** يقرأ القالب الرسمي ويستخرج الرؤوس والقوائم المعتمدة */
export async function readTemplate(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);

  const ws = wb.getWorksheet(TEMPLATE_SHEET) || wb.worksheets.find(w => w.columnCount >= COLUMNS.length);
  if (!ws) throw new Error(`لم يتم العثور على ورقة «${TEMPLATE_SHEET}» في القالب`);

  const headerRow = ws.getRow(HEADER_ROW);
  const headers = [];
  for (let c = 1; c <= COLUMNS.length; c++) headers.push(toStr(headerRow.getCell(c).value));

  const lookup = wb.getWorksheet(LOOKUP_SHEET);
  const lists = {};
  const listIds = {};

  if (lookup) {
    for (const [name, range] of Object.entries(LOOKUP_RANGES)) {
      const values = [];
      const ids = {};
      for (let r = range.from; r <= range.to; r++) {
        const label = toStr(lookup.getCell(r, 1).value);
        const id = lookup.getCell(r, 2).value;
        if (label) { values.push(label); ids[label] = id; }
      }
      lists[name] = values;
      listIds[name] = ids;
    }
    // القوائم قد تمتد أبعد من النطاق الافتراضي إذا كان للعميل مواقع متعددة
    lists.locations = readOpenRange(lookup, 1, LOOKUP_RANGES.taxes.from);
  }

  return { workbookBuffer: buffer, sheetName: ws.name, headers, lists, listIds };
}

/**
 * القوائم في do_not_edit متجاورة، وعدد المواقع يختلف بين الحسابات.
 * تُقرأ المواقع من الصف الأول حتى أول صف تبدأ عنده قائمة الضرائب.
 */
function readOpenRange(sheet, startRow, stopBefore) {
  const out = [];
  for (let r = startRow; r < stopBefore; r++) {
    const v = toStr(sheet.getCell(r, 1).value);
    if (!v) break;
    out.push(v);
  }
  return out;
}

/**
 * يبني ملف القالب النهائي جاهزاً للرفع إلى قيود.
 *
 * @param {object[]} rows صفوف مُحوَّلة ومُتحقَّق منها
 * @param {object} template ناتج readTemplate — تُستخدم قوائمه كما هي
 * @returns {Promise<ArrayBuffer>}
 */
export async function buildTemplateFile(rows, template) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Qoyod Invoice Import Tool';
  wb.created = new Date();

  /* ورقة القوائم المخفية — تُنسخ من القالب الأصلي بلا تعديل */
  const lookup = wb.addWorksheet(LOOKUP_SHEET);
  lookup.state = 'veryHidden';

  let r = 1;
  const ranges = {};
  for (const name of ['locations', 'taxes', 'yesNo', 'paymentMethods']) {
    const values = template.lists?.[name] || [];
    ranges[name] = { from: r, to: r + Math.max(values.length, 1) - 1 };
    for (const v of values) {
      lookup.getCell(r, 1).value = v;
      const id = template.listIds?.[name]?.[v];
      if (id !== undefined && id !== null) lookup.getCell(r, 2).value = id;
      r++;
    }
  }

  /* ورقة القالب */
  const ws = wb.addWorksheet(TEMPLATE_SHEET, { views: [{ state: 'frozen', ySplit: HEADER_ROW }] });

  for (const [col, width] of Object.entries(STYLE.columnWidths)) {
    ws.getColumn(col).width = width;
  }

  // صف 1 — عناوين المجموعتين المدموجة
  ws.mergeCells('A1:J1');
  ws.mergeCells('K1:S1');
  styleHeaderCell(ws.getCell('A1'), STYLE.groupHeaders.invoice, STYLE.groupInvoiceFill);
  styleHeaderCell(ws.getCell('K1'), STYLE.groupHeaders.line, STYLE.groupLineFill);

  // صف 2 — الرؤوس
  COLUMNS.forEach((spec, i) => {
    styleHeaderCell(ws.getCell(HEADER_ROW, i + 1), spec.header, STYLE.headerFill);
  });
  ws.getRow(HEADER_ROW).height = 42;

  // صفوف البيانات
  rows.forEach((row, i) => {
    const excelRow = ws.getRow(FIRST_DATA_ROW + i);
    COLUMNS.forEach((spec, c) => {
      const cell = excelRow.getCell(c + 1);
      const raw = row[spec.key];

      if (spec.type === 'date') {
        cell.value = raw ? formatDate(raw) : null;
        cell.numFmt = STYLE.dateFormat;
      } else if (spec.type === 'number') {
        cell.value = raw === null || raw === undefined || raw === '' ? null : Number(raw);
      } else {
        cell.value = raw === null || raw === undefined || raw === '' ? null : raw;
      }

      cell.font = { name: STYLE.fontName, size: STYLE.dataFontSize };
    });
  });

  applyDataValidations(ws, ranges);

  return wb.xlsx.writeBuffer();
}

function styleHeaderCell(cell, text, fill) {
  cell.value = text;
  cell.font = { name: STYLE.fontName, size: STYLE.headerFontSize, bold: true, color: { argb: STYLE.headerFontColor } };
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
  cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
}

/**
 * قيود التحقق كما هي في القالب الرسمي حرفاً بحرف.
 *
 * تُطبَّق على نطاق واحد لكل عمود لا على كل خلية على حدة: الكتابة خلية بخلية
 * تُنشئ 5000 صف فارغ فعلي وتضخّم الملف إلى مئات الكيلوبايتات، بينما النطاق
 * يطابق بنية القالب الأصلي ويُبقي حجم الملف في حدوده الطبيعية.
 */
function applyDataValidations(ws, ranges) {
  const last = FIRST_DATA_ROW + MAX_DATA_ROWS - 1;
  const listRef = name => `${LOOKUP_SHEET}!$A$${ranges[name].from}:$A$${ranges[name].to}`;

  const apply = (col, dv) => ws.dataValidations.add(`${col}${FIRST_DATA_ROW}:${col}${last}`, dv);

  apply('A', { type: 'textLength', operator: 'lessThanOrEqual', formulae: [191], allowBlank: true, showErrorMessage: true,
    errorTitle: 'مرجع الفاتورة / التسلسل', error: 'يجب ألا يتجاوز 191 حرفًا' });

  apply('C', { type: 'textLength', operator: 'lessThanOrEqual', formulae: [191], allowBlank: true, showErrorMessage: true,
    errorTitle: 'الرقم المرجعي للعميل', error: 'يجب ألا يتجاوز 191 حرفًا' });

  for (const [col, name, title] of [
    ['G', 'locations', 'اختر الموقع'],
    ['S', 'taxes', 'اختر الضريبة'],
    ['P', 'yesNo', 'اختر خيارًا'],
    ['H', 'paymentMethods', 'اختر طريقة الدفع'],
  ]) {
    apply(col, { type: 'list', formulae: [listRef(name)], allowBlank: true, showErrorMessage: true,
      errorTitle: title, error: 'يُسمح فقط بالقيم من القائمة المنسدلة' });
  }

  // صيغة التحقق تُكتب مرة واحدة بمرجع نسبي للخلية الأولى، وإكسل يوزّعها على النطاق
  for (const [col, title] of [['D', 'تاريخ الإصدار'], ['E', 'تاريخ الاستحقاق'], ['F', 'تاريخ التوريد']]) {
    const a = `${col}${FIRST_DATA_ROW}`;
    apply(col, {
      type: 'custom', allowBlank: true, showErrorMessage: true,
      formulae: [`OR(ISBLANK(${a}),OR(AND(ISNUMBER(${a}),${a}>DATE(1900,1,1)),AND(LEN(${a})=10,MID(${a},3,1)="/",MID(${a},6,1)="/",ISNUMBER(--SUBSTITUTE(${a},"/","")))))`],
      errorTitle: title, error: 'يرجى إدخال تاريخ صحيح بصيغة DD/MM/YYYY',
    });
  }

  apply('M', { type: 'decimal', operator: 'greaterThan', formulae: [0], allowBlank: false, showErrorMessage: true,
    errorTitle: 'الكمية', error: 'يجب أن تكون رقمًا موجبًا' });

  apply('O', { type: 'decimal', operator: 'greaterThanOrEqual', formulae: [0], allowBlank: false, showErrorMessage: true,
    errorTitle: 'سعر الوحدة', error: 'يجب أن يكون صفرًا أو أكبر' });

  apply('Q', { type: 'decimal', operator: 'between', formulae: [0, 100], allowBlank: true, showErrorMessage: true,
    errorTitle: 'نسبة الخصم', error: 'يجب أن تكون بين 0 و 100' });

  apply('R', { type: 'decimal', operator: 'greaterThanOrEqual', formulae: [0], allowBlank: true, showErrorMessage: true,
    errorTitle: 'قيمة الخصم', error: 'يجب أن يكون صفرًا أو أكبر' });
}
