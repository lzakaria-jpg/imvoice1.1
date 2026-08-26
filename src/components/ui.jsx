import React, { useRef, useState } from 'react';

export function FileDrop({ label, hint, accept, file, onFile, disabled }) {
  const ref = useRef(null);
  const [over, setOver] = useState(false);

  const pick = files => { if (files && files[0]) onFile(files[0]); };

  return (
    <div
      className={`drop${over ? ' over' : ''}${file ? ' filled' : ''}`}
      onClick={() => !disabled && ref.current?.click()}
      onDragOver={e => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={e => { e.preventDefault(); setOver(false); if (!disabled) pick(e.dataTransfer.files); }}
      role="button" tabIndex={0}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); ref.current?.click(); } }}
    >
      <input ref={ref} type="file" accept={accept} onChange={e => pick(e.target.files)} />
      <div className="drop-title">{file ? `✓ ${file}` : label}</div>
      <div className="drop-hint">{file ? 'اضغط لاستبدال الملف' : hint}</div>
    </div>
  );
}

export function Stat({ k, v, tone }) {
  return (
    <div className="stat">
      <div className="stat-k">{k}</div>
      <div className={`stat-v${tone ? ' ' + tone : ''}`}>{v}</div>
    </div>
  );
}

export function Badge({ tone, children }) {
  return <span className={`badge${tone ? ' ' + tone : ''}`}>{children}</span>;
}

export function Note({ tone, children }) {
  return <div className={`note${tone ? ' ' + tone : ''}`}>{children}</div>;
}

export function Card({ title, aside, children, tight }) {
  return (
    <section className="card">
      {(title || aside) && (
        <header className="card-head">
          {title && <h2>{title}</h2>}
          <span className="spacer" />
          {aside}
        </header>
      )}
      <div className={`card-body${tight ? ' tight' : ''}`}>{children}</div>
    </section>
  );
}

export function ColumnSelect({ value, options, onChange, allowEmpty = true }) {
  return (
    <select
      className={value ? 'set' : 'unset'}
      value={value || ''}
      onChange={e => onChange(e.target.value)}
    >
      {allowEmpty && <option value="">— اختر عموداً —</option>}
      {options.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

/** رقم منسّق بفواصل وخانتين — كل الأرقام في الواجهة تمر من هنا */
export function n(v, d = 2) {
  if (v === null || v === undefined || v === '' || Number.isNaN(Number(v))) return '—';
  return Number(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}

export function i(v) {
  if (v === null || v === undefined || v === '') return '—';
  return Number(v).toLocaleString('en-US');
}
