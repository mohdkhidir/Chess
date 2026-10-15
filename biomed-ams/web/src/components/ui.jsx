import { Children, cloneElement, isValidElement, useEffect, useId, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Icon } from './icons.jsx';
import { pushBackHandler } from '../lib/platform.js';

export function Button({ variant = 'primary', size, icon, busy, children, className = '', type = 'button', ...rest }) {
  return (
    <button
      type={type}
      className={`btn btn-${variant}${size ? ` btn-${size}` : ''}${busy ? ' is-busy' : ''} ${className}`}
      disabled={busy || rest.disabled}
      {...rest}
    >
      {busy ? <span className="spinner sm" aria-hidden="true" /> : icon ? <Icon name={icon} size={18} /> : null}
      {children ? <span>{children}</span> : null}
    </button>
  );
}

export function LinkButton({ to, variant = 'secondary', icon, children, className = '' }) {
  return (
    <Link to={to} className={`btn btn-${variant} ${className}`}>
      {icon ? <Icon name={icon} size={18} /> : null}
      {children ? <span>{children}</span> : null}
    </Link>
  );
}

export function IconButton({ icon, label, onClick, className = '', badge, ...rest }) {
  return (
    <button type="button" className={`icon-btn ${className}`} aria-label={label} title={label} onClick={onClick} {...rest}>
      <Icon name={icon} size={22} />
      {badge ? <span className="dot-badge">{badge > 99 ? '99+' : badge}</span> : null}
    </button>
  );
}

export function Card({ title, subtitle, actions, children, className = '', flush }) {
  return (
    <section className={`card ${flush ? 'card-flush' : ''} ${className}`}>
      {title || actions ? (
        <header className="card-head">
          <div>
            {title ? <h2 className="card-title">{title}</h2> : null}
            {subtitle ? <p className="card-sub">{subtitle}</p> : null}
          </div>
          {actions ? <div className="card-actions">{actions}</div> : null}
        </header>
      ) : null}
      {children}
    </section>
  );
}

export function Badge({ tone = 'neutral', children, title }) {
  return (
    <span className={`badge tone-${tone}`} title={title}>
      <span className="badge-dot" aria-hidden="true" />
      {children}
    </span>
  );
}

export function StatusBadge({ map, value }) {
  if (!value) return null;
  const [label, tone] = map[value] || [value, 'neutral'];
  return <Badge tone={tone}>{label}</Badge>;
}

export function Field({ label, hint, error, required, children, className = '' }) {
  const id = useId();
  const kids = Children.toArray(children);
  const first = kids[0];
  const body = isValidElement(first) && !first.props.id ? [cloneElement(first, { id }), ...kids.slice(1)] : kids;
  return (
    <div className={`field ${className}`}>
      {label ? (
        <label className="field-label" htmlFor={id}>
          {label}
          {required ? <span className="req" aria-hidden="true"> *</span> : null}
        </label>
      ) : null}
      {body}
      {hint ? <p className="field-hint">{hint}</p> : null}
      {error ? <p className="field-error">{error}</p> : null}
    </div>
  );
}

export function Input(props) {
  return <input className="input" {...props} />;
}

export function Textarea(props) {
  return <textarea className="input textarea" rows={props.rows || 3} {...props} />;
}

export function Select({ options, placeholder, value, onChange, ...rest }) {
  return (
    <select className="input select" value={value ?? ''} onChange={onChange} {...rest}>
      {placeholder !== undefined ? <option value="">{placeholder}</option> : null}
      {options.map((o) => {
        const [v, l] = Array.isArray(o) ? o : [o, o];
        return (
          <option key={String(v)} value={v}>
            {l}
          </option>
        );
      })}
    </select>
  );
}

export function Toggle({ checked, onChange, label, hint }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={!!checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="toggle-track" aria-hidden="true" />
      <span className="toggle-text">
        {label}
        {hint ? <small>{hint}</small> : null}
      </span>
    </label>
  );
}

export function Segmented({ options, value, onChange, ariaLabel }) {
  return (
    <div className="segmented" role="tablist" aria-label={ariaLabel}>
      {options.map(([v, l, count]) => (
        <button
          key={v}
          type="button"
          role="tab"
          aria-selected={value === v}
          className={value === v ? 'is-on' : ''}
          onClick={() => onChange(v)}
        >
          {l}
          {count ? <span className="seg-count">{count}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function Modal({ open, title, onClose, children, footer, wide }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const pop = pushBackHandler(onClose);
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    document.body.classList.add('modal-open');
    const t = setTimeout(() => ref.current?.querySelector('input, select, textarea, button')?.focus(), 30);
    return () => {
      pop();
      clearTimeout(t);
      document.removeEventListener('keydown', onKey);
      document.body.classList.remove('modal-open');
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <header className="modal-head">
          <h2>{title}</h2>
          <IconButton icon="x" label="Close" onClick={onClose} />
        </header>
        <div className="modal-body">{children}</div>
        {footer ? <footer className="modal-foot">{footer}</footer> : null}
      </div>
    </div>
  );
}

/**
 * A small form in a dialog, used for actions that need a reason, a date or a choice.
 * fields: [{ name, label, type: 'text'|'textarea'|'date'|'datetime-local'|'number'|'select', options, required, hint, initial }]
 */
export function ActionDialog({ open, title, intro, fields = [], confirmLabel = 'Confirm', tone = 'primary', onSubmit, onClose }) {
  const [values, setValues] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  useEffect(() => {
    if (open) {
      setValues(Object.fromEntries(fields.map((f) => [f.name, f.initial ?? ''])));
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const submit = async (e) => {
    e.preventDefault();
    for (const f of fields) {
      if (f.required && (values[f.name] === '' || values[f.name] === undefined)) {
        setError(`${f.label} is required`);
        return;
      }
    }
    setBusy(true);
    setError(null);
    try {
      await onSubmit(values);
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={open}
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant={tone} type="submit" form="action-dialog" busy={busy}>{confirmLabel}</Button>
        </>
      }
    >
      <form id="action-dialog" onSubmit={submit} className="stack">
        {intro ? <p className="muted">{intro}</p> : null}
        {fields.map((f) => (
          <Field key={f.name} label={f.label} hint={f.hint} required={f.required}>
            {f.type === 'textarea' ? (
              <Textarea value={values[f.name] ?? ''} onChange={(e) => setValues({ ...values, [f.name]: e.target.value })} />
            ) : f.type === 'select' ? (
              <Select options={f.options} placeholder={f.placeholder} value={values[f.name]} onChange={(e) => setValues({ ...values, [f.name]: e.target.value })} />
            ) : (
              <Input
                type={f.type || 'text'}
                inputMode={f.type === 'number' ? 'decimal' : undefined}
                step={f.type === 'number' ? 'any' : undefined}
                value={values[f.name] ?? ''}
                onChange={(e) => setValues({ ...values, [f.name]: e.target.value })}
              />
            )}
          </Field>
        ))}
        {error ? <p className="form-error" role="alert">{error}</p> : null}
      </form>
    </Modal>
  );
}

export function Empty({ icon = 'info', title, children, action }) {
  return (
    <div className="empty">
      <Icon name={icon} size={28} />
      <p className="empty-title">{title}</p>
      {children ? <p className="muted">{children}</p> : null}
      {action}
    </div>
  );
}

export function Loading({ label = 'Loading…' }) {
  return (
    <div className="loading" role="status">
      <span className="spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

export function ErrorBox({ error, onRetry }) {
  if (!error) return null;
  return (
    <div className="error-box" role="alert">
      <Icon name="alert" />
      <span>{error.message || String(error)}</span>
      {onRetry ? <Button variant="ghost" size="sm" onClick={onRetry}>Retry</Button> : null}
    </div>
  );
}

export function Pager({ page, pageSize, total, onPage }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return <p className="pager muted">{total} record{total === 1 ? '' : 's'}</p>;
  return (
    <div className="pager">
      <IconButton icon="left" label="Previous page" disabled={page <= 1} onClick={() => onPage(page - 1)} />
      <span>
        Page {page} of {pages} · {total} records
      </span>
      <IconButton icon="right" label="Next page" disabled={page >= pages} onClick={() => onPage(page + 1)} />
    </div>
  );
}

export function KV({ items }) {
  return (
    <dl className="kv">
      {items.filter(Boolean).map(([k, v]) => (
        <div key={k} className="kv-row">
          <dt>{k}</dt>
          <dd>{v === null || v === undefined || v === '' ? '—' : v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function SearchBox({ value, onChange, placeholder = 'Search…' }) {
  return (
    <div className="search">
      <Icon name="search" size={18} />
      <input
        className="input"
        type="search"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        aria-label={placeholder}
      />
    </div>
  );
}

export function PageHeader({ title, subtitle, actions, back }) {
  const nav = useNavigate();
  return (
    <div className="page-head">
      <div className="page-head-main">
        {back ? <IconButton icon="left" label="Back" className="back-btn" onClick={() => (window.history.length > 1 ? nav(-1) : nav(back))} /> : null}
        <div>
          <h1>{title}</h1>
          {subtitle ? <p className="muted">{subtitle}</p> : null}
        </div>
      </div>
      {actions ? <div className="page-actions">{actions}</div> : null}
    </div>
  );
}

export function Toolbar({ children }) {
  return <div className="toolbar">{children}</div>;
}

export function RowLink({ to, children, className = '' }) {
  return (
    <Link to={to} className={`row-link ${className}`}>
      <div className="row-main">{children}</div>
      <Icon name="right" size={18} className="row-chevron" />
    </Link>
  );
}

export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.filter(Boolean).map(([k, l, n]) => (
        <button key={k} type="button" role="tab" aria-selected={value === k} className={value === k ? 'is-on' : ''} onClick={() => onChange(k)}>
          {l}
          {n ? <span className="tab-count">{n}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function Toasts({ toasts }) {
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast tone-${t.tone}`}>
          <Icon name={t.tone === 'critical' ? 'alert' : t.tone === 'good' ? 'checkCircle' : 'info'} size={18} />
          <span>{t.message}</span>
        </div>
      ))}
    </div>
  );
}

export function DataTable({ columns, rows, empty = 'No records', rowKey = (r, i) => r.id ?? i, onRow }) {
  if (!rows.length) return <p className="muted pad">{empty}</p>;
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} className={c.align ? `al-${c.align}` : ''}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={rowKey(r, i)} onClick={onRow ? () => onRow(r) : undefined} className={onRow ? 'clickable' : ''}>
              {columns.map((c) => (
                <td key={c.key} className={c.align ? `al-${c.align}` : ''}>
                  {c.render ? c.render(r) : r[c.key] ?? '—'}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
