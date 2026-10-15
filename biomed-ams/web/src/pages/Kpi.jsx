import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp, useQuery } from '../lib/api.jsx';
import { Button, Card, DataTable, ErrorBox, Loading, PageHeader } from '../components/ui.jsx';
import { BarChart, KpiTile, LineChart, StatTile } from '../components/charts.jsx';
import { PeriodFilters, cleanParams } from '../components/Filters.jsx';
import { date, hours, monthLabel, money0, num, pct } from '../lib/format.js';
import { exportPdf } from '../lib/exporter.js';

export default function Kpi() {
  const { call, toast } = useApp();
  const [f, setF] = useState({ period: 'this_month', department_id: '' });
  const params = cleanParams(f);
  const valid = f.period !== 'custom' || (f.from && f.to);
  const k = useQuery('kpi.summary', params, { enabled: valid });
  const trend = useQuery('kpi.trend', { department_id: f.department_id || undefined, months: 12 });
  const depts = useQuery('kpi.departments', params, { enabled: valid && !f.department_id });
  const [busy, setBusy] = useState(false);

  const pdf = async () => {
    setBusy(true);
    try {
      await exportPdf(await call('reports.run', { type: 'KPI_SUMMARY', ...params }));
    } catch (e) {
      toast(e.message, 'critical');
    } finally {
      setBusy(false);
    }
  };

  const d = k.data;
  const t = trend.data;
  return (
    <>
      <PageHeader
        title="Key performance indicators"
        subtitle={d ? `${date(d.period.from)} – ${date(d.period.to)}` : 'Work order closure, PPM completion and uptime'}
        actions={<Button variant="secondary" icon="download" busy={busy} onClick={pdf}>KPI report (PDF)</Button>}
      />
      <PeriodFilters value={f} onChange={setF} />
      <ErrorBox error={k.error} onRetry={k.reload} />
      {!d && k.loading ? (
        <Loading />
      ) : d ? (
        <div className={k.loading ? 'is-stale' : ''}>
          <div className="grid-3">
            <KpiTile label="PPM completion" value={d.ppm.completion_rate} target={d.targets.ppm} hint={`${d.ppm.completed} of ${d.ppm.completed + d.ppm.overdue} due · ${d.ppm.pending} not yet due`} />
            <KpiTile label="Work order closure" value={d.cm.closure_rate} target={d.targets.cm_closure} hint={`${d.cm.closed} of ${d.cm.raised} raised in period`} />
            <KpiTile label="Equipment uptime" value={d.uptime.value} target={d.targets.uptime} hint={`${num(d.uptime.downtime_hours)} h downtime`} />
            <KpiTile label="PPM done on time" value={d.ppm.on_time_rate} target={d.targets.ppm} hint={`${d.ppm.late} completed late`} />
            <KpiTile label="WO closed within repair target" value={d.cm.on_time_closure_rate} target={d.targets.cm_closure} hint={`Targets: ${Object.entries(d.targets.repair_target_days).map(([p, v]) => `${p} ${v}d`).join(' · ')}`} />
            <KpiTile label="Response within target" value={d.cm.response_within_target_rate} hint={`Targets: ${Object.entries(d.targets.response_target_hours).map(([p, v]) => `${p} ${v}h`).join(' · ')}`} />
          </div>
          <div className="grid-stats section-gap">
            <StatTile label="Avg response" value={hours(d.cm.avg_response_hours)} />
            <StatTile label="Avg turnaround" value={hours(d.cm.avg_turnaround_hours)} />
            <StatTile label="Open backlog" value={d.cm.backlog} tone={d.cm.backlog ? 'warning' : undefined} />
            <StatTile label="PPM overdue" value={d.ppm.overdue} tone={d.ppm.overdue ? 'critical' : 'good'} />
            <StatTile label="CM cost" value={money0(d.cm.total_cost)} />
            <StatTile label="Satisfaction" value={d.tickets.satisfaction ? `${d.tickets.satisfaction} / 5` : '—'} sub={`${d.tickets.rated} rating(s)`} />
          </div>
        </div>
      ) : null}

      {t ? (
        <div className="grid-2 section-gap">
          <Card title="12-month trend" subtitle="Monthly PPM completion, WO closure and uptime (%)">
            <LineChart
              labels={t.months.map((m) => monthLabel(m.month))}
              series={[
                { key: 'ppm', label: 'PPM completion', color: 'var(--s1)', values: t.months.map((m) => m.ppm_completion) },
                { key: 'cm', label: 'WO closure', color: 'var(--s2)', values: t.months.map((m) => m.cm_closure) },
                { key: 'up', label: 'Uptime', color: 'var(--s3)', values: t.months.map((m) => m.uptime) },
              ]}
              yMax={100}
              unit="%"
              target={{ value: t.targets.ppm, label: `Target ${t.targets.ppm}%` }}
              ariaLabel="Twelve month KPI trend"
            />
          </Card>
          <Card title="Work orders raised vs closed" subtitle="Corrective maintenance per month">
            <BarChart
              labels={t.months.map((m) => monthLabel(m.month))}
              series={[
                { key: 'raised', label: 'Raised', color: 'var(--s1)', values: t.months.map((m) => m.cm_raised) },
                { key: 'closed', label: 'Closed', color: 'var(--s2)', values: t.months.map((m) => m.cm_closed) },
              ]}
              ariaLabel="Work orders raised and closed per month"
            />
          </Card>
          <Card title="Monthly figures" className="span-2" flush>
            <DataTable
              columns={[
                { key: 'month', label: 'Month', render: (m) => monthLabel(m.month) },
                { key: 'ppm_scheduled', label: 'PPM due', align: 'right' },
                { key: 'ppm_completed', label: 'PPM done', align: 'right' },
                { key: 'ppm_completion', label: 'PPM %', align: 'right', render: (m) => pct(m.ppm_completion) },
                { key: 'cm_raised', label: 'WO raised', align: 'right' },
                { key: 'cm_closed', label: 'WO closed', align: 'right' },
                { key: 'cm_closure', label: 'Closure %', align: 'right', render: (m) => pct(m.cm_closure) },
                { key: 'uptime', label: 'Uptime %', align: 'right', render: (m) => pct(m.uptime, 2) },
              ]}
              rows={[...t.months].reverse()}
              rowKey={(m) => m.month}
            />
          </Card>
        </div>
      ) : null}

      {depts.data && !f.department_id ? (
        <Card className="section-gap" title="By department" flush>
          <DataTable
            columns={[
              { key: 'department', label: 'Department' },
              { key: 'assets', label: 'Assets', align: 'right' },
              { key: 'ppm_completion', label: 'PPM %', align: 'right', render: (r) => pct(r.ppm_completion) },
              { key: 'ppm_overdue', label: 'PPM overdue', align: 'right' },
              { key: 'cm_raised', label: 'WO raised', align: 'right' },
              { key: 'cm_closure', label: 'Closure %', align: 'right', render: (r) => pct(r.cm_closure) },
              { key: 'avg_response_hours', label: 'Avg response', align: 'right', render: (r) => hours(r.avg_response_hours) },
              { key: 'uptime', label: 'Uptime %', align: 'right', render: (r) => pct(r.uptime, 2) },
            ]}
            rows={depts.data.rows}
            rowKey={(r) => r.department_id}
            onRow={(r) => setF({ ...f, department_id: String(r.department_id) })}
          />
        </Card>
      ) : null}

      {d && d.uptime.worst.length ? (
        <Card className="section-gap" title="Lowest uptime in period" flush>
          <DataTable
            columns={[
              { key: 'tag_no', label: 'Tag', render: (r) => <Link to={`/assets/${r.id}`} className="mono">{r.tag_no}</Link> },
              { key: 'name', label: 'Equipment' },
              { key: 'department_name', label: 'Department' },
              { key: 'downtime_hours', label: 'Downtime', align: 'right', render: (r) => hours(r.downtime_hours) },
              { key: 'uptime', label: 'Uptime', align: 'right', render: (r) => pct(r.uptime, 2) },
            ]}
            rows={d.uptime.worst.filter((r) => r.downtime_hours > 0)}
            empty="No downtime recorded in this period"
          />
        </Card>
      ) : null}
    </>
  );
}
