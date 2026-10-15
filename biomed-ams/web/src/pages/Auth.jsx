import { useState } from 'react';
import { Button, Field, Input, Select } from '../components/ui.jsx';
import { Icon } from '../components/icons.jsx';
import { useApp } from '../lib/api.jsx';
import { checkServer, getConfig, rpc, setConfig, normaliseUrl } from '../lib/transport.js';

function Brand({ title = 'BioMed AMS', sub = 'Biomedical equipment asset management' }) {
  return (
    <div className="auth-brand">
      <img src="./icon.svg" alt="" />
      <h1>{title}</h1>
      <p>{sub}</p>
    </div>
  );
}

export function Splash({ label = 'Starting…' }) {
  return (
    <div className="auth">
      <Brand />
      <div className="auth-card" style={{ textAlign: 'center' }}>
        <span className="spinner" aria-hidden="true" /> <span className="muted">{label}</span>
      </div>
    </div>
  );
}

export function Welcome({ onDone }) {
  const [mode, setMode] = useState('local');
  const [start, setStart] = useState('demo');
  const [url, setUrl] = useState(getConfig().serverUrl || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const go = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === 'server') {
        await checkServer(url);
        setConfig({ mode: 'server', serverUrl: normaliseUrl(url) });
      } else {
        setConfig({ mode: 'local' });
        if (start === 'demo') {
          const meta = await rpc('meta.bootstrap');
          if (meta.needs_setup) await rpc('setup.demo');
        }
      }
      await onDone();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth">
      <Brand />
      <form className="auth-card stack" onSubmit={go}>
        <h2>How will you use this app?</h2>
        <button type="button" className={`choice-card ${mode === 'local' ? 'is-on' : ''}`} onClick={() => setMode('local')} aria-pressed={mode === 'local'}>
          <Icon name="box" size={24} />
          <span>
            <strong>On this device only</strong>
            <span>Data stays on this phone or browser. Good for a single user, a small unit, or trying the system. Back up regularly from Settings.</span>
          </span>
        </button>
        <button type="button" className={`choice-card ${mode === 'server' ? 'is-on' : ''}`} onClick={() => setMode('server')} aria-pressed={mode === 'server'}>
          <Icon name="database" size={24} />
          <span>
            <strong>Connect to hospital server</strong>
            <span>Shared data for the whole hospital: helpdesk tickets, approvals and work orders reach every user.</span>
          </span>
        </button>
        {mode === 'local' ? (
          <Field label="Start with">
            <Select
              value={start}
              onChange={(e) => setStart(e.target.value)}
              options={[
                ['demo', 'Demo hospital (sample data, all modules filled)'],
                ['empty', 'Empty system (set up my hospital)'],
              ]}
            />
          </Field>
        ) : (
          <Field label="Server address" hint="Ask your IT or biomedical unit, e.g. http://192.168.1.20:8080 or https://ams.myhospital.gov.my">
            <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="http://192.168.1.20:8080" inputMode="url" autoCapitalize="off" autoCorrect="off" required />
          </Field>
        )}
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <Button type="submit" busy={busy} className="btn-block">
          {mode === 'server' ? 'Connect' : start === 'demo' ? 'Load demo and continue' : 'Continue'}
        </Button>
        <p className="muted small">You can change this later in Settings → Connection.</p>
      </form>
    </div>
  );
}

export function ConnectionError({ error, onRetry, onReset }) {
  return (
    <div className="auth">
      <Brand />
      <div className="auth-card stack">
        <h2>Cannot start</h2>
        <p className="muted">{error?.message || 'The app could not reach its data.'}</p>
        <Button onClick={onRetry} icon="refresh">Try again</Button>
        <Button variant="secondary" onClick={onReset}>Change connection</Button>
      </div>
    </div>
  );
}

export function Setup({ meta, onDone, onChangeMode }) {
  const { adopt } = useApp();
  const [f, setF] = useState({ hospital_name: '', hospital_code: '', state: '', admin_full_name: '', admin_username: 'admin', admin_password: '', confirm: '', setup_code: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    if (f.admin_password !== f.confirm) {
      setError('Passwords do not match');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await rpc('setup.init', { ...f, hospital_code: f.hospital_code.toUpperCase() });
      await adopt(r.token, r.user);
      await onDone();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth">
      <Brand title="Set up your hospital" sub="One-time setup. Creates the administrator account." />
      <form className="auth-card stack" onSubmit={submit}>
        <Field label="Hospital name" required>
          <Input value={f.hospital_name} onChange={set('hospital_name')} placeholder="e.g. Hospital Sultanah …" required />
        </Field>
        <div className="form-grid">
          <Field label="Hospital code" hint="Used in tag numbers, e.g. HSA" required>
            <Input value={f.hospital_code} onChange={set('hospital_code')} maxLength={12} required style={{ textTransform: 'uppercase' }} />
          </Field>
          <Field label="State">
            <Input value={f.state} onChange={set('state')} placeholder="e.g. Johor" />
          </Field>
        </div>
        <Field label="Administrator full name" required>
          <Input value={f.admin_full_name} onChange={set('admin_full_name')} required />
        </Field>
        <Field label="Administrator username" required>
          <Input value={f.admin_username} onChange={set('admin_username')} autoCapitalize="off" required />
        </Field>
        <div className="form-grid">
          <Field label="Password" hint="At least 8 characters with letters and numbers" required>
            <Input type="password" value={f.admin_password} onChange={set('admin_password')} autoComplete="new-password" required />
          </Field>
          <Field label="Confirm password" required>
            <Input type="password" value={f.confirm} onChange={set('confirm')} autoComplete="new-password" required />
          </Field>
        </div>
        {meta.setup_code_required ? (
          <Field label="Setup code" hint="Shown in the server console when it started" required>
            <Input value={f.setup_code} onChange={set('setup_code')} inputMode="numeric" required />
          </Field>
        ) : null}
        <p className="muted small">A starter library of 15 departments and 21 equipment categories with PPM checklists is loaded. Edit them later in Master Data.</p>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <Button type="submit" busy={busy} className="btn-block">Create hospital</Button>
        <Button variant="ghost" onClick={onChangeMode}>Change connection</Button>
      </form>
    </div>
  );
}

const DEMO_USERS = [
  ['admin', 'Administrator · approves up to L3'],
  ['manager', 'Head of Biomedical · L2 approver'],
  ['engineer', 'Biomedical engineer · L1 approver'],
  ['tech1', 'Technician'],
  ['nurse', 'ICU nurse · raises helpdesk tickets'],
  ['director', 'Hospital director · L3 approver'],
  ['auditor', 'Viewer / auditor'],
];

export function Login({ meta, onChangeMode }) {
  const { login } = useApp();
  const [mode, setMode] = useState('login');
  const [f, setF] = useState({ username: '', password: '' });
  const [r, setR] = useState({ full_name: '', username: '', staff_no: '', department_id: '', designation: '', email: '', phone: '', requested_role: 'REQUESTER', password: '', confirm: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(f.username.trim(), f.password);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const register = async (e) => {
    e.preventDefault();
    if (r.password !== r.confirm) {
      setError('Passwords do not match');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await rpc('auth.register', r);
      setDone(res.message);
      setMode('login');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const setr = (k) => (e) => setR({ ...r, [k]: e.target.value });

  return (
    <div className="auth">
      <Brand title={meta.hospital_name} sub="BioMed AMS — biomedical equipment asset management" />
      {mode === 'login' ? (
        <form className="auth-card stack" onSubmit={submit}>
          <h2>Log in</h2>
          {done ? <div className="notice"><Icon name="checkCircle" /> <span>{done}</span></div> : null}
          <Field label="Username">
            <Input value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} autoComplete="username" autoCapitalize="off" autoCorrect="off" required />
          </Field>
          <Field label="Password">
            <Input type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} autoComplete="current-password" required />
          </Field>
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          <Button type="submit" busy={busy} className="btn-block">Log in</Button>
          {meta.demo ? (
            <div className="demo-creds">
              <p style={{ marginBottom: 6 }}><strong>Demo accounts</strong> — password <span className="mono">demo1234</span>. Tap a name to fill in.</p>
              <table>
                <tbody>
                  {DEMO_USERS.map(([u, d]) => (
                    <tr key={u}>
                      <td><button type="button" onClick={() => setF({ username: u, password: 'demo1234' })}>{u}</button></td>
                      <td className="muted">{d}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          <div className="row-between">
            <Button variant="ghost" size="sm" onClick={() => { setMode('register'); setError(null); setDone(null); }}>Register new account</Button>
            <Button variant="ghost" size="sm" onClick={onChangeMode}>Change connection</Button>
          </div>
        </form>
      ) : (
        <form className="auth-card stack" onSubmit={register}>
          <h2>Request an account</h2>
          <p className="muted small">An administrator approves new accounts and assigns your role and approval level.</p>
          <Field label="Full name" required><Input value={r.full_name} onChange={setr('full_name')} required /></Field>
          <div className="form-grid">
            <Field label="Username" required><Input value={r.username} onChange={setr('username')} autoCapitalize="off" required /></Field>
            <Field label="Staff number"><Input value={r.staff_no} onChange={setr('staff_no')} /></Field>
          </div>
          <Field label="Department" required>
            <Select value={r.department_id} onChange={setr('department_id')} placeholder="Select…" options={(meta.departments || []).map((d) => [d.id, d.name])} required />
          </Field>
          <div className="form-grid">
            <Field label="Designation"><Input value={r.designation} onChange={setr('designation')} placeholder="e.g. Staff Nurse" /></Field>
            <Field label="I need access as">
              <Select
                value={r.requested_role}
                onChange={setr('requested_role')}
                options={[
                  ['REQUESTER', 'Clinical user (report faults)'],
                  ['TECHNICIAN', 'Technician / assistant engineer'],
                  ['ENGINEER', 'Biomedical engineer'],
                  ['MANAGER', 'Manager / head of department'],
                  ['VIEWER', 'Viewer / auditor'],
                ]}
              />
            </Field>
            <Field label="Email"><Input type="email" value={r.email} onChange={setr('email')} /></Field>
            <Field label="Phone"><Input type="tel" value={r.phone} onChange={setr('phone')} /></Field>
            <Field label="Password" required><Input type="password" value={r.password} onChange={setr('password')} autoComplete="new-password" required /></Field>
            <Field label="Confirm password" required><Input type="password" value={r.confirm} onChange={setr('confirm')} autoComplete="new-password" required /></Field>
          </div>
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          <Button type="submit" busy={busy} className="btn-block">Submit registration</Button>
          <Button variant="ghost" onClick={() => { setMode('login'); setError(null); }}>Back to log in</Button>
        </form>
      )}
    </div>
  );
}

export function ForcedPasswordChange() {
  const { call, refreshMe, logout, toast } = useApp();
  const [f, setF] = useState({ current_password: '', new_password: '', confirm: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const submit = async (e) => {
    e.preventDefault();
    if (f.new_password !== f.confirm) {
      setError('Passwords do not match');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await call('auth.changePassword', f);
      toast('Password changed', 'good');
      await refreshMe();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="auth">
      <Brand title="Choose a new password" sub="Your administrator issued a temporary password." />
      <form className="auth-card stack" onSubmit={submit}>
        <Field label="Temporary / current password"><Input type="password" value={f.current_password} onChange={(e) => setF({ ...f, current_password: e.target.value })} required /></Field>
        <Field label="New password" hint="At least 8 characters with letters and numbers"><Input type="password" value={f.new_password} onChange={(e) => setF({ ...f, new_password: e.target.value })} autoComplete="new-password" required /></Field>
        <Field label="Confirm new password"><Input type="password" value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} autoComplete="new-password" required /></Field>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <Button type="submit" busy={busy} className="btn-block">Save password</Button>
        <Button variant="ghost" onClick={logout}>Log out</Button>
      </form>
    </div>
  );
}
