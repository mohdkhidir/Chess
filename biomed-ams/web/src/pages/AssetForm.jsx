import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useApp, useQuery } from '../lib/api.jsx';
import { Button, Card, ErrorBox, Field, Input, LinkButton, Loading, PageHeader, Select, Textarea, Toggle } from '../components/ui.jsx';
import { Icon } from '../components/icons.jsx';
import { RISK_CLASS, money } from '../lib/format.js';
import { catOptions, deptOptions, locOptions, vendorOptions } from '../lib/options.js';
import { exportLabels, qrDataUrl } from '../lib/exporter.js';

const EMPTY = {
  name: '', category_id: '', manufacturer: '', model: '', serial_no: '', tag_no: '',
  department_id: '', location_id: '', supplier_id: '', service_vendor_id: '',
  purchase_date: '', commissioning_date: '', warranty_end: '', purchase_cost: '', po_no: '', funding: '',
  mda_reg_no: '', risk_class: '', criticality: '', lifespan_years: '', salvage_value: '',
  ppm_required: true, ppm_frequency_months: '', remarks: '', initial_status: 'ACTIVE',
};

function Created({ result, onAnother }) {
  const { settings } = useApp();
  const [qr, setQr] = useState(null);
  useEffect(() => {
    qrDataUrl(result.tag_no).then(setQr);
  }, [result.tag_no]);
  return (
    <Card>
      <div className="stack" style={{ alignItems: 'center', textAlign: 'center' }}>
        <Icon name="checkCircle" size={40} />
        <h2>Asset registered</h2>
        <p className="muted">Tag number generated</p>
        <div className="qr-preview">
          {qr ? <img src={qr} alt={`QR code for ${result.tag_no}`} /> : null}
          <div style={{ textAlign: 'left' }}>
            <div className="mono" style={{ fontSize: '1.3rem', fontWeight: 700 }}>{result.tag_no}</div>
            <div className="muted small">{result.name}</div>
          </div>
        </div>
        {result.status === 'PENDING' ? (
          <div className="notice warn"><Icon name="clock" /> <span>Waiting for registration approval. It becomes active (and its PPM schedule starts) once approved.</span></div>
        ) : (
          <div className="notice"><Icon name="calendar" /> <span>The asset is in service and its PPM schedule has been generated.</span></div>
        )}
        <div className="row" style={{ justifyContent: 'center' }}>
          <Button icon="printer" onClick={() => exportLabels([{ tag_no: result.tag_no, name: result.name, serial_no: result.serial_no }], settings.hospital_name)}>Print tag label</Button>
          <LinkButton to={`/assets/${result.id}`} icon="box">View asset</LinkButton>
          <Button variant="ghost" icon="plus" onClick={onAnother}>Register another</Button>
        </div>
      </div>
    </Card>
  );
}

export default function AssetForm() {
  const { id } = useParams();
  const editing = !!id;
  const nav = useNavigate();
  const { lookups, call, toast, settings, can, refreshBadges } = useApp();
  const existing = useQuery('assets.get', { id }, { enabled: editing });
  const [f, setF] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [created, setCreated] = useState(null);

  useEffect(() => {
    if (editing && existing.data) {
      const a = existing.data;
      const v = {};
      for (const k of Object.keys(EMPTY)) v[k] = a[k] ?? '';
      v.ppm_required = !!a.ppm_required;
      setF(v);
    }
  }, [editing, existing.data]);

  const cat = useMemo(() => lookups.categories.find((c) => String(c.id) === String(f.category_id)), [lookups, f.category_id]);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e && e.target ? e.target.value : e }));
  const pickCategory = (e) => {
    const c = lookups.categories.find((x) => String(x.id) === e.target.value);
    setF((x) => ({
      ...x,
      category_id: e.target.value,
      name: !x.name || lookups.categories.some((y) => y.name === x.name) ? c?.name || '' : x.name,
      risk_class: c?.risk_class || x.risk_class,
      criticality: c?.criticality || x.criticality,
    }));
  };

  const moveLocked = editing && existing.data && existing.data.status !== 'PENDING' && !can('asset.status');

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const payload = { ...f };
    for (const k of ['location_id', 'supplier_id', 'service_vendor_id', 'lifespan_years', 'purchase_cost', 'salvage_value', 'ppm_frequency_months']) {
      if (payload[k] === '') payload[k] = null;
    }
    try {
      if (editing) {
        delete payload.ppm_frequency_months;
        delete payload.initial_status;
        if (payload.tag_no === existing.data.tag_no) delete payload.tag_no;
        if (moveLocked) {
          delete payload.department_id;
          delete payload.location_id;
        }
        const r = await call('assets.update', { id, ...payload });
        toast(r.changed.length ? 'Asset updated' : 'No changes', 'good');
        nav(`/assets/${id}`, { replace: true });
      } else {
        if (payload.ppm_frequency_months === null) delete payload.ppm_frequency_months;
        const r = await call('assets.create', payload);
        refreshBadges();
        setCreated({ ...r, name: f.name, serial_no: f.serial_no });
        window.scrollTo(0, 0);
      }
    } catch (err) {
      setError(err.message);
      toast(err.message, 'critical');
    } finally {
      setBusy(false);
    }
  };

  if (editing && existing.loading && !existing.data) return <Loading />;
  if (editing && existing.error) return <ErrorBox error={existing.error} onRetry={existing.reload} />;
  if (created) {
    return (
      <>
        <PageHeader title="Register asset" back="/assets" />
        <Created result={created} onAnother={() => { setCreated(null); setF({ ...EMPTY, department_id: f.department_id, category_id: f.category_id, name: f.name }); }} />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={editing ? `Edit ${existing.data?.tag_no || ''}` : 'Register asset'}
        subtitle={editing ? existing.data?.name : 'A unique tag number is generated when you save'}
        back="/assets"
      />
      <form onSubmit={submit}>
        <Card>
          <div className="form-grid">
            <div className="form-section">Identification</div>
            <Field label="Equipment category" required>
              <Select value={f.category_id} onChange={pickCategory} placeholder="Select category…" options={catOptions(lookups)} required />
            </Field>
            <Field label="Equipment name" required>
              <Input value={f.name} onChange={set('name')} required />
            </Field>
            <Field label="Manufacturer"><Input value={f.manufacturer} onChange={set('manufacturer')} /></Field>
            <Field label="Model"><Input value={f.model} onChange={set('model')} /></Field>
            <Field label="Serial number"><Input value={f.serial_no} onChange={set('serial_no')} autoCapitalize="characters" /></Field>
            {!editing ? (
              <Field label="Existing tag number" hint={`Leave blank to generate one (${settings.tag_format}). Fill in only for equipment already tagged.`}>
                <Input value={f.tag_no} onChange={set('tag_no')} autoCapitalize="characters" />
              </Field>
            ) : can('users.manage') ? (
              <Field label="Tag number" hint="Administrators only. Changing a tag means re-labelling the device.">
                <Input value={f.tag_no} onChange={set('tag_no')} autoCapitalize="characters" required />
              </Field>
            ) : null}

            <div className="form-section">Location & service department</div>
            <Field label="Service department" required hint={moveLocked ? 'Use "Transfer" on the asset page to move it' : undefined}>
              <Select value={f.department_id} onChange={(e) => setF((x) => ({ ...x, department_id: e.target.value, location_id: '' }))} placeholder="Select department…" options={deptOptions(lookups)} required disabled={moveLocked} />
            </Field>
            <Field label="Location">
              <Select value={f.location_id} onChange={set('location_id')} placeholder="—" options={locOptions(lookups, f.department_id)} disabled={moveLocked} />
            </Field>

            <div className="form-section">Procurement</div>
            <Field label="Supplier"><Select value={f.supplier_id} onChange={set('supplier_id')} placeholder="—" options={vendorOptions(lookups)} /></Field>
            <Field label="PO / LO number"><Input value={f.po_no} onChange={set('po_no')} /></Field>
            <Field label="Purchase date"><Input type="date" value={f.purchase_date} onChange={set('purchase_date')} /></Field>
            <Field label="Testing & commissioning date" hint="Start of service life and PPM cycle"><Input type="date" value={f.commissioning_date} onChange={set('commissioning_date')} /></Field>
            <Field label="Purchase cost (RM)" hint={f.purchase_cost !== '' ? `${money(f.purchase_cost)} · ${Number(f.purchase_cost) >= settings.capital_threshold ? 'capital asset (H)' : 'inventory item (I)'}` : `Capital asset threshold ${money(settings.capital_threshold)}`}>
              <Input type="number" inputMode="decimal" min="0" step="0.01" value={f.purchase_cost} onChange={set('purchase_cost')} />
            </Field>
            <Field label="Funding"><Select value={f.funding} onChange={set('funding')} placeholder="—" options={lookups.funding_sources} /></Field>
            <Field label="Warranty end"><Input type="date" value={f.warranty_end} onChange={set('warranty_end')} /></Field>

            <div className="form-section">Regulatory & risk</div>
            <Field label="MDA registration no." hint="Medical Device Authority (Act 737) registration number"><Input value={f.mda_reg_no} onChange={set('mda_reg_no')} /></Field>
            <Field label="Device risk class"><Select value={f.risk_class} onChange={set('risk_class')} placeholder="From category" options={Object.entries(RISK_CLASS)} /></Field>
            <Field label="Clinical criticality"><Select value={f.criticality} onChange={set('criticality')} placeholder="From category" options={['High', 'Medium', 'Low']} /></Field>
            <Field label="Expected lifespan (years)" hint={cat ? `Category default: ${cat.lifespan_years} years` : undefined}><Input type="number" min="1" max="50" value={f.lifespan_years} onChange={set('lifespan_years')} /></Field>
            <Field label="Salvage value (RM)"><Input type="number" min="0" step="0.01" value={f.salvage_value} onChange={set('salvage_value')} /></Field>

            <div className="form-section">Maintenance</div>
            <Field label="Service vendor (if outsourced)"><Select value={f.service_vendor_id} onChange={set('service_vendor_id')} placeholder="In-house" options={vendorOptions(lookups)} /></Field>
            {!editing ? (
              <>
                <Field label="PPM frequency (months)" hint={cat ? `Category default: every ${cat.ppm_frequency_months} months` : 'Choose a category first'}>
                  <Input type="number" min="1" max="60" value={f.ppm_frequency_months} onChange={set('ppm_frequency_months')} placeholder={cat ? String(cat.ppm_frequency_months) : ''} disabled={!f.ppm_required} />
                </Field>
                <div className="full">
                  <Toggle checked={f.ppm_required} onChange={(v) => setF((x) => ({ ...x, ppm_required: v }))} label="Include in PPM programme" hint="A PPM plan and 12-month schedule are created from the category checklist" />
                </div>
                <Field label="Status after approval">
                  <Select value={f.initial_status} onChange={set('initial_status')} options={[['ACTIVE', 'In service'], ['STANDBY', 'Standby / spare']]} />
                </Field>
              </>
            ) : null}
            <Field label="Remarks" className="full"><Textarea value={f.remarks} onChange={set('remarks')} /></Field>
          </div>
          {error ? <p className="form-error" role="alert" style={{ marginTop: 12 }}>{error}</p> : null}
          <div className="form-actions">
            <Link to={editing ? `/assets/${id}` : '/assets'} className="btn btn-ghost">Cancel</Link>
            <Button type="submit" busy={busy} icon="check">{editing ? 'Save changes' : 'Register & generate tag'}</Button>
          </div>
        </Card>
      </form>
    </>
  );
}
