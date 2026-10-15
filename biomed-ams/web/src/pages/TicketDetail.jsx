import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useApp, useQuery } from '../lib/api.jsx';
import AssetPicker from '../components/AssetPicker.jsx';
import { ActionDialog, Button, Card, ErrorBox, Field, KV, Loading, Modal, PageHeader, Select, StatusBadge, Toggle } from '../components/ui.jsx';
import { PRIORITY, TICKET_STATUS, WO_STATUS, dateTime, hours } from '../lib/format.js';
import { techOptions } from '../lib/options.js';

function ConvertDialog({ t, onClose, onDone }) {
  const { lookups, call, toast, can, user } = useApp();
  const [asset, setAsset] = useState(t.asset_id ? { id: t.asset_id, tag_no: t.tag_no, name: t.asset_name, department_name: t.department_name } : null);
  const [priority, setPriority] = useState(t.priority);
  const [assigned, setAssigned] = useState(can('wo.assign') ? '' : String(user.id));
  const [down, setDown] = useState(['BREAKDOWN', 'MALFUNCTION', 'DAMAGE'].includes(t.category));
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!asset) {
      toast('Select the equipment', 'critical');
      return;
    }
    setBusy(true);
    try {
      const r = await call('tickets.convert', { id: t.id, asset_id: asset.id, priority, assigned_to: assigned || null, equipment_down: down });
      toast(`Work order ${r.work_order.wo_no} raised`, 'good');
      onDone(r.work_order.id);
    } catch (e) {
      toast(e.message, 'critical');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open title="Raise work order" onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button busy={busy} onClick={submit}>Create work order</Button></>}>
      <div className="stack">
        <AssetPicker value={asset} onChange={setAsset} required />
        <Field label="Priority"><Select value={priority} onChange={(e) => setPriority(e.target.value)} options={Object.entries(PRIORITY).map(([k, v]) => [k, v[0]])} /></Field>
        <Field label="Assign to"><Select value={assigned} onChange={(e) => setAssigned(e.target.value)} placeholder="Unassigned" options={techOptions(lookups)} disabled={!can('wo.assign')} /></Field>
        <Toggle checked={down} onChange={setDown} label="Equipment is down" hint="Starts downtime from when the ticket was logged" />
      </div>
    </Modal>
  );
}

export default function TicketDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { call, toast, refreshBadges } = useApp();
  const { data: t, error, loading, reload } = useQuery('tickets.get', { id });
  const [dialog, setDialog] = useState(null);
  if (!t && loading) return <Loading />;
  if (!t) return <ErrorBox error={error} onRetry={reload} />;
  const after = () => {
    reload();
    refreshBadges();
  };

  return (
    <div className={loading ? 'is-stale' : ''}>
      <PageHeader back="/tickets" title={t.subject} subtitle={<span className="mono">{t.ticket_no}</span>} actions={<StatusBadge map={TICKET_STATUS} value={t.status} />} />
      <Card>
        <KV
          items={[
            ['Equipment', t.tag_no ? <Link to={`/assets/${t.asset_id}`}><span className="mono">{t.tag_no}</span> · {t.asset_name}</Link> : 'Not specified'],
            ['Department', `${t.department_name}${t.location_text ? ` · ${t.location_text}` : ''}`],
            ['Urgency', <StatusBadge key="p" map={PRIORITY} value={t.priority} />],
            ['Details', t.description],
            ['Reported by', `${t.reporter_name || ''}${t.contact_name && t.contact_name !== t.reporter_name ? ` · contact ${t.contact_name}` : ''}${t.contact_phone ? ` · ${t.contact_phone}` : ''}`],
            ['Logged', dateTime(t.created_at)],
            t.acknowledged_at ? ['Work order raised', dateTime(t.acknowledged_at)] : null,
            t.resolved_at ? ['Resolved', dateTime(t.resolved_at)] : null,
            t.closed_at ? ['Closed', dateTime(t.closed_at)] : null,
            t.rating ? ['Your rating', `${'★'.repeat(t.rating)}${'☆'.repeat(5 - t.rating)}${t.feedback ? ` · ${t.feedback}` : ''}`] : null,
          ]}
        />
        <div className="row" style={{ marginTop: 14 }}>
          {t.status === 'NEW' && t.can_manage ? <Button icon="wrench" onClick={() => setDialog('convert')}>Raise work order</Button> : null}
          {t.status === 'NEW' ? <Button variant="ghost" icon="x" onClick={() => setDialog('cancel')}>Cancel ticket</Button> : null}
          {t.can_confirm ? <Button variant="good" icon="checkCircle" onClick={() => setDialog('confirm')}>Confirm fixed</Button> : null}
          {t.can_confirm ? <Button variant="secondary" icon="alert" onClick={() => setDialog('notfixed')}>Still not working</Button> : null}
        </div>
      </Card>

      {t.work_order ? (
        <Card className="section-gap" title={`Work order ${t.work_order.wo_no}`} actions={t.can_manage ? <Link className="btn btn-ghost" to={`/wo/${t.work_order.id}`}>Open</Link> : null}>
          <KV
            items={[
              ['Status', <StatusBadge key="s" map={WO_STATUS} value={t.work_order.status} />],
              ['Technician', t.wo_assigned_name || 'Not yet assigned'],
              ['Response time', t.work_order.response_hours === null ? '—' : hours(t.work_order.response_hours)],
              ['Action taken', t.work_order.action_taken],
            ]}
          />
          <ul className="timeline section-gap">
            {t.work_order.logs.map((l, i) => (
              <li key={i}>
                <div className="t-when">{dateTime(l.created_at)}{l.user_name ? ` · ${l.user_name}` : ''}</div>
                <div className="t-what">{l.action.replace(/_/g, ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase())}</div>
                {l.note ? <div className="t-desc">{l.note}</div> : null}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {dialog === 'convert' ? <ConvertDialog t={t} onClose={() => setDialog(null)} onDone={(woId) => { refreshBadges(); nav(`/wo/${woId}`); }} /> : null}
      <ActionDialog open={dialog === 'cancel'} title="Cancel ticket" tone="danger" fields={[{ name: 'reason', label: 'Reason', type: 'textarea', required: true }]}
        onSubmit={async (v) => { await call('tickets.cancel', { id: t.id, ...v }); toast('Ticket cancelled', 'good'); after(); }} onClose={() => setDialog(null)} />
      <ActionDialog open={dialog === 'confirm'} title="Confirm the equipment is fixed" confirmLabel="Confirm & close" tone="good"
        fields={[
          { name: 'rating', label: 'How satisfied are you with the service?', type: 'select', options: [['5', '5 — Excellent'], ['4', '4 — Good'], ['3', '3 — Fair'], ['2', '2 — Poor'], ['1', '1 — Very poor']], initial: '5' },
          { name: 'feedback', label: 'Comments', type: 'textarea' },
        ]}
        onSubmit={async (v) => { await call('tickets.confirm', { id: t.id, ...v }); toast('Thank you — ticket closed', 'good'); after(); }} onClose={() => setDialog(null)} />
      <ActionDialog open={dialog === 'notfixed'} title="Still not working" intro="The work order is reopened and the technician is notified." fields={[{ name: 'reason', label: 'What is still wrong?', type: 'textarea', required: true }]}
        onSubmit={async (v) => { await call('tickets.notFixed', { id: t.id, ...v }); toast('Reopened for the technician', 'good'); after(); }} onClose={() => setDialog(null)} />
    </div>
  );
}
