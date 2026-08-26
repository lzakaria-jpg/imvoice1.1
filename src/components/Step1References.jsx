import React from 'react';
import { Card, FileDrop, Note, Stat, ColumnSelect, Badge, i } from './ui.jsx';

/**
 * الخطوة 1 — المراجع.
 *
 * تُرفع قبل أي شيء لأن كل ما بعدها يعتمد عليها: القوائم المعتمدة تأتي من
 * القالب المنزَّل من حساب العميل نفسه، والمطابقة تحتاج ملفي العملاء والمنتجات.
 */
export default function Step1References({ state, actions }) {
  const { template, templateFile, customersFile, productsFile, references, refMapping, refHeaders } = state;

  return (
    <>
      <h1 className="page-title">المراجع</h1>
      <p className="page-sub">
        ارفع قالب قيود وملفي العملاء والمنتجات. الأداة تبني كل عمليات التحقق على هذه الملفات، لا على قيم مخزّنة مسبقاً.
      </p>

      <Card title="قالب قيود الرسمي" aside={template ? <Badge tone="ok">مقروء</Badge> : <Badge tone="stop">مطلوب</Badge>}>
        <Note>
          نزّل القالب من <strong>المبيعات ← فواتير المبيعات ← استيراد</strong> في حساب العميل نفسه.
          القوائم المنسدلة (المواقع والضرائب وطرق الدفع) تختلف بين الحسابات، وقيود يوقف الاستيراد إذا بُني الملف على نموذج قديم.
        </Note>

        <FileDrop
          label="اسحب قالب قيود هنا أو اضغط للاختيار"
          hint="ملف xlsx يحتوي على ورقة Invoice Upload Template"
          accept=".xlsx"
          file={templateFile}
          onFile={f => actions.loadTemplate(f)}
        />

        {template && (
          <div className="grid-2" style={{ marginTop: 14 }}>
            <ListPreview title="المواقع" values={template.lists.locations} />
            <ListPreview title="الضرائب" values={template.lists.taxes} />
            <ListPreview title="طرق الدفع" values={template.lists.paymentMethods} />
            <ListPreview title="شامل الضريبة" values={template.lists.yesNo} />
          </div>
        )}
      </Card>

      <Card
        title="ملف العملاء"
        aside={references.customers?.length
          ? <Badge tone="ok">{i(references.customers.length)} عميل</Badge>
          : <Badge tone="stop">مطلوب</Badge>}
      >
        <Note>
          قيود يطابق العميل بحقل <strong>الرقم المرجعي</strong> في سجل العميل، لا باسمه — وهذا أكثر أسباب فشل الاستيراد.
          صدّر قائمة العملاء من قيود وارفعها هنا.
        </Note>

        <FileDrop
          label="اسحب ملف العملاء هنا"
          hint="xlsx أو csv — يحتاج عمود الاسم وعمود الرقم المرجعي"
          accept=".xlsx,.csv"
          file={customersFile}
          onFile={f => actions.loadReference(f, 'customers')}
        />

        {refHeaders.customers && (
          <div className="grid-2" style={{ marginTop: 14 }}>
            <label className="field">
              <span>عمود اسم العميل</span>
              <ColumnSelect
                value={refMapping.customers.name}
                options={refHeaders.customers}
                onChange={v => actions.setRefMapping('customers', 'name', v)}
              />
            </label>
            <label className="field">
              <span>عمود الرقم المرجعي</span>
              <ColumnSelect
                value={refMapping.customers.ref}
                options={refHeaders.customers}
                onChange={v => actions.setRefMapping('customers', 'ref', v)}
              />
            </label>
          </div>
        )}
      </Card>

      <Card
        title="ملف المنتجات"
        aside={references.products?.length
          ? <Badge tone="ok">{i(references.products.length)} منتج</Badge>
          : <Badge tone="stop">مطلوب</Badge>}
      >
        <Note>
          يُستخدم لأمرين: التأكد أن كل منتج في ملف العميل موجود فعلاً في قيود، والتأكد أن الكمية المتاحة تكفي.
          قيود يرفض الفاتورة كاملة إذا لم تكفِ كمية منتج مخزَّن.
        </Note>

        <FileDrop
          label="اسحب ملف المنتجات هنا"
          hint="xlsx أو csv — يحتاج الرمز أو الباركود، والاسم، والكمية المتاحة"
          accept=".xlsx,.csv"
          file={productsFile}
          onFile={f => actions.loadReference(f, 'products')}
        />

        {refHeaders.products && (
          <div className="grid-3" style={{ marginTop: 14 }}>
            <label className="field">
              <span>عمود الرمز / الباركود</span>
              <ColumnSelect
                value={refMapping.products.code}
                options={refHeaders.products}
                onChange={v => actions.setRefMapping('products', 'code', v)}
              />
            </label>
            <label className="field">
              <span>عمود اسم المنتج</span>
              <ColumnSelect
                value={refMapping.products.name}
                options={refHeaders.products}
                onChange={v => actions.setRefMapping('products', 'name', v)}
              />
            </label>
            <label className="field">
              <span>عمود الكمية المتاحة</span>
              <ColumnSelect
                value={refMapping.products.stock}
                options={refHeaders.products}
                onChange={v => actions.setRefMapping('products', 'stock', v)}
              />
            </label>
          </div>
        )}

        {references.products?.length > 0 && (
          <div className="grid-3">
            <Stat k="منتجات بكمية معروفة" v={i(references.products.filter(p => p.stock !== null).length)} />
            <Stat k="منتجات بلا كمية" v={i(references.products.filter(p => p.stock === null).length)} />
          </div>
        )}
      </Card>
    </>
  );
}

function ListPreview({ title, values }) {
  return (
    <div className="stat">
      <div className="stat-k">{title} · {values?.length || 0}</div>
      <div style={{ fontSize: 12.5, marginTop: 5, lineHeight: 1.7 }}>
        {(values || []).map(v => <div key={v}>{v}</div>)}
        {!values?.length && <span style={{ color: 'var(--stop)' }}>القائمة فارغة</span>}
      </div>
    </div>
  );
}
