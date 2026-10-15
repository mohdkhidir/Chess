import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useApp, useDebounced, useQuery } from '../lib/api.jsx';
import { Card, Empty, ErrorBox, LinkButton, Loading, PageHeader, Pager, RowLink, SearchBox, Segmented, Select, StatusBadge, Toolbar } from '../components/ui.jsx';
import { Icon } from '../components/icons.jsx';
import { PRIORITY, WO_STATUS, ago, hours } from '../lib/format.js';
import { deptOptions, techOptions } from '../lib/options.js';

export default function WorkOrders() {
  const { lookups, can } = useApp();
  const [sp, setSp] = useSearchParams();
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const status = sp.get('status') || 'ACTIVE';
  const assigned = sp.get('assigned') || '';
  const dept = sp.get('dept') || '';
  const priority = sp.get('priority') || '';
  const page = Number(sp.get('page') || 1);
  const set = (k, v) => {
    const n = new URLSearchParams(sp);
    if (v) n.set(k, v);
    else n.delete(k);
    if (k !== 'page') n.delete('page');
    setSp(n, { replace: true });
  };
  const { data, error, loading, reload } = useQuery('wo.list', {
    q: dq,
    status: status === 'ALL' ? undefined : status,
    assigned_to: assigned || undefined,
    department_id: dept || undefined,
    priority: priority || undefined,
    page,
    page_size: 30,
  });

  return (
    <>
      <PageHeader
        title="Corrective maintenance"
        subtitle="Breakdown and repair work orders"
        actions={can('wo.create') ? <LinkButton to="/wo/new" variant="primary" icon="plus">New work order</LinkButton> : null}
      />
      <div style={{ marginBottom: 10 }}>
        <Segmented
          value={status}
          onChange={(v) => set('status', v)}
          options={[['ACTIVE', 'Open'], ['ON_HOLD', 'On hold'], ['COMPLETED', 'To verify'], ['DONE', 'Completed'], ['ALL', 'All']]}
          ariaLabel="Work order status"
        />
      </div>
      <Toolbar>
        <SearchBox value={q} onChange={setQ} placeholder="WO no., tag, equipment, problem" />
        <Select value={assigned} onChange={(e) => set('assigned', e.target.value)} placeholder="Anyone" options={[['me', 'Assigned to me'], ['none', 'Unassigned'], ...techOptions(lookups)]} aria-label="Assigned to" />
        <Select value={priority} onChange={(e) => set('priority', e.target.value)} placeholder="Any priority" options={Object.entries(PRIORITY).map(([k, v]) => [k, v[0]])} aria-label="Priority" />
        <Select value={dept} onChange={(e) => set('dept', e.target.value)} placeholder="All departments" options={deptOptions(lookups)} aria-label="Department" />
      </Toolbar>
      <ErrorBox error={error} onRetry={reload} />
      <Card flush className={loading && data ? 'is-stale' : ''}>
        {!data && loading ? (
          <Loading />
        ) : data && data.rows.length ? (
          <div className="list">
            {data.rows.map((w) => (
              <RowLink key={w.id} to={`/wo/${w.id}`}>
                <div className="row-top">
                  <span className="row-title"><span className="mono">{w.tag_no}</span> · {w.asset_name}</span>
                  <StatusBadge map={WO_STATUS} value={w.status} />
                </div>
                <div className="t-desc">{w.problem}</div>
                <div className="row-meta">
                  <StatusBadge map={PRIORITY} value={w.priority} />
                  <span className="mono">{w.wo_no}</span>
                  <span><Icon name="clock" size={14} /> {ago(w.reported_at)}</span>
                  <span><Icon name="pin" size={14} /> {w.department_name}</span>
                  <span><Icon name="user" size={14} /> {w.assigned_name || 'Unassigned'}</span>
                  {w.equipment_down && ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'ON_HOLD'].includes(w.status) ? <span>Down {hours(w.downtime_hours)}</span> : null}
                </div>
              </RowLink>
            ))}
          </div>
        ) : (
          <Empty icon="wrench" title="No work orders here" action={can('wo.create') ? <Link to="/wo/new" className="btn btn-primary">New work order</Link> : null} />
        )}
        {data ? <Pager page={data.page} pageSize={data.page_size} total={data.total} onPage={(p) => set('page', String(p))} /> : null}
      </Card>
      {can('wo.create') ? <Link to="/wo/new" className="fab" aria-label="New work order"><Icon name="plus" size={26} /></Link> : null}
    </>
  );
}
