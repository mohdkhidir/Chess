import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useApp, useDebounced, useQuery } from '../lib/api.jsx';
import { Badge, Button, Card, Empty, ErrorBox, Field, Input, Loading, Modal, PageHeader, SearchBox, Select, StatusBadge, Textarea, Toggle, Toolbar } from '../components/ui.jsx';
import { ASSET_STATUS, date } from '../lib/format.js';
import { catOptions, deptOptions, techOptions } from '../lib/options.js';

function PlanEditor({ assetId, onClose, onSaved }) {
  const { lookups, call, toast } = useApp();
  const { data, error, loading } = useQuery('ppm.plans.get', { asset_id: assetId });
  const [f, setF] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!data) return;
    const p = data.plan;
    setF({
      frequency_months: p ? p.frequency_months : data.asset.ppm_frequency_months || 12,
      start_date: p ? p.start_date : '',
      checklist: (p && p.checklist.length ? p.checklist : data.asset.category_checklist).join('\n'),
      est_required: p ? !!p.est_required : !!data.asset.category_est,
      performed_by: p ? p.performed_by : data.asset.service_vendor_id ? 'VENDOR' : 'IN_HOUSE',
      vendor_id: p ? p.vendor_id || '' : data.asset.service_vendor_id || '',
      assigned_to: p ? p.assigned_to || '' : '',
      estimated_hours: p ? p.estimated_hours : 1,
      active: p ? !!p.active : true,
    });
  }, [data]);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await call('ppm.plans.save', {
        asset_id: assetId,
        ...f,
        checklist: f.checklist.split('\n'),
        vendor_id: f.vendor_id || null,
        assigned_to: f.assigned_to || null,
        start_date: f.start_date || null,
      });
      toast(`PPM plan saved${r.created ? ` · ${r.created} PPM(s) scheduled` : ''}`, 'good');
      onSaved();
      onClose();
    } catch (err) {
      toast(err.message, 'critical');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open wide title={data ? `PPM plan — ${data.asset.tag_no}` : 'PPM plan'} onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit" form="plan-form" busy={busy} disabled={!f}>Save plan</Button></>}>
      {error ? <ErrorBox error={error} /> : null}
      {loading || !f ? (
        <Loading />
      ) : (
        <form id="plan-form" className="form-grid" onSubmit={save}>
          <p className="muted full">{data.asset.name} · status {ASSET_STATUS[data.asset.status][0]}</p>
          <Field label="Frequency (months)" required hint="e.g. 3 quarterly, 6 half-yearly, 12 yearly">
            <Input type="number" min="1" max="60" value={f.frequency_months} onChange={set('frequency_months')} required />
          </Field>
          <Field label="First due date" hint="Leave blank to count from the commissioning date">
            <Input type="date" value={f.start_date} onChange={set('start_date')} />
          </Field>
          <Field label="Performed by">
            <Select value={f.performed_by} onChange={set('performed_by')} options={[['IN_HOUSE', 'In-house biomedical team'], ['VENDOR', 'External vendor / contractor']]} />
          </Field>
          {f.performed_by === 'VENDOR' ? (
            <Field label="Vendor" required>
              <Select value={f.vendor_id} onChange={set('vendor_id')} placeholder="Select…" options={lookups.vendors.filter((v) => v.active).map((v) => [v.id, v.name])} required />
            </Field>
          ) : (
            <Field label="Assigned technician">
              <Select value={f.assigned_to} onChange={set('assigned_to')} placeholder="Unassigned" options={techOptions(lookups)} />
            </Field>
          )}
          <Field label="Estimated hours"><Input type="number" min="0" step="0.5" value={f.estimated_hours} onChange={set('estimated_hours')} /></Field>
          <div className="stack" style={{ justifyContent: 'center' }}>
            <Toggle checked={f.est_required} onChange={(v) => setF({ ...f, est_required: v })} label="Electrical safety test" hint="IEC 62353 recurrent test" />
            <Toggle checked={f.active} onChange={(v) => setF({ ...f, active: v })} label="Plan active" hint="Inactive plans stop generating PPMs" />
          </div>
          <Field label="Checklist (one item per line)" className="full" hint={`${f.checklist.split('\n').filter((x) => x.trim()).length} items`}>
            <Textarea rows={10} value={f.checklist} onChange={set('checklist')} />
          </Field>
        </form>
      )}
    </Modal>
  );
}

export default function PpmPlans() {
  const { lookups } = useApp();
  const [sp, setSp] = useSearchParams();
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const [dept, setDept] = useState('');
  const [cat, setCat] = useState('');
  const [missing, setMissing] = useState(false);
  const editing = sp.get('asset');
  const { data, error, loading, reload } = useQuery('ppm.plans.list', { q: dq, department_id: dept || undefined, category_id: cat || undefined, without_plan: missing || undefined });

  const open = (id) => setSp(id ? { asset: String(id) } : {}, { replace: !id });

  return (
    <>
      <PageHeader back="/ppm" title="PPM plans" subtitle="Monitoring plan per asset: frequency, checklist, who performs it" />
      <Toolbar>
        <SearchBox value={q} onChange={setQ} placeholder="Tag or equipment" />
        <Select value={dept} onChange={(e) => setDept(e.target.value)} placeholder="All departments" options={deptOptions(lookups)} aria-label="Department" />
        <Select value={cat} onChange={(e) => setCat(e.target.value)} placeholder="All categories" options={catOptions(lookups)} aria-label="Category" />
        <Toggle checked={missing} onChange={setMissing} label="Without plan" />
      </Toolbar>
      <ErrorBox error={error} onRetry={reload} />
      <Card flush className={loading && data ? 'is-stale' : ''}>
        {!data && loading ? (
          <Loading />
        ) : data && data.rows.length ? (
          <div className="list">
            {data.rows.map((p) => (
              <button key={p.asset_id} type="button" className="row-link" style={{ width: '100%', border: 0, background: 'none', textAlign: 'left', cursor: 'pointer' }} onClick={() => open(p.asset_id)}>
                <div className="row-main">
                  <div className="row-top">
                    <span className="row-title"><span className="mono">{p.tag_no}</span> · {p.name}</span>
                    {p.id ? (p.active ? <Badge tone="good">Every {p.frequency_months}m</Badge> : <Badge>Inactive</Badge>) : <Badge tone="warning">No plan</Badge>}
                  </div>
                  <div className="row-meta">
                    <span>{p.department_name}</span>
                    <span>{p.category_name}</span>
                    {p.id ? <span>{p.performed_by === 'VENDOR' ? `Vendor: ${p.vendor_name || '—'}` : p.assigned_name || 'Unassigned'}</span> : null}
                    {p.next_due ? <span>Next {date(p.next_due)}</span> : null}
                    {p.last_done ? <span>Last {date(p.last_done)}</span> : null}
                    <StatusBadge map={ASSET_STATUS} value={p.asset_status} />
                  </div>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <Empty icon="list" title="No assets found" />
        )}
      </Card>
      {editing ? <PlanEditor assetId={Number(editing)} onClose={() => open(null)} onSaved={reload} /> : null}
    </>
  );
}
