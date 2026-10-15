import { useState } from 'react';
import { useApp, useQuery } from '../lib/api.jsx';
import { ActionDialog, Badge, Button, Card, Empty, ErrorBox, Field, Input, Loading, Modal, PageHeader, Segmented, Select } from '../components/ui.jsx';
import { deptOptions } from '../lib/options.js';
import { ago } from '../lib/format.js';

const STATUS_TONE = { ACTIVE: 'good', PENDING: 'warning', DISABLED: 'neutral', REJECTED: 'neutral' };

function UserEditor({ user: u, onClose, onSaved }) {
  const { lookups, call, toast, settings } = useApp();
  const creating = !u;
  const pending = u?.status === 'PENDING';
  const [f, setF] = useState({
    username: u?.username || '',
    full_name: u?.full_name || '',
    staff_no: u?.staff_no || '',
    designation: u?.designation || '',
    email: u?.email || '',
    phone: u?.phone || '',
    department_id: u?.department_id ? String(u.department_id) : '',
    role: u?.role || 'TECHNICIAN',
    approval_level: String(u?.approval_level ?? 0),
    status: u?.status === 'DISABLED' ? 'DISABLED' : 'ACTIVE',
    password: '',
  });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const levels = [['0', 'None — cannot approve'], ...[1, 2, 3].map((l) => [String(l), `Level ${l} — ${settings.approval_level_names[l]}`])];

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (pending) {
        await call('users.approve', { id: u.id, role: f.role, approval_level: Number(f.approval_level), department_id: f.department_id || null });
        toast('Registration approved', 'good');
      } else {
        await call('users.save', { ...f, id: u?.id, approval_level: Number(f.approval_level), department_id: f.department_id || null });
        toast(creating ? 'User created — they must change the password at first login' : 'User updated', 'good');
      }
      onSaved();
      onClose();
    } catch (err) {
      toast(err.message, 'critical');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open wide title={creating ? 'Register user' : pending ? `Approve registration — ${u.username}` : `Edit ${u.username}`} onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit" form="user-form" busy={busy}>{pending ? 'Approve' : 'Save'}</Button></>}>
      <form id="user-form" className="form-grid" onSubmit={save}>
        <Field label="Username" required><Input value={f.username} onChange={set('username')} disabled={!creating} autoCapitalize="off" required /></Field>
        <Field label="Full name" required><Input value={f.full_name} onChange={set('full_name')} disabled={pending} required /></Field>
        <Field label="Staff number"><Input value={f.staff_no} onChange={set('staff_no')} disabled={pending} /></Field>
        <Field label="Designation"><Input value={f.designation} onChange={set('designation')} disabled={pending} /></Field>
        <Field label="Email"><Input type="email" value={f.email} onChange={set('email')} disabled={pending} /></Field>
        <Field label="Phone"><Input value={f.phone} onChange={set('phone')} disabled={pending} /></Field>
        <Field label="Department"><Select value={f.department_id} onChange={set('department_id')} placeholder="—" options={deptOptions(lookups)} /></Field>
        <Field label="Role" hint="Decides what the user can do">
          <Select value={f.role} onChange={set('role')} options={Object.entries(lookups.roles)} />
        </Field>
        <Field label="Level of approval" hint="Decides what the user can approve" className="full">
          <Select value={f.approval_level} onChange={set('approval_level')} options={levels} />
        </Field>
        {!creating && !pending ? (
          <Field label="Account status"><Select value={f.status} onChange={set('status')} options={[['ACTIVE', 'Active'], ['DISABLED', 'Disabled']]} /></Field>
        ) : null}
        {creating ? (
          <Field label="Temporary password" required hint="At least 8 characters with letters and numbers; changed at first login">
            <Input type="text" value={f.password} onChange={set('password')} autoComplete="new-password" required />
          </Field>
        ) : null}
      </form>
    </Modal>
  );
}

export default function Users() {
  const { call, toast, lookups } = useApp();
  const [status, setStatus] = useState('');
  const { data, error, loading, reload } = useQuery('users.list', { status: status || undefined });
  const [edit, setEdit] = useState(null);
  const [reset, setReset] = useState(null);
  const pendingCount = data ? data.rows.filter((u) => u.status === 'PENDING').length : 0;
  const deptName = (id) => lookups.departments.find((d) => d.id === id)?.name;

  return (
    <>
      <PageHeader title="Users" subtitle="User registration, roles and levels of approval" actions={<Button icon="plus" onClick={() => setEdit({ user: null })}>Register user</Button>} />
      <div style={{ marginBottom: 12 }}>
        <Segmented value={status} onChange={setStatus} options={[['', 'All'], ['PENDING', 'Pending', pendingCount || undefined], ['ACTIVE', 'Active'], ['DISABLED', 'Disabled']]} ariaLabel="Status" />
      </div>
      <ErrorBox error={error} onRetry={reload} />
      <Card flush>
        {!data && loading ? (
          <Loading />
        ) : data && data.rows.length ? (
          <div className="list">
            {data.rows.map((u) => (
              <div key={u.id} className="row-link" style={{ alignItems: 'center' }}>
                <button type="button" className="row-main" style={{ border: 0, background: 'none', textAlign: 'left', cursor: 'pointer', padding: 0 }} onClick={() => setEdit({ user: u })}>
                  <div className="row-top">
                    <span className="row-title">{u.full_name}</span>
                    <Badge tone={STATUS_TONE[u.status]}>{u.status === 'PENDING' ? 'Awaiting approval' : u.status.toLowerCase()}</Badge>
                  </div>
                  <div className="row-meta">
                    <span className="mono">{u.username}</span>
                    <span>{lookups.roles[u.role]}</span>
                    {u.approval_level ? <Badge tone="info">Approver L{u.approval_level}</Badge> : null}
                    {u.department_id ? <span>{deptName(u.department_id)}</span> : null}
                    {u.locked ? <Badge tone="critical">Locked</Badge> : null}
                    {u.must_change_password ? <span>Temporary password</span> : null}
                    {u.last_login_at ? <span>Last login {ago(u.last_login_at)}</span> : null}
                  </div>
                </button>
                {u.status === 'PENDING' ? (
                  <Button size="sm" variant="ghost" onClick={async () => { try { await call('users.reject', { id: u.id }); toast('Registration rejected', 'good'); reload(); } catch (e) { toast(e.message, 'critical'); } }}>Reject</Button>
                ) : u.status === 'ACTIVE' ? (
                  <Button size="sm" variant="ghost" onClick={() => setReset(u)}>Reset password</Button>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <Empty icon="users" title="No users" />
        )}
      </Card>
      {edit ? <UserEditor user={edit.user} onClose={() => setEdit(null)} onSaved={reload} /> : null}
      <ActionDialog
        open={!!reset}
        title={`Reset password — ${reset?.username}`}
        intro="Also unlocks the account. The user must change this password at next login."
        fields={[{ name: 'new_password', label: 'Temporary password', required: true }]}
        onSubmit={async (v) => { await call('users.resetPassword', { id: reset.id, ...v }); toast('Password reset', 'good'); reload(); }}
        onClose={() => setReset(null)}
      />
    </>
  );
}
