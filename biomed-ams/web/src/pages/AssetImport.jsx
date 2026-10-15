import { useState } from 'react';
import { useApp } from '../lib/api.jsx';
import { Button, Card, DataTable, Field, PageHeader, Toggle } from '../components/ui.jsx';
import { Icon } from '../components/icons.jsx';
import { saveFile } from '../lib/platform.js';

const COLUMNS = [
  ['tag_no', 'Existing tag number (blank = generate)'],
  ['name', 'Equipment name'],
  ['category_code', 'Category code, e.g. INF'],
  ['department_code', 'Department code, e.g. ICU'],
  ['location_code', 'Location code (optional)'],
  ['manufacturer', ''],
  ['model', ''],
  ['serial_no', ''],
  ['purchase_date', 'DD/MM/YYYY or YYYY-MM-DD'],
  ['commissioning_date', 'DD/MM/YYYY or YYYY-MM-DD'],
  ['warranty_end', 'DD/MM/YYYY or YYYY-MM-DD'],
  ['purchase_cost', 'RM, e.g. 7500.00'],
  ['po_no', ''],
  ['funding', ''],
  ['supplier', 'Vendor name as in Master Data'],
  ['mda_reg_no', ''],
  ['remarks', ''],
];

const ALIASES = {
  tag: 'tag_no', 'tag no': 'tag_no', 'asset tag': 'tag_no', 'no. tag': 'tag_no',
  equipment: 'name', 'equipment name': 'name', description: 'name',
  category: 'category_code', department: 'department_code', dept: 'department_code', location: 'location_code',
  brand: 'manufacturer', serial: 'serial_no', 'serial number': 'serial_no', 'serial no': 'serial_no',
  cost: 'purchase_cost', price: 'purchase_cost', 'purchase price': 'purchase_cost', po: 'po_no', 'lo no': 'po_no',
};

export function parseCsv(text) {
  const src = text.replace(/^﻿/, '');
  const firstLine = src.split(/\r?\n/, 1)[0] || '';
  const delim = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ';' : ',';
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delim) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

export default function AssetImport() {
  const { call, toast, lookups } = useApp();
  const [rows, setRows] = useState(null);
  const [fileName, setFileName] = useState('');
  const [strict, setStrict] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  const template = () => {
    const sampleCat = lookups.categories[0]?.code || 'INF';
    const sampleDept = lookups.departments[0]?.code || 'ICU';
    const csv = `${COLUMNS.map((c) => c[0]).join(',')}\r\n,Infusion Pump,${sampleCat},${sampleDept},,B. Braun,Infusomat Space,SN123456,15/03/2022,01/04/2022,01/04/2024,7500.00,PO-2022-0012,Government,,,\r\n`;
    saveFile('asset-import-template.csv', `﻿${csv}`, 'text/csv');
  };

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setResult(null);
    setFileName(file.name);
    const text = await file.text();
    const table = parseCsv(text);
    if (table.length < 2) {
      toast('The file has no data rows', 'critical');
      return;
    }
    const header = table[0].map((h) => {
      const k = h.trim().toLowerCase();
      return ALIASES[k] || k.replace(/\s+/g, '_');
    });
    const parsed = table.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] || '').trim()])));
    setRows(parsed);
  };

  const run = async () => {
    setBusy(true);
    try {
      const r = await call('assets.import', { rows, all_or_nothing: strict });
      setResult(r);
      toast(`${r.created} asset(s) imported${r.errors.length ? `, ${r.errors.length} row(s) skipped` : ''}`, r.errors.length ? 'warning' : 'good');
    } catch (e) {
      toast(e.message, 'critical');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader back="/assets" title="Import assets from CSV" subtitle="Bring in an existing equipment list from Excel (save as CSV UTF-8)" />
      <Card title="1. Prepare the file">
        <p className="muted" style={{ marginBottom: 10 }}>
          Columns (first row = headers): <span className="mono">{COLUMNS.map((c) => c[0]).join(', ')}</span>. Category, department and location codes must exist in Master Data.
          Imported assets are activated directly and get a PPM plan from their category.
        </p>
        <Button variant="secondary" icon="download" onClick={template}>Download template</Button>
      </Card>
      <Card title="2. Choose the file">
        <Field label="CSV file">
          <input className="input" type="file" accept=".csv,text/csv" onChange={onFile} />
        </Field>
        {rows ? <p className="muted small" style={{ marginTop: 8 }}>{fileName}: {rows.length} row(s) found.</p> : null}
      </Card>
      {rows ? (
        <Card title="3. Check and import" subtitle="First 10 rows">
          <DataTable
            columns={[
              { key: 'tag_no', label: 'Tag' },
              { key: 'name', label: 'Name' },
              { key: 'category_code', label: 'Cat' },
              { key: 'department_code', label: 'Dept' },
              { key: 'serial_no', label: 'Serial' },
              { key: 'purchase_date', label: 'Purchased' },
              { key: 'purchase_cost', label: 'Cost', align: 'right' },
            ]}
            rows={rows.slice(0, 10)}
            rowKey={(_, i) => i}
          />
          <div className="stack section-gap">
            <Toggle checked={strict} onChange={setStrict} label="All or nothing" hint="Cancel the whole import if any row has an error" />
            <Button icon="upload" busy={busy} onClick={run}>Import {rows.length} row(s)</Button>
          </div>
        </Card>
      ) : null}
      {result ? (
        <Card title="Result">
          <p><Icon name="checkCircle" size={18} /> {result.created} asset(s) created.</p>
          {result.errors.length ? (
            <DataTable columns={[{ key: 'row', label: 'Row' }, { key: 'message', label: 'Problem' }]} rows={result.errors} rowKey={(r) => r.row} />
          ) : null}
        </Card>
      ) : null}
    </>
  );
}
