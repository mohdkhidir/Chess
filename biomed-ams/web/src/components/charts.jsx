// Small SVG chart kit: thin marks, hairline grid, crosshair/tooltip hover, legend for 2+ series.
// Colours come from CSS tokens (see styles.css) so light and dark themes each use validated steps.
import { useEffect, useMemo, useRef, useState } from 'react';

function useWidth() {
  const ref = useRef(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    setW(el.clientWidth);
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver((entries) => setW(Math.floor(entries[0].contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

function niceMax(v) {
  if (!v || v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return step * p;
}

const compactTick = (v) => {
  const a = Math.abs(v);
  if (a >= 1e6) return `${+(v / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${+(v / 1e3).toFixed(a >= 1e4 ? 0 : 1)}K`;
  return `${+v.toFixed(1)}`;
};

export function Legend({ items, kind = 'line' }) {
  return (
    <ul className="legend">
      {items.map((s) => (
        <li key={s.key}>
          <span className={`legend-key ${kind}`} style={{ background: s.color }} aria-hidden="true" />
          {s.label}
        </li>
      ))}
    </ul>
  );
}

function Tooltip({ x, y, width, title, rows, format }) {
  const left = Math.min(Math.max(x + 12, 4), Math.max(4, width - 184));
  return (
    <div className="chart-tip" style={{ left, top: Math.max(0, y - 8) }} role="status">
      <div className="chart-tip-title">{title}</div>
      {rows.map((r) => (
        <div className="chart-tip-row" key={r.key}>
          <span className="tip-key" style={{ background: r.color }} aria-hidden="true" />
          <strong>{r.value === null || r.value === undefined ? '—' : format(r.value)}</strong>
          <span>{r.label}</span>
        </div>
      ))}
    </div>
  );
}

/** Multi-series line chart on one shared y-axis. */
export function LineChart({ labels, series, height = 220, yMax, yMin = 0, unit = '', target, format, ariaLabel }) {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState(null);
  const fmt = format || ((v) => `${+Number(v).toFixed(1)}${unit}`);
  const pad = { l: 40, r: 14, t: 14, b: 26 };
  const w = Math.max(width, 240);
  const innerW = w - pad.l - pad.r;
  const innerH = height - pad.t - pad.b;
  const max = useMemo(() => {
    if (yMax !== undefined) return yMax;
    const all = series.flatMap((s) => s.values).filter((v) => v !== null && v !== undefined);
    return niceMax(Math.max(target?.value || 0, ...all, 1));
  }, [series, yMax, target]);
  const n = labels.length;
  const x = (i) => pad.l + (n <= 1 ? innerW / 2 : (innerW * i) / (n - 1));
  const y = (v) => pad.t + innerH - ((v - yMin) / (max - yMin)) * innerH;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => yMin + (max - yMin) * f);
  const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(innerW / 56))));

  const paths = series.map((s) => {
    let d = '';
    let pen = false;
    s.values.forEach((v, i) => {
      if (v === null || v === undefined) {
        pen = false;
        return;
      }
      d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
      pen = true;
    });
    return d;
  });

  const pick = (clientX) => {
    const r = ref.current.getBoundingClientRect();
    const px = clientX - r.left;
    const i = Math.round(((px - pad.l) / innerW) * (n - 1));
    return Math.min(n - 1, Math.max(0, i));
  };

  return (
    <div className="chart" ref={ref}>
      {series.length > 1 ? <Legend items={series} /> : null}
      <svg width={w} height={height} role="img" aria-label={ariaLabel || 'Line chart'}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={w - pad.r} y1={y(t)} y2={y(t)} className="grid" />
            <text x={pad.l - 6} y={y(t) + 4} className="axis" textAnchor="end">{compactTick(t)}{unit === '%' ? '' : ''}</text>
          </g>
        ))}
        {labels.map((l, i) => (i % every === 0 || i === n - 1 ? (
          <text key={l} x={x(i)} y={height - 8} className="axis" textAnchor={n > 1 && i === 0 ? 'start' : n > 1 && i === n - 1 ? 'end' : 'middle'}>{l}</text>
        ) : null))}
        {target ? (
          <g>
            <line x1={pad.l} x2={w - pad.r} y1={y(target.value)} y2={y(target.value)} className="target-line" />
            <text x={w - pad.r} y={y(target.value) - 5} className="axis target-label" textAnchor="end">{target.label}</text>
          </g>
        ) : null}
        {series.map((s, si) => (
          <path key={s.key} d={paths[si]} fill="none" style={{ stroke: s.color }} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        ))}
        {series.map((s) => {
          const last = s.values.reduce((acc, v, i) => (v !== null && v !== undefined ? i : acc), -1);
          return last >= 0 ? <circle key={s.key} cx={x(last)} cy={y(s.values[last])} r="4" style={{ fill: s.color }} className="dot" /> : null;
        })}
        {hover !== null ? (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={pad.t + innerH} className="crosshair" />
            {series.map((s) => (s.values[hover] === null || s.values[hover] === undefined ? null : (
              <circle key={s.key} cx={x(hover)} cy={y(s.values[hover])} r="4.5" style={{ fill: s.color }} className="dot" />
            )))}
          </g>
        ) : null}
        <rect
          x={pad.l - 10}
          y={0}
          width={innerW + 20}
          height={height}
          fill="transparent"
          tabIndex={0}
          aria-label="Chart data — use left and right arrow keys"
          onPointerMove={(e) => setHover(pick(e.clientX))}
          onPointerDown={(e) => setHover(pick(e.clientX))}
          onPointerLeave={() => setHover(null)}
          onFocus={() => setHover(n - 1)}
          onBlur={() => setHover(null)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft') setHover((h) => Math.max(0, (h ?? n - 1) - 1));
            if (e.key === 'ArrowRight') setHover((h) => Math.min(n - 1, (h ?? 0) + 1));
          }}
        />
      </svg>
      {hover !== null ? (
        <Tooltip
          x={x(hover)}
          y={pad.t}
          width={w}
          title={labels[hover]}
          rows={series.map((s) => ({ key: s.key, label: s.label, color: s.color, value: s.values[hover] }))}
          format={fmt}
        />
      ) : null}
    </div>
  );
}

// Column with a 4px rounded data end and a square baseline.
function column(x, y, w, h, round) {
  if (h <= 0) return '';
  const r = Math.min(round ? 4 : 0, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

/** Grouped or stacked columns. */
export function BarChart({ labels, series, height = 220, stacked = false, format, yFormat, ariaLabel, tone }) {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState(null);
  const fmt = format || ((v) => compactTick(v));
  const pad = { l: 44, r: 10, t: 12, b: 26 };
  const w = Math.max(width, 240);
  const innerW = w - pad.l - pad.r;
  const innerH = height - pad.t - pad.b;
  const n = labels.length;
  const totals = labels.map((_, i) => (stacked ? series.reduce((s, x) => s + (x.values[i] || 0), 0) : Math.max(0, ...series.map((x) => x.values[i] || 0))));
  const max = niceMax(Math.max(...totals, 1));
  const band = innerW / Math.max(n, 1);
  const groupW = stacked ? Math.min(24, band * 0.6) : Math.min(24 * series.length + 2 * (series.length - 1), band * 0.75);
  const barW = stacked ? groupW : (groupW - 2 * (series.length - 1)) / series.length;
  const y = (v) => pad.t + innerH - (v / max) * innerH;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => max * f);
  const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(innerW / 48))));
  const pick = (clientX) => {
    const r = ref.current.getBoundingClientRect();
    return Math.min(n - 1, Math.max(0, Math.floor((clientX - r.left - pad.l) / band)));
  };

  return (
    <div className="chart" ref={ref}>
      {series.length > 1 ? <Legend items={series} kind="rect" /> : null}
      <svg width={w} height={height} role="img" aria-label={ariaLabel || 'Bar chart'}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={w - pad.r} y1={y(t)} y2={y(t)} className="grid" />
            <text x={pad.l - 6} y={y(t) + 4} className="axis" textAnchor="end">{yFormat ? yFormat(t) : compactTick(t)}</text>
          </g>
        ))}
        {hover !== null ? <rect x={pad.l + band * hover} y={pad.t} width={band} height={innerH} className="band-hover" /> : null}
        {labels.map((l, i) => {
          const cx = pad.l + band * i + band / 2;
          let acc = 0;
          return (
            <g key={l}>
              {series.map((s, si) => {
                const v = s.values[i] || 0;
                if (stacked) {
                  const top = si === series.length - 1 || series.slice(si + 1).every((x) => !(x.values[i] > 0));
                  const y0 = y(acc);
                  acc += v;
                  const y1 = y(acc);
                  const h = Math.max(0, y0 - y1 - (acc > v && v > 0 ? 2 : 0));
                  return v > 0 ? <path key={s.key} d={column(cx - barW / 2, y1, barW, h, top)} style={{ fill: s.color }} /> : null;
                }
                const bx = cx - groupW / 2 + si * (barW + 2);
                return v > 0 ? <path key={s.key} d={column(bx, y(v), barW, y(0) - y(v), true)} style={{ fill: tone ? tone(v, i) : s.color }} /> : null;
              })}
              {i % every === 0 || i === n - 1 ? <text x={cx} y={height - 8} className="axis" textAnchor="middle">{l}</text> : null}
            </g>
          );
        })}
        <line x1={pad.l} x2={w - pad.r} y1={y(0)} y2={y(0)} className="baseline" />
        <rect
          x={pad.l}
          y={0}
          width={innerW}
          height={height}
          fill="transparent"
          tabIndex={0}
          aria-label="Chart data — use left and right arrow keys"
          onPointerMove={(e) => setHover(pick(e.clientX))}
          onPointerDown={(e) => setHover(pick(e.clientX))}
          onPointerLeave={() => setHover(null)}
          onFocus={() => setHover(0)}
          onBlur={() => setHover(null)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft') setHover((h) => Math.max(0, (h ?? 0) - 1));
            if (e.key === 'ArrowRight') setHover((h) => Math.min(n - 1, (h ?? -1) + 1));
          }}
        />
      </svg>
      {hover !== null ? (
        <Tooltip
          x={pad.l + band * hover + band / 2}
          y={pad.t}
          width={w}
          title={labels[hover]}
          rows={[
            ...series.map((s) => ({ key: s.key, label: s.label, color: s.color, value: s.values[hover] ?? 0 })),
            ...(stacked && series.length > 1 ? [{ key: '__t', label: 'Total', color: 'transparent', value: totals[hover] }] : []),
          ]}
          format={fmt}
        />
      ) : null}
    </div>
  );
}

export function statusTone(value, target, higherIsBetter = true) {
  if (value === null || value === undefined || target === null || target === undefined) return 'neutral';
  const gap = higherIsBetter ? target - value : value - target;
  if (gap <= 0) return 'good';
  if (gap <= 5) return 'warning';
  return 'critical';
}

/** Progress meter against a target; the fill carries severity, the track is a lighter step. */
export function Meter({ value, target, max = 100, label, tone: forced }) {
  const tone = forced || statusTone(value, target);
  const pctW = value === null || value === undefined ? 0 : Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className={`meter tone-${tone}`} role="meter" aria-valuemin={0} aria-valuemax={max} aria-valuenow={value ?? 0} aria-label={label}>
      <div className="meter-fill" style={{ width: `${pctW}%` }} />
      {target !== undefined && target !== null ? <div className="meter-target" style={{ left: `${(target / max) * 100}%` }} title={`Target ${target}`} /> : null}
    </div>
  );
}

/** KPI tile: label, value, target and a meter. */
export function KpiTile({ label, value, unit = '%', target, hint, to }) {
  const tone = statusTone(value, target);
  const text = value === null || value === undefined ? '—' : `${+Number(value).toFixed(1)}${unit}`;
  const statusText = value === null || value === undefined ? 'No data yet' : tone === 'good' ? 'Target met' : 'Below target';
  const body = (
    <>
      <span className="kpi-label">{label}</span>
      <span className="kpi-value">{text}</span>
      <Meter value={value} target={target} label={label} />
      <span className="kpi-foot">
        {target !== undefined && target !== null ? (
          <>
            <span className={`status-chip tone-${tone}`}>
              <span className="badge-dot" aria-hidden="true" />
              {statusText}
            </span>
            <span className="muted">Target {target}{unit}</span>
          </>
        ) : null}
      </span>
      {hint ? <span className="kpi-hint">{hint}</span> : null}
    </>
  );
  return to ? <a className="kpi-tile" href={to}>{body}</a> : <div className="kpi-tile">{body}</div>;
}

export function StatTile({ label, value, sub, tone, icon, onClick }) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag className={`stat-tile ${tone ? `tone-${tone}` : ''}`} onClick={onClick} type={onClick ? 'button' : undefined}>
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      {sub ? <span className="stat-sub">{sub}</span> : null}
      {icon}
    </Tag>
  );
}
