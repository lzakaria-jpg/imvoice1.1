import React from 'react';
import { Card, FileDrop, Note, Stat, ColumnSelect, Badge, i, n } from './ui.jsx';
import { SOURCE_FIELD_ALIASES } from '../engine/parseSource.js';

const FIELD_LABELS = {
  invoiceNumber: 'رقم الفاتورة',
  lineType:      'نوع السطر',
  date:          'التاريخ',
  sellType:      'نوع العملية (بيع / مرتجع)',
  customerName:  'اسم العميل',
  location:      'الموقع',
  channel:       'القناة',
  sku:           'رمز المنتج / الباركود',
  details:       'وصف المنتج',
  quantity:      'الكمية',
  subtotalEx:    'المبلغ قبل الضريبة',
  discount:      'الخصم',
  totalTax:      'إجمالي الضريبة',
  totalInc:      'الإجمالي شامل الضريبة',
  paymentMethod: 'طريقة الدفع',
  paidAmount:    'المبلغ المدفوع',
  vat:           'ضريبة القيمة المضافة',
  otherTaxes:    'ضرائب أخرى',
};

const REQUIRED = ['invoiceNumber', 'lineType', 'quantity', 'subtotalEx', 'totalInc', 'totalTax', 'date'];
const IMPORTANT = ['sellType', 'customerName', 'location', 'sku', 'details', 'discount', 'paymentMethod'];
const OPTIONAL = ['channel', 'paidAmount', 'vat', 'otherTaxes'];

/**
 * الخطوة 2 — ملف العميل وربط أعمدته.
 *
 * الربط حر بالكامل: الأداة تكتشف الأعمدة تلقائياً ثم تترك التصحيح للمستخدم،
 * حتى تعمل مع أي مصدر لا مع تصدير واحد بعينه.
 */
export default function Step2Source({ state, actions }) {
  const { sourceFile, sourceHeaders, sourceMapping, parsed } = state;
  const missing = REQUIRED.filter(f => !sourceMapping[f]);

  return (
    <>
      <h1 className="page-title">ملف العميل</h1>
      <p className="page-sub">ارفع ملف الفواتير كما استلمته، وصحّح ربط الأعمدة إن لزم.</p>

      <Card title="الملف">
        <FileDrop
          label="اسحب ملف فواتير العميل هنا"
          hint="xlsx أو csv"
          accept=".xlsx,.csv"
          file={sourceFile}
          onFile={f => actions.loadSource(f)}
        />
      </Card>

      {sourceHeaders && (
        <Card
          title="ربط الأعمدة"
          aside={missing.length
            ? <Badge tone="stop">{i(missing.length)} حقل أساسي ناقص</Badge>
            : <Badge tone="ok">الحقول الأساسية مكتملة</Badge>}
        >
          <Note>
            <strong>نوع السطر</strong> هو الحقل الذي يفكّك الملف: يميّز صف رأس الفاتورة عن صفوف البنود عن صفوف الدفع.
            بدونه لا يمكن معرفة أي البنود تخص أي فاتورة.
          </Note>

          <FieldGroup title="حقول أساسية" fields={REQUIRED} {...{ sourceHeaders, sourceMapping, actions }} />
          <FieldGroup title="حقول مهمة" fields={IMPORTANT} {...{ sourceHeaders, sourceMapping, actions }} />
          <FieldGroup title="حقول اختيارية" fields={OPTIONAL} {...{ sourceHeaders, sourceMapping, actions }} />
        </Card>
      )}

      {parsed && (
        <Card title="نتيجة التفكيك">
          <div className="grid-3">
            <Stat k="صفوف الملف" v={i(parsed.stats.totalRows)} />
            <Stat k="فواتير مبيعات" v={i(parsed.stats.salesInvoices)} tone="ok" />
            <Stat k="بنود المبيعات" v={i(parsed.stats.salesLines)} />
            <Stat k="فواتير مرتجعات" v={i(parsed.stats.returnInvoices)} tone="warn" />
            <Stat k="بنود المرتجعات" v={i(parsed.stats.returnLines)} tone="warn" />
            <Stat
              k="إجمالي المبيعات"
              v={n(parsed.sales.reduce((s, x) => s + x.sourceTotalInclusive, 0))}
            />
          </div>

          {parsed.stats.returnInvoices > 0 && (
            <Note tone="warn">
              فُصلت <strong>{i(parsed.stats.returnInvoices)}</strong> فاتورة مرتجع ولن تُدرج في ملف الاستيراد.
              المرتجعات ليست فواتير مبيعات، ولها مسار مستقل في قيود. تنزّل في ملف منفصل عند التصدير.
            </Note>
          )}

          {parsed.issues.length > 0 && (
            <IssueSummary issues={parsed.issues} />
          )}
        </Card>
      )}
    </>
  );
}

function FieldGroup({ title, fields, sourceHeaders, sourceMapping, actions }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink-2)', marginBottom: 8 }}>{title}</div>
      <div className="grid-3">
        {fields.map(f => (
          <label className="field" key={f}>
            <span>{FIELD_LABELS[f] || f}</span>
            <ColumnSelect
              value={sourceMapping[f]}
              options={sourceHeaders}
              onChange={v => actions.setSourceMapping(f, v)}
            />
          </label>
        ))}
      </div>
    </div>
  );
}

function IssueSummary({ issues }) {
  const grouped = new Map();
  for (const x of issues) {
    if (!grouped.has(x.code)) grouped.set(x.code, { code: x.code, severity: x.severity, count: 0, sample: x.message });
    grouped.get(x.code).count++;
  }
  const list = [...grouped.values()].sort((a, b) => (a.severity === 'fatal' ? -1 : 1) - (b.severity === 'fatal' ? -1 : 1));

  return (
    <div className="table-wrap" style={{ marginTop: 14 }}>
      <table>
        <thead>
          <tr><th>الخطورة</th><th className="n">العدد</th><th>الملاحظة</th></tr>
        </thead>
        <tbody>
          {list.map(g => (
            <tr key={g.code} className={g.severity === 'fatal' ? 'row-stop' : 'row-warn'}>
              <td><Badge tone={g.severity === 'fatal' ? 'stop' : 'warn'}>{g.severity === 'fatal' ? 'فادح' : 'تحذير'}</Badge></td>
              <td className="n">{i(g.count)}</td>
              <td>{g.sample}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
