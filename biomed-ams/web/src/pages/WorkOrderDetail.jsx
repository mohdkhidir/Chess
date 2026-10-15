import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAction, useApp, useQuery } from '../lib/api.jsx';
import { ActionDialog, Badge, Button, Card, DataTable, ErrorBox, Field, IconButton, Input, KV, Loading, PageHeader, Select, StatusBadge, Textarea } from '../components/ui.jsx';
import { APPROVAL_STATUS, PRIORITY, WO_RESULTS, WO_STATUS, dateTime, hours, money, nowLocalInput } from '../lib/format.js';
import { techOptions } from '../lib/options.js';

function PartsEditor({ parts, onChange, readOnly }) {
  if (readOnly) {
    return (
      <DataTable
        columns={[
          { key: 'part_no', label: 'Part no.' },
          { key: 'description', label: 'Description' },
          { key: 'qty', label: 'Qty', align: 'right' },
          { key: 'unit_cost', label: 'Unit (RM)', align: 'right', render: (p) => money(p.unit_cost).replace('RM ', '') },
          { key: 'total', label: 'Total (RM)', align: 'right', render: (p) => money(p.qty * p.unit_cost).replace('RM ', '') },
        ]}
        rows={parts}
        empty="No parts used"
      />
    );
  }
  const upd = (i, k, v) => onChange(parts.map((p, j) => (j === i ? { ...p, [k]: v } : p)));
  return (
    <div className="stack" style={{ gap: 8 }}>
      {parts.map((p, i) => (
        <div key={i} className="check-item">
          <div className="form-grid">
            <Field label="Description"><Input value={p.description} onChange={(e) => upd(i, 'description', e.target.value)} placeholder="e.g. SpO2 sensor" /></Field>
            <Field label="Part number"><Input value={p.part_no || ''} onChange={(e) => upd(i, 'part_no', e.target.value)} /></Field>
            <Field label="Quantity"><Input type="number" min="0.01" step="any" value={p.qty} onChange={(e) => upd(i, 'qty', e.target.value)} /></Field>
            <Field label="Unit cost (RM)"><Input type="number" min="0" step="0.01" value={p.unit_cost} onChange={(e) => upd(i, 'unit_cost', e.target.value)} /></Field>
          </div>
          <div className="row-between">
            <span className="muted small">Line total {money((Number(p.qty) || 0) * (Number(p.unit_cost) || 0))}</span>
            <IconButton icon="trash" label="Remove part" onClick={() => onChange(parts.filter((_, j) => j !== i))} />
          </div>
        </div>
      ))}
      <Button variant="secondary" size="sm" icon="plus" onClick={() => onChange([...parts, { description: '', part_no: '', qty: 1, unit_cost: 0 }])}>Add part</Button>
    </div>
  );
}

export default function WorkOrderDetail() {
  const { id } = useParams();
  const { can, user, lookups, call, toast, refreshBadges } = useApp();
  const { data: w, error, loading, reload } = useQuery('wo.get', { id });
  const [run, busy] = useAction();
  const [dialog, setDialog] = useState(null);
  const [form, setForm] = useState(null);

  useEffect(() => {
    if (w) {
      setForm({
        failure_cause: w.failure_cause || '',
        action_taken: w.action_taken || '',
        labour_hours: w.labour_hours || '',
        vendor_cost: w.vendor_cost || '',
        parts: w.parts.map((p) => ({ part_no: p.part_no, description: p.description, qty: p.qty, unit_cost: p.unit_cost })),
      });
    }
  }, [w]);

  if (!w && loading) return <Loading />;
  if (!w) return <ErrorBox error={error} onRetry={reload} />;

  const open = ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'ON_HOLD'].includes(w.status);
  const mine = w.assigned_to === user.id;
  const exec = can('wo.execute') && (mine || !w.assigned_to || can('wo.assign'));
  const editable = exec && ['ASSIGNED', 'IN_PROGRESS', 'ON_HOLD', 'OPEN'].includes(w.status);
  const after = () => {
    reload();
    refreshBadges();
  };
  const details = () => ({
    ...form,
    labour_hours: form.labour_hours === '' ? 0 : form.labour_hours,
    vendor_cost: form.vendor_cost === '' ? 0 : form.vendor_cost,
    parts: form.parts.filter((p) => p.description.trim()),
    failure_cause: form.failure_cause || null,
  });

  return (
    <div className={loading ? 'is-stale' : ''}>
      <PageHeader
        back="/wo"
        title={`Work order ${w.wo_no}`}
        subtitle={<><Link to={`/assets/${w.asset_id}`} className="mono">{w.tag_no}</Link> · {w.asset_name} · {w.department_name}{w.location_name ? ` / ${w.location_name}` : ''}</>}
        actions={<><StatusBadge map={PRIORITY} value={w.priority} /> <StatusBadge map={WO_STATUS} value={w.status} /></>}
      />

      <Card>
        <p style={{ fontWeight: 600, marginBottom: 10 }}>{w.problem}</p>
        <KV
          items={[
            ['Reported', `${dateTime(w.reported_at)}${w.created_by_name ? ` · logged by ${w.created_by_name}` : ''}`],
            ['Source', w.ticket_no ? <Link to={`/tickets/${w.ticket_id}`}>Helpdesk {w.ticket_no}</Link> : w.source === 'PPM' ? 'Failed PPM' : w.source === 'PREDICTIVE' ? 'Predictive inspection' : 'Direct'],
            ['Assigned to', w.assigned_name || 'Unassigned'],
            ['Response time', w.response_hours === null ? `Target ${w.response_target_hours} h` : <>{hours(w.response_hours)} {w.response_met ? <Badge tone="good">Within target</Badge> : <Badge tone="critical">Over {w.response_target_hours} h target</Badge>}</>],
            ['Turnaround', w.completed_at ? <>{hours(w.turnaround_hours)} {w.repair_met ? <Badge tone="good">Within {w.repair_target_days} days</Badge> : <Badge tone="critical">Over {w.repair_target_days} days</Badge>}</> : `${hours(w.turnaround_hours)} so far · target ${w.repair_target_days} days`],
            ['Equipment down', w.equipment_down ? `Yes · ${hours(w.downtime_hours)} downtime` : 'No (still usable)'],
            w.hold_reason ? ['On hold because', w.hold_reason] : null,
            w.estimated_cost ? ['Repair cost approval', <>{money(w.estimated_cost)} <StatusBadge map={APPROVAL_STATUS} value={w.cost_approval_status} /></>] : null,
            w.completed_at ? ['Completed', `${dateTime(w.completed_at)} · ${WO_RESULTS[w.result] || ''}`] : null,
            w.closed_at ? ['Verified & closed', `${dateTime(w.closed_at)} · ${w.closed_by_name || ''}`] : null,
            ['Total cost', `${money(w.total_cost)} (labour ${money(w.labour_cost)}, parts ${money(w.parts_cost)}, vendor ${money(w.vendor_cost)})`],
          ]}
        />
        <div className="row" style={{ marginTop: 14 }}>
          {open && can('wo.assign') ? <Button variant="secondary" icon="user" onClick={() => setDialog('assign')}>{w.assigned_to ? 'Reassign' : 'Assign'}</Button> : null}
          {open && can('wo.execute') && !w.assigned_to ? <Button variant="secondary" icon="check" busy={busy} onClick={() => run('wo.accept', { id: w.id }, { success: 'Work order accepted', onDone: after })}>Accept</Button> : null}
          {['OPEN', 'ASSIGNED'].includes(w.status) && exec ? <Button icon="play" onClick={() => setDialog('start')}>Attend / start</Button> : null}
          {w.status === 'IN_PROGRESS' && exec ? <Button variant="secondary" icon="pause" onClick={() => setDialog('hold')}>Put on hold</Button> : null}
          {w.status === 'ON_HOLD' && exec && w.cost_approval_status !== 'PENDING' ? <Button icon="play" busy={busy} onClick={() => run('wo.resume', { id: w.id }, { success: 'Resumed', onDone: after })}>Resume</Button> : null}
          {['IN_PROGRESS', 'ON_HOLD', 'ASSIGNED'].includes(w.status) && exec && w.cost_approval_status !== 'PENDING' ? <Button variant="secondary" icon="wallet" onClick={() => setDialog('cost')}>Request cost approval</Button> : null}
          {w.status === 'COMPLETED' && can('wo.close') ? <Button variant="good" icon="checkCircle" onClick={() => setDialog('close')}>Verify & close</Button> : null}
          {['COMPLETED', 'CLOSED'].includes(w.status) && can('wo.close') ? <Button variant="ghost" icon="refresh" onClick={() => setDialog('reopen')}>Reopen</Button> : null}
          {open && can('wo.assign') ? <Button variant="ghost" icon="x" onClick={() => setDialog('cancel')}>Cancel</Button> : null}
          <Button variant="ghost" icon="edit" onClick={() => setDialog('note')}>Add note</Button>
        </div>
      </Card>

      {form ? (
        <Card className="section-gap" title="Repair details" subtitle={editable ? 'Save as you go; complete when the equipment is fit for use' : undefined}>
          {editable ? (
            <div className="form-grid">
              <Field label="Failure cause">
                <Select value={form.failure_cause} onChange={(e) => setForm({ ...form, failure_cause: e.target.value })} placeholder="Select…" options={lookups.failure_causes} />
              </Field>
              <Field label="Labour hours">
                <Input type="number" min="0" step="0.25" value={form.labour_hours} onChange={(e) => setForm({ ...form, labour_hours: e.target.value })} />
              </Field>
              <Field label="Action taken" className="full">
                <Textarea value={form.action_taken} onChange={(e) => setForm({ ...form, action_taken: e.target.value })} placeholder="Diagnosis, parts replaced, tests performed" />
              </Field>
              <Field label="Vendor / external service cost (RM)">
                <Input type="number" min="0" step="0.01" value={form.vendor_cost} onChange={(e) => setForm({ ...form, vendor_cost: e.target.value })} />
              </Field>
              <div className="full">
                <div className="field-label" style={{ marginBottom: 6 }}>Spare parts used</div>
                <PartsEditor parts={form.parts} onChange={(parts) => setForm({ ...form, parts })} />
              </div>
            </div>
          ) : (
            <>
              <KV items={[['Failure cause', w.failure_cause], ['Action taken', w.action_taken], ['Labour', `${w.labour_hours} h`]]} />
              <div className="section-gap"><PartsEditor parts={w.parts} readOnly /></div>
            </>
          )}
          {editable ? (
            <div className="form-actions">
              <Button variant="secondary" busy={busy} onClick={() => run('wo.update', { id: w.id, ...details() }, { success: 'Saved', onDone: after })}>Save progress</Button>
              {w.cost_approval_status !== 'PENDING' ? <Button icon="check" onClick={() => setDialog('complete')}>Complete repair</Button> : <span className="muted small">Waiting for cost approval before completion</span>}
            </div>
          ) : null}
        </Card>
      ) : null}

      {w.approvals.length ? (
        <Card className="section-gap" title="Cost approvals">
          <div className="list">
            {w.approvals.map((a) => (
              <div key={a.id} className="row-link" style={{ cursor: 'default' }}>
                <div className="row-main">
                  <div className="row-top"><span className="row-title">{money(a.amount)}</span><StatusBadge map={APPROVAL_STATUS} value={a.status} /></div>
                  <div className="row-meta"><span>Level {a.current_level} of {a.required_level}</span><span>{dateTime(a.requested_at)}</span></div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      <Card className="section-gap" title="Activity log">
        <ul className="timeline">
          {w.logs.map((l) => (
            <li key={l.id}>
              <div className="t-when">{dateTime(l.created_at)}{l.user_name ? ` · ${l.user_name}` : ''}</div>
              <div className="t-what">{l.action.replace(/_/g, ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase())}</div>
              {l.note ? <div className="t-desc">{l.note}</div> : null}
            </li>
          ))}
        </ul>
      </Card>

      <ActionDialog open={dialog === 'assign'} title="Assign work order" fields={[{ name: 'assigned_to', label: 'Technician', type: 'select', required: true, placeholder: 'Select…', options: techOptions(lookups), initial: w.assigned_to || '' }]}
        onSubmit={async (v) => { await call('wo.assign', { id: w.id, ...v }); toast('Assigned', 'good'); after(); }} onClose={() => setDialog(null)} />
      <ActionDialog open={dialog === 'start'} title="Attend / start work" intro="The attendance time is the response time measured for the KPI." fields={[{ name: 'response_at', label: 'Attended at', type: 'datetime-local', required: true, initial: nowLocalInput() }]}
        onSubmit={async (v) => { await call('wo.start', { id: w.id, ...v }); toast('Work started', 'good'); after(); }} onClose={() => setDialog(null)} />
      <ActionDialog open={dialog === 'hold'} title="Put on hold" fields={[{ name: 'reason', label: 'Reason', type: 'select', required: true, placeholder: 'Select…', options: ['Awaiting spare part from supplier', 'Awaiting vendor / manufacturer service', 'Equipment in use — cannot be released', 'Awaiting user / ward', 'Other'] }]}
        onSubmit={async (v) => { await call('wo.hold', { id: w.id, ...v }); toast('On hold', 'good'); after(); }} onClose={() => setDialog(null)} />
      <ActionDialog open={dialog === 'cost'} title="Request repair cost approval" intro="The approval level follows the cost limits in Settings. The work order waits on hold until it is decided."
        fields={[{ name: 'estimated_cost', label: 'Estimated cost (RM)', type: 'number', required: true }, { name: 'justification', label: 'Justification / quotation', type: 'textarea', required: true }]}
        onSubmit={async (v) => { const r = await call('wo.requestCost', { id: w.id, ...v }); toast(`Sent for level ${r.level} approval`, 'good'); after(); }} onClose={() => setDialog(null)} />
      <ActionDialog open={dialog === 'complete'} title="Complete repair" confirmLabel="Complete"
        fields={[
          { name: 'result', label: 'Outcome', type: 'select', required: true, placeholder: 'Select…', options: Object.entries(WO_RESULTS) },
          { name: 'completed_at', label: 'Completed at', type: 'datetime-local', required: true, initial: nowLocalInput() },
        ]}
        onSubmit={async (v) => {
          const r = await call('wo.complete', { id: w.id, ...details(), ...v });
          toast('Repair completed — awaiting verification', 'good');
          if (r.suggest_disposal) toast('Asset marked out of service. Consider requesting disposal from the asset page.', 'info');
          after();
        }} onClose={() => setDialog(null)} />
      <ActionDialog open={dialog === 'close'} title="Verify & close" intro="Confirm the equipment was checked and is fit for clinical use." confirmLabel="Close work order" tone="good" fields={[{ name: 'remarks', label: 'Remarks', type: 'textarea' }]}
        onSubmit={async (v) => { await call('wo.close', { id: w.id, ...v }); toast('Work order closed', 'good'); after(); }} onClose={() => setDialog(null)} />
      <ActionDialog open={dialog === 'reopen'} title="Reopen work order" fields={[{ name: 'reason', label: 'Reason', type: 'textarea', required: true }]}
        onSubmit={async (v) => { await call('wo.reopen', { id: w.id, ...v }); toast('Reopened', 'good'); after(); }} onClose={() => setDialog(null)} />
      <ActionDialog open={dialog === 'cancel'} title="Cancel work order" tone="danger" intro="Use for duplicates or reports raised in error. Cancelled work orders do not count in KPIs." fields={[{ name: 'reason', label: 'Reason', type: 'textarea', required: true }]}
        onSubmit={async (v) => { await call('wo.cancel', { id: w.id, ...v }); toast('Work order cancelled', 'good'); after(); }} onClose={() => setDialog(null)} />
      <ActionDialog open={dialog === 'note'} title="Add note" fields={[{ name: 'note', label: 'Note', type: 'textarea', required: true }]}
        onSubmit={async (v) => { await call('wo.note', { id: w.id, ...v }); toast('Note added', 'good'); after(); }} onClose={() => setDialog(null)} />
    </div>
  );
}
