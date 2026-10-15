import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp, useQuery } from '../lib/api.jsx';
import { ActionDialog, Button, Card, Empty, ErrorBox, Loading, Modal, PageHeader, Segmented, StatusBadge } from '../components/ui.jsx';
import { APPROVAL_STATUS, dateTime, money } from '../lib/format.js';

const refLink = (a) => {
  if (a.type.startsWith('ASSET_')) return `/assets/${a.ref_id}`;
  if (a.type === 'PPM_DEFERRAL') return `/ppm/${a.ref_id}`;
  if (a.type === 'WO_COST') return `/wo/${a.ref_id}`;
  return null;
};

function Steps({ id }) {
  const { data, loading } = useQuery('approvals.get', { id });
  if (loading && !data) return <Loading />;
  if (!data) return null;
  return (
    <div className="stack">
      <p className="muted">{data.type_label} · requested by {data.requested_by_name} on {dateTime(data.requested_at)}</p>
      {data.payload?.reason || data.payload?.justification ? <p><strong>Justification:</strong> {data.payload.reason || data.payload.justification}</p> : null}
      {data.payload?.new_date ? <p><strong>New date:</strong> {data.payload.new_date}</p> : null}
      <ul className="timeline">
        {data.steps.map((s) => (
          <li key={s.id}>
            <div className="t-when">{dateTime(s.decided_at)}</div>
            <div className="t-what">Level {s.level} · {s.approver_name} · {s.decision.toLowerCase()}</div>
            {s.remarks ? <div className="t-desc">{s.remarks}</div> : null}
          </li>
        ))}
        {data.status === 'PENDING' ? (
          <li>
            <div className="t-what">Waiting for level {data.current_level}: {data.current_level_name}</div>
          </li>
        ) : null}
      </ul>
    </div>
  );
}

export default function Approvals() {
  const { user, call, toast, refreshBadges, settings } = useApp();
  const canSeeAll = ['ADMIN', 'MANAGER', 'VIEWER'].includes(user.role) || user.approval_level > 0;
  const [box, setBox] = useState(user.approval_level ? 'mine' : 'requested');
  const { data, error, loading, reload } = useQuery('approvals.list', { box });
  const [act, setAct] = useState(null);
  const [view, setView] = useState(null);

  const decide = async (values) => {
    const r = await call('approvals.decide', { id: act.a.id, decision: act.decision, remarks: values.remarks });
    toast(r.status === 'APPROVED' ? 'Approved' : r.status === 'REJECTED' ? 'Rejected' : `Approved at your level — forwarded to level ${r.current_level}`, 'good');
    refreshBadges();
    reload();
  };

  return (
    <>
      <PageHeader
        title="Approvals"
        subtitle={user.approval_level ? `You approve up to level ${user.approval_level} (${settings.approval_level_names[user.approval_level]})` : 'You can follow the requests you made'}
      />
      <div style={{ marginBottom: 12 }}>
        <Segmented
          value={box}
          onChange={setBox}
          options={[
            ...(user.approval_level ? [['mine', 'Awaiting me']] : []),
            ['requested', 'My requests'],
            ...(canSeeAll ? [['all', 'All']] : []),
          ]}
          ariaLabel="Approval box"
        />
      </div>
      <ErrorBox error={error} onRetry={reload} />
      {!data && loading ? (
        <Loading />
      ) : data && data.rows.length ? (
        <div className={`stack ${loading ? 'is-stale' : ''}`}>
          {data.rows.map((a) => (
            <Card key={a.id}>
              <div className="row-top" style={{ marginBottom: 6 }}>
                <span className="muted small">{a.type_label}</span>
                <StatusBadge map={APPROVAL_STATUS} value={a.status} />
              </div>
              <h3 style={{ marginBottom: 6 }}>{a.title}</h3>
              <div className="row-meta" style={{ marginBottom: 10 }}>
                {a.amount ? <span>{money(a.amount)}</span> : null}
                <span>By {a.requested_by_name || '—'}</span>
                <span>{dateTime(a.requested_at)}</span>
                <span>
                  Level {a.status === 'PENDING' ? a.current_level : a.required_level} of {a.required_level}
                  {a.status === 'PENDING' ? ` · next: ${a.current_level_name}` : ''}
                </span>
              </div>
              {a.payload?.reason || a.payload?.justification ? <p className="t-desc" style={{ marginBottom: 10 }}>{a.payload.reason || a.payload.justification}</p> : null}
              <div className="row">
                {a.can_act ? (
                  <>
                    <Button variant="good" icon="check" onClick={() => setAct({ a, decision: 'APPROVED' })}>Approve</Button>
                    <Button variant="danger" icon="x" onClick={() => setAct({ a, decision: 'REJECTED' })}>Reject</Button>
                  </>
                ) : null}
                <Button variant="ghost" onClick={() => setView(a.id)}>Details</Button>
                {refLink(a) ? <Link className="btn btn-ghost" to={refLink(a)}>Open item</Link> : null}
                {a.status === 'PENDING' && a.requested_by === user.id ? (
                  <Button variant="ghost" onClick={async () => { try { await call('approvals.cancel', { id: a.id }); toast('Request withdrawn', 'good'); reload(); refreshBadges(); } catch (e) { toast(e.message, 'critical'); } }}>Withdraw</Button>
                ) : null}
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <Card><Empty icon="checkCircle" title={box === 'mine' ? 'Nothing waiting for you' : 'No requests'} /></Card>
      )}
      <ActionDialog
        open={!!act}
        title={act?.decision === 'APPROVED' ? 'Approve request' : 'Reject request'}
        intro={act?.a.title}
        tone={act?.decision === 'APPROVED' ? 'good' : 'danger'}
        confirmLabel={act?.decision === 'APPROVED' ? 'Approve' : 'Reject'}
        fields={[{ name: 'remarks', label: act?.decision === 'APPROVED' ? 'Remarks (optional)' : 'Reason for rejection', type: 'textarea', required: act?.decision === 'REJECTED' }]}
        onSubmit={decide}
        onClose={() => setAct(null)}
      />
      <Modal open={!!view} title="Approval trail" onClose={() => setView(null)}>
        {view ? <Steps id={view} /> : null}
      </Modal>
    </>
  );
}
