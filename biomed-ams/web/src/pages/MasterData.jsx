import { useState } from 'react';
import { useApp } from '../lib/api.jsx';
import { Badge, Button, Card, DataTable, Field, Input, Modal, PageHeader, SearchBox, Select, Tabs, Textarea, Toggle } from '../components/ui.jsx';
import { RISK_CLASS } from '../lib/format.js';
import { deptOptions } from '../lib/options.js';

const SPECS = {
  departments: {
    label: 'Departments',
    method: 'departments.save',
    blank: { code: '', name: '', type: 'Clinical', head_name: '', phone: '', active: true },
    columns: [
      { key: 'code', label: 'Code' },
      { key: 'name', label: 'Service department' },
      { key: 'type', label: 'Type' },
      { key: 'head_name', label: 'Head' },
    ],
  },
  locations: {
    label: 'Locations',
    method: 'locations.save',
    blank: { code: '', name: '', block: '', floor: '', department_id: '', active: true },
    columns: [
      { key: 'code', label: 'Code' },
      { key: 'name', label: 'Location' },
      { key: 'block', label: 'Block' },
      { key: 'floor', label: 'Level' },
      { key: 'department_name', label: 'Department' },
    ],
  },
  categories: {
    label: 'Equipment categories',
    method: 'categories.save',
    blank: { code: '', name: '', risk_class: 'B', criticality: 'Medium', ppm_frequency_months: 12, lifespan_years: 8, est_required: true, checklist: '', active: true },
    columns: [
      { key: 'code', label: 'Code' },
      { key: 'name', label: 'Category' },
      { key: 'risk_class', label: 'Class' },
      { key: 'criticality', label: 'Criticality' },
      { key: 'ppm_frequency_months', label: 'PPM (months)', align: 'right' },
      { key: 'lifespan_years', label: 'Life (yrs)', align: 'right' },
      { key: 'checklist', label: 'Checklist', align: 'right', render: (c) => `${c.checklist.length} items` },
    ],
  },
  vendors: {
    label: 'Vendors',
    method: 'vendors.save',
    blank: { name: '', type: 'Supplier', contact_person: '', phone: '', email: '', address: '', active: true },
    columns: [
      { key: 'name', label: 'Company' },
      { key: 'type', label: 'Type' },
      { key: 'contact_person', label: 'Contact' },
      { key: 'phone', label: 'Phone' },
    ],
  },
};

function Editor({ kind, row, onClose }) {
  const { lookups, call, toast, refreshLookups } = useApp();
  const spec = SPECS[kind];
  const [f, setF] = useState(() => {
    const base = { ...spec.blank, ...(row || {}) };
    if (kind === 'categories') base.checklist = Array.isArray(base.checklist) ? base.checklist.join('\n') : base.checklist;
    base.active = row ? !!row.active : true;
    if ('est_required' in base) base.est_required = !!base.est_required;
    return base;
  });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await call(spec.method, { ...f, id: row?.id, department_id: f.department_id || null });
      await refreshLookups();
      toast('Saved', 'good');
      onClose();
    } catch (err) {
      toast(err.message, 'critical');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open wide={kind === 'categories'} title={`${row ? 'Edit' : 'Add'} ${spec.label.toLowerCase().replace(/s$/, '')}`} onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit" form="md-form" busy={busy}>Save</Button></>}>
      <form id="md-form" className="form-grid" onSubmit={save}>
        {kind !== 'vendors' ? <Field label="Code" required><Input value={f.code} onChange={set('code')} required style={{ textTransform: 'uppercase' }} /></Field> : null}
        <Field label="Name" required><Input value={f.name} onChange={set('name')} required /></Field>
        {kind === 'departments' ? (
          <>
            <Field label="Type"><Select value={f.type} onChange={set('type')} options={['Clinical', 'Clinical Support', 'Non-Clinical']} /></Field>
            <Field label="Head of department"><Input value={f.head_name || ''} onChange={set('head_name')} /></Field>
            <Field label="Phone / extension"><Input value={f.phone || ''} onChange={set('phone')} /></Field>
          </>
        ) : null}
        {kind === 'locations' ? (
          <>
            <Field label="Block"><Input value={f.block || ''} onChange={set('block')} /></Field>
            <Field label="Level / floor"><Input value={f.floor || ''} onChange={set('floor')} /></Field>
            <Field label="Department"><Select value={f.department_id || ''} onChange={set('department_id')} placeholder="—" options={deptOptions(lookups)} /></Field>
          </>
        ) : null}
        {kind === 'categories' ? (
          <>
            <Field label="Risk class (Act 737)"><Select value={f.risk_class} onChange={set('risk_class')} options={Object.entries(RISK_CLASS)} /></Field>
            <Field label="Clinical criticality"><Select value={f.criticality} onChange={set('criticality')} options={['High', 'Medium', 'Low']} /></Field>
            <Field label="Default PPM frequency (months, 0 = none)"><Input type="number" min="0" max="60" value={f.ppm_frequency_months} onChange={set('ppm_frequency_months')} /></Field>
            <Field label="Expected lifespan (years)"><Input type="number" min="1" max="50" value={f.lifespan_years} onChange={set('lifespan_years')} /></Field>
            <div className="full"><Toggle checked={f.est_required} onChange={(v) => setF({ ...f, est_required: v })} label="Electrical safety test in PPM" /></div>
            <Field label="Default PPM checklist (one item per line)" className="full" hint="Copied into each new asset's PPM plan">
              <Textarea rows={10} value={f.checklist} onChange={set('checklist')} />
            </Field>
          </>
        ) : null}
        {kind === 'vendors' ? (
          <>
            <Field label="Type"><Select value={f.type} onChange={set('type')} options={lookups.vendor_types} /></Field>
            <Field label="Contact person"><Input value={f.contact_person || ''} onChange={set('contact_person')} /></Field>
            <Field label="Phone"><Input value={f.phone || ''} onChange={set('phone')} /></Field>
            <Field label="Email"><Input type="email" value={f.email || ''} onChange={set('email')} /></Field>
            <Field label="Address" className="full"><Textarea value={f.address || ''} onChange={set('address')} /></Field>
          </>
        ) : null}
        <div className="full"><Toggle checked={f.active} onChange={(v) => setF({ ...f, active: v })} label="Active" hint="Inactive entries stay on old records but cannot be chosen for new ones" /></div>
      </form>
    </Modal>
  );
}

export default function MasterData() {
  const { lookups } = useApp();
  const [tab, setTab] = useState('departments');
  const [edit, setEdit] = useState(null);
  const [q, setQ] = useState('');
  const spec = SPECS[tab];
  const rows = (lookups[tab] || []).filter((r) => !q || `${r.code || ''} ${r.name}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <>
      <PageHeader title="Master data" subtitle="Departments, locations, equipment categories (with PPM checklists) and vendors" actions={<Button icon="plus" onClick={() => setEdit({ row: null })}>Add</Button>} />
      <Tabs tabs={Object.entries(SPECS).map(([k, v]) => [k, v.label, (lookups[k] || []).length])} value={tab} onChange={(t) => { setTab(t); setQ(''); }} />
      <div className="toolbar"><SearchBox value={q} onChange={setQ} placeholder={`Search ${spec.label.toLowerCase()}`} /></div>
      <Card flush>
        <DataTable
          columns={[...spec.columns, { key: 'active', label: '', render: (r) => (r.active ? null : <Badge>Inactive</Badge>) }]}
          rows={rows}
          onRow={(r) => setEdit({ row: r })}
          empty="Nothing here yet"
        />
      </Card>
      {edit ? <Editor kind={tab} row={edit.row} onClose={() => setEdit(null)} /> : null}
    </>
  );
}
