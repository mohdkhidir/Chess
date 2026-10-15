import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useApp } from '../lib/api.jsx';
import AssetPicker from '../components/AssetPicker.jsx';
import { Button, Card, Field, Input, PageHeader, Select, Textarea, Toggle } from '../components/ui.jsx';
import { PRIORITY, nowLocalInput } from '../lib/format.js';
import { techOptions } from '../lib/options.js';

export default function WorkOrderNew() {
  const { call, toast, lookups, can, user, refreshBadges } = useApp();
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const [asset, setAsset] = useState(null);
  const [f, setF] = useState({ priority: 'P3', problem: '', equipment_down: true, reported_at: nowLocalInput(), assigned_to: can('wo.assign') ? '' : String(user.id) });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const id = sp.get('asset');
    if (id) call('assets.get', { id }).then(setAsset).catch(() => {});
  }, [sp, call]);

  const submit = async (e) => {
    e.preventDefault();
    if (!asset) {
      toast('Select the equipment', 'critical');
      return;
    }
    setBusy(true);
    try {
      const r = await call('wo.create', { ...f, asset_id: asset.id, assigned_to: f.assigned_to || null });
      toast(`Work order ${r.wo_no} created`, 'good');
      refreshBadges();
      nav(`/wo/${r.id}`, { replace: true });
    } catch (err) {
      toast(err.message, 'critical');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader back="/wo" title="New corrective work order" subtitle="Record a breakdown or repair job" />
      <form onSubmit={submit}>
        <Card>
          <div className="form-grid">
            <div className="full"><AssetPicker value={asset} onChange={setAsset} required /></div>
            <Field label="Priority" required hint={PRIORITY[f.priority][2]}>
              <Select value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })} options={Object.entries(PRIORITY).map(([k, v]) => [k, v[0]])} />
            </Field>
            <Field label="Reported at" required>
              <Input type="datetime-local" value={f.reported_at} max={nowLocalInput()} onChange={(e) => setF({ ...f, reported_at: e.target.value })} required />
            </Field>
            <Field label="Problem reported" className="full" required>
              <Textarea value={f.problem} onChange={(e) => setF({ ...f, problem: e.target.value })} placeholder="What is wrong, error code, what the user saw" required />
            </Field>
            <Field label="Assign to" hint={can('wo.assign') ? undefined : 'You will be assigned'}>
              <Select value={f.assigned_to} onChange={(e) => setF({ ...f, assigned_to: e.target.value })} placeholder="Unassigned" options={techOptions(lookups)} disabled={!can('wo.assign')} />
            </Field>
            <div className="stack" style={{ justifyContent: 'center' }}>
              <Toggle checked={f.equipment_down} onChange={(v) => setF({ ...f, equipment_down: v })} label="Equipment is down" hint="Counts as downtime for uptime KPI until repaired" />
            </div>
          </div>
          <div className="form-actions">
            <Button type="submit" busy={busy} icon="check">Create work order</Button>
          </div>
        </Card>
      </form>
    </>
  );
}
