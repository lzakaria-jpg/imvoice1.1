import React, { useState } from 'react';
import { Card, Note, Stat, Badge, i, n } from './ui.jsx';
import { exportInvoiceTemplate, exportReturns, exportReport } from '../io/exportFiles.js';

/**
 * الخطوة 5 — التصدير.
 *
 * ثلاثة ملفات لأن الترحيل ليس ملفاً واحداً: ما يُرفع، وما يُعالَج بمسار آخر،
 * وما يُحتفظ به كأثر تدقيقي.
 */
export default function Step5Export({ state, actions }) {
  const { result, parsed, options, template } = state;
  const [busy, setBusy] = useState('');

  if (!result) return <div className="empty">أكمل الخطوات السابقة</div>;

  const { rows, reconciliation, summary, stock, notes, validation } = result;
  const stamp = new Date().toISOString().slice(0, 10);

  const run = async (key, fn) => {
    setBusy(key);
    try { await fn(); }
    catch (e) { alert(`تعذّر إنشاء الملف: ${e.message}`); }
    finally { setBusy(''); }
  };

  return (
    <>
      <h1 className="page-title">التصدير</h1>
      <p className="page-sub">الملفات الناتجة عن التحويل.</p>

      <div className="grid-3" style={{ marginBottom: 16 }}>
        <Stat k="فواتير للرفع" v={i(summary.invoices)} tone="ok" />
        <Stat k="صفوف القالب" v={i(summary.rows)} />
        <Stat k="مرتجعات مفصولة" v={i(parsed?.stats.returnInvoices || 0)} tone="warn" />
      </div>

      {!validation.canExport && (
        <Note tone="stop">
          التصدير موقوف: <strong>{i(validation.fatal.length)}</strong> خطأ فادح. ارجع إلى خطوة التحقق.
        </Note>
      )}

      <Card title="ملفات التصدير">
        <ExportRow
          title="قالب قيود جاهز للرفع"
          desc={`${i(summary.rows)} صف · بنفس تنسيق القالب الرسمي وقوائمه المنسدلة`}
          disabled={!validation.canExport || busy}
          busy={busy === 'template'}
          onClick={() => run('template', () =>
            exportInvoiceTemplate(rows, template, `فواتير_مبيعات_قيود_${stamp}.xlsx`))}
        />

        {parsed?.returns?.length > 0 && (
          <ExportRow
            title="المرتجعات المفصولة"
            desc={`${i(parsed.returns.length)} فاتورة · تُعالَج كإشعارات دائنة، لا تُرفع بمسار فواتير المبيعات`}
            disabled={!!busy}
            busy={busy === 'returns'}
            tone="warn"
            onClick={() => run('returns', () =>
              exportReturns(parsed.returns, `مرتجعات_${stamp}.xlsx`))}
          />
        )}

        <ExportRow
          title="تقرير التحقق والمطابقة"
          desc="الملخص · الملاحظات كاملة · المطابقة الحسابية لكل فاتورة · حالة الكميات"
          disabled={!!busy}
          busy={busy === 'report'}
          onClick={() => run('report', () =>
            exportReport({ validation, reconciliation, summary, stock, notes, stats: parsed?.stats },
              `تقرير_التحقق_${stamp}.xlsx`))}
        />
      </Card>

      <Card title="إعدادات التحويل">
        <Note>
          هذه الإعدادات تغيّر أرقام المخرج. القيم الافتراضية مُثبتة على بيانات حقيقية — لا تغيّرها بلا سبب.
        </Note>

        <label className="field" style={{ maxWidth: 460 }}>
          <span>دقة سعر الوحدة</span>
          <select value={options.unitPriceDecimals} onChange={e => actions.setOption('unitPriceDecimals', Number(e.target.value))}>
            <option value={4}>أربع خانات عشرية — أدق مطابقة</option>
            <option value={2}>خانتان — إن رفض قيود الدقة الأعلى</option>
          </select>
        </label>

        <label className="field" style={{ maxWidth: 460 }}>
          <span>أسلوب الخصم</span>
          <select value={options.discountMode} onChange={e => actions.setOption('discountMode', e.target.value)}>
            <option value="percent">نسبة مئوية — محايدة تجاه أساس الاحتساب</option>
            <option value="value">قيمة — أساسها غير مؤكد مع التسعير الشامل</option>
          </select>
        </label>

        <label className="field" style={{ maxWidth: 460 }}>
          <span>أساس التسعير</span>
          <select value={options.priceMode} onChange={e => actions.setOption('priceMode', e.target.value)}>
            <option value="inclusive">شامل الضريبة</option>
            <option value="exclusive">غير شامل الضريبة</option>
          </select>
        </label>

        <label className="checkline">
          <input type="checkbox" checked={options.repeatInvoiceData}
                 onChange={e => actions.setOption('repeatInvoiceData', e.target.checked)} />
          تكرار بيانات الفاتورة في كل صف — كما يتطلبه توثيق قيود
        </label>

        <label className="checkline">
          <input type="checkbox" checked={options.phase2Einvoicing}
                 onChange={e => actions.setOption('phase2Einvoicing', e.target.checked)} />
          المنشأة في المرحلة الثانية من الفوترة الإلكترونية — تجعل طريقة الدفع إلزامية
        </label>

        <label className="checkline">
          <input type="checkbox" checked={options.enforceStock}
                 onChange={e => actions.setOption('enforceStock', e.target.checked)} />
          منع التصدير عند نقص كمية أي منتج مخزَّن
        </label>
      </Card>

      <Card title="بعد الرفع">
        <div style={{ fontSize: 13, lineHeight: 2 }}>
          <div>ارفع الملف من: المبيعات ← فواتير المبيعات ← استيراد ← الخطوة الثالثة.</div>
          <div>الفواتير تتبع صلاحيتك: مع صلاحية الاعتماد تُنشأ معتمدة بقيد محاسبي فوري، وبدونها بانتظار الموافقة.</div>
          <div>يصلك بريد «تقرير استيراد الفواتير» بعدد الفواتير المنشأة وأسباب أي صف فاشل مع رقم صفه.</div>
          <div>راجع تقرير النشاط تحت نوع المعاملة «استيراد» لتفاصيل كل محاولة.</div>
        </div>
      </Card>
    </>
  );
}

function ExportRow({ title, desc, onClick, disabled, busy, tone }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 14, padding: '13px 0',
      borderBottom: '1px solid var(--line-soft)',
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 13.5, display: 'flex', alignItems: 'center', gap: 8 }}>
          {title}
          {tone && <Badge tone={tone}>منفصل</Badge>}
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>{desc}</div>
      </div>
      <button className="btn primary" onClick={onClick} disabled={disabled}>
        {busy ? 'جارٍ الإنشاء…' : 'تنزيل'}
      </button>
    </div>
  );
}
