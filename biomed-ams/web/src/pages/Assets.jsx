import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useApp, useDebounced, useQuery } from '../lib/api.jsx';
import { Button, Card, Empty, ErrorBox, LinkButton, Loading, PageHeader, Pager, RowLink, SearchBox, Select, StatusBadge, Toolbar } from '../components/ui.jsx';
import { Icon } from '../components/icons.jsx';
import { ASSET_STATUS, date } from '../lib/format.js';
import { catOptions, deptOptions, statusOptions } from '../lib/options.js';
import { exportLabels } from '../lib/exporter.js';

export default function Assets() {
  const { lookups, can, user, call, settings, toast } = useApp();
  const [sp, setSp] = useSearchParams();
  const [q, setQ] = useState(sp.get('q') || '');
  const dq = useDebounced(q);
  const f = {
    department_id: sp.get('dept') || '',
    category_id: sp.get('cat') || '',
    status: sp.get('status') || '',
    page: Number(sp.get('page') || 1),
  };
  const setF = (k, v) => {
    const next = new URLSearchParams(sp);
    if (v) next.set(k, v);
    else next.delete(k);
    if (k !== 'page') next.delete('page');
    setSp(next, { replace: true });
  };
  const params = { q: dq, department_id: f.department_id, category_id: f.category_id, status: f.status, page: f.page, page_size: 30, sort: 'tag' };
  const { data, error, loading, reload } = useQuery('assets.list', params);
  const [printing, setPrinting] = useState(false);

  const printLabels = async () => {
    setPrinting(true);
    try {
      const all = await call('assets.list', { ...params, page: 1, page_size: 1000 });
      if (!all.rows.length) return;
      await exportLabels(all.rows, settings.hospital_name);
      toast(`${all.rows.length} label(s) generated`, 'good');
    } catch (e) {
      toast(e.message, 'critical');
    } finally {
      setPrinting(false);
    }
  };

  return (
    <>
      <PageHeader
        title={user.role === 'REQUESTER' ? 'Equipment in my department' : 'Asset masterlist'}
        subtitle="All registered biomedical equipment with tag, location and service department"
        actions={
          <>
            {can('asset.create') ? <LinkButton to="/assets/new" variant="primary" icon="plus">Register</LinkButton> : null}
            {can('asset.import') ? <LinkButton to="/assets/import" icon="upload">Import CSV</LinkButton> : null}
            {can('asset.create') ? <Button variant="secondary" icon="printer" busy={printing} onClick={printLabels}>QR labels</Button> : null}
          </>
        }
      />
      <Toolbar>
        <SearchBox value={q} onChange={(v) => { setQ(v); setF('page', ''); }} placeholder="Tag, name, serial, model…" />
        {user.role !== 'REQUESTER' ? (
          <Select value={f.department_id} onChange={(e) => setF('dept', e.target.value)} placeholder="All departments" options={deptOptions(lookups)} aria-label="Department" />
        ) : null}
        <Select value={f.category_id} onChange={(e) => setF('cat', e.target.value)} placeholder="All categories" options={catOptions(lookups)} aria-label="Category" />
        <Select value={f.status} onChange={(e) => setF('status', e.target.value)} placeholder="Any status" options={[['IN_FLEET', 'In fleet (not disposed)'], ...statusOptions(ASSET_STATUS)]} aria-label="Status" />
      </Toolbar>
      <ErrorBox error={error} onRetry={reload} />
      <Card flush className={loading && data ? 'is-stale' : ''}>
        {!data && loading ? (
          <Loading />
        ) : data && data.rows.length ? (
          <div className="list">
            {data.rows.map((a) => (
              <RowLink key={a.id} to={`/assets/${a.id}`}>
                <div className="row-top">
                  <span className="row-title mono">{a.tag_no}</span>
                  <StatusBadge map={ASSET_STATUS} value={a.status} />
                </div>
                <div className="row-meta">
                  <span><strong style={{ color: 'var(--ink)' }}>{a.name}</strong></span>
                  {a.manufacturer || a.model ? <span>{[a.manufacturer, a.model].filter(Boolean).join(' ')}</span> : null}
                  {a.serial_no ? <span>S/N {a.serial_no}</span> : null}
                </div>
                <div className="row-meta">
                  <span><Icon name="pin" size={14} /> {a.department_name}{a.location_name ? ` · ${a.location_name}` : ''}</span>
                  {a.next_ppm ? <span><Icon name="calendar" size={14} /> Next PPM {date(a.next_ppm)}</span> : null}
                </div>
              </RowLink>
            ))}
          </div>
        ) : (
          <Empty icon="box" title="No assets match" action={can('asset.create') ? <Link to="/assets/new" className="btn btn-primary">Register the first asset</Link> : null}>
            Change the filters or register new equipment.
          </Empty>
        )}
        {data ? <Pager page={data.page} pageSize={data.page_size} total={data.total} onPage={(p) => setF('page', String(p))} /> : null}
      </Card>
      {can('asset.create') ? (
        <Link to="/assets/new" className="fab" aria-label="Register asset"><Icon name="plus" size={26} /></Link>
      ) : null}
    </>
  );
}
