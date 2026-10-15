import { useState } from 'react';
import { useApp } from '../lib/api.jsx';
import { Button, Card, Field, Input, KV, PageHeader, Segmented } from '../components/ui.jsx';
import { getConfig } from '../lib/transport.js';
import { getTheme, setTheme } from '../lib/theme.js';

export default function Profile({ onChangeMode }) {
  const { user, call, toast, logout, refreshMe, settings } = useApp();
  const [p, setP] = useState({ full_name: user.full_name, email: user.email || '', phone: user.phone || '' });
  const [pw, setPw] = useState({ current_password: '', new_password: '', confirm: '' });
  const [busy, setBusy] = useState(null);
  const [theme, setT] = useState(getTheme());
  const cfg = getConfig();

  const saveProfile = async (e) => {
    e.preventDefault();
    setBusy('p');
    try {
      await call('auth.updateProfile', p);
      await refreshMe();
      toast('Profile saved', 'good');
    } catch (err) {
      toast(err.message, 'critical');
    } finally {
      setBusy(null);
    }
  };
  const changePw = async (e) => {
    e.preventDefault();
    if (pw.new_password !== pw.confirm) {
      toast('New passwords do not match', 'critical');
      return;
    }
    setBusy('pw');
    try {
      await call('auth.changePassword', pw);
      setPw({ current_password: '', new_password: '', confirm: '' });
      toast('Password changed', 'good');
    } catch (err) {
      toast(err.message, 'critical');
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <PageHeader title="My profile" subtitle={`${user.username} · ${user.role_label}`} actions={<Button variant="secondary" icon="logout" onClick={logout}>Log out</Button>} />
      <div className="grid-2">
        <Card title="Account">
          <KV
            items={[
              ['Role', user.role_label],
              ['Level of approval', user.approval_level ? `Level ${user.approval_level} — ${settings.approval_level_names[user.approval_level]}` : 'None'],
              ['Department', user.department_name],
              ['Designation', user.designation],
              ['Staff number', user.staff_no],
              ['Connected to', cfg.mode === 'local' ? 'This device (standalone)' : cfg.serverUrl || window.location.origin],
            ]}
          />
          <div className="form-actions"><Button variant="ghost" onClick={onChangeMode}>Change connection</Button></div>
        </Card>
        <Card title="Contact details">
          <form className="stack" onSubmit={saveProfile}>
            <Field label="Full name"><Input value={p.full_name} onChange={(e) => setP({ ...p, full_name: e.target.value })} required /></Field>
            <Field label="Email"><Input type="email" value={p.email} onChange={(e) => setP({ ...p, email: e.target.value })} /></Field>
            <Field label="Phone"><Input type="tel" value={p.phone} onChange={(e) => setP({ ...p, phone: e.target.value })} /></Field>
            <div className="form-actions"><Button type="submit" busy={busy === 'p'}>Save</Button></div>
          </form>
        </Card>
        <Card title="Change password">
          <form className="stack" onSubmit={changePw}>
            <Field label="Current password"><Input type="password" value={pw.current_password} onChange={(e) => setPw({ ...pw, current_password: e.target.value })} autoComplete="current-password" required /></Field>
            <Field label="New password" hint="At least 8 characters with letters and numbers"><Input type="password" value={pw.new_password} onChange={(e) => setPw({ ...pw, new_password: e.target.value })} autoComplete="new-password" required /></Field>
            <Field label="Confirm new password"><Input type="password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} autoComplete="new-password" required /></Field>
            <div className="form-actions"><Button type="submit" busy={busy === 'pw'}>Change password</Button></div>
          </form>
        </Card>
        <Card title="Display">
          <Segmented value={theme} onChange={(v) => { setT(v); setTheme(v); }} options={[['system', 'System'], ['light', 'Light'], ['dark', 'Dark']]} ariaLabel="Theme" />
        </Card>
      </div>
    </>
  );
}
