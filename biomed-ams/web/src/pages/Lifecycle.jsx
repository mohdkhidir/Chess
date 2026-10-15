import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp, useQuery } from '../lib/api.jsx';
import { Button, Card, DataTable, ErrorBox, Loading, PageHeader, Select } from '../components/ui.jsx';
import { BarChart, Meter, StatTile } from '../components/charts.jsx';
import { LIFE_STATE, compact, money0, num, pct } from '../lib/format.js';
import { catOptions, deptOptions } from '../lib/options.js';
import { exportCsv, exportPdf } from '../lib/exporter.js';

export default function Lifecycle() {
  const { lookups, call, toast, settings } = useApp();
  const [f, setF] = useState({ department_id: '', category_id: '', state: '' });
  const params = { department_id: f.department_id || undefined, category_id: f.category_id || undefined, state: f.state || undefined };
  const { data, error, loading, reload } = useQuery('lifecycle.lifespan', params);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const exportAs = async (kind) => {
    setBusy(true);
    try {
      const r = await call('reports.run', { type: 'LIFESPAN', ...params });
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
        title="Asset lifespan & replacement"
        subtitle={`Age against expected life, book value and a 5-year replacement plan (prices +${settings.inflation_rate}%/yr)`}
        actions={<><Button variant="secondary" icon="download" busy={busy} onClick={() => exportAs('pdf')}>PDF</Button><Button variant="ghost" busy={busy} onClick={() => exportAs('csv')}>CSV</Button></>}
      />
      <div className="toolbar">
        <Select value={f.department_id} onChange={set('department_id')} placeholder="All departments" options={deptOptions(lookups)} aria-label="Department" />
        <Select value={f.category_id} onChange={set('category_id')} placeholder="All categories" options={catOptions(lookups)} aria-label="Category" />
        <Select value={f.state} onChange={set('state')} placeholder="Any life stage" options={Object.entries(LIFE_STATE).map(([k, v]) => [k, v[0]])} aria-label="Life stage" />
      </div>
      <ErrorBox error={error} onRetry={reload} />
      {!data && loading ? (
        <Loading />
      ) : data ? (
        <div className={loading ? 'is-stale' : ''}>
          <div className="grid-stats">
            <StatTile label="Assets in fleet" value={data.summary.assets} sub={`Average age ${num(data.summary.avg_age, 1)} yrs`} />
            <StatTile label="Beyond expected life" value={data.summary.beyond_life} tone={data.summary.beyond_life ? 'critical' : 'good'} onClick={() => setF({ ...f, state: 'BEYOND_LIFE' })} />
            <StatTile label="Near end of life" value={data.summary.near_end} tone={data.summary.near_end ? 'warning' : undefined} sub="≥ 80% of life used" onClick={() => setF({ ...f, state: 'NEAR_END' })} />
            <StatTile label="Purchase value" value={money0(data.summary.purchase_value)} />
            <StatTile label="Book value" value={money0(data.summary.book_value)} sub="Straight-line" />
            <StatTile label="Replacement need (to +5 yrs)" value={money0(data.summary.replacement_5y_cost)} />
          </div>
          <Card className="section-gap" title="Replacement plan" subtitle="Estimated replacement cost by end-of-life year (RM)">
            <BarChart
              labels={data.replacement_plan.map((p) => p.year)}
              series={[{ key: 'cost', label: 'Replacement cost', color: 'var(--s1)', values: data.replacement_plan.map((p) => p.cost) }]}
              format={(v) => `RM ${compact(v)}`}
              yFormat={(v) => compact(v)}
              ariaLabel="Replacement cost by year"
            />
            <DataTable
              columns={[
                { key: 'year', label: 'End-of-life year' },
                { key: 'count', label: 'Assets', align: 'right' },
                { key: 'cost', label: 'Estimated cost', align: 'right', render: (p) => money0(p.cost) },
              ]}
              rows={data.replacement_plan}
              rowKey={(p) => p.year}
            />
          </Card>
          <Card className="section-gap" title="Assets by life used" flush>
            <DataTable
              columns={[
                { key: 'tag_no', label: 'Tag', render: (r) => <Link to={`/assets/${r.id}`} className="mono">{r.tag_no}</Link> },
                { key: 'name', label: 'Equipment' },
                { key: 'department_name', label: 'Department' },
                { key: 'age_years', label: 'Age / life', align: 'right', render: (r) => `${num(r.age_years, 1)} / ${r.lifespan_years} y` },
                { key: 'life_used_pct', label: 'Life used', render: (r) => <div className="risk-bar" style={{ minWidth: 120 }}><Meter value={Math.min(r.life_used_pct, 100)} tone={LIFE_STATE[r.state][1]} label="Life used" /><span className="score">{pct(r.life_used_pct, 0)}</span></div> },
                { key: 'end_of_life_year', label: 'EOL', align: 'right' },
                { key: 'book_value', label: 'Book value', align: 'right', render: (r) => money0(r.book_value) },
                { key: 'maintenance_cost_ratio', label: 'Maint. ratio', align: 'right', render: (r) => (r.maintenance_cost_ratio === null ? '—' : pct(r.maintenance_cost_ratio, 0)) },
                { key: 'replacement_cost', label: 'Replace est.', align: 'right', render: (r) => money0(r.replacement_cost) },
              ]}
              rows={data.rows.slice(0, 300)}
              empty="No assets"
            />
            {data.rows.length > 300 ? <p className="pad muted small">Showing 300 of {data.rows.length}. Export for the full list.</p> : null}
          </Card>
        </div>
      ) : null}
    </>
  );
}
