import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useApp, useDebounced, useQuery } from '../lib/api.jsx';
import { Badge, Card, Empty, ErrorBox, Input, LinkButton, Loading, PageHeader, Pager, RowLink, SearchBox, Segmented, Select, StatusBadge, Toolbar } from '../components/ui.jsx';
import { Icon } from '../components/icons.jsx';
import { PPM_STATUS, date } from '../lib/format.js';
import { deptOptions } from '../lib/options.js';

const VIEWS = [
  ['OPEN', 'To do'],
  ['OVERDUE', 'Overdue'],
  ['UPCOMING', 'Upcoming'],
  ['COMPLETED', 'Completed'],
  ['ALL', 'All'],
];

export default function PpmSchedule() {
  const { lookups, can, user } = useApp();
  const [sp, setSp] = useSearchParams();
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const view = sp.get('view') || 'OPEN';
  const month = sp.get('month') || '';
  const dept = sp.get('dept') || '';
  const assigned = sp.get('assigned') || '';
  const type = sp.get('type') || '';
  const page = Number(sp.get('page') || 1);
  const set = (k, v) => {
    const n = new URLSearchParams(sp);
    if (v) n.set(k, v);
    else n.delete(k);
    if (k !== 'page') n.delete('page');
    setSp(n, { replace: true });
  };
  const params = {
    q: dq,
    month: month || undefined,
    department_id: dept || undefined,
    assigned_to: assigned || undefined,
    type: type || undefined,
    display_status: view === 'ALL' ? undefined : view,
    page,
    page_size: 30,
  };
  const { data, error, loading, reload } = useQuery('ppm.list', params);

  return (
    <>
      <PageHeader
        title="PPM schedule"
        subtitle="Planned preventive maintenance work orders"
        actions={
          <>
            <LinkButton to="/ppm/masterlist" icon="grid">Masterlist</LinkButton>
            {can('ppm.plan') ? <LinkButton to="/ppm/plans" icon="list">Plans</LinkButton> : null}
          </>
        }
      />
      <div style={{ marginBottom: 10 }}>
        <Segmented options={VIEWS} value={view} onChange={(v) => set('view', v)} ariaLabel="PPM status" />
      </div>
      <Toolbar>
        <SearchBox value={q} onChange={setQ} placeholder="Tag, equipment or PPM no." />
        <Input type="month" value={month} onChange={(e) => set('month', e.target.value)} aria-label="Month" />
        {user.role !== 'REQUESTER' ? <Select value={dept} onChange={(e) => set('dept', e.target.value)} placeholder="All departments" options={deptOptions(lookups)} aria-label="Department" /> : null}
        <Select value={type} onChange={(e) => set('type', e.target.value)} placeholder="PPM + predictive" options={[['PPM', 'Planned PPM'], ['PDM', 'Predictive inspections']]} aria-label="Type" />
        {can('ppm.execute') ? <Select value={assigned} onChange={(e) => set('assigned', e.target.value)} placeholder="Anyone" options={[['me', 'Assigned to me']]} aria-label="Assigned" /> : null}
      </Toolbar>
      <ErrorBox error={error} onRetry={reload} />
      <Card flush className={loading && data ? 'is-stale' : ''}>
        {!data && loading ? (
          <Loading />
        ) : data && data.rows.length ? (
          <div className="list">
            {data.rows.map((s) => (
              <RowLink key={s.id} to={`/ppm/${s.id}`}>
                <div className="row-top">
                  <span className="row-title">
                    <span className="mono">{s.tag_no}</span> · {s.asset_name}
                  </span>
                  <StatusBadge map={PPM_STATUS} value={s.display_status} />
                </div>
                <div className="row-meta">
                  <span className="mono">{s.ppm_no}</span>
                  {s.type === 'PDM' ? <Badge tone="info">Predictive</Badge> : null}
                  <span><Icon name="calendar" size={14} /> {date(s.scheduled_date)}{s.status !== 'COMPLETED' ? ` · due by ${date(s.window_end)}` : ''}</span>
                  {s.completed_date ? <span>Done {date(s.completed_date)} · {s.overall_result}</span> : null}
                </div>
                <div className="row-meta">
                  <span><Icon name="pin" size={14} /> {s.department_name}{s.location_name ? ` · ${s.location_name}` : ''}</span>
                  <span><Icon name="user" size={14} /> {s.assigned_name || (s.plan_performed_by === 'VENDOR' ? s.plan_vendor_name || 'Vendor' : 'Unassigned')}</span>
                </div>
              </RowLink>
            ))}
          </div>
        ) : (
          <Empty icon="calendar" title={view === 'OVERDUE' ? 'No overdue PPM' : 'Nothing here'}>
            {view === 'OPEN' ? 'No PPM is due right now.' : 'Try another month or filter.'}
          </Empty>
        )}
        {data ? <Pager page={data.page} pageSize={data.page_size} total={data.total} onPage={(p) => set('page', String(p))} /> : null}
      </Card>
    </>
  );
}
