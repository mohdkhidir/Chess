import { docNo, insert } from './db.js';
import { addDays, endOfMonth, int, num, startOfMonth } from './util.js';
import {
  expensesReport, kpiByDepartment, kpiSummary, kpiTrend, lifespanReport, predictAll,
} from './analytics.js';
import { pendingForUserCount } from './approvals.js';
import { isScopedToDepartment } from './permissions.js';
import { displayStatus } from './ppm.js';

export function generatePdm(ctx, p = {}) {
  const threshold = num(p.threshold, { min: 1, max: 100, def: ctx.settings.pdm_risk_threshold, name: 'Risk threshold' });
  const daysAhead = int(p.days_ahead, { min: 0, max: 60, def: 7, name: 'Days ahead' });
  const { rows } = predictAll(ctx, p);
  const date = addDays(ctx.today(), daysAhead);
  const created = [];
  const skipped = [];
  for (const r of rows) {
    if (r.score < threshold) continue;
    if (!['ACTIVE', 'STANDBY'].includes(r.status)) {
      skipped.push({ tag_no: r.tag_no, reason: 'Asset is not in service' });
      continue;
    }
    const openPdm = ctx.db.get(
      "SELECT ppm_no FROM ppm_schedules WHERE asset_id = ? AND type = 'PDM' AND status IN ('SCHEDULED','IN_PROGRESS')",
      [r.id],
    );
    if (openPdm) {
      skipped.push({ tag_no: r.tag_no, reason: `${openPdm.ppm_no} already open` });
      continue;
    }
    const plan = ctx.db.get('SELECT id, assigned_to FROM ppm_plans WHERE asset_id = ?', [r.id]);
    const reason = `Risk score ${r.score} (${r.level}); P(failure in ${p.horizon_days || ctx.settings.pdm_horizon_days} days) ${r.probability}%. ${r.recommendations.join('. ')}`.slice(0, 1000);
    const no = docNo(ctx.db, 'PDM', date);
    const sid = insert(ctx.db, 'ppm_schedules', {
      ppm_no: no,
      plan_id: plan?.id ?? null,
      asset_id: r.id,
      type: 'PDM',
      scheduled_date: date,
      status: 'SCHEDULED',
      assigned_to: plan?.assigned_to ?? null,
      reason,
      created_at: ctx.now(),
    });
    ctx.event(r.id, 'PDM_GENERATED', `Predictive inspection ${no} scheduled for ${date} (risk ${r.score})`, 'ppm_schedules', sid);
    created.push({ id: sid, ppm_no: no, tag_no: r.tag_no, score: r.score });
  }
  ctx.audit('Predictive maintenance generated', 'ppm_schedules', null, { threshold, created: created.length });
  return { threshold, scheduled_date: date, created, skipped };
}

function dashboard(ctx) {
  const db = ctx.db;
  const u = ctx.user;
  const today = ctx.today();
  const scoped = isScopedToDepartment(u);
  const dw = scoped ? 'AND a.department_id = ?' : '';
  const dp = scoped ? [u.department_id] : [];
  const out = { role: u.role, today };

  const counts = db.all(`SELECT a.status, COUNT(*) AS n FROM assets a WHERE 1 = 1 ${dw} GROUP BY a.status`, dp);
  out.assets = Object.fromEntries(counts.map((r) => [r.status, r.n]));
  out.assets.fleet = ['ACTIVE', 'BREAKDOWN', 'OUT_OF_SERVICE', 'STANDBY', 'DISPOSAL_PENDING'].reduce((s, k) => s + (out.assets[k] || 0), 0);
  out.assets.warranty_expiring = db.get(
    `SELECT COUNT(*) AS n FROM assets a WHERE a.warranty_end BETWEEN ? AND ? AND a.status NOT IN ('DISPOSED','REJECTED') ${dw}`,
    [today, addDays(today, 90), ...dp],
  ).n;

  const open = db.all(
    `SELECT s.id, s.type, s.scheduled_date, s.status, s.completed_date, s.assigned_to FROM ppm_schedules s JOIN assets a ON a.id = s.asset_id
     WHERE (s.status IN ('SCHEDULED','IN_PROGRESS') AND s.scheduled_date <= ?) ${dw}`,
    [endOfMonth(today), ...dp],
  );
  const grace = ctx.settings.ppm_grace_days;
  let overdue = 0;
  let due = 0;
  let mine = 0;
  for (const s of open) {
    const d = displayStatus(s, today, grace);
    if (d === 'OVERDUE') overdue++;
    else if (d === 'DUE' || d === 'IN_PROGRESS') due++;
    if (s.assigned_to === u.id && d !== 'UPCOMING') mine++;
  }
  const doneThisMonth = db.get(
    `SELECT COUNT(*) AS n FROM ppm_schedules s JOIN assets a ON a.id = s.asset_id WHERE s.status = 'COMPLETED' AND s.completed_date BETWEEN ? AND ? ${dw}`,
    [startOfMonth(today), today, ...dp],
  ).n;
  out.ppm = { due, overdue, mine, done_this_month: doneThisMonth };

  if (ctx.can('wo.view')) {
    const w = db.get(
      `SELECT
         SUM(CASE WHEN status IN ('OPEN','ASSIGNED','IN_PROGRESS','ON_HOLD') THEN 1 ELSE 0 END) AS open,
         SUM(CASE WHEN status = 'OPEN' AND assigned_to IS NULL THEN 1 ELSE 0 END) AS unassigned,
         SUM(CASE WHEN status IN ('OPEN','ASSIGNED','IN_PROGRESS','ON_HOLD') AND priority = 'P1' THEN 1 ELSE 0 END) AS p1,
         SUM(CASE WHEN status = 'ON_HOLD' THEN 1 ELSE 0 END) AS on_hold,
         SUM(CASE WHEN status = 'COMPLETED' THEN 1 ELSE 0 END) AS awaiting_verification,
         SUM(CASE WHEN status IN ('ASSIGNED','IN_PROGRESS','ON_HOLD') AND assigned_to = ? THEN 1 ELSE 0 END) AS mine
       FROM work_orders`,
      [u.id],
    );
    out.wo = Object.fromEntries(Object.entries(w).map(([k, v]) => [k, v || 0]));
  }

  const tw = scoped ? 'AND (t.department_id = ? OR t.reporter_id = ?)' : '';
  const tp = scoped ? [u.department_id, u.id] : [];
  out.tickets = db.get(
    `SELECT SUM(CASE WHEN status = 'NEW' THEN 1 ELSE 0 END) AS new,
            SUM(CASE WHEN status = 'ASSIGNED' THEN 1 ELSE 0 END) AS in_progress,
            SUM(CASE WHEN status = 'RESOLVED' THEN 1 ELSE 0 END) AS awaiting_confirmation
     FROM tickets t WHERE 1 = 1 ${tw}`,
    tp,
  );
  for (const k of Object.keys(out.tickets)) out.tickets[k] = out.tickets[k] || 0;
  out.my_tickets = db.all(
    `SELECT t.id, t.ticket_no, t.subject, t.status, t.priority, t.created_at, a.tag_no FROM tickets t
     LEFT JOIN assets a ON a.id = t.asset_id WHERE t.reporter_id = ? AND t.status IN ('NEW','ASSIGNED','RESOLVED')
     ORDER BY t.created_at DESC LIMIT 5`,
    [u.id],
  );

  out.approvals_pending = pendingForUserCount(ctx);

  if (ctx.can('kpi.view')) {
    const k = kpiSummary(ctx, { period: 'this_month' });
    out.kpi = { ppm: k.ppm.completion_rate, cm_closure: k.cm.closure_rate, uptime: k.uptime.value, avg_response_hours: k.cm.avg_response_hours, targets: k.targets };
    out.trend = kpiTrend(ctx, { months: 6 });
  }
  if (ctx.can('analytics.view')) {
    const pr = predictAll(ctx, {});
    out.risk = { levels: pr.levels, top: pr.rows.slice(0, 5) };
  }
  out.recent = db.all(
    `SELECT e.id, e.asset_id, e.event_type, e.description, e.created_at, a.tag_no, u.full_name AS user_name
     FROM asset_events e JOIN assets a ON a.id = e.asset_id LEFT JOIN users u ON u.id = e.user_id
     WHERE 1 = 1 ${dw} ORDER BY e.created_at DESC, e.id DESC LIMIT 12`,
    dp,
  );
  return out;
}

function badges(ctx) {
  const out = { approvals: pendingForUserCount(ctx), tickets: 0, my_work: 0 };
  if (ctx.can('ticket.manage')) out.tickets = ctx.db.get("SELECT COUNT(*) AS n FROM tickets WHERE status = 'NEW'").n;
  else {
    out.tickets = ctx.db.get("SELECT COUNT(*) AS n FROM tickets WHERE reporter_id = ? AND status = 'RESOLVED'", [ctx.user.id]).n;
  }
  if (ctx.can('wo.execute')) {
    out.my_work = ctx.db.get(
      "SELECT COUNT(*) AS n FROM work_orders WHERE assigned_to = ? AND status IN ('ASSIGNED','IN_PROGRESS')",
      [ctx.user.id],
    ).n;
  }
  return out;
}

export const handlers = {
  'dashboard.get': { fn: (ctx) => dashboard(ctx) },
  'dashboard.badges': { fn: (ctx) => badges(ctx) },
  'kpi.summary': { perm: 'kpi.view', fn: (ctx, p) => kpiSummary(ctx, p) },
  'kpi.trend': { perm: 'kpi.view', fn: (ctx, p) => kpiTrend(ctx, p) },
  'kpi.departments': { perm: 'kpi.view', fn: (ctx, p) => kpiByDepartment(ctx, p) },
  'predictive.list': { perm: 'analytics.view', fn: (ctx, p) => predictAll(ctx, p) },
  'predictive.generate': { perm: 'predictive.generate', write: true, fn: (ctx, p) => generatePdm(ctx, p) },
  'lifecycle.lifespan': { perm: 'analytics.view', fn: (ctx, p) => lifespanReport(ctx, p) },
  'lifecycle.expenses': { perm: 'analytics.view', fn: (ctx, p) => expensesReport(ctx, p) },
};
