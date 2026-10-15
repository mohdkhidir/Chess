// Every report returns the same shape so the app can show it as a table and export it to
// PDF or CSV without per-report code: { title, subtitle, columns, rows, summary, orientation }.
import { bad, diffHours, id, int, oneOf, round } from './util.js';
import { listAssets, ASSET_STATUS } from './assets.js';
import { listSchedules, PPM_DISPLAY } from './ppm.js';
import { WO_STATUS, WO_RESULTS } from './workorders.js';
import { TICKET_STATUS } from './tickets.js';
import {
  expensesReport, kpiByDepartment, kpiSummary, kpiTrend, lifespanReport, predictAll, resolvePeriod,
} from './analytics.js';
import { handlers as assetHandlers } from './assets.js';
import { handlers as ppmHandlers } from './ppm.js';
import { APPROVAL_TYPES } from './settings.js';

export const REPORT_TYPES = {
  ASSET_REGISTER: { label: 'Asset register (masterlist)', params: ['department', 'category', 'status'] },
  PPM_MASTERLIST: { label: 'PPM masterlist (annual planner)', params: ['year', 'department', 'category'] },
  PPM_COMPLIANCE: { label: 'PPM compliance by department', params: ['period', 'department'] },
  PPM_LIST: { label: 'PPM work list / overdue PPM', params: ['period', 'department', 'ppm_status'] },
  CM_REPORT: { label: 'Corrective maintenance work orders', params: ['period', 'department', 'wo_status'] },
  TICKETS: { label: 'Helpdesk tickets', params: ['period', 'department'] },
  KPI_SUMMARY: { label: 'KPI summary (WO closure, PPM completion, uptime)', params: ['period', 'department'] },
  ASSET_HISTORY: { label: 'Asset history card', params: ['asset'] },
  PREDICTIVE: { label: 'Predictive maintenance risk ranking', params: ['department', 'category', 'horizon'] },
  LIFESPAN: { label: 'Asset lifespan & replacement plan', params: ['department', 'category'] },
  EXPENSES: { label: 'Maintenance expenses', params: ['period', 'department', 'category', 'group_by'] },
  APPROVALS: { label: 'Approval log', params: ['period'] },
};

const col = (key, label, opts = {}) => ({ key, label, ...opts });
const money = (key, label) => col(key, label, { align: 'right', format: 'money' });
const pct = (key, label) => col(key, label, { align: 'right', format: 'pct' });
const numc = (key, label) => col(key, label, { align: 'right', format: 'num' });

function periodText(from, to) {
  return `Period: ${from} to ${to}`;
}

function filterText(ctx, p) {
  const parts = [];
  if (p.department_id) parts.push(`Department: ${ctx.db.get('SELECT name FROM departments WHERE id = ?', [Number(p.department_id)])?.name}`);
  if (p.category_id) parts.push(`Category: ${ctx.db.get('SELECT name FROM categories WHERE id = ?', [Number(p.category_id)])?.name}`);
  return parts.join(' · ');
}

const builders = {
  ASSET_REGISTER(ctx, p) {
    const { rows } = listAssets(ctx, { ...p, page_size: 5000, sort: 'department' });
    return {
      title: 'Asset Register',
      subtitle: filterText(ctx, p),
      orientation: 'landscape',
      columns: [
        col('tag_no', 'Tag No.'), col('name', 'Equipment'), col('manufacturer', 'Manufacturer'), col('model', 'Model'),
        col('serial_no', 'Serial No.'), col('department_name', 'Department'), col('location_name', 'Location'),
        col('risk_class', 'Class'), col('purchase_date', 'Purchased'), money('purchase_cost', 'Cost (RM)'),
        col('status_label', 'Status'),
      ],
      rows: rows.map((r) => ({ ...r, status_label: ASSET_STATUS[r.status] })),
      summary: [
        { label: 'Assets', value: rows.length },
        { label: 'Total purchase value (RM)', value: round(rows.reduce((s, r) => s + (r.purchase_cost || 0), 0)), format: 'money' },
      ],
    };
  },

  PPM_MASTERLIST(ctx, p) {
    const data = ppmHandlers['ppm.masterlist'].fn(ctx, p);
    const code = { COMPLETED: 'C', COMPLETED_LATE: 'L', OVERDUE: 'O', DUE: 'D', UPCOMING: 'P', IN_PROGRESS: 'W', DEFERRED: 'F', CANCELLED: 'X' };
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return {
      title: `PPM Masterlist ${data.year}`,
      subtitle: [filterText(ctx, p), 'P planned · D due · W in progress · C completed · L completed late · O overdue · F deferred · X cancelled'].filter(Boolean).join(' — '),
      orientation: 'landscape',
      columns: [
        col('tag_no', 'Tag No.'), col('name', 'Equipment'), col('department_name', 'Department'), numc('frequency_months', 'Freq (m)'),
        ...months.map((m, i) => col(`m${i}`, m, { align: 'center' })),
      ],
      rows: data.rows.map((r) => {
        const o = { tag_no: r.tag_no, name: r.name, department_name: r.department_name, frequency_months: r.frequency_months };
        r.months.forEach((cells, i) => {
          o[`m${i}`] = cells.map((c) => code[c.status] || '?').join(' ');
        });
        return o;
      }),
      summary: [
        { label: 'PPMs scheduled', value: data.totals.scheduled },
        { label: 'Completed', value: data.totals.completed + data.totals.completed_late },
        { label: 'Overdue', value: data.totals.overdue },
        { label: 'Pending', value: data.totals.pending },
      ],
    };
  },

  PPM_COMPLIANCE(ctx, p) {
    const r = kpiByDepartment(ctx, p);
    const total = kpiSummary(ctx, p);
    return {
      title: 'PPM Compliance by Department',
      subtitle: periodText(r.period.from, r.period.to),
      orientation: 'portrait',
      columns: [col('department', 'Department'), numc('assets', 'Assets'), numc('ppm_scheduled', 'PPM scheduled'), pct('ppm_completion', 'Completion %'), numc('ppm_overdue', 'Overdue')],
      rows: r.rows,
      summary: [
        { label: 'Hospital PPM completion', value: total.ppm.completion_rate, format: 'pct' },
        { label: 'On-time completion', value: total.ppm.on_time_rate, format: 'pct' },
        { label: 'Target', value: total.targets.ppm, format: 'pct' },
      ],
    };
  },

  PPM_LIST(ctx, p) {
    const { from, to } = resolvePeriod(ctx, p);
    const { rows } = listSchedules(ctx, { from, to, department_id: p.department_id, display_status: p.ppm_status || undefined, page_size: 10000 });
    return {
      title: p.ppm_status === 'OVERDUE' ? 'Overdue PPM List' : 'PPM Work List',
      subtitle: [periodText(from, to), filterText(ctx, p)].filter(Boolean).join(' · '),
      orientation: 'landscape',
      columns: [
        col('ppm_no', 'PPM No.'), col('type', 'Type'), col('tag_no', 'Tag No.'), col('asset_name', 'Equipment'), col('department_name', 'Department'),
        col('scheduled_date', 'Scheduled'), col('window_end', 'Due by'), col('status_label', 'Status'), col('completed_date', 'Done'),
        col('overall_result', 'Result'), col('assigned_name', 'Assigned'),
      ],
      rows: rows.map((r) => ({ ...r, status_label: PPM_DISPLAY[r.display_status] })),
      summary: [{ label: 'Items', value: rows.length }],
    };
  },

  CM_REPORT(ctx, p) {
    const { from, to } = resolvePeriod(ctx, p);
    const where = ['w.reported_at BETWEEN ? AND ?'];
    const params = [`${from} 00:00:00`, `${to} 23:59:59`];
    if (p.department_id) {
      where.push('a.department_id = ?');
      params.push(id(p.department_id));
    }
    if (p.wo_status === 'ACTIVE') where.push("w.status IN ('OPEN','ASSIGNED','IN_PROGRESS','ON_HOLD')");
    else if (p.wo_status) {
      where.push('w.status = ?');
      params.push(oneOf(p.wo_status, Object.keys(WO_STATUS), { name: 'Status' }));
    }
    const rows = ctx.db.all(
      `SELECT w.*, a.tag_no, a.name AS asset_name, d.name AS department_name, u.full_name AS assigned_name
       FROM work_orders w JOIN assets a ON a.id = w.asset_id JOIN departments d ON d.id = a.department_id
       LEFT JOIN users u ON u.id = w.assigned_to WHERE ${where.join(' AND ')} ORDER BY w.reported_at`,
      params,
    ).map((w) => ({
      ...w,
      status_label: WO_STATUS[w.status],
      result_label: w.result ? WO_RESULTS[w.result] : '',
      response_hours: w.response_at ? round(diffHours(w.reported_at, w.response_at), 1) : null,
      turnaround_hours: w.completed_at ? round(diffHours(w.reported_at, w.completed_at), 1) : null,
      total_cost: round(w.labour_cost + w.parts_cost + w.vendor_cost),
    }));
    const k = kpiSummary(ctx, p);
    return {
      title: 'Corrective Maintenance Report',
      subtitle: [periodText(from, to), filterText(ctx, p)].filter(Boolean).join(' · '),
      orientation: 'landscape',
      columns: [
        col('wo_no', 'WO No.'), col('priority', 'Pri'), col('tag_no', 'Tag No.'), col('asset_name', 'Equipment'), col('department_name', 'Department'),
        col('reported_at', 'Reported'), numc('response_hours', 'Resp (h)'), col('completed_at', 'Completed'), numc('turnaround_hours', 'TAT (h)'),
        col('failure_cause', 'Cause'), col('status_label', 'Status'), money('total_cost', 'Cost (RM)'),
      ],
      rows,
      summary: [
        { label: 'Work orders', value: k.cm.raised },
        { label: 'Closed', value: k.cm.closed },
        { label: 'Closure rate', value: k.cm.closure_rate, format: 'pct' },
        { label: 'Avg response (h)', value: k.cm.avg_response_hours },
        { label: 'Total cost (RM)', value: k.cm.total_cost, format: 'money' },
      ],
    };
  },

  TICKETS(ctx, p) {
    const { from, to } = resolvePeriod(ctx, p);
    const where = ['t.created_at BETWEEN ? AND ?'];
    const params = [`${from} 00:00:00`, `${to} 23:59:59`];
    if (p.department_id) {
      where.push('t.department_id = ?');
      params.push(id(p.department_id));
    }
    const rows = ctx.db.all(
      `SELECT t.*, a.tag_no, d.name AS department_name, r.full_name AS reporter_name, w.wo_no
       FROM tickets t JOIN departments d ON d.id = t.department_id LEFT JOIN assets a ON a.id = t.asset_id
       LEFT JOIN users r ON r.id = t.reporter_id LEFT JOIN work_orders w ON w.id = t.work_order_id
       WHERE ${where.join(' AND ')} ORDER BY t.created_at`,
      params,
    ).map((t) => ({ ...t, status_label: TICKET_STATUS[t.status], resolution_hours: t.resolved_at ? round(diffHours(t.created_at, t.resolved_at), 1) : null }));
    const rated = rows.filter((t) => t.rating);
    return {
      title: 'Helpdesk Ticket Report',
      subtitle: [periodText(from, to), filterText(ctx, p)].filter(Boolean).join(' · '),
      orientation: 'landscape',
      columns: [
        col('ticket_no', 'Ticket'), col('created_at', 'Logged'), col('priority', 'Pri'), col('department_name', 'Department'), col('tag_no', 'Tag No.'),
        col('subject', 'Subject'), col('reporter_name', 'Reported by'), col('wo_no', 'WO No.'), col('status_label', 'Status'),
        numc('resolution_hours', 'Resolve (h)'), numc('rating', 'Rating'),
      ],
      rows,
      summary: [
        { label: 'Tickets', value: rows.length },
        { label: 'Resolved', value: rows.filter((t) => t.resolved_at).length },
        { label: 'Avg satisfaction (1-5)', value: rated.length ? round(rated.reduce((s, t) => s + t.rating, 0) / rated.length, 2) : null },
      ],
    };
  },

  KPI_SUMMARY(ctx, p) {
    const k = kpiSummary(ctx, p);
    const trend = kpiTrend(ctx, { ...p, months: 12 });
    const row = (kpi, value, target, unit = '%', higherIsBetter = true) => ({
      kpi,
      value: value === null || value === undefined ? '—' : `${value}${unit}`,
      target: target === null ? '—' : `${higherIsBetter ? '≥' : '≤'} ${target}${unit}`,
      status: value === null || target === null ? '—' : (higherIsBetter ? value >= target : value <= target) ? 'MET' : 'NOT MET',
    });
    return {
      title: 'KPI Summary',
      subtitle: [periodText(k.period.from, k.period.to), filterText(ctx, p)].filter(Boolean).join(' · '),
      orientation: 'portrait',
      columns: [col('kpi', 'Indicator'), col('value', 'Actual', { align: 'right' }), col('target', 'Target', { align: 'right' }), col('status', 'Status')],
      rows: [
        row('PPM completion rate', k.ppm.completion_rate, k.targets.ppm),
        row('PPM completed on time', k.ppm.on_time_rate, k.targets.ppm),
        row('Corrective WO closure rate', k.cm.closure_rate, k.targets.cm_closure),
        row('WO closed within repair target', k.cm.on_time_closure_rate, k.targets.cm_closure),
        row('Response within target time', k.cm.response_within_target_rate, null),
        row('Equipment uptime', k.uptime.value, k.targets.uptime),
        { kpi: 'Average response time', value: k.cm.avg_response_hours === null ? '—' : `${k.cm.avg_response_hours} h`, target: '—', status: '—' },
        { kpi: 'Average turnaround time', value: k.cm.avg_turnaround_hours === null ? '—' : `${k.cm.avg_turnaround_hours} h`, target: '—', status: '—' },
        { kpi: 'PPM scheduled / completed / overdue', value: `${k.ppm.scheduled} / ${k.ppm.completed} / ${k.ppm.overdue}`, target: '—', status: '—' },
        { kpi: 'WO raised / closed / open backlog', value: `${k.cm.raised} / ${k.cm.closed} / ${k.cm.backlog}`, target: '—', status: '—' },
        { kpi: 'Helpdesk satisfaction (1-5)', value: k.tickets.satisfaction ?? '—', target: '—', status: '—' },
      ],
      summary: trend.months.map((m) => ({ label: m.month, value: `PPM ${m.ppm_completion ?? '—'}% · WO ${m.cm_closure ?? '—'}% · Up ${m.uptime ?? '—'}%` })),
    };
  },

  ASSET_HISTORY(ctx, p) {
    if (!p.asset_id) throw bad('Choose an asset');
    const h = assetHandlers['assets.history'].fn(ctx, { id: p.asset_id });
    const a = assetHandlers['assets.get'].fn(ctx, { id: p.asset_id });
    const rows = [
      ...h.events.map((e) => ({ date: e.created_at, type: e.event_type.replace(/_/g, ' '), reference: e.ref_type ? `${e.ref_type}#${e.ref_id}` : '', description: e.description, by: e.user_name || '' })),
    ];
    return {
      title: `Asset History Card — ${a.tag_no}`,
      subtitle: `${a.name} · ${a.manufacturer || ''} ${a.model || ''} · S/N ${a.serial_no || '—'} · ${a.department_name}${a.location_name ? ` / ${a.location_name}` : ''}`,
      orientation: 'portrait',
      columns: [col('date', 'Date'), col('type', 'Event'), col('description', 'Description'), col('by', 'By')],
      rows,
      summary: [
        { label: 'Status', value: a.status_label },
        { label: 'In service since', value: a.lifecycle.in_service_date },
        { label: 'Age / expected life (yrs)', value: `${a.lifecycle.age_years} / ${a.lifecycle.lifespan_years}` },
        { label: 'Purchase cost (RM)', value: a.purchase_cost, format: 'money' },
        { label: 'Maintenance cost to date (RM)', value: a.costs.total, format: 'money' },
        { label: 'Corrective work orders', value: h.cm.length },
        { label: 'PPMs completed', value: h.ppm.filter((x) => x.status === 'COMPLETED').length },
        { label: 'Risk score', value: a.risk ? `${a.risk.score} (${a.risk.level})` : '—' },
      ],
    };
  },

  PREDICTIVE(ctx, p) {
    const r = predictAll(ctx, { ...p, horizon_days: p.horizon_days || undefined });
    return {
      title: 'Predictive Maintenance — Risk Ranking',
      subtitle: [`Horizon ${r.horizon_days} days`, filterText(ctx, p), 'Model: failure history + category prior, adjusted for age, trend and PPM findings'].filter(Boolean).join(' · '),
      orientation: 'landscape',
      columns: [
        col('tag_no', 'Tag No.'), col('name', 'Equipment'), col('department_name', 'Department'), numc('score', 'Risk'), col('level', 'Level'),
        pct('probability', `P(fail)`), numc('failures_12m', 'Fails 12m'), numc('mtbf_days', 'MTBF (d)'), col('predicted_next_failure', 'Next failure (est.)'),
        pct('life_used_pct', 'Life used'), col('recommendation', 'Main recommendation'),
      ],
      rows: r.rows.map((x) => ({ ...x, recommendation: x.recommendations[0] || '' })),
      summary: Object.entries(r.levels).map(([k, v]) => ({ label: k, value: v })),
    };
  },

  LIFESPAN(ctx, p) {
    const r = lifespanReport(ctx, p);
    const label = { OK: 'Within life', NEAR_END: 'Near end of life', BEYOND_LIFE: 'Beyond life' };
    return {
      title: 'Asset Lifespan & Replacement Plan',
      subtitle: filterText(ctx, p),
      orientation: 'landscape',
      columns: [
        col('tag_no', 'Tag No.'), col('name', 'Equipment'), col('department_name', 'Department'), col('in_service_date', 'In service'),
        numc('age_years', 'Age (y)'), numc('lifespan_years', 'Life (y)'), pct('life_used_pct', 'Used'), col('end_of_life_year', 'EOL year'),
        money('purchase_cost', 'Cost (RM)'), money('book_value', 'Book value'), money('maintenance_cost', 'Maint. cost'), money('replacement_cost', 'Replace est.'),
        col('state_label', 'State'),
      ],
      rows: r.rows.map((x) => ({ ...x, state_label: label[x.state] })),
      summary: [
        { label: 'Assets', value: r.summary.assets },
        { label: 'Beyond life', value: r.summary.beyond_life },
        { label: 'Near end of life', value: r.summary.near_end },
        { label: 'Book value (RM)', value: r.summary.book_value, format: 'money' },
        ...r.replacement_plan.map((x) => ({ label: `Replace ${x.year}: ${x.count} asset(s)`, value: x.cost, format: 'money' })),
      ],
    };
  },

  EXPENSES(ctx, p) {
    const r = expensesReport(ctx, p);
    return {
      title: 'Maintenance Expenses Report',
      subtitle: [periodText(r.period.from, r.period.to), filterText(ctx, p), `Grouped by ${r.group_by}`].filter(Boolean).join(' · '),
      orientation: 'portrait',
      columns: [
        col('group', r.group_by[0].toUpperCase() + r.group_by.slice(1)), numc('jobs', 'Jobs'), money('cm', 'Corrective'), money('ppm', 'Preventive'),
        money('parts', 'Parts'), money('labour', 'Labour'), money('vendor', 'Vendor'), money('total', 'Total (RM)'),
      ],
      rows: r.rows,
      summary: [
        { label: 'Total (RM)', value: r.summary.total, format: 'money' },
        { label: 'Corrective (RM)', value: r.summary.cm, format: 'money' },
        { label: 'Preventive (RM)', value: r.summary.ppm, format: 'money' },
        { label: 'Cost of service ratio (annualised)', value: r.summary.cost_of_service_ratio, format: 'pct' },
      ],
    };
  },

  APPROVALS(ctx, p) {
    const { from, to } = resolvePeriod(ctx, p);
    const rows = ctx.db.all(
      `SELECT a.*, u.full_name AS requested_by_name,
              (SELECT GROUP_CONCAT(x.full_name || ' (L' || s.level || ', ' || s.decision || ')', '; ')
               FROM approval_steps s JOIN users x ON x.id = s.approver_id WHERE s.approval_id = a.id) AS decided_by
       FROM approvals a LEFT JOIN users u ON u.id = a.requested_by
       WHERE a.requested_at BETWEEN ? AND ? ORDER BY a.requested_at`,
      [`${from} 00:00:00`, `${to} 23:59:59`],
    ).map((a) => ({ ...a, type_label: APPROVAL_TYPES[a.type] }));
    return {
      title: 'Approval Log',
      subtitle: periodText(from, to),
      orientation: 'landscape',
      columns: [
        col('requested_at', 'Requested'), col('type_label', 'Type'), col('title', 'Request'), money('amount', 'Amount'),
        col('requested_by_name', 'Requested by'), numc('required_level', 'Level'), col('status', 'Status'), col('decided_by', 'Decision(s)'), col('decided_at', 'Decided'),
      ],
      rows,
      summary: [
        { label: 'Requests', value: rows.length },
        { label: 'Approved', value: rows.filter((r) => r.status === 'APPROVED').length },
        { label: 'Rejected', value: rows.filter((r) => r.status === 'REJECTED').length },
        { label: 'Pending', value: rows.filter((r) => r.status === 'PENDING').length },
      ],
    };
  },
};

export const handlers = {
  'reports.types': {
    perm: 'report.view',
    fn: () => REPORT_TYPES,
  },
  'reports.run': {
    perm: 'report.view',
    fn(ctx, p) {
      const type = oneOf(p.type, Object.keys(REPORT_TYPES), { name: 'Report type' });
      if (['PREDICTIVE', 'LIFESPAN', 'EXPENSES'].includes(type) && !ctx.can('analytics.view')) {
        throw bad('You do not have access to this report');
      }
      if (p.year !== undefined) int(p.year, { min: 2000, max: 2100, name: 'Year' });
      const out = builders[type](ctx, p);
      const s = ctx.settings;
      return {
        type,
        hospital: s.hospital_name,
        generated_at: ctx.now(),
        generated_by: ctx.user.full_name,
        ...out,
      };
    },
  },
};
