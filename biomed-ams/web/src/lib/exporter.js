// CSV / PDF export for reports and QR tag labels. Libraries load on first use only.
import { saveFile } from './platform.js';

const pad2 = (n) => String(n).padStart(2, '0');

function stamp() {
  const d = new Date();
  return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}-${pad2(d.getHours())}${pad2(d.getMinutes())}`;
}

const slug = (s) => String(s || 'report').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50);

// Malaysian day-first dates for printed output.
function displayDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/.exec(s);
  if (!m) return s;
  return `${m[3]}/${m[2]}/${m[1]}${m[4] ? ` ${m[4]}:${m[5]}` : ''}`;
}

const nf2 = new Intl.NumberFormat('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nf1 = new Intl.NumberFormat('en-MY', { maximumFractionDigits: 1 });

export function displayCell(col, v) {
  if (v === null || v === undefined || v === '') return '';
  if (col.format === 'money') return nf2.format(Number(v));
  if (col.format === 'pct') return `${nf1.format(Number(v))}%`;
  if (col.format === 'num') return nf1.format(Number(v));
  const s = String(v);
  return /^\d{4}-\d{2}-\d{2}( \d{2}:\d{2}(:\d{2})?)?$/.test(s) ? displayDate(s) : s;
}

export function summaryValue(s) {
  if (s.value === null || s.value === undefined || s.value === '') return '—';
  if (s.format === 'money') return `RM ${nf2.format(Number(s.value))}`;
  if (s.format === 'pct') return `${nf1.format(Number(s.value))}%`;
  return String(s.value);
}

// ---------------- CSV ----------------

function csvCell(v) {
  let s = v === null || v === undefined ? '' : String(v);
  // Stop spreadsheet formula injection from free-text fields.
  if (/^[=+@\t\r-]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function reportToCsv(report) {
  const lines = [
    csvCell(report.title),
    csvCell(`${report.hospital} - generated ${report.generated_at} by ${report.generated_by}`),
  ];
  if (report.subtitle) lines.push(csvCell(report.subtitle));
  lines.push('');
  lines.push(report.columns.map((c) => csvCell(c.label)).join(','));
  for (const r of report.rows) lines.push(report.columns.map((c) => csvCell(r[c.key])).join(','));
  if (report.summary && report.summary.length) {
    lines.push('');
    for (const s of report.summary) lines.push(`${csvCell(s.label)},${csvCell(s.value)}`);
  }
  return `﻿${lines.join('\r\n')}`;
}

export async function exportCsv(report) {
  await saveFile(`${slug(report.title)}-${stamp()}.csv`, reportToCsv(report), 'text/csv;charset=utf-8');
}

export function rowsToCsv(columns, rows) {
  return `﻿${[columns.map((c) => csvCell(c.label)).join(','), ...rows.map((r) => columns.map((c) => csvCell(r[c.key])).join(','))].join('\r\n')}`;
}

// ---------------- PDF ----------------

// The built-in PDF fonts only cover Windows-1252; map the few symbols we use and drop the rest.
const PDF_MAP = { '≥': '>=', '≤': '<=', '→': '->', '←': '<-', '✓': 'OK', '✗': 'X', '×': 'x', 'µ': 'u', 'Ω': 'ohm' };
export function pdfText(v) {
  return String(v ?? '')
    .replace(/[≥≤→←✓✗×µΩ]/g, (c) => PDF_MAP[c])
    .replace(/[^\x20-\x7e\xa0-\xff–—‘’“”•…€\n]/g, '?');
}

async function pdfLibs() {
  const [{ jsPDF }, { autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  return { jsPDF, autoTable };
}

export async function reportToPdf(report) {
  const { jsPDF, autoTable } = await pdfLibs();
  const landscape = report.orientation === 'landscape';
  const doc = new jsPDF({ orientation: landscape ? 'landscape' : 'portrait', unit: 'mm', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(82, 81, 78);
  doc.text(pdfText(report.hospital), 14, 14);
  doc.setFontSize(15);
  doc.setTextColor(11, 11, 11);
  doc.text(pdfText(report.title), 14, 22);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(82, 81, 78);
  let y = 28;
  if (report.subtitle) {
    const lines = doc.splitTextToSize(pdfText(report.subtitle), W - 28);
    doc.text(lines, 14, y);
    y += lines.length * 4;
  }
  doc.text(pdfText(`Generated ${displayDate(report.generated_at)} by ${report.generated_by}`), 14, y);
  y += 4;

  const right = new Set(report.columns.map((c, i) => (c.align === 'right' ? i : -1)).filter((i) => i >= 0));
  const center = new Set(report.columns.map((c, i) => (c.align === 'center' ? i : -1)).filter((i) => i >= 0));
  const columnStyles = {};
  report.columns.forEach((_, i) => {
    if (right.has(i)) columnStyles[i] = { halign: 'right' };
    if (center.has(i)) columnStyles[i] = { halign: 'center' };
  });
  autoTable(doc, {
    startY: y + 2,
    head: [report.columns.map((c) => pdfText(c.label))],
    body: report.rows.map((r) => report.columns.map((c) => pdfText(displayCell(c, r[c.key])))),
    styles: { fontSize: report.columns.length > 12 ? 6.5 : 7.5, cellPadding: 1.4, overflow: 'linebreak', lineColor: [225, 224, 217], lineWidth: 0.1 },
    headStyles: { fillColor: [28, 92, 171], textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [246, 246, 243] },
    columnStyles,
    margin: { left: 12, right: 12, bottom: 14 },
    didDrawPage: () => {
      doc.setFontSize(7.5);
      doc.setTextColor(137, 135, 129);
      doc.text(pdfText(`${report.title} — BioMed AMS`), 12, H - 7);
      doc.text(`Page ${doc.getCurrentPageInfo().pageNumber}`, W - 12, H - 7, { align: 'right' });
    },
  });
  if (report.summary && report.summary.length) {
    autoTable(doc, {
      startY: doc.lastAutoTable.finalY + 6,
      head: [['Summary', '']],
      body: report.summary.map((s) => [pdfText(s.label), pdfText(summaryValue(s))]),
      styles: { fontSize: 8, cellPadding: 1.4 },
      headStyles: { fillColor: [235, 235, 230], textColor: 20 },
      columnStyles: { 1: { halign: 'right' } },
      tableWidth: Math.min(150, W - 24),
      margin: { left: 12, right: 12 },
    });
  }
  return new Uint8Array(doc.output('arraybuffer'));
}

export async function exportPdf(report) {
  const bytes = await reportToPdf(report);
  await saveFile(`${slug(report.title)}-${stamp()}.pdf`, bytes, 'application/pdf');
}

// ---------------- QR labels ----------------

export async function qrDataUrl(text, size = 300) {
  const { default: QRCode } = await import('qrcode');
  return QRCode.toDataURL(text, { errorCorrectionLevel: 'M', margin: 1, width: size });
}

/** A4 sheet, 3 x 8 labels of 70 x 37 mm (common 24-up label stock). */
export async function labelsPdf(assets, hospital) {
  const { jsPDF } = await pdfLibs();
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const cols = 3;
  const rows = 8;
  const lw = 70;
  const lh = 37;
  const left = (210 - cols * lw) / 2;
  const top = (297 - rows * lh) / 2;
  for (let i = 0; i < assets.length; i++) {
    const slot = i % (cols * rows);
    if (i > 0 && slot === 0) doc.addPage();
    const a = assets[i];
    const x = left + (slot % cols) * lw;
    const y = top + Math.floor(slot / cols) * lh;
    doc.setDrawColor(200);
    doc.setLineWidth(0.1);
    doc.rect(x + 1, y + 1, lw - 2, lh - 2);
    doc.addImage(await qrDataUrl(a.tag_no, 240), 'PNG', x + 3, y + 4.5, 28, 28);
    const tx = x + 33;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(90);
    doc.text(doc.splitTextToSize(pdfText(hospital), lw - 36).slice(0, 2), tx, y + 7);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(0);
    doc.text(doc.splitTextToSize(pdfText(a.tag_no), lw - 36).slice(0, 2), tx, y + 15);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.text(doc.splitTextToSize(pdfText(a.name), lw - 36).slice(0, 2), tx, y + 23);
    doc.setFontSize(6);
    doc.setTextColor(90);
    doc.text(pdfText(`S/N ${a.serial_no || '-'}`).slice(0, 34), tx, y + 31);
  }
  return new Uint8Array(doc.output('arraybuffer'));
}

export async function exportLabels(assets, hospital) {
  const bytes = await labelsPdf(assets, hospital);
  await saveFile(`asset-labels-${stamp()}.pdf`, bytes, 'application/pdf');
}

export async function exportCsvRows(name, columns, rows) {
  await saveFile(`${slug(name)}-${stamp()}.csv`, rowsToCsv(columns, rows), 'text/csv;charset=utf-8');
}
