import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useApp } from '../lib/api.jsx';
import AssetPicker from '../components/AssetPicker.jsx';
import { Button, Card, Field, Input, PageHeader, Select, Textarea } from '../components/ui.jsx';
import { PRIORITY } from '../lib/format.js';
import { deptOptions } from '../lib/options.js';

export default function TicketNew() {
  const { call, toast, lookups, user, refreshBadges } = useApp();
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const [asset, setAsset] = useState(null);
  const [f, setF] = useState({
    category: 'BREAKDOWN',
    priority: 'P3',
    subject: '',
    description: '',
    department_id: user.department_id ? String(user.department_id) : '',
    location_text: '',
    contact_name: user.full_name,
    contact_phone: user.phone || '',
  });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const id = sp.get('asset');
    if (id) call('assets.get', { id }).then(setAsset).catch(() => {});
  }, [sp, call]);
  useEffect(() => {
    if (asset) setF((x) => ({ ...x, department_id: String(asset.department_id) }));
  }, [asset]);

  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await call('tickets.create', { ...f, asset_id: asset?.id ?? null });
      toast(`Ticket ${r.ticket_no} sent to the biomedical team`, 'good');
      refreshBadges();
      nav(`/tickets/${r.id}`, { replace: true });
    } catch (err) {
      toast(err.message, 'critical');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader back="/tickets" title="Report a fault" subtitle="Scan the asset tag or search for the equipment" />
      <form onSubmit={submit}>
        <Card>
          <div className="form-grid">
            <div className="full">
              <AssetPicker value={asset} onChange={setAsset} />
              <p className="field-hint" style={{ marginTop: 6 }}>Not tagged or cannot find it? Leave blank and describe the equipment below.</p>
            </div>
            <Field label="Problem type">
              <Select value={f.category} onChange={set('category')} options={Object.entries(lookups.ticket_categories)} />
            </Field>
            <Field label="Urgency" hint={PRIORITY[f.priority][2]}>
              <Select value={f.priority} onChange={set('priority')} options={Object.entries(PRIORITY).map(([k, v]) => [k, `${v[0]} — ${v[2]}`])} />
            </Field>
            <Field label="Subject" className="full" required>
              <Input value={f.subject} onChange={set('subject')} placeholder="e.g. Monitor NIBP not inflating" required />
            </Field>
            <Field label="Details" className="full">
              <Textarea value={f.description} onChange={set('description')} placeholder="Error message, when it started, is a backup unit available?" />
            </Field>
            {!asset ? (
              <>
                <Field label="Department" required>
                  <Select value={f.department_id} onChange={set('department_id')} placeholder="Select…" options={deptOptions(lookups)} required />
                </Field>
                <Field label="Exact location"><Input value={f.location_text} onChange={set('location_text')} placeholder="e.g. Bed 12, Ward 5A" /></Field>
              </>
            ) : null}
            <Field label="Contact person"><Input value={f.contact_name} onChange={set('contact_name')} /></Field>
            <Field label="Phone / extension"><Input value={f.contact_phone} onChange={set('contact_phone')} inputMode="tel" /></Field>
          </div>
          <div className="form-actions">
            <Button type="submit" busy={busy} icon="headset">Send to biomedical team</Button>
          </div>
        </Card>
      </form>
    </>
  );
}
