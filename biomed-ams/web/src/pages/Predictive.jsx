import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useApp, useQuery } from '../lib/api.jsx';
import { ActionDialog, Button, Card, Empty, ErrorBox, Loading, PageHeader, Pager, Select, StatusBadge } from '../components/ui.jsx';
import { Meter, StatTile } from '../components/charts.jsx';
import { RISK_LEVEL, date, num, pct } from '../lib/format.js';
import { catOptions, deptOptions } from '../lib/options.js';
import { exportCsv, exportPdf } from '../lib/exporter.js';

const PAGE = 25;

export default function Predictive() {
  const { lookups, can, call, toast, settings, refreshBadges } = useApp();
  const nav = useNavigate();
  const [f, setF] = useState({ department_id: '', category_id: '', horizon_days: String(settings.pdm_horizon_days), level: '' });
  const [page, setPage] = useState(1);
  const [gen, setGen] = useState(false);
  const [busy, setBusy] = useState(false);
  const params = { department_id: f.department_id || undefined, category_id: f.category_id || undefined, horizon_days: Number(f.horizon_days) };
  const { data, error, loading, reload } = useQuery('predictive.list', params);
  const rows = useMemo(() => (data ? data.rows.filter((r) => !f.level || r.level === f.level) : []), [data, f.level]);
  const set = (k) => (e) => {
    setF({ ...f, [k]: e.target.value });
    setPage(1);
  };

  const exportAs = async (kind) => {
    setBusy(true);
    try {
      const r = await call('reports.run', { type: 'PREDICTIVE', ...params });
      if (kind === 'pdf') await exportPdf(r);
      else await exportCsv(r);
    } catch (e) {
      toast(e.message, 'critical');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Predictive maintenance"
        subtitle="Which equipment is most likely to break down next, and what to do about it"
        actions={
          <>
            {can('predictive.generate') ? <Button icon="bolt" onClick={() => setGen(true)}>Generate inspections</Button> : null}
            <Button variant="secondary" icon="download" busy={busy} onClick={() => exportAs('pdf')}>PDF</Button>
            <Button variant="ghost" busy={busy} onClick={() => exportAs('csv')}>CSV</Button>
          </>
        }
      />
      <div className="toolbar">
        <Select value={f.horizon_days} onChange={set('horizon_days')} options={[['30', 'Next 30 days'], ['60', 'Next 60 days'], ['90', 'Next 90 days'], ['180', 'Next 6 months'], ['365', 'Next 12 months']]} aria-label="Horizon" />
        <Select value={f.department_id} onChange={set('department_id')} placeholder="All departments" options={deptOptions(lookups)} aria-label="Department" />
        <Select value={f.category_id} onChange={set('category_id')} placeholder="All categories" options={catOptions(lookups)} aria-label="Category" />
        <Select value={f.level} onChange={set('level')} placeholder="All risk levels" options={Object.entries(RISK_LEVEL).map(([k, v]) => [k, v[0]])} aria-label="Risk level" />
      </div>
      <ErrorBox error={error} onRetry={reload} />
      {data ? (
        <div className="grid-stats" style={{ marginBottom: 12 }}>
          {Object.entries(RISK_LEVEL).map(([k, [label, tone]]) => (
            <StatTile key={k} label={`${label} risk`} value={data.levels[k]} tone={data.levels[k] && k !== 'LOW' ? tone : undefined} onClick={() => setF({ ...f, level: f.level === k ? '' : k })} />
          ))}
        </div>
      ) : null}
      <Card flush className={loading && data ? 'is-stale' : ''}>
        {!data && loading ? (
          <Loading label="Analysing maintenance history…" />
        ) : rows.length ? (
          <div className="list">
            {rows.slice((page - 1) * PAGE, page * PAGE).map((r) => (
              <div key={r.id} className="row-link" style={{ alignItems: 'flex-start', cursor: 'pointer' }} onClick={() => nav(`/assets/${r.id}`)} role="link" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && nav(`/assets/${r.id}`)}>
                <div className="row-main">
                  <div className="row-top">
                    <span className="row-title"><span className="mono">{r.tag_no}</span> · {r.name}</span>
                    <StatusBadge map={RISK_LEVEL} value={r.level} />
                  </div>
                  <div className="risk-bar"><Meter value={r.score} tone={RISK_LEVEL[r.level][1]} label={`Risk score ${r.score}`} /><span className="score">{r.score}</span></div>
                  <div className="row-meta">
                    <span>{r.department_name}</span>
                    <span>P(breakdown) {pct(r.probability)}</span>
                    <span>{r.failures_12m} breakdown(s) in 12 m</span>
                    {r.mtbf_days ? <span>MTBF {num(r.mtbf_days)} d</span> : null}
                    {r.predicted_next_failure ? <span>Next est. {date(r.predicted_next_failure)}</span> : null}
                    <span>Life used {pct(r.life_used_pct, 0)}</span>
                    {r.maintenance_cost_ratio !== null ? <span>Cost ratio {pct(r.maintenance_cost_ratio, 0)}</span> : null}
                  </div>
                  {r.recommendations.length ? <ul className="recs">{r.recommendations.slice(0, 3).map((x) => <li key={x}>{x}</li>)}</ul> : null}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <Empty icon="trend" title="No assets to analyse" />
        )}
        {rows.length ? <Pager page={page} pageSize={PAGE} total={rows.length} onPage={setPage} /> : null}
      </Card>

      <Card className="section-gap" title="How the prediction works">
        <ul className="recs">
          <li>Breakdown rate per asset comes from its own corrective work orders, blended with its equipment category so new devices are not assumed perfect.</li>
          <li>The rate is raised when breakdowns are increasing, when the device is past 70% of its expected life, and after failed PPMs.</li>
          <li>Chance of breakdown in the chosen horizon uses a Poisson model. The risk score (0–100) adds clinical criticality, age and maintenance cost.</li>
          <li>This is statistical prediction from maintenance records — no sensors. Treat it as a ranking for planning inspections and budgets, and record every repair so it stays accurate.</li>
        </ul>
        <p className="muted small" style={{ marginTop: 8 }}>
          Generated inspections appear in the <Link to="/ppm?type=PDM&view=ALL">PPM schedule</Link> as predictive (PDM) jobs.
        </p>
      </Card>

      <ActionDialog
        open={gen}
        title="Generate predictive inspections"
        intro="Creates an inspection job for every in-service asset at or above the risk score below that has no open predictive job."
        confirmLabel="Generate"
        fields={[
          { name: 'threshold', label: 'Minimum risk score', type: 'number', required: true, initial: String(settings.pdm_risk_threshold) },
          { name: 'days_ahead', label: 'Schedule inspections in (days)', type: 'number', required: true, initial: '7' },
        ]}
        onSubmit={async (v) => {
          const r = await call('predictive.generate', { ...params, threshold: Number(v.threshold), days_ahead: Number(v.days_ahead) });
          toast(`${r.created.length} inspection(s) scheduled for ${date(r.scheduled_date)}${r.skipped.length ? ` · ${r.skipped.length} skipped (already open or not in service)` : ''}`, 'good');
          refreshBadges();
          reload();
        }}
        onClose={() => setGen(false)}
      />
    </>
  );
}
