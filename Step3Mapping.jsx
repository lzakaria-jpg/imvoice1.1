import React, { useState, useMemo } from 'react';
import { Card, Note, Badge, i, n } from './ui.jsx';

/**
 * الخطوة 3 — المطابقة.
 *
 * كل قيمة تعذّرت مطابقتها تلقائياً تظهر هنا بصف أحمر حتى يُتخذ قرار بشأنها.
 * لا شيء يُخمَّن، ولا شيء يُسقط بصمت.
 */
export default function Step3Mapping({ state, actions }) {
  const [tab, setTab] = useState('customers');
  const { decisions, template, references, pending } = state;
  if (!pending) return <div className="empty">ارفع المراجع وملف العميل أولاً</div>;

  const tabs = [
    { id: 'customers', label: 'العملاء', open: pending.customers.length },
    { id: 'products',  label: 'المنتجات', open: pending.products.length },
    { id: 'payments',  label: 'طرق الدفع', open: pending.payments.length },
    { id: 'locations', label: 'المواقع', open: pending.locations.length },
  ];

  return (
    <>
      <h1 className="page-title">المطابقة</h1>
      <p className="page-sub">
        قيم ملف العميل التي لا تطابق مراجع قيود تلقائياً. حدّد البديل لكل قيمة، وقراراتك تُحفظ للملفات القادمة.
      </p>

      <section className="card">
        <div className="tabs">
          {tabs.map(t => (
            <button key={t.id} className={`tab${tab === t.id ? ' active' : ''}`} onClick={() => setTab(t.id)}>
              {t.label}
              <Badge tone={t.open ? 'stop' : 'ok'}>{t.open ? i(t.open) : '✓'}</Badge>
            </button>
          ))}
        </div>

        <div className="card-body">
          {tab === 'customers' && (
            <CustomerTab pending={pending.customers} references={references} decisions={decisions} actions={actions} />
          )}
          {tab === 'products' && (
            <ProductTab pending={pending.products} references={references} decisions={decisions} actions={actions} />
          )}
          {tab === 'payments' && (
            <ListTab
              kind="payments" pending={pending.payments}
              options={template?.lists?.paymentMethods || []}
              decisions={decisions} actions={actions}
              title="طرق الدفع"
              help="قيود يقبل خمس طرق فقط. اربط كل قيمة من نظام العميل بما يقابلها. طريقة الدفع إلزامية إذا كانت المنشأة في المرحلة الثانية من الفوترة الإلكترونية."
              defaultKey="defaultPayment"
              defaultLabel="طريقة الدفع الافتراضية للفواتير بلا قيمة"
            />
          )}
          {tab === 'locations' && (
            <ListTab
              kind="locations" pending={pending.locations}
              options={template?.lists?.locations || []}
              decisions={decisions} actions={actions}
              title="المواقع"
              help="المواقع تأتي من حساب العميل عبر القالب. أي قيمة خارج القائمة يرفضها قيود."
              defaultKey="defaultLocation"
              defaultLabel="الموقع الافتراضي للفواتير بلا موقع"
            />
          )}
        </div>
      </section>
    </>
  );
}

/* ─────────────────────────── العملاء ─────────────────────────── */

function CustomerTab({ pending, references, decisions, actions }) {
  const customers = references.customers || [];
  const [q, setQ] = useState('');

  const options = useMemo(
    () => customers.map(c => ({ value: c.ref, label: `${c.name || '(بلا اسم)'} — ${c.ref}` })),
    [customers]
  );

  return (
    <>
      <Note>
        قيود يطابق العميل بحقل <strong>الرقم المرجعي</strong> لا بالاسم. اختر العميل المقابل من قائمة قيود، أو
        اترك الفواتير بلا عميل على العميل الافتراضي أدناه.
      </Note>

      <label className="field" style={{ maxWidth: 460 }}>
        <span>الرقم المرجعي للعميل الافتراضي — يُستخدم للفواتير التي لا تحمل اسم عميل</span>
        <input
          type="text"
          value={decisions.customers?.[''] || ''}
          placeholder="مثال: CASH-001"
          onChange={e => actions.decide('customers', '', e.target.value)}
        />
      </label>

      {pending.length === 0
        ? <div className="empty">كل عملاء الملف مطابقون ✓</div>
        : (
          <>
            <input
              type="text" placeholder="ابحث في القيم غير المطابقة…"
              value={q} onChange={e => setQ(e.target.value)}
              style={{ maxWidth: 320, marginBottom: 12 }}
            />
            <MatchTable
              rows={pending.filter(p => !q || p.label.includes(q))}
              options={options}
              valueOf={p => decisions.customers?.[p.key] || ''}
              onChange={(p, v) => actions.decide('customers', p.key, v)}
              headers={['اسم العميل في المصدر', 'فواتير', 'السبب', 'العميل في قيود']}
            />
          </>
        )}
    </>
  );
}

/* ─────────────────────────── المنتجات ─────────────────────────── */

function ProductTab({ pending, references, decisions, actions }) {
  const products = references.products || [];
  const [q, setQ] = useState('');

  const options = useMemo(
    () => products.map(p => ({
      value: p.code,
      label: `${p.name || '(بلا اسم)'} — ${p.code}${p.stock !== null ? ` · متاح ${p.stock}` : ''}`,
    })),
    [products]
  );

  return (
    <>
      <Note>
        كل بند يحتاج منتجاً موجوداً في قيود. الرسوم مثل الشحن والدفع عند الاستلام تحتاج منتجات خدمية
        مضافة مسبقاً في حساب العميل.
      </Note>

      {pending.length === 0
        ? <div className="empty">كل منتجات الملف مطابقة ✓</div>
        : (
          <>
            <input
              type="text" placeholder="ابحث في القيم غير المطابقة…"
              value={q} onChange={e => setQ(e.target.value)}
              style={{ maxWidth: 320, marginBottom: 12 }}
            />
            <MatchTable
              rows={pending.filter(p => !q || p.label.includes(q) || (p.sku || '').includes(q))}
              options={options}
              valueOf={p => decisions.products?.[p.key] || ''}
              onChange={(p, v) => actions.decide('products', p.key, v)}
              headers={['المنتج في المصدر', 'بنود', 'السبب', 'المنتج في قيود']}
            />
          </>
        )}
    </>
  );
}

/* ─────────────────── القوائم المعتمدة: دفع / مواقع ─────────────────── */

function ListTab({ kind, pending, options, decisions, actions, help, defaultKey, defaultLabel }) {
  const opts = options.map(o => ({ value: o, label: o }));

  return (
    <>
      <Note>{help}</Note>

      <label className="field" style={{ maxWidth: 460 }}>
        <span>{defaultLabel}</span>
        <select
          className={decisions[defaultKey] ? 'set' : 'unset'}
          value={decisions[defaultKey] || ''}
          onChange={e => actions.setDefault(defaultKey, e.target.value)}
        >
          <option value="">— بدون قيمة افتراضية —</option>
          {options.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      </label>

      {pending.length === 0
        ? <div className="empty">كل القيم مطابقة ✓</div>
        : (
          <MatchTable
            rows={pending}
            options={opts}
            valueOf={p => decisions[kind]?.[p.key] || ''}
            onChange={(p, v) => actions.decide(kind, p.key, v)}
            headers={['القيمة في المصدر', 'فواتير', 'السبب', 'القيمة في قيود']}
          />
        )}
    </>
  );
}

/* ─────────────────────────── الجدول المشترك ─────────────────────────── */

function MatchTable({ rows, options, valueOf, onChange, headers }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>{headers[0]}</th>
            <th className="n">{headers[1]}</th>
            <th>{headers[2]}</th>
            <th style={{ minWidth: 300 }}>{headers[3]}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(p => {
            const v = valueOf(p);
            return (
              <tr key={p.key} className={v ? 'row-ok' : 'row-stop'}>
                <td>
                  <span className="truncate" title={p.label}>{p.label}</span>
                  {p.sku && <div className="mono" style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>{p.sku}</div>}
                </td>
                <td className="n">{i(p.count)}</td>
                <td style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>{p.reason}</td>
                <td>
                  <select className={v ? 'set' : 'unset'} value={v} onChange={e => onChange(p, e.target.value)}>
                    <option value="">— اختر —</option>
                    {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
