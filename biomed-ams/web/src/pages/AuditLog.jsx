import { useState } from 'react';
import { useApp, useDebounced, useQuery } from '../lib/api.jsx';
import { Card, DataTable, ErrorBox, Input, Loading, PageHeader, Pager, SearchBox, Select, Toolbar } from '../components/ui.jsx';
import { dateTime } from '../lib/format.js';

const ENTITIES = [
  ['assets', 'Assets'], ['work_orders', 'Work orders'], ['ppm_schedules', 'PPM'], ['ppm_plans', 'PPM plans'], ['tickets', 'Tickets'],
  ['approvals', 'Approvals'], ['users', 'Users'], ['settings', 'Settings'], ['system', 'System'],
  ['departments', 'Departments'], ['locations', 'Locations'], ['categories', 'Categories'], ['vendors', 'Vendors'],
];

export default function AuditLog() {
  const { lookups } = useApp();
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const [f, setF] = useState({ entity: '', user_id: '', from: '', to: '' });
  const [page, setPage] = useState(1);
  const params = { q: dq, page, page_size: 50, ...Object.fromEntries(Object.entries(f).filter(([, v]) => v)) };
  const { data, error, loading, reload } = useQuery('audit.list', params);
  const set = (k) => (e) => {
    setF({ ...f, [k]: e.target.value });
    setPage(1);
  };
  const details = (d) => {
    if (!d) return '';
    try {
      const o = JSON.parse(d);
      return Object.entries(o).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' · ');
    } catch {
      return d;
    }
  };
  return (
    <>
      <PageHeader title="Audit log" subtitle="Who did what and when — every change is recorded and cannot be edited" />
      <Toolbar>
        <SearchBox value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Search actions and details" />
        <Select value={f.entity} onChange={set('entity')} placeholder="All records" options={ENTITIES} aria-label="Record type" />
        <Select value={f.user_id} onChange={set('user_id')} placeholder="All users" options={lookups.users.map((u) => [u.id, u.full_name])} aria-label="User" />
        <Input type="date" value={f.from} onChange={set('from')} aria-label="From" />
        <Input type="date" value={f.to} onChange={set('to')} aria-label="To" />
      </Toolbar>
      <ErrorBox error={error} onRetry={reload} />
      <Card flush className={loading && data ? 'is-stale' : ''}>
        {!data && loading ? (
          <Loading />
        ) : data ? (
          <>
            <DataTable
              columns={[
                { key: 'created_at', label: 'When', render: (r) => <span className="nowrap">{dateTime(r.created_at)}</span> },
                { key: 'user_name', label: 'User', render: (r) => r.user_name || 'System' },
                { key: 'action', label: 'Action' },
                { key: 'entity', label: 'Record', render: (r) => (r.entity ? `${r.entity.replace(/_/g, ' ')}${r.entity_id ? ` #${r.entity_id}` : ''}` : '') },
                { key: 'details', label: 'Details', render: (r) => <span className="small muted">{details(r.details)}</span> },
              ]}
              rows={data.rows}
              empty="No entries"
            />
            <Pager page={data.page} pageSize={data.page_size} total={data.total} onPage={setPage} />
          </>
        ) : null}
      </Card>
    </>
  );
}
