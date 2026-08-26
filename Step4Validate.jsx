import React, { useState } from 'react';
import { Card, Note, Badge, Stat, i, n } from './ui.jsx';

/**
 * الخطوة 4 — التحقق.
 *
 * يفصل بين ثلاث نوافذ على نفس البيانات: الملاحظات، المطابقة الحسابية، الكميات.
 * الفصل مقصود لأن كلاً منها يُقرأ بطريقة مختلفة ويقود إلى إجراء مختلف.
 */
export default function Step4Validate({ state }) {
  const [tab, setTab] = useState('issues');
  const { result } = state;

  if (!result) return <div className="empty">أكمل الخطوات السابقة لبدء التحقق</div>;

  const { validation, reconciliation, summary, stock, notes } = result;
  const shortages = stock.filter(s => s.status === 'insufficient');
  const unknown = stock.filter(s => s.status === 'unknown_product');
  const drifted = reconciliation.filter(t => Math.abs(t.drift) > 0.011);

  return (
    <>
      <h1 className="page-title">التحقق</h1>
      <p className="page-sub">خمس طبقات فحص على الصفوف المُحوَّلة قبل التصدير.</p>

      <div className="grid-3" style={{ marginBottom: 16 }}>
        <Stat k="أخطاء فادحة" v={i(validation.fatal.length)} tone={validation.fatal.length ? 'stop' : 'ok'} />
        <Stat k="تحذيرات" v={i(validation.warn.length + notes.length)} tone="warn" />
        <Stat k="فواتير بانحراف" v={i(drifted.length)} tone={drifted.length ? 'warn' : 'ok'} />
        <Stat k="نقص كميات" v={i(shortages.length)} tone={shortages.length ? 'stop' : 'ok'} />
        <Stat k="الفرق الكلي" v={n(summary.expectedGrandTotal - summary.sourceGrandTotal)}
              tone={Math.abs(summary.expectedGrandTotal - summary.sourceGrandTotal) <= 0.05 ? 'ok' : 'warn'} />
        <Stat k="أقصى انحراف لفاتورة" v={n(summary.maxDrift)} />
      </div>

      {validation.fatal.length === 0
        ? <Note tone="ok">لا توجد أخطاء فادحة. الملف جاهز للتصدير.</Note>
        : <Note tone="stop">
            <strong>{i(validation.fatal.length)}</strong> خطأ فادح يمنع التصدير. عالجها من شاشة المطابقة أو صحّح ملف المصدر.
          </Note>}

      <section className="card">
        <div className="tabs">
          <Tab id="issues" tab={tab} setTab={setTab} label="الملاحظات" count={validation.issues.length + notes.length} />
          <Tab id="recon" tab={tab} setTab={setTab} label="المطابقة الحسابية" count={reconciliation.length} />
          <Tab id="stock" tab={tab} setTab={setTab} label="الكميات" count={stock.length} />
        </div>
        <div className="card-body tight">
          {tab === 'issues' && <IssuesTable issues={[...validation.issues, ...notes]} />}
          {tab === 'recon' && <ReconTable rows={reconciliation} />}
          {tab === 'stock' && <StockTable rows={stock} />}
        </div>
      </section>
    </>
  );
}

function Tab({ id, tab, setTab, label, count }) {
  return (
    <button className={`tab${tab === id ? ' active' : ''}`} onClick={() => setTab(id)}>
      {label} <Badge>{i(count)}</Badge>
    </button>
  );
}

function IssuesTable({ issues }) {
  const [only, setOnly] = useState('all');
  const filtered = issues.filter(x => only === 'all' || x.severity === only);
  const order = { fatal: 0, warn: 1 };
  const sorted = [...filtered].sort((a, b) => order[a.severity] - order[b.severity]);

  if (!issues.length) return <div className="empty">لا ملاحظات</div>;

  return (
    <>
      <div style={{ padding: '12px 18px', display: 'flex', gap: 8 }}>
        {[['all', 'الكل'], ['fatal', 'فادح'], ['warn', 'تحذير']].map(([v, l]) => (
          <button key={v} className={`btn sm${only === v ? ' primary' : ''}`} onClick={() => setOnly(v)}>{l}</button>
        ))}
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>الخطورة</th><th>الفاتورة</th><th className="n">صف المصدر</th><th>الملاحظة</th></tr>
          </thead>
          <tbody>
            {sorted.slice(0, 500).map((x, k) => (
              <tr key={k} className={x.severity === 'fatal' ? 'row-stop' : ''}>
                <td><Badge tone={x.severity === 'fatal' ? 'stop' : 'warn'}>{x.severity === 'fatal' ? 'فادح' : 'تحذير'}</Badge></td>
                <td className="mono">{x.invoiceRef || '—'}</td>
                <td className="n">{x.sourceRow ?? '—'}</td>
                <td>{x.message}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {sorted.length > 500 && (
        <div style={{ padding: '10px 18px', fontSize: 12.5, color: 'var(--ink-3)' }}>
          معروض 500 من {i(sorted.length)} — التقرير الكامل في ملف التحقق عند التصدير.
        </div>
      )}
    </>
  );
}

function ReconTable({ rows }) {
  const [onlyDrift, setOnlyDrift] = useState(true);
  const list = onlyDrift ? rows.filter(t => Math.abs(t.drift) > 0.011) : rows;
  const sorted = [...list].sort((a, b) => Math.abs(b.drift) - Math.abs(a.drift));

  return (
    <>
      <div style={{ padding: '12px 18px' }}>
        <label className="checkline">
          <input type="checkbox" checked={onlyDrift} onChange={e => setOnlyDrift(e.target.checked)} />
          الفواتير المنحرفة فقط
        </label>
      </div>
      {sorted.length === 0
        ? <div className="empty">كل الفواتير مطابقة تماماً ✓</div>
        : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>الفاتورة</th><th className="n">بنود</th>
                  <th className="n">إجمالي المصدر</th><th className="n">إجمالي قيود</th><th className="n">الفرق</th>
                </tr>
              </thead>
              <tbody>
                {sorted.slice(0, 500).map(t => (
                  <tr key={t.invoiceRef} className={Math.abs(t.drift) > 1 ? 'row-stop' : Math.abs(t.drift) > 0.011 ? 'row-warn' : ''}>
                    <td className="mono">{t.invoiceRef}</td>
                    <td className="n">{i(t.lineCount)}</td>
                    <td className="n">{n(t.sourceTotal)}</td>
                    <td className="n">{n(t.expectedTotal)}</td>
                    <td className="n"><strong>{t.drift >= 0 ? '+' : ''}{n(t.drift)}</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
    </>
  );
}

function StockTable({ rows }) {
  const [only, setOnly] = useState('problem');
  const label = { ok: 'كافية', insufficient: 'نقص', not_tracked: 'غير مخزَّن', unknown_product: 'غير موجود في قيود' };
  const tone = { ok: 'ok', insufficient: 'stop', not_tracked: 'info', unknown_product: 'stop' };

  const list = only === 'problem'
    ? rows.filter(r => r.status === 'insufficient' || r.status === 'unknown_product')
    : rows;

  if (!rows.length) return <div className="empty">فحص الكميات غير مفعّل أو لا توجد منتجات مطابقة</div>;

  return (
    <>
      <div style={{ padding: '12px 18px', display: 'flex', gap: 8 }}>
        {[['problem', 'المشكلات فقط'], ['all', 'كل المنتجات']].map(([v, l]) => (
          <button key={v} className={`btn sm${only === v ? ' primary' : ''}`} onClick={() => setOnly(v)}>{l}</button>
        ))}
      </div>
      {list.length === 0
        ? <div className="empty">كل الكميات كافية ✓</div>
        : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>الرمز</th><th>الاسم</th>
                  <th className="n">المطلوب</th><th className="n">المتاح</th><th className="n">النقص</th>
                  <th className="n">فواتير</th><th>الحالة</th>
                </tr>
              </thead>
              <tbody>
                {list.slice(0, 500).map(p => (
                  <tr key={p.code} className={p.status === 'insufficient' || p.status === 'unknown_product' ? 'row-stop' : ''}>
                    <td className="mono">{p.code}</td>
                    <td><span className="truncate" title={p.name}>{p.name || '—'}</span></td>
                    <td className="n">{n(p.required, 0)}</td>
                    <td className="n">{p.available === null ? '—' : n(p.available, 0)}</td>
                    <td className="n">{p.shortage ? n(p.shortage, 0) : '—'}</td>
                    <td className="n">{i(p.invoiceCount)}</td>
                    <td><Badge tone={tone[p.status]}>{label[p.status]}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
    </>
  );
}
