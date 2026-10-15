import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAction, useApp, useQuery } from '../lib/api.jsx';
import { ActionDialog, Badge, Button, Card, ErrorBox, Field, Input, KV, Loading, PageHeader, Select, StatusBadge, Textarea, Toggle } from '../components/ui.jsx';
import { Icon } from '../components/icons.jsx';
import { APPROVAL_STATUS, PPM_STATUS, date, dateTime, money, todayInput } from '../lib/format.js';
import { techOptions } from '../lib/options.js';

const RESULTS = [['PASS', 'Pass'], ['FAIL', 'Fail'], ['NA', 'N/A']];

function Choice({ value, onChange, label }) {
  return (
    <div className="choice" role="radiogroup" aria-label={label}>
      {RESULTS.map(([v, l]) => (
        <button key={v} type="button" role="radio" aria-checked={value === v} className={value === v ? `on-${v}` : ''} onClick={() => onChange(v)}>
          {l}
        </button>
      ))}
    </div>
  );
}

function ExecuteForm({ s, onDone }) {
  const { call, toast, settings } = useApp();
  const nav = useNavigate();
  const [items, setItems] = useState(() => s.checklist.map((item) => ({ item, result: '', remark: '' })));
  const [est, setEst] = useState(s.est_required ? '' : 'NA');
  const [readings, setReadings] = useState({ earth_resistance: '', equipment_leakage: '', applied_part_leakage: '', insulation_resistance: '' });
  const [f, setF] = useState({ completed_date: todayInput(), labour_hours: s.estimated_hours || 1, parts_cost: '', vendor_cost: '', vendor_name: s.plan_performed_by === 'VENDOR' ? s.plan_vendor_name || '' : '', remarks: '' });
  const [createCm, setCreateCm] = useState(true);
  const [down, setDown] = useState(true);
  const [overall, setOverall] = useState('');
  const [busy, setBusy] = useState(false);

  const failed = useMemo(() => items.filter((i) => i.result === 'FAIL').length + (est === 'FAIL' ? 1 : 0), [items, est]);
  const unanswered = items.filter((i) => !i.result).length + (est ? 0 : 1);
  const autoResult = failed ? 'FAIL' : 'PASS';
  const result = overall || autoResult;

  const allPass = () => setItems(items.map((i) => ({ ...i, result: i.result || 'PASS' })));
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    if (unanswered) {
      toast(`Answer all ${unanswered} remaining checklist item(s)`, 'critical');
      return;
    }
    setBusy(true);
    try {
      const r = await call('ppm.complete', {
        id: s.id,
        ...f,
        checklist_results: items,
        est_result: est,
        est_readings: readings,
        overall_result: result,
        create_cm: createCm,
        equipment_down: down,
      });
      toast(`PPM recorded — ${r.overall}`, r.overall === 'PASS' ? 'good' : 'critical');
      if (r.followup_wo) {
        toast(`Corrective work order ${r.followup_wo.wo_no} raised`, 'info');
        nav(`/wo/${r.followup_wo.id}`);
      } else onDone();
    } catch (err) {
      toast(err.message, 'critical');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="stack">
      <Card title="Checklist" subtitle={`${items.length} items · ${unanswered} unanswered`} actions={<Button size="sm" variant="secondary" icon="check" onClick={allPass}>Mark rest as pass</Button>}>
        <div className="checklist">
          {items.map((it, i) => (
            <div key={it.item} className={`check-item ${it.result === 'FAIL' ? 'is-fail' : ''}`}>
              <span className="check-q">{i + 1}. {it.item}</span>
              <Choice value={it.result} label={it.item} onChange={(v) => setItems(items.map((x, j) => (j === i ? { ...x, result: v } : x)))} />
              {it.result === 'FAIL' || it.remark ? (
                <Input placeholder="Finding / reading" value={it.remark} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, remark: e.target.value } : x)))} />
              ) : null}
            </div>
          ))}
          {!items.length ? <p className="muted">No checklist defined for this plan. Add one in PPM plans.</p> : null}
        </div>
      </Card>
      <Card title="Electrical safety test" subtitle="IEC 62353 recurrent test — record analyser readings">
        <div className="stack">
          <Choice value={est} onChange={setEst} label="Electrical safety result" />
          {est && est !== 'NA' ? (
            <div className="form-grid">
              <Field label="Protective earth resistance (Ω)"><Input type="number" step="0.001" min="0" inputMode="decimal" value={readings.earth_resistance} onChange={(e) => setReadings({ ...readings, earth_resistance: e.target.value })} /></Field>
              <Field label="Equipment leakage (µA)"><Input type="number" step="1" min="0" inputMode="decimal" value={readings.equipment_leakage} onChange={(e) => setReadings({ ...readings, equipment_leakage: e.target.value })} /></Field>
              <Field label="Applied part leakage (µA)"><Input type="number" step="1" min="0" inputMode="decimal" value={readings.applied_part_leakage} onChange={(e) => setReadings({ ...readings, applied_part_leakage: e.target.value })} /></Field>
              <Field label="Insulation resistance (MΩ)"><Input type="number" step="0.1" min="0" inputMode="decimal" value={readings.insulation_resistance} onChange={(e) => setReadings({ ...readings, insulation_resistance: e.target.value })} /></Field>
            </div>
          ) : null}
        </div>
      </Card>
      <Card title="Completion">
        <div className="form-grid">
          <Field label="Completed on" required><Input type="date" value={f.completed_date} max={todayInput()} onChange={set('completed_date')} required /></Field>
          <Field label="Labour hours" hint={`Costed at RM ${settings.labour_rate}/hour`}><Input type="number" min="0" step="0.25" value={f.labour_hours} onChange={set('labour_hours')} /></Field>
          <Field label="Parts / consumables (RM)"><Input type="number" min="0" step="0.01" value={f.parts_cost} onChange={set('parts_cost')} /></Field>
          <Field label="Vendor charge (RM)"><Input type="number" min="0" step="0.01" value={f.vendor_cost} onChange={set('vendor_cost')} /></Field>
          <Field label="Vendor / engineer name"><Input value={f.vendor_name} onChange={set('vendor_name')} /></Field>
          <Field label="Overall result" hint={`Suggested from checklist: ${autoResult}`}>
            <Select value={overall} onChange={(e) => setOverall(e.target.value)} placeholder={`Auto (${autoResult})`} options={[['PASS', 'Pass — fit for clinical use'], ['FAIL', 'Fail — not fit for use']]} />
          </Field>
          <Field label="Remarks" className="full" hint={result === 'PASS' && failed ? 'Required: explain why it passes with failed items' : undefined}>
            <Textarea value={f.remarks} onChange={set('remarks')} />
          </Field>
          {result === 'FAIL' ? (
            <div className="full stack">
              <div className="notice warn"><Icon name="alert" /> <span>A failed PPM should be followed by a corrective work order and the device tagged out of use.</span></div>
              <Toggle checked={createCm} onChange={setCreateCm} label="Raise a corrective work order" />
              {createCm ? <Toggle checked={down} onChange={setDown} label="Equipment taken out of use (counts as downtime)" /> : null}
            </div>
          ) : null}
        </div>
        <div className="form-actions">
          <Button type="submit" busy={busy} icon="check" variant={result === 'FAIL' ? 'danger' : 'primary'}>Complete PPM ({result})</Button>
        </div>
      </Card>
    </form>
  );
}

function Results({ s }) {
  const r = s.checklist_results || [];
  return (
    <>
      <Card title="Checklist results" subtitle={`${r.filter((x) => x.result === 'FAIL').length} failed of ${r.length}`}>
        <div className="checklist">
          {r.map((it) => (
            <div key={it.item} className={`check-item ${it.result === 'FAIL' ? 'is-fail' : ''}`}>
              <div className="row-between">
                <span className="check-q">{it.item}</span>
                <Badge tone={it.result === 'PASS' ? 'good' : it.result === 'FAIL' ? 'critical' : 'neutral'}>{it.result}</Badge>
              </div>
              {it.remark ? <span className="muted small">{it.remark}</span> : null}
            </div>
          ))}
        </div>
      </Card>
      <Card title="Electrical safety & costs">
        <KV
          items={[
            ['Electrical safety', s.est_result],
            ['Earth resistance', s.est_readings?.earth_resistance !== undefined ? `${s.est_readings.earth_resistance} Ω` : null],
            ['Equipment leakage', s.est_readings?.equipment_leakage !== undefined ? `${s.est_readings.equipment_leakage} µA` : null],
            ['Applied part leakage', s.est_readings?.applied_part_leakage !== undefined ? `${s.est_readings.applied_part_leakage} µA` : null],
            ['Labour', `${s.labour_hours} h · ${money(s.labour_cost)}`],
            ['Parts', money(s.parts_cost)],
            ['Vendor', s.vendor_cost ? `${money(s.vendor_cost)}${s.vendor_name ? ` · ${s.vendor_name}` : ''}` : s.vendor_name],
            ['Remarks', s.remarks],
          ]}
        />
        {s.followup_wo_id ? <p style={{ marginTop: 10 }}><Link to={`/wo/${s.followup_wo_id}`}>Follow-up corrective work order →</Link></p> : null}
      </Card>
    </>
  );
}

export default function PpmDetail() {
  const { id } = useParams();
  const { can, lookups, call, toast } = useApp();
  const { data: s, error, loading, reload } = useQuery('ppm.get', { id });
  const [run, busy] = useAction();
  const [dialog, setDialog] = useState(null);
  const [executing, setExecuting] = useState(false);

  useEffect(() => setExecuting(false), [id]);

  if (!s && loading) return <Loading />;
  if (!s) return <ErrorBox error={error} onRetry={reload} />;
  const open = ['SCHEDULED', 'IN_PROGRESS'].includes(s.status);
  const canExec = can('ppm.execute') && open && ['ACTIVE', 'STANDBY', 'BREAKDOWN', 'OUT_OF_SERVICE'].includes(s.asset_status);

  return (
    <div className={loading ? 'is-stale' : ''}>
      <PageHeader
        back="/ppm"
        title={`${s.type === 'PDM' ? 'Predictive inspection' : 'PPM'} ${s.ppm_no}`}
        subtitle={<><Link to={`/assets/${s.asset_id}`} className="mono">{s.tag_no}</Link> · {s.asset_name} · {s.department_name}</>}
        actions={<StatusBadge map={PPM_STATUS} value={s.display_status} />}
      />
      <Card>
        <KV
          items={[
            ['Scheduled', date(s.scheduled_date)],
            ['Due by', date(s.window_end)],
            ['Frequency', s.frequency_months ? `Every ${s.frequency_months} month(s)` : null],
            ['Assigned to', s.assigned_name || (s.plan_performed_by === 'VENDOR' ? `Vendor: ${s.plan_vendor_name || '—'}` : 'Unassigned')],
            ['Equipment', `${s.manufacturer || ''} ${s.model || ''} · S/N ${s.serial_no || '—'}`],
            ['Location', s.location_name],
            s.started_at ? ['Started', dateTime(s.started_at)] : null,
            s.completed_date ? ['Completed', `${date(s.completed_date)} · ${s.performed_by_name || ''}`] : null,
            s.overall_result ? ['Result', <Badge key="r" tone={s.overall_result === 'PASS' ? 'good' : 'critical'}>{s.overall_result}</Badge>] : null,
            s.reason ? ['Why scheduled', s.reason] : null,
            s.deferred_to ? ['Deferred to', `${date(s.deferred_to)} — ${s.defer_reason}`] : null,
          ]}
        />
        {s.approvals.length ? (
          <div className="stack" style={{ marginTop: 10 }}>
            {s.approvals.map((a) => (
              <div key={a.id} className="row"><StatusBadge map={APPROVAL_STATUS} value={a.status} /> <span className="small">{a.title}</span></div>
            ))}
          </div>
        ) : null}
        {open ? (
          <div className="row" style={{ marginTop: 14 }}>
            {canExec && s.status === 'SCHEDULED' ? <Button icon="play" busy={busy} onClick={() => run('ppm.start', { id: s.id }, { success: 'PPM started', onDone: () => { reload(); setExecuting(true); } })}>Start</Button> : null}
            {canExec && !executing ? <Button variant={s.status === 'IN_PROGRESS' ? 'primary' : 'secondary'} icon="check" onClick={() => setExecuting(true)}>Fill checklist</Button> : null}
            {can('ppm.defer') ? <Button variant="secondary" icon="clock" onClick={() => setDialog('defer')}>Defer</Button> : null}
            {can('ppm.plan') ? <Button variant="ghost" icon="user" onClick={() => setDialog('assign')}>Assign</Button> : null}
            {can('ppm.plan') ? <Button variant="ghost" icon="x" onClick={() => setDialog('cancel')}>Cancel</Button> : null}
          </div>
        ) : null}
      </Card>

      <div className="section-gap">
        {s.status === 'COMPLETED' ? <Results s={s} /> : null}
        {executing && canExec ? <ExecuteForm s={s} onDone={() => { setExecuting(false); reload(); }} /> : null}
      </div>

      <ActionDialog
        open={dialog === 'defer'}
        title="Defer PPM"
        intro="Deferral needs approval. The PPM is moved to the new date once approved and is excluded from this month's KPI."
        fields={[
          { name: 'new_date', label: 'New date', type: 'date', required: true },
          { name: 'reason', label: 'Reason', type: 'textarea', required: true, hint: 'e.g. equipment in continuous use, on loan, awaiting vendor' },
        ]}
        onSubmit={async (v) => {
          const r = await call('ppm.defer', { id: s.id, ...v });
          toast(r.status === 'PENDING' ? 'Deferral submitted for approval' : 'PPM deferred', 'good');
          reload();
        }}
        onClose={() => setDialog(null)}
      />
      <ActionDialog
        open={dialog === 'assign'}
        title="Assign PPM"
        fields={[{ name: 'assigned_to', label: 'Technician', type: 'select', options: techOptions(lookups), placeholder: 'Unassigned', initial: s.assigned_to || '' }]}
        onSubmit={async (v) => {
          await call('ppm.assign', { id: s.id, assigned_to: v.assigned_to || null });
          toast('Assigned', 'good');
          reload();
        }}
        onClose={() => setDialog(null)}
      />
      <ActionDialog
        open={dialog === 'cancel'}
        title="Cancel PPM"
        tone="danger"
        intro="Cancelled PPMs are excluded from compliance KPIs. Use only when the PPM is genuinely not required."
        fields={[{ name: 'reason', label: 'Reason', type: 'textarea', required: true }]}
        onSubmit={async (v) => {
          await call('ppm.cancel', { id: s.id, ...v });
          toast('PPM cancelled', 'good');
          reload();
        }}
        onClose={() => setDialog(null)}
      />
    </div>
  );
}
