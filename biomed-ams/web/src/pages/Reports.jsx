import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useApp, useQuery } from '../lib/api.jsx';
import AssetPicker from '../components/AssetPicker.jsx';
import { Button, Card, DataTable, ErrorBox, Field, Input, Loading, PageHeader, Select } from '../components/ui.jsx';
import { Icon } from '../components/icons.jsx';
import { PERIODS, PPM_STATUS, WO_STATUS, todayInput } from '../lib/format.js';
import { catOptions, deptOptions, statusOptions } from '../lib/options.js';
import { displayCell, exportCsv, exportPdf, summaryValue } from '../lib/exporter.js';
import { isNative } from '../lib/platform.js';

const ASSET_STATUS_OPTS = [['IN_FLEET', 'In fleet (not disposed)'], ['ACTIVE', 'In service'], ['BREAKDOWN', 'Breakdown'], ['OUT_OF_SERVICE', 'Out of service'], ['STANDBY', 'Standby'], ['DISPOSED', 'Disposed']];

export default function Reports() {
  const { lookups, call, toast, can } = useApp();
  const [sp] = useSearchParams();
  const types = useQuery('reports.types', {});
  const [type, setType] = useState(sp.get('type') || 'ASSET_REGISTER');
  const [p, setP] = useState({ period: 'this_month', year: Number(todayInput().slice(0, 4)), group_by: 'department', horizon_days: 90 });
  const [asset, setAsset] = useState(null);
  const [report, setReport] = useState(null);
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    const id = sp.get('asset');
    if (id) call('assets.get', { id }).then(setAsset).catch(() => {});
  }, [sp, call]);

  const def = types.data?.[type];
  const has = (k) => def?.params.includes(k);
  const set = (k) => (e) => setP({ ...p, [k]: e.target.value });

  const run = async () => {
    setBusy(true);
    try {
      const params = { type, ...p };
      if (type === 'ASSET_HISTORY') params.asset_id = asset?.id;
      for (const k of Object.keys(params)) if (params[k] === '') delete params[k];
      setReport(await call('reports.run', params));
    } catch (e) {
      toast(e.message, 'critical');
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (sp.get('type') === 'ASSET_HISTORY' && asset) run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asset]);

  const doExport = async (kind) => {
    setExporting(true);
    try {
      if (kind === 'pdf') await exportPdf(report);
      else await exportCsv(report);
    } catch (e) {
      toast(e.message, 'critical');
    } finally {
      setExporting(false);
    }
  };

  if (!types.data) return types.error ? <ErrorBox error={types.error} onRetry={types.reload} /> : <Loading />;
  const available = Object.entries(types.data).filter(([k]) => !['PREDICTIVE', 'LIFESPAN', 'EXPENSES'].includes(k) || can('analytics.view'));

  return (
    <>
      <PageHeader title="Reports" subtitle="Preview, then save as PDF or CSV (Excel). On the phone, files open the share menu." />
      <Card className="no-print">
        <div className="form-grid">
          <Field label="Report" className="full">
            <Select value={type} onChange={(e) => { setType(e.target.value); setReport(null); }} options={available.map(([k, v]) => [k, v.label])} />
          </Field>
          {has('period') ? (
            <>
              <Field label="Period"><Select value={p.period} onChange={set('period')} options={PERIODS} /></Field>
              {p.period === 'custom' ? (
                <>
                  <Field label="From"><Input type="date" value={p.from || ''} onChange={set('from')} /></Field>
                  <Field label="To"><Input type="date" value={p.to || ''} onChange={set('to')} /></Field>
                </>
              ) : null}
            </>
          ) : null}
          {has('year') ? (
            <Field label="Year"><Input type="number" min="2000" max="2100" value={p.year} onChange={set('year')} /></Field>
          ) : null}
          {has('department') ? <Field label="Department"><Select value={p.department_id || ''} onChange={set('department_id')} placeholder="All departments" options={deptOptions(lookups)} /></Field> : null}
          {has('category') ? <Field label="Category"><Select value={p.category_id || ''} onChange={set('category_id')} placeholder="All categories" options={catOptions(lookups)} /></Field> : null}
          {has('status') ? <Field label="Asset status"><Select value={p.status || ''} onChange={set('status')} placeholder="Any" options={ASSET_STATUS_OPTS} /></Field> : null}
          {has('ppm_status') ? <Field label="PPM status"><Select value={p.ppm_status || ''} onChange={set('ppm_status')} placeholder="Any" options={statusOptions(PPM_STATUS)} /></Field> : null}
          {has('wo_status') ? <Field label="Work order status"><Select value={p.wo_status || ''} onChange={set('wo_status')} placeholder="Any" options={[['ACTIVE', 'Open (not completed)'], ...statusOptions(WO_STATUS)]} /></Field> : null}
          {has('group_by') ? <Field label="Group by"><Select value={p.group_by} onChange={set('group_by')} options={[['department', 'Department'], ['category', 'Category'], ['asset', 'Asset'], ['month', 'Month']]} /></Field> : null}
          {has('horizon') ? <Field label="Horizon"><Select value={p.horizon_days} onChange={set('horizon_days')} options={[[30, '30 days'], [90, '90 days'], [180, '6 months'], [365, '12 months']]} /></Field> : null}
          {has('asset') ? <div className="full"><AssetPicker value={asset} onChange={setAsset} required /></div> : null}
        </div>
        <div className="form-actions">
          <Button icon="file" busy={busy} onClick={run}>Preview report</Button>
        </div>
      </Card>

      {report ? (
        <div className="report-paper section-gap">
          <div className="row-between">
            <div>
              <div className="muted small">{report.hospital}</div>
              <h2 className="report-title">{report.title}</h2>
            </div>
            <div className="row no-print">
              <Button icon="download" busy={exporting} onClick={() => doExport('pdf')}>PDF</Button>
              <Button variant="secondary" busy={exporting} onClick={() => doExport('csv')}>CSV / Excel</Button>
              {!isNative() ? <Button variant="ghost" icon="printer" onClick={() => window.print()}>Print</Button> : null}
            </div>
          </div>
          <p className="report-meta">
            {report.subtitle ? `${report.subtitle} · ` : ''}Generated {displayCell({}, report.generated_at)} by {report.generated_by} · {report.rows.length} row(s)
          </p>
          {report.summary?.length ? (
            <div className="summary-list">
              {report.summary.map((s) => (
                <div key={s.label}><strong>{summaryValue(s)}</strong>{s.label}</div>
              ))}
            </div>
          ) : null}
          <DataTable
            columns={report.columns.map((c) => ({ ...c, render: (r) => displayCell(c, r[c.key]) || '—' }))}
            rows={report.rows.slice(0, 500)}
            rowKey={(r, i) => i}
            empty="No data for these filters"
          />
          {report.rows.length > 500 ? <p className="muted small pad"><Icon name="info" size={14} /> Preview shows 500 of {report.rows.length} rows; PDF and CSV contain all rows.</p> : null}
        </div>
      ) : null}
    </>
  );
}
