import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { readTemplate } from './engine/template.js';
import { detectMapping, parseSource } from './engine/parseSource.js';
import { collectDecisions, runPipeline } from './engine/pipeline.js';
import { ENGINE_DEFAULTS } from './engine/constants.js';
import { readWorkbook, mapReferenceRecords, detectReferenceMapping } from './io/readWorkbook.js';

import ReconStrip from './components/ReconStrip.jsx';
import Step1References from './components/Step1References.jsx';
import Step2Source from './components/Step2Source.jsx';
import Step3Mapping from './components/Step3Mapping.jsx';
import Step4Validate from './components/Step4Validate.jsx';
import Step5Export from './components/Step5Export.jsx';

const STEPS = [
  { id: 1, label: 'المراجع',  hint: 'قالب قيود · العملاء · المنتجات' },
  { id: 2, label: 'ملف العميل', hint: 'الرفع وربط الأعمدة' },
  { id: 3, label: 'المطابقة',  hint: 'العملاء · المنتجات · الدفع · المواقع' },
  { id: 4, label: 'التحقق',    hint: 'الملاحظات والمطابقة الحسابية' },
  { id: 5, label: 'التصدير',   hint: 'قالب قيود · المرتجعات · التقرير' },
];

const STORE_KEY = 'qoyod-invoice-import/decisions';

/** القرارات تُحفظ محلياً حتى لا يعيد المستخدم ربط طرق الدفع مع كل ملف */
function loadDecisions() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* التخزين المحلي قد يكون معطلاً — نتابع بقيم فارغة */ }
  return { customers: {}, products: {}, payments: {}, locations: {}, defaultPayment: '', defaultLocation: '' };
}

export default function App() {
  const [step, setStep] = useState(1);
  const [error, setError] = useState('');

  const [template, setTemplate] = useState(null);
  const [templateFile, setTemplateFile] = useState('');

  const [references, setReferences] = useState({ customers: [], products: [] });
  const [refRaw, setRefRaw] = useState({ customers: null, products: null });
  const [refHeaders, setRefHeaders] = useState({ customers: null, products: null });
  const [refMapping, setRefMapping] = useState({
    customers: { name: '', ref: '' },
    products: { code: '', name: '', stock: '' },
  });
  const [customersFile, setCustomersFile] = useState('');
  const [productsFile, setProductsFile] = useState('');

  const [sourceFile, setSourceFile] = useState('');
  const [sourceRaw, setSourceRaw] = useState(null);
  const [sourceHeaders, setSourceHeaders] = useState(null);
  const [sourceMapping, setSourceMapping] = useState({});

  const [decisions, setDecisions] = useState(loadDecisions);
  const [options, setOptions] = useState(ENGINE_DEFAULTS);

  useEffect(() => {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(decisions)); } catch { /* تجاهل */ }
  }, [decisions]);

  /* ── تفكيك المصدر ── */
  const parsed = useMemo(() => {
    if (!sourceRaw || !sourceMapping.invoiceNumber || !sourceMapping.lineType) return null;
    try { return parseSource(sourceRaw.records, sourceMapping); }
    catch (e) { setError(`تعذّر تفكيك الملف: ${e.message}`); return null; }
  }, [sourceRaw, sourceMapping]);

  /* ── القرارات المعلّقة ── */
  const pending = useMemo(() => {
    if (!parsed || !template) return null;
    return collectDecisions({ sales: parsed.sales, references, decisions, template });
  }, [parsed, template, references, decisions]);

  /* ── التحويل والتحقق ── */
  const result = useMemo(() => {
    if (!parsed || !template || !parsed.sales.length) return null;
    try { return runPipeline({ sales: parsed.sales, references, decisions, template, options }); }
    catch (e) { setError(`تعذّر التحويل: ${e.message}`); return null; }
  }, [parsed, template, references, decisions, options]);

  /* ── الأفعال ── */
  const loadTemplate = useCallback(async file => {
    setError('');
    try {
      const buf = await file.arrayBuffer();
      const t = await readTemplate(buf);
      setTemplate(t);
      setTemplateFile(file.name);
      setDecisions(d => ({
        ...d,
        defaultLocation: d.defaultLocation || t.lists.locations?.[0] || '',
      }));
    } catch (e) {
      setError(`تعذّرت قراءة القالب: ${e.message}`);
      setTemplate(null); setTemplateFile('');
    }
  }, []);

  const loadReference = useCallback(async (file, kind) => {
    setError('');
    try {
      const wbk = await readWorkbook(file);
      const m = detectReferenceMapping(wbk.headers, kind);
      setRefRaw(r => ({ ...r, [kind]: wbk }));
      setRefHeaders(h => ({ ...h, [kind]: wbk.headers }));
      setRefMapping(mm => ({ ...mm, [kind]: { ...mm[kind], ...m } }));
      setReferences(refs => ({ ...refs, [kind]: mapReferenceRecords(wbk.records, m, kind) }));
      kind === 'customers' ? setCustomersFile(file.name) : setProductsFile(file.name);
    } catch (e) {
      setError(`تعذّرت قراءة الملف: ${e.message}`);
    }
  }, []);

  const setRefMappingField = useCallback((kind, field, value) => {
    setRefMapping(prev => {
      const next = { ...prev, [kind]: { ...prev[kind], [field]: value } };
      const raw = refRaw[kind];
      if (raw) setReferences(refs => ({ ...refs, [kind]: mapReferenceRecords(raw.records, next[kind], kind) }));
      return next;
    });
  }, [refRaw]);

  const loadSource = useCallback(async file => {
    setError('');
    try {
      const wbk = await readWorkbook(file);
      setSourceRaw(wbk);
      setSourceHeaders(wbk.headers);
      setSourceMapping(detectMapping(wbk.headers));
      setSourceFile(file.name);
    } catch (e) {
      setError(`تعذّرت قراءة الملف: ${e.message}`);
      setSourceRaw(null); setSourceHeaders(null); setSourceFile('');
    }
  }, []);

  const actions = useMemo(() => ({
    loadTemplate,
    loadReference,
    loadSource,
    setRefMapping: setRefMappingField,
    setSourceMapping: (field, value) => setSourceMapping(m => ({ ...m, [field]: value })),
    decide: (kind, key, value) => setDecisions(d => ({ ...d, [kind]: { ...d[kind], [key]: value } })),
    setDefault: (key, value) => setDecisions(d => ({ ...d, [key]: value })),
    setOption: (key, value) => setOptions(o => ({ ...o, [key]: value })),
    resetDecisions: () => setDecisions({ customers: {}, products: {}, payments: {}, locations: {}, defaultPayment: '', defaultLocation: '' }),
  }), [loadTemplate, loadReference, loadSource, setRefMappingField]);

  const state = {
    template, templateFile, references, refHeaders, refMapping, customersFile, productsFile,
    sourceFile, sourceHeaders, sourceMapping, parsed, decisions, pending, result, options,
  };

  const ready = {
    1: true,
    2: !!template,
    3: !!parsed && !!template,
    4: !!result,
    5: !!result,
  };

  const openCount = pending
    ? pending.customers.filter(p => !decisions.customers?.[p.key]).length
      + pending.products.filter(p => !decisions.products?.[p.key]).length
      + pending.payments.filter(p => !decisions.payments?.[p.key]).length
      + pending.locations.filter(p => !decisions.locations?.[p.key]).length
    : 0;

  return (
    <div className="app">
      <header className="topbar">
        <h1>استيراد فواتير المبيعات</h1>
        <span className="sub">تحويل ملفات العملاء إلى قالب قيود الرسمي</span>
        <span className="spacer" />
        {result && (
          <span className="sub mono">
            {result.summary.invoices} فاتورة · {result.summary.rows} صف
          </span>
        )}
      </header>

      <div className="shell">
        <nav className="sidebar">
          <ol className="steps">
            {STEPS.map(s => (
              <li key={s.id}>
                <button
                  className={`step${step === s.id ? ' active' : ''}${step > s.id && ready[s.id] ? ' done' : ''}`}
                  onClick={() => setStep(s.id)}
                  disabled={!ready[s.id]}
                >
                  <span className="step-num">{s.id}</span>
                  <span>
                    <span className="step-label">{s.label}</span>
                    <span className="step-hint">
                      {s.id === 3 && openCount > 0 ? `${openCount} قرار معلّق` : s.hint}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ol>

          <div style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid var(--line)' }}>
            <button className="btn ghost sm" onClick={actions.resetDecisions}>
              مسح قرارات المطابقة المحفوظة
            </button>
          </div>
        </nav>

        <main className="main">
          {error && (
            <div className="note stop" role="alert">
              {error}
              <button className="btn ghost sm" style={{ marginInlineStart: 10 }} onClick={() => setError('')}>إخفاء</button>
            </div>
          )}

          {step === 1 && <Step1References state={state} actions={actions} />}
          {step === 2 && <Step2Source state={state} actions={actions} />}
          {step === 3 && <Step3Mapping state={state} actions={actions} />}
          {step === 4 && <Step4Validate state={state} actions={actions} />}
          {step === 5 && <Step5Export state={state} actions={actions} />}

          <div className="actions">
            <button className="btn" onClick={() => setStep(s => Math.max(1, s - 1))} disabled={step === 1}>
              السابق
            </button>
            <button
              className="btn primary"
              onClick={() => setStep(s => Math.min(5, s + 1))}
              disabled={step === 5 || !ready[step + 1]}
            >
              التالي
            </button>
          </div>
        </main>
      </div>

      <ReconStrip result={result} stats={parsed?.stats} />
    </div>
  );
}
