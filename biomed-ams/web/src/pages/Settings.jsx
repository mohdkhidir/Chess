import { useEffect, useState } from 'react';
import { useApp, useQuery } from '../lib/api.jsx';
import { Button, Card, ErrorBox, Field, Input, KV, Loading, PageHeader, Segmented, Select, Tabs, Toggle } from '../components/ui.jsx';
import { Icon } from '../components/icons.jsx';
import { PRIORITY, money } from '../lib/format.js';
import { downloadBackup, getConfig, restoreLocal, wipeLocal } from '../lib/transport.js';
import { saveFile } from '../lib/platform.js';
import { getTheme, setTheme } from '../lib/theme.js';

const LEVEL_OPTS = [['0', 'No approval needed'], ['1', 'Level 1'], ['2', 'Level 1 → 2'], ['3', 'Level 1 → 2 → 3']];

function Display({ onChangeMode }) {
  const cfg = getConfig();
  const [theme, setT] = useState(getTheme());
  return (
    <div className="grid-2">
      <Card title="Connection">
        <KV items={[['Mode', cfg.mode === 'local' ? 'Standalone — data on this device' : 'Hospital server'], cfg.mode === 'server' ? ['Server', cfg.serverUrl || window.location.origin] : null]} />
        <div className="form-actions"><Button variant="secondary" icon="refresh" onClick={onChangeMode}>Change connection</Button></div>
        {cfg.mode === 'local' ? <p className="muted small">Switching to a server does not move this device's data. Send a backup to the administrator to load it on the server.</p> : null}
      </Card>
      <Card title="Display">
        <Field label="Theme">
          <Segmented value={theme} onChange={(v) => { setT(v); setTheme(v); }} options={[['system', 'System'], ['light', 'Light'], ['dark', 'Dark']]} ariaLabel="Theme" />
        </Field>
      </Card>
    </div>
  );
}

function DataTab() {
  const { call, toast } = useApp();
  const cfg = getConfig();
  const stats = useQuery('system.stats', {});
  const [busy, setBusy] = useState(null);
  const backup = async () => {
    setBusy('backup');
    try {
      const bytes = await downloadBackup();
      const d = new Date();
      const name = `biomed-ams-backup-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}.sqlite`;
      await saveFile(name, bytes, 'application/vnd.sqlite3');
      toast('Backup created', 'good');
    } catch (e) {
      toast(e.message, 'critical');
    } finally {
      setBusy(null);
    }
  };
  const restore = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!window.confirm('Replace ALL data on this device with the backup? This cannot be undone.')) return;
    setBusy('restore');
    try {
      await restoreLocal(new Uint8Array(await file.arrayBuffer()));
      toast('Backup restored — restarting', 'good');
      setTimeout(() => window.location.reload(), 800);
    } catch (err) {
      toast(err.message, 'critical');
      setBusy(null);
    }
  };
  const wipe = async () => {
    if (!window.confirm('Delete ALL data on this device? Make a backup first. This cannot be undone.')) return;
    if (window.prompt('Type DELETE to confirm') !== 'DELETE') return;
    await wipeLocal();
    localStorage.removeItem('ams.token');
    window.location.reload();
  };
  return (
    <div className="grid-2">
      <Card title="Backup" subtitle="A complete copy of the database (.sqlite)">
        <p className="muted" style={{ marginBottom: 12 }}>
          {cfg.mode === 'local'
            ? 'Data in standalone mode lives only on this device. Back up at least weekly and keep the file somewhere safe (e.g. Google Drive).'
            : 'Download a consistent copy of the hospital database. Schedule server-side backups as well.'}
        </p>
        <Button icon="download" busy={busy === 'backup'} onClick={backup}>Create backup</Button>
      </Card>
      {cfg.mode === 'local' ? (
        <Card title="Restore or reset" subtitle="Standalone mode only">
          <div className="stack">
            <Field label="Restore from a backup file" hint="Replaces everything on this device">
              <input className="input" type="file" accept=".sqlite,.db,application/octet-stream" onChange={restore} disabled={!!busy} />
            </Field>
            <Button variant="danger" icon="trash" onClick={wipe}>Delete all data on this device</Button>
          </div>
        </Card>
      ) : null}
      <Card title="Database">
        {stats.data ? (
          <KV items={[['App version', stats.data.version], ['Schema', `v${stats.data.schema_version}`], ...Object.entries(stats.data.counts).map(([k, v]) => [k.replace(/_/g, ' '), v])]} />
        ) : (
          <Loading />
        )}
      </Card>
    </div>
  );
}

export default function Settings({ onChangeMode }) {
  const { can, call, toast, refreshSettings, settings: live } = useApp();
  const admin = can('settings.manage');
  const [tab, setTab] = useState(admin ? 'general' : 'display');
  const { data, error, loading, reload } = useQuery('settings.get', {}, { enabled: admin });
  const [s, setS] = useState(null);
  const [preview, setPreview] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (data) {
      setS(JSON.parse(JSON.stringify(data.settings)));
      setPreview(data.tag_preview);
    }
  }, [data]);

  useEffect(() => {
    if (!s || !admin) return undefined;
    const t = setTimeout(() => {
      call('settings.previewTag', { tag_format: s.tag_format, hospital_code: s.hospital_code })
        .then((r) => setPreview(r.preview))
        .catch((e) => setPreview(`⚠ ${e.message}`));
    }, 300);
    return () => clearTimeout(t);
  }, [s?.tag_format, s?.hospital_code, admin, call]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async (keys) => {
    setBusy(true);
    try {
      const patch = Object.fromEntries(keys.map((k) => [k, s[k]]));
      await call('settings.save', { settings: patch });
      await refreshSettings();
      toast('Settings saved', 'good');
      reload();
    } catch (e) {
      toast(e.message, 'critical');
    } finally {
      setBusy(false);
    }
  };

  const set = (k, v) => setS({ ...s, [k]: v });
  const inp = (k, type = 'text') => <Input type={type} value={s[k] ?? ''} onChange={(e) => set(k, type === 'number' ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value)} />;
  const nested = (k, sub, type = 'number') => (
    <Input type={type} min="0" step="any" value={s[k][sub] ?? ''} onChange={(e) => setS({ ...s, [k]: { ...s[k], [sub]: type === 'number' ? Number(e.target.value) : e.target.value } })} />
  );
  const saveBar = (keys) => (
    <div className="form-actions"><Button icon="check" busy={busy} onClick={() => save(keys)}>Save</Button></div>
  );

  const tabs = admin
    ? [['general', 'Hospital'], ['tagging', 'Asset tagging'], ['kpi', 'KPI targets'], ['approvals', 'Approval levels'], ['analytics', 'Predictive & lifespan'], ['data', 'Data & backup'], ['display', 'Connection & display']]
    : [['display', 'Connection & display'], ...(can('system.backup') ? [['data', 'Data & backup']] : [])];

  return (
    <>
      <PageHeader title="System settings" subtitle={admin ? live.hospital_name : 'Personal and device settings'} />
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      {tab === 'display' ? <Display onChangeMode={onChangeMode} /> : null}
      {tab === 'data' ? <DataTab /> : null}
      {admin && !['display', 'data'].includes(tab) ? (
        error ? <ErrorBox error={error} onRetry={reload} /> : !s || loading ? <Loading /> : (
          <>
            {tab === 'general' ? (
              <Card>
                <div className="form-grid">
                  <Field label="Hospital name" required>{inp('hospital_name')}</Field>
                  <Field label="Hospital code" hint="Used in tag numbers" required>{inp('hospital_code')}</Field>
                  <Field label="Address" className="full">{inp('hospital_address')}</Field>
                  <Field label="State">{inp('state')}</Field>
                  <Field label="Time zone" hint="Malaysia: Asia/Kuala_Lumpur (UTC+8)">{inp('timezone')}</Field>
                  <Field label="Currency">{inp('currency')}</Field>
                  <Field label="In-house labour rate (RM / hour)" hint="Used to cost technician hours on PPM and repairs">{inp('labour_rate', 'number')}</Field>
                  <Field label="Login session length (hours)">{inp('session_hours', 'number')}</Field>
                </div>
                {saveBar(['hospital_name', 'hospital_code', 'hospital_address', 'state', 'timezone', 'currency', 'labour_rate', 'session_hours'])}
              </Card>
            ) : null}

            {tab === 'tagging' ? (
              <Card title="Tag number format" subtitle="Applied to new registrations; existing tags never change">
                <div className="form-grid">
                  <Field label="Format" className="full">{inp('tag_format')}</Field>
                  <div className="full notice"><Icon name="tag" /> <span>Next tag looks like <strong className="mono">{preview}</strong></span></div>
                  <div className="full">
                    <table className="table">
                      <tbody>
                        {data.tag_tokens.map(([t, d]) => (
                          <tr key={t}><td className="mono"><button type="button" className="btn btn-ghost btn-sm" onClick={() => set('tag_format', `${s.tag_format}${t}`)}>{t}</button></td><td>{d}</td></tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="full row">
                    <span className="muted small">Presets:</span>
                    <Button size="sm" variant="secondary" onClick={() => set('tag_format', '{HOSP}/{CAT}/{YYYY}/{SEQ5}')}>HOSP/CAT/YYYY/00001</Button>
                    <Button size="sm" variant="secondary" onClick={() => set('tag_format', 'KKM/{HOSP}/{CLS}/{YY}/{SEQ5}')}>Government (KEW.PA style)</Button>
                    <Button size="sm" variant="secondary" onClick={() => set('tag_format', '{HOSP}-{CAT}{SEQ6}')}>HOSP-CAT000001</Button>
                  </div>
                  <Field label="Capital asset threshold (RM)" hint={`Purchase cost at or above ${money(s.capital_threshold)} = capital asset (H); below = inventory (I). Check the current Treasury circular for government hospitals.`}>{inp('capital_threshold', 'number')}</Field>
                </div>
                {saveBar(['tag_format', 'capital_threshold'])}
              </Card>
            ) : null}

            {tab === 'kpi' ? (
              <Card>
                <div className="form-grid">
                  <div className="form-section">Targets (%)</div>
                  <Field label="PPM completion target">{inp('kpi_ppm_target', 'number')}</Field>
                  <Field label="Work order closure target">{inp('kpi_cm_closure_target', 'number')}</Field>
                  <Field label="Uptime target">{inp('kpi_uptime_target', 'number')}</Field>
                  <Field label="PPM grace days after month end" hint="0 = PPM must be done within its scheduled month">{inp('ppm_grace_days', 'number')}</Field>
                  <Field label="PPM planning horizon (months)">{inp('ppm_horizon_months', 'number')}</Field>
                  <div className="form-section">Response time targets (hours)</div>
                  {Object.keys(PRIORITY).map((p) => <Field key={p} label={`${PRIORITY[p][0]} — ${PRIORITY[p][2]}`}>{nested('response_target_hours', p)}</Field>)}
                  <div className="form-section">Repair completion targets (days)</div>
                  {Object.keys(PRIORITY).map((p) => <Field key={p} label={PRIORITY[p][0]}>{nested('repair_target_days', p)}</Field>)}
                </div>
                {saveBar(['kpi_ppm_target', 'kpi_cm_closure_target', 'kpi_uptime_target', 'ppm_grace_days', 'ppm_horizon_months', 'response_target_hours', 'repair_target_days'])}
              </Card>
            ) : null}

            {tab === 'approvals' ? (
              <Card title="Levels of approval" subtitle="Give users an approval level (0–3) in Users. A higher level can also approve lower levels.">
                <div className="form-grid">
                  <div className="form-section">Level names</div>
                  {[1, 2, 3].map((l) => <Field key={l} label={`Level ${l}`}>{nested('approval_level_names', l, 'text')}</Field>)}
                  <div className="form-section">What needs approval</div>
                  {Object.entries({ ASSET_REGISTRATION: 'New asset registration', ASSET_TRANSFER: 'Asset transfer', ASSET_DISPOSAL: 'Asset disposal / condemnation', PPM_DEFERRAL: 'PPM deferral' }).map(([k, label]) => (
                    <Field key={k} label={label}>
                      <Select value={String(s.approval_rules[k])} onChange={(e) => setS({ ...s, approval_rules: { ...s.approval_rules, [k]: Number(e.target.value) } })} options={LEVEL_OPTS} />
                    </Field>
                  ))}
                  <div className="form-section">Repair cost approval (work orders)</div>
                  <Field label="Level 1 approves up to (RM)">{inp('wo_cost_level1_max', 'number')}</Field>
                  <Field label="Level 2 approves up to (RM)" hint="Above this needs level 3">{inp('wo_cost_level2_max', 'number')}</Field>
                  <div className="full">
                    <Toggle checked={!!s.allow_self_approval} onChange={(v) => set('allow_self_approval', v)} label="Allow people to approve their own requests" hint="Off is recommended (segregation of duties)" />
                  </div>
                </div>
                {saveBar(['approval_level_names', 'approval_rules', 'wo_cost_level1_max', 'wo_cost_level2_max', 'allow_self_approval'])}
              </Card>
            ) : null}

            {tab === 'analytics' ? (
              <Card>
                <div className="form-grid">
                  <Field label="Predictive inspection threshold (risk score)" hint="Generate inspections for assets at or above this score">{inp('pdm_risk_threshold', 'number')}</Field>
                  <Field label="Default prediction horizon">
                    <Select value={String(s.pdm_horizon_days)} onChange={(e) => set('pdm_horizon_days', Number(e.target.value))} options={[['30', '30 days'], ['60', '60 days'], ['90', '90 days'], ['180', '180 days'], ['365', '365 days']]} />
                  </Field>
                  <Field label="Replacement review at maintenance cost (% of purchase)" hint="Common rule of thumb: 50%">{inp('replacement_cost_ratio', 'number')}</Field>
                  <Field label="Price inflation for replacement forecast (% / year)">{inp('inflation_rate', 'number')}</Field>
                </div>
                {saveBar(['pdm_risk_threshold', 'pdm_horizon_days', 'replacement_cost_ratio', 'inflation_rate'])}
              </Card>
            ) : null}
          </>
        )
      ) : null}
    </>
  );
}
