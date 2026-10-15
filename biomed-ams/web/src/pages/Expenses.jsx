import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp, useQuery } from '../lib/api.jsx';
import { Button, Card, DataTable, ErrorBox, Loading, PageHeader, Segmented } from '../components/ui.jsx';
import { BarChart, StatTile } from '../components/charts.jsx';
import { PeriodFilters, cleanParams } from '../components/Filters.jsx';
import { PERIODS, compact, date, money, money0, monthLabel, pct } from '../lib/format.js';
import { exportCsv, exportPdf } from '../lib/exporter.js';

export default function Expenses() {
  const { call, toast } = useApp();
  const [f, setF] = useState({ period: 'last_12_months', department_id: '', category_id: '' });
  const [group, setGroup] = useState('department');
  const valid = f.period !== 'custom' || (f.from && f.to);
  const params = { ...cleanParams(f), group_by: group };
  const { data, error, loading, reload } = useQuery('lifecycle.expenses', params, { enabled: valid });
  const monthly = useQuery('lifecycle.expenses', { ...cleanParams(f), group_by: 'month' }, { enabled: valid });
  const [busy, setBusy] = useState(false);

  const exportAs = async (kind) => {
    setBusy(true);
    try {
      const r = await call('reports.run', { type: 'EXPENSES', ...params });
      if (kind === 'pdf') await exportPdf(r);
      else await exportCsv(r);
    } catch (e) {
      toast(e.message, 'critical');
    } finally {
      setBusy(false);
    }
  };

  const m = monthly.data;
  return (
    <>
      <PageHeader
        title="Maintenance expenses"
        subtitle={data ? `${date(data.period.from)} – ${date(data.period.to)}` : 'Corrective and preventive maintenance spend'}
        actions={<><Button variant="secondary" icon="download" busy={busy} onClick={() => exportAs('pdf')}>PDF</Button><Button variant="ghost" busy={busy} onClick={() => exportAs('csv')}>CSV</Button></>}
      />
      <PeriodFilters value={f} onChange={setF} category periods={PERIODS} />
      <ErrorBox error={error} onRetry={reload} />
      {!data && loading ? (
        <Loading />
      ) : data ? (
        <div className={loading ? 'is-stale' : ''}>
          <div className="grid-stats">
            <StatTile label="Total spend" value={money0(data.summary.total)} sub={`${data.summary.jobs} jobs`} />
            <StatTile label="Corrective (CM)" value={money0(data.summary.cm)} />
            <StatTile label="Preventive (PPM)" value={money0(data.summary.ppm)} />
            <StatTile label="Spare parts" value={money0(data.summary.parts)} />
            <StatTile label="Labour + vendor" value={money0(data.summary.labour + data.summary.vendor)} />
            <StatTile label="Cost of service ratio" value={pct(data.summary.cost_of_service_ratio, 2)} sub="Annual spend ÷ fleet value" />
          </div>
          {m ? (
            <Card className="section-gap" title="Monthly spend" subtitle="Corrective vs preventive (RM)">
              <BarChart
                stacked
                labels={m.rows.map((r) => monthLabel(r.group))}
                series={[
                  { key: 'cm', label: 'Corrective', color: 'var(--s1)', values: m.rows.map((r) => r.cm) },
                  { key: 'ppm', label: 'Preventive', color: 'var(--s2)', values: m.rows.map((r) => r.ppm) },
                ]}
                format={(v) => `RM ${compact(v)}`}
                ariaLabel="Monthly maintenance spend"
              />
            </Card>
          ) : null}
          <Card className="section-gap" title="Breakdown" actions={<Segmented value={group} onChange={setGroup} options={[['department', 'Department'], ['category', 'Category'], ['asset', 'Asset'], ['month', 'Month']]} ariaLabel="Group by" />} flush>
            <DataTable
              columns={[
                { key: 'group', label: group[0].toUpperCase() + group.slice(1), render: (r) => (group === 'month' ? monthLabel(r.group) : r.group) },
                { key: 'jobs', label: 'Jobs', align: 'right' },
                { key: 'cm', label: 'Corrective', align: 'right', render: (r) => money(r.cm) },
                { key: 'ppm', label: 'Preventive', align: 'right', render: (r) => money(r.ppm) },
                { key: 'parts', label: 'Parts', align: 'right', render: (r) => money(r.parts) },
                { key: 'labour', label: 'Labour', align: 'right', render: (r) => money(r.labour) },
                { key: 'vendor', label: 'Vendor', align: 'right', render: (r) => money(r.vendor) },
                { key: 'total', label: 'Total', align: 'right', render: (r) => <strong>{money(r.total)}</strong> },
              ]}
              rows={data.rows}
              rowKey={(r) => r.group}
              empty="No maintenance spending recorded in this period"
            />
          </Card>
          <Card className="section-gap" title="Top 10 costliest assets" flush>
            <DataTable
              columns={[
                { key: 'tag_no', label: 'Tag', render: (r) => <Link to={`/assets/${r.id}`} className="mono">{r.tag_no}</Link> },
                { key: 'name', label: 'Equipment' },
                { key: 'department_name', label: 'Department' },
                { key: 'total', label: 'Spend', align: 'right', render: (r) => money(r.total) },
                { key: 'purchase_cost', label: '% of price', align: 'right', render: (r) => (r.purchase_cost ? pct((r.total / r.purchase_cost) * 100, 0) : '—') },
              ]}
              rows={data.top_assets}
              empty="No spending yet"
            />
          </Card>
        </div>
      ) : null}
    </>
  );
}
