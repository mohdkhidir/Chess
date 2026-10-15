import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAction, useApp, useQuery } from '../lib/api.jsx';
import { Button, Card, Empty, ErrorBox, Loading, PageHeader, Select, Toolbar } from '../components/ui.jsx';
import { MONTH_NAMES, PPM_STATUS, date, todayInput } from '../lib/format.js';
import { catOptions, deptOptions } from '../lib/options.js';
import { exportCsv, exportPdf } from '../lib/exporter.js';

const CODE = { COMPLETED: 'C', COMPLETED_LATE: 'L', OVERDUE: 'O', DUE: 'D', UPCOMING: 'P', IN_PROGRESS: 'W', DEFERRED: 'F', CANCELLED: 'X' };

export default function PpmMasterlist() {
  const { lookups, can, call, toast } = useApp();
  const thisYear = Number(todayInput().slice(0, 4));
  const [year, setYear] = useState(thisYear);
  const [dept, setDept] = useState('');
  const [cat, setCat] = useState('');
  const params = { year, department_id: dept || undefined, category_id: cat || undefined };
  const { data, error, loading, reload } = useQuery('ppm.masterlist', params);
  const [run, busy] = useAction();
  const [exporting, setExporting] = useState(false);
  const nowMonth = Number(todayInput().slice(5, 7)) - 1;

  const doExport = async (kind) => {
    setExporting(true);
    try {
      const r = await call('reports.run', { type: 'PPM_MASTERLIST', ...params });
      if (kind === 'pdf') await exportPdf(r);
      else await exportCsv(r);
    } catch (e) {
      toast(e.message, 'critical');
    } finally {
      setExporting(false);
    }
  };

  return (
    <>
      <PageHeader
        title={`PPM masterlist ${year}`}
        subtitle="Annual preventive maintenance planner — one row per asset, one column per month"
        back="/ppm"
        actions={
          <>
            {can('ppm.plan') ? (
              <Button icon="calendar" busy={busy} onClick={() => run('ppm.generate', { year }, { success: (r) => `${r.created} PPM(s) generated for ${year}`, onDone: reload })}>
                Generate {year}
              </Button>
            ) : null}
            <Button variant="secondary" icon="download" busy={exporting} onClick={() => doExport('pdf')}>PDF</Button>
            <Button variant="ghost" busy={exporting} onClick={() => doExport('csv')}>CSV</Button>
          </>
        }
      />
      <Toolbar>
        <Select value={year} onChange={(e) => setYear(Number(e.target.value))} options={[thisYear - 2, thisYear - 1, thisYear, thisYear + 1].map((y) => [y, String(y)])} aria-label="Year" />
        <Select value={dept} onChange={(e) => setDept(e.target.value)} placeholder="All departments" options={deptOptions(lookups)} aria-label="Department" />
        <Select value={cat} onChange={(e) => setCat(e.target.value)} placeholder="All categories" options={catOptions(lookups)} aria-label="Category" />
      </Toolbar>
      <ErrorBox error={error} onRetry={reload} />
      {data ? (
        <div className="summary-list">
          <div><strong>{data.totals.scheduled}</strong>Scheduled</div>
          <div><strong>{data.totals.completed + data.totals.completed_late}</strong>Completed ({data.totals.completed_late} late)</div>
          <div><strong>{data.totals.overdue}</strong>Overdue</div>
          <div><strong>{data.totals.pending}</strong>Pending</div>
          <div><strong>{data.totals.deferred}</strong>Deferred</div>
        </div>
      ) : null}
      <Card flush className={loading && data ? 'is-stale' : ''}>
        {!data && loading ? (
          <Loading />
        ) : data && data.rows.length ? (
          <div className="matrix-wrap">
            <table className="matrix">
              <thead>
                <tr>
                  <th className="asset-col">Asset</th>
                  <th>Freq</th>
                  {MONTH_NAMES.map((m, i) => (
                    <th key={m} className={year === thisYear && i === nowMonth ? 'now' : ''}>{m}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.asset_id}>
                    <td className="asset-col">
                      <Link to={`/assets/${r.asset_id}`} className="mono">{r.tag_no}</Link>
                      <small>{r.name} · {r.department_name}</small>
                    </td>
                    <td className="muted">{r.frequency_months ? `${r.frequency_months}m` : '—'}</td>
                    {r.months.map((cells, i) => (
                      <td key={i} className={year === thisYear && i === nowMonth ? 'now' : ''}>
                        {cells.map((c) => (
                          <Link
                            key={c.id}
                            to={`/ppm/${c.id}`}
                            className={`cell-mark s-${c.status}`}
                            title={`${c.ppm_no} · ${PPM_STATUS[c.status][0]} · ${date(c.date)}${c.completed_date ? ` · done ${date(c.completed_date)}` : ''}`}
                            aria-label={`${c.ppm_no} ${PPM_STATUS[c.status][0]}`}
                          >
                            {CODE[c.status]}
                          </Link>
                        ))}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty icon="grid" title={`No PPM scheduled in ${year}`}>
            {can('ppm.plan') ? `Use "Generate ${year}" to build the schedule from the PPM plans.` : 'Ask the biomedical engineer to generate the schedule.'}
          </Empty>
        )}
      </Card>
      <div className="matrix-legend" aria-label="Legend">
        {Object.entries(CODE).map(([k, c]) => (
          <span key={k}><span className={`cell-mark s-${k}`}>{c}</span>{PPM_STATUS[k][0]}</span>
        ))}
      </div>
    </>
  );
}
