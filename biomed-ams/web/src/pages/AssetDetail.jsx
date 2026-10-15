import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAction, useApp, useQuery } from '../lib/api.jsx';
import {
  ActionDialog, Badge, Button, Card, Empty, ErrorBox, Field, KV, LinkButton, Loading, Modal, PageHeader, RowLink, Select, StatusBadge, Tabs, Textarea,
} from '../components/ui.jsx';
import { Meter } from '../components/charts.jsx';
import { Icon } from '../components/icons.jsx';
import {
  ASSET_STATUS, LIFE_STATE, PPM_STATUS, RISK_CLASS, RISK_LEVEL, WO_STATUS, date, dateTime, money, num, pct, todayInput,
} from '../lib/format.js';
import { deptOptions, locOptions } from '../lib/options.js';
import { exportLabels, qrDataUrl } from '../lib/exporter.js';

function TransferDialog({ open, asset, onClose, onDone }) {
  const { lookups } = useApp();
  const [run, busy] = useAction();
  const [f, setF] = useState({ department_id: '', location_id: '', reason: '' });
  useEffect(() => {
    if (open) setF({ department_id: '', location_id: '', reason: '' });
  }, [open]);
  const submit = async (e) => {
    e.preventDefault();
    await run('assets.transfer', { id: asset.id, ...f }, {
      success: (r) => (r.status === 'PENDING' ? 'Transfer submitted for approval' : 'Asset transferred'),
      onDone: () => {
        onClose();
        onDone();
      },
    });
  };
  return (
    <Modal open={open} title={`Transfer ${asset.tag_no}`} onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit" form="transfer" busy={busy}>Submit</Button></>}>
      <form id="transfer" className="stack" onSubmit={submit}>
        <p className="muted">Currently at {asset.department_name}{asset.location_name ? ` / ${asset.location_name}` : ''}.</p>
        <Field label="New department" required>
          <Select value={f.department_id} onChange={(e) => setF({ ...f, department_id: e.target.value, location_id: '' })} placeholder="Select…" options={deptOptions(lookups)} required />
        </Field>
        <Field label="New location">
          <Select value={f.location_id} onChange={(e) => setF({ ...f, location_id: e.target.value })} placeholder="—" options={locOptions(lookups, f.department_id)} />
        </Field>
        <Field label="Reason" required>
          <Textarea value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} required />
        </Field>
      </form>
    </Modal>
  );
}

function Overview({ a }) {
  const { settings } = useApp();
  const [qr, setQr] = useState(null);
  useEffect(() => {
    qrDataUrl(a.tag_no).then(setQr);
  }, [a.tag_no]);
  const warrantyActive = a.warranty_end && a.warranty_end >= todayInput();
  return (
    <div className="grid-2">
      <Card title="Details">
        <KV
          items={[
            ['Category', `${a.category_name} (${a.category_code})`],
            ['Manufacturer', a.manufacturer],
            ['Model', a.model],
            ['Serial number', a.serial_no],
            ['Service department', a.department_name],
            ['Location', a.location_name],
            ['Risk class', RISK_CLASS[a.risk_class]],
            ['Criticality', a.criticality],
            ['MDA registration', a.mda_reg_no],
            ['Asset class', a.asset_class === 'H' ? 'Capital asset (H)' : 'Inventory (I)'],
          ]}
        />
      </Card>
      <Card title="Procurement">
        <KV
          items={[
            ['Supplier', a.supplier_name],
            ['Service vendor', a.service_vendor_name || 'In-house'],
            ['PO / LO number', a.po_no],
            ['Purchase date', date(a.purchase_date)],
            ['Commissioned', date(a.commissioning_date)],
            ['Purchase cost', money(a.purchase_cost)],
            ['Funding', a.funding],
            ['Warranty', a.warranty_end ? <>{date(a.warranty_end)} {warrantyActive ? <Badge tone="good">Active</Badge> : <Badge>Expired</Badge>}</> : null],
            ['Remarks', a.remarks],
          ]}
        />
      </Card>
      <Card title="Tag label">
        <div className="qr-preview">
          {qr ? <img src={qr} alt={`QR code ${a.tag_no}`} /> : null}
          <div className="stack" style={{ gap: 6 }}>
            <span className="mono" style={{ fontWeight: 700, fontSize: '1.1rem' }}>{a.tag_no}</span>
            <span className="muted small">Scan with the app to open this asset or report a fault.</span>
            <Button size="sm" variant="secondary" icon="printer" onClick={() => exportLabels([a], settings.hospital_name)}>Print label (PDF)</Button>
          </div>
        </div>
      </Card>
      <Card title="Maintenance status">
        <KV
          items={[
            ['Next PPM', a.next_ppm ? <Link to={`/ppm/${a.next_ppm.id}`}>{date(a.next_ppm.scheduled_date)} · {a.next_ppm.ppm_no}</Link> : a.plan ? 'Not scheduled' : 'No PPM plan'],
            ['Last PPM', a.last_ppm ? <Link to={`/ppm/${a.last_ppm.id}`}>{date(a.last_ppm.completed_date)} · {a.last_ppm.overall_result}</Link> : null],
            ['PPM frequency', a.plan ? `Every ${a.plan.frequency_months} month(s)${a.plan.active ? '' : ' (inactive)'}` : null],
            ['Open work orders', a.open_work_orders.length ? a.open_work_orders.map((w) => <Link key={w.id} to={`/wo/${w.id}`} style={{ display: 'block' }}>{w.wo_no} · {w.problem}</Link>) : 'None'],
            ['Pending approvals', a.pending_approvals.length ? a.pending_approvals.map((p) => <Link key={p.id} to="/approvals" style={{ display: 'block' }}>{p.title} (L{p.current_level}/{p.required_level})</Link>) : 'None'],
          ]}
        />
      </Card>
      {a.risk ? (
        <Card title="Breakdown risk" subtitle={`Predicted from ${a.risk.failures} breakdown(s), age and cost`} className="span-2">
          <div className="row" style={{ alignItems: 'center' }}>
            <span className="hero">{a.risk.score}</span>
            <div className="grow stack" style={{ gap: 6 }}>
              <StatusBadge map={RISK_LEVEL} value={a.risk.level} />
              <Meter value={a.risk.score} tone={RISK_LEVEL[a.risk.level][1]} label="Risk score" />
            </div>
          </div>
          <KV
            items={[
              ['Chance of breakdown (90 days)', pct(a.risk.probability)],
              ['Breakdowns last 12 months', a.risk.failures_12m],
              ['Mean time between failures', a.risk.mtbf_days ? `${num(a.risk.mtbf_days)} days` : 'No failures yet'],
              ['Next breakdown (estimate)', date(a.risk.predicted_next_failure)],
            ]}
          />
          {a.risk.recommendations.length ? <ul className="recs">{a.risk.recommendations.map((r) => <li key={r}>{r}</li>)}</ul> : null}
        </Card>
      ) : null}
    </div>
  );
}

function Lifecycle({ a }) {
  const l = a.lifecycle;
  const { settings } = useApp();
  return (
    <div className="grid-2">
      <Card title="Lifespan">
        <div className="stack">
          <div className="row-between"><StatusBadge map={LIFE_STATE} value={l.state} /><span className="muted">{num(l.age_years, 1)} of {l.lifespan_years} years</span></div>
          <Meter value={Math.min(l.life_used_pct, 100)} tone={LIFE_STATE[l.state][1]} label="Life used" />
          <KV
            items={[
              ['In service since', date(l.in_service_date)],
              ['Life used', pct(l.life_used_pct)],
              ['Remaining', `${num(l.remaining_years, 1)} years`],
              ['End of life', date(l.end_of_life_date)],
            ]}
          />
        </div>
      </Card>
      <Card title="Cost of ownership">
        <div className="stack">
          <KV
            items={[
              ['Purchase cost', money(a.purchase_cost)],
              ['Book value (straight-line)', money(l.book_value)],
              ['Corrective maintenance', money(a.costs.cm)],
              ['Preventive maintenance', money(a.costs.ppm)],
              ['Total maintenance', money(a.costs.total)],
              ['Maintenance ÷ purchase cost', l.maintenance_cost_ratio === null ? '—' : pct(l.maintenance_cost_ratio)],
              [`Replacement estimate (${settings.inflation_rate}%/yr)`, money(l.replacement_cost)],
            ]}
          />
          {l.maintenance_cost_ratio !== null ? (
            <>
              <Meter value={Math.min(l.maintenance_cost_ratio, settings.replacement_cost_ratio * 1.5)} max={settings.replacement_cost_ratio * 1.5} tone={l.maintenance_cost_ratio >= settings.replacement_cost_ratio ? 'critical' : l.maintenance_cost_ratio >= settings.replacement_cost_ratio * 0.7 ? 'warning' : 'good'} label="Maintenance cost ratio" />
              <p className="muted small">Replacement review threshold: {settings.replacement_cost_ratio}% of purchase cost</p>
            </>
          ) : null}
          {l.replacement_flag ? <div className="notice warn"><Icon name="alert" /> <span>Candidate for replacement planning.</span></div> : null}
        </div>
      </Card>
    </div>
  );
}

export default function AssetDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { can, call, toast } = useApp();
  const [tab, setTab] = useState('overview');
  const [dialog, setDialog] = useState(null);
  const { data: a, error, loading, reload } = useQuery('assets.get', { id });
  const history = useQuery('assets.history', { id }, { enabled: tab !== 'overview' && tab !== 'life' });
  const [run] = useAction();

  if (!a && loading) return <Loading />;
  if (!a) return <ErrorBox error={error} onRetry={reload} />;
  const refresh = () => {
    reload();
    history.reload();
  };
  const inFleet = ['ACTIVE', 'STANDBY', 'OUT_OF_SERVICE', 'BREAKDOWN'].includes(a.status);

  return (
    <div className={loading ? 'is-stale' : ''}>
      <PageHeader
        back="/assets"
        title={<span className="mono">{a.tag_no}</span>}
        subtitle={`${a.name}${a.model ? ` · ${a.manufacturer || ''} ${a.model}` : ''}`}
        actions={<StatusBadge map={ASSET_STATUS} value={a.status} />}
      />
      <div className="row" style={{ marginBottom: 14 }}>
        {can('wo.create') && inFleet ? <LinkButton to={`/wo/new?asset=${a.id}`} variant="primary" icon="wrench">New work order</LinkButton> : null}
        {!can('wo.create') && can('ticket.create') && inFleet ? <LinkButton to={`/tickets/new?asset=${a.id}`} variant="primary" icon="headset">Report a fault</LinkButton> : null}
        {can('asset.edit') && a.status !== 'DISPOSED' ? <LinkButton to={`/assets/${a.id}/edit`} icon="edit">Edit</LinkButton> : null}
        {can('asset.transfer') && inFleet ? <Button variant="secondary" icon="move" onClick={() => setDialog('transfer')}>Transfer</Button> : null}
        {can('asset.status') && inFleet ? <Button variant="secondary" icon="refresh" onClick={() => setDialog('status')}>Change status</Button> : null}
        {can('asset.dispose') && inFleet ? <Button variant="ghost" icon="trash" onClick={() => setDialog('dispose')}>Dispose</Button> : null}
        {can('asset.create') && a.status === 'REJECTED' ? (
          <Button variant="secondary" icon="refresh" onClick={() => run('assets.resubmit', { id: a.id }, { success: 'Resubmitted', onDone: refresh })}>Resubmit</Button>
        ) : null}
        {can('report.view') ? (
          <Button variant="ghost" icon="file" onClick={() => nav(`/reports?type=ASSET_HISTORY&asset=${a.id}`)}>History card</Button>
        ) : null}
      </div>

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          ['overview', 'Overview'],
          ['ppm', 'PPM'],
          ['cm', 'Repairs', a.open_work_orders.length],
          ['history', 'History'],
          ['life', 'Lifespan & cost'],
        ]}
      />

      {tab === 'overview' ? <Overview a={a} /> : null}
      {tab === 'life' ? <Lifecycle a={a} /> : null}
      {tab === 'ppm' ? (
        <Card flush title="Preventive maintenance" subtitle={a.plan ? `Every ${a.plan.frequency_months} month(s) · ${a.plan.checklist.length} checklist items${a.plan.performed_by === 'VENDOR' ? ` · by ${a.plan.vendor_name || 'vendor'}` : ''}` : 'No PPM plan yet'} actions={can('ppm.plan') ? <LinkButton to={`/ppm/plans?asset=${a.id}`} variant="ghost" icon="edit">{a.plan ? 'Edit plan' : 'Create plan'}</LinkButton> : null}>
          {history.data ? (
            history.data.ppm.length ? (
              <div className="list">
                {history.data.ppm.map((p) => (
                  <RowLink key={p.id} to={`/ppm/${p.id}`}>
                    <div className="row-top"><span className="row-title">{p.ppm_no}{p.type === 'PDM' ? ' · predictive' : ''}</span><StatusBadge map={PPM_STATUS} value={p.status === 'SCHEDULED' && p.scheduled_date.slice(0, 7) < todayInput().slice(0, 7) ? 'OVERDUE' : p.status === 'SCHEDULED' ? 'UPCOMING' : p.status} /></div>
                    <div className="row-meta"><span>Scheduled {date(p.scheduled_date)}</span>{p.completed_date ? <span>Done {date(p.completed_date)} · {p.overall_result}</span> : null}{p.cost ? <span>{money(p.cost)}</span> : null}</div>
                  </RowLink>
                ))}
              </div>
            ) : (
              <Empty icon="calendar" title="No PPM records yet" />
            )
          ) : (
            <Loading />
          )}
        </Card>
      ) : null}
      {tab === 'cm' ? (
        <Card flush title="Corrective maintenance" actions={can('wo.create') && inFleet ? <LinkButton to={`/wo/new?asset=${a.id}`} variant="ghost" icon="plus">New</LinkButton> : null}>
          {history.data ? (
            history.data.cm.length ? (
              <div className="list">
                {history.data.cm.map((w) => (
                  <RowLink key={w.id} to={`/wo/${w.id}`}>
                    <div className="row-top"><span className="row-title">{w.wo_no} · {w.priority}</span><StatusBadge map={WO_STATUS} value={w.status} /></div>
                    <div className="t-desc">{w.problem}</div>
                    <div className="row-meta"><span>{dateTime(w.reported_at)}</span>{w.failure_cause ? <span>{w.failure_cause}</span> : null}{w.cost ? <span>{money(w.cost)}</span> : null}</div>
                  </RowLink>
                ))}
              </div>
            ) : (
              <Empty icon="wrench" title="No breakdowns recorded" />
            )
          ) : (
            <Loading />
          )}
        </Card>
      ) : null}
      {tab === 'history' ? (
        <Card title="Asset history" subtitle="Every registration, transfer, PPM, repair and approval">
          {history.data ? (
            <ul className="timeline">
              {history.data.events.map((e) => (
                <li key={e.id}>
                  <div className="t-when">{dateTime(e.created_at)}{e.user_name ? ` · ${e.user_name}` : ''}</div>
                  <div className="t-what">{e.event_type.replace(/_/g, ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase())}</div>
                  <div className="t-desc">{e.description}</div>
                </li>
              ))}
            </ul>
          ) : (
            <Loading />
          )}
        </Card>
      ) : null}

      <TransferDialog open={dialog === 'transfer'} asset={a} onClose={() => setDialog(null)} onDone={refresh} />
      <ActionDialog
        open={dialog === 'status'}
        title="Change status"
        fields={[
          { name: 'status', label: 'New status', type: 'select', required: true, options: [['ACTIVE', 'In service'], ['STANDBY', 'Standby / spare'], ['OUT_OF_SERVICE', 'Out of service']], placeholder: 'Select…' },
          { name: 'reason', label: 'Reason', type: 'textarea', required: true },
        ]}
        onSubmit={async (v) => {
          await call('assets.setStatus', { id: a.id, ...v });
          toast('Status changed', 'good');
          refresh();
        }}
        onClose={() => setDialog(null)}
      />
      <ActionDialog
        open={dialog === 'dispose'}
        title={`Dispose ${a.tag_no}`}
        intro="Disposal (condemnation) needs approval. Open PPMs are cancelled once it is approved."
        tone="danger"
        confirmLabel="Request disposal"
        fields={[
          { name: 'method', label: 'Disposal method', type: 'select', required: true, placeholder: 'Select…', options: ['Condemnation / scrap', 'Return to supplier', 'Trade-in', 'Transfer to other facility', 'Sale / auction', 'Donation', 'Other'] },
          { name: 'reason', label: 'Justification', type: 'textarea', required: true, hint: 'e.g. beyond economical repair, parts discontinued, technical assessment reference' },
        ]}
        onSubmit={async (v) => {
          const r = await call('assets.dispose', { id: a.id, ...v });
          toast(r.status === 'DISPOSED' ? 'Asset disposed' : 'Disposal submitted for approval', 'good');
          refresh();
        }}
        onClose={() => setDialog(null)}
      />
    </div>
  );
}
