import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useApp, useDebounced, useQuery } from '../lib/api.jsx';
import { Card, Empty, ErrorBox, LinkButton, Loading, PageHeader, Pager, RowLink, SearchBox, Segmented, Select, StatusBadge, Toolbar } from '../components/ui.jsx';
import { Icon } from '../components/icons.jsx';
import { PRIORITY, TICKET_STATUS, ago } from '../lib/format.js';
import { deptOptions } from '../lib/options.js';

export default function Tickets() {
  const { lookups, can, user } = useApp();
  const [sp, setSp] = useSearchParams();
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const status = sp.get('status') || 'OPEN';
  const dept = sp.get('dept') || '';
  const mine = sp.get('mine') === '1';
  const page = Number(sp.get('page') || 1);
  const set = (k, v) => {
    const n = new URLSearchParams(sp);
    if (v) n.set(k, v);
    else n.delete(k);
    if (k !== 'page') n.delete('page');
    setSp(n, { replace: true });
  };
  const { data, error, loading, reload } = useQuery('tickets.list', {
    q: dq,
    status: status === 'ALL' ? undefined : status,
    department_id: dept || undefined,
    mine: mine || undefined,
    page,
    page_size: 30,
  });

  return (
    <>
      <PageHeader
        title="Helpdesk"
        subtitle={can('ticket.manage') ? 'Fault reports from wards and clinics — triage into work orders' : 'Report equipment problems and follow progress'}
        actions={can('ticket.create') ? <LinkButton to="/tickets/new" variant="primary" icon="plus">Report a fault</LinkButton> : null}
      />
      <div style={{ marginBottom: 10 }}>
        <Segmented
          value={status}
          onChange={(v) => set('status', v)}
          options={[['OPEN', 'Open'], ['NEW', 'New'], ['RESOLVED', 'To confirm'], ['CLOSED', 'Closed'], ['ALL', 'All']]}
          ariaLabel="Ticket status"
        />
      </div>
      <Toolbar>
        <SearchBox value={q} onChange={setQ} placeholder="Ticket no., subject or tag" />
        {user.role !== 'REQUESTER' ? <Select value={dept} onChange={(e) => set('dept', e.target.value)} placeholder="All departments" options={deptOptions(lookups)} aria-label="Department" /> : null}
        <Select value={mine ? '1' : ''} onChange={(e) => set('mine', e.target.value)} placeholder={user.role === 'REQUESTER' ? 'My department' : 'Everyone'} options={[['1', 'Reported by me']]} aria-label="Reporter" />
      </Toolbar>
      <ErrorBox error={error} onRetry={reload} />
      <Card flush className={loading && data ? 'is-stale' : ''}>
        {!data && loading ? (
          <Loading />
        ) : data && data.rows.length ? (
          <div className="list">
            {data.rows.map((t) => (
              <RowLink key={t.id} to={`/tickets/${t.id}`}>
                <div className="row-top">
                  <span className="row-title">{t.subject}</span>
                  <StatusBadge map={TICKET_STATUS} value={t.status} />
                </div>
                <div className="row-meta">
                  <StatusBadge map={PRIORITY} value={t.priority} />
                  <span className="mono">{t.ticket_no}</span>
                  {t.tag_no ? <span className="mono">{t.tag_no}</span> : null}
                  <span><Icon name="pin" size={14} /> {t.department_name}</span>
                  <span><Icon name="clock" size={14} /> {ago(t.created_at)}</span>
                  {t.wo_no ? <span><Icon name="wrench" size={14} /> {t.wo_no}{t.wo_assigned_name ? ` · ${t.wo_assigned_name}` : ''}</span> : null}
                </div>
              </RowLink>
            ))}
          </div>
        ) : (
          <Empty icon="headset" title="No tickets" action={can('ticket.create') ? <Link to="/tickets/new" className="btn btn-primary">Report a fault</Link> : null} />
        )}
        {data ? <Pager page={data.page} pageSize={data.page_size} total={data.total} onPage={(p) => set('page', String(p))} /> : null}
      </Card>
      {can('ticket.create') ? <Link to="/tickets/new" className="fab" aria-label="Report a fault"><Icon name="plus" size={26} /></Link> : null}
    </>
  );
}
