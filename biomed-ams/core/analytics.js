// KPI, predictive maintenance, lifespan and expense analytics. Everything is computed from the
// maintenance records in the database; nothing here needs sensors or external data.
import {
  addDays, addMonths, avg, clamp, diffDays, diffHours, endOfMonth, groupBy, int, id, oneOf, dateOrNull,
  round, startOfMonth, sum, yearsBetween, bad,
} from './util.js';
import { displayStatus } from './ppm.js';
import { isScopedToDepartment } from './permissions.js';

const FLEET = "('ACTIVE','BREAKDOWN','OUT_OF_SERVICE','STANDBY','DISPOSAL_PENDING')";
const OPEN_WO = ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'ON_HOLD'];

function scope(ctx, p, alias = 'a') {
  const where = [];
  const params = [];
  if (isScopedToDepartment(ctx.user)) {
    where.push(`${alias}.department_id = ?`);
    params.push(ctx.user.department_id);
  } else if (p.department_id) {
    where.push(`${alias}.department_id = ?`);
    params.push(id(p.department_id, 'Department'));
  }
  if (p.category_id) {
    where.push(`${alias}.category_id = ?`);
    params.push(id(p.category_id, 'Category'));
  }
  return { where, params };
}

export function resolvePeriod(ctx, p = {}) {
  const today = ctx.today();
  const preset = p.period || 'this_month';
  let from;
  let to;
  switch (preset) {
    case 'this_month': from = startOfMonth(today); to = endOfMonth(today); break;
    case 'last_month': { const d = addMonths(startOfMonth(today), -1); from = d; to = endOfMonth(d); break; }
    case 'this_quarter': {
      const m = Number(today.slice(5, 7));
      const qStart = `${today.slice(0, 4)}-${String(Math.floor((m - 1) / 3) * 3 + 1).padStart(2, '0')}-01`;
      from = qStart; to = endOfMonth(addMonths(qStart, 2)); break;
    }
    case 'ytd': from = `${today.slice(0, 4)}-01-01`; to = today; break;
    case 'last_year': { const y = Number(today.slice(0, 4)) - 1; from = `${y}-01-01`; to = `${y}-12-31`; break; }
    case 'last_12_months': from = startOfMonth(addMonths(today, -11)); to = endOfMonth(today); break;
    case 'custom':
      from = dateOrNull(p.from, 'From');
      to = dateOrNull(p.to, 'To');
      if (!from || !to) throw bad('Choose both dates for a custom period');
      if (to < from) throw bad('End date is before start date');
      break;
    default: throw bad('Unknown period');
  }
  return { from, to, preset };
}

// ---------------- KPI ----------------

function ppmStats(ctx, p, from, to) {
  const { where, params } = scope(ctx, p);
  const rows = ctx.db.all(
    `SELECT s.id, s.type, s.scheduled_date, s.status, s.completed_date, a.department_id
     FROM ppm_schedules s JOIN assets a ON a.id = s.asset_id
     WHERE s.type = 'PPM' AND s.scheduled_date BETWEEN ? AND ? ${where.length ? `AND ${where.join(' AND ')}` : ''}`,
    [from, to, ...params],
  );
  return summarisePpm(ctx, rows);
}

function summarisePpm(ctx, rows) {
  const today = ctx.today();
  const grace = ctx.settings.ppm_grace_days;
  const t = { scheduled: 0, completed: 0, on_time: 0, late: 0, overdue: 0, pending: 0, deferred: 0, cancelled: 0 };
  for (const r of rows) {
    const d = displayStatus(r, today, grace);
    if (d === 'CANCELLED') { t.cancelled++; continue; }
    if (d === 'DEFERRED') { t.deferred++; continue; }
    t.scheduled++;
    if (d === 'COMPLETED') { t.completed++; t.on_time++; } else if (d === 'COMPLETED_LATE') { t.completed++; t.late++; } else if (d === 'OVERDUE') t.overdue++;
    else t.pending++;
  }
  const due = t.completed + t.overdue;
  t.completion_rate = due ? round((t.completed / due) * 100, 1) : null;
  t.on_time_rate = due ? round((t.on_time / due) * 100, 1) : null;
  return t;
}

function cmRows(ctx, p, from, to) {
  const { where, params } = scope(ctx, p);
  return ctx.db.all(
    `SELECT w.*, a.department_id FROM work_orders w JOIN assets a ON a.id = w.asset_id
     WHERE w.status != 'CANCELLED' AND w.reported_at BETWEEN ? AND ? ${where.length ? `AND ${where.join(' AND ')}` : ''}`,
    [`${from} 00:00:00`, `${to} 23:59:59`, ...params],
  );
}

function summariseCm(ctx, rows) {
  const s = ctx.settings;
  const closed = rows.filter((w) => w.status === 'COMPLETED' || w.status === 'CLOSED');
  const responded = rows.filter((w) => w.response_at);
  const responseHrs = responded.map((w) => diffHours(w.reported_at, w.response_at));
  const turnaround = closed.map((w) => diffHours(w.reported_at, w.completed_at));
  const onTime = closed.filter((w) => diffHours(w.reported_at, w.completed_at) <= s.repair_target_days[w.priority] * 24);
  const respOnTime = responded.filter((w) => diffHours(w.reported_at, w.response_at) <= s.response_target_hours[w.priority]);
  return {
    raised: rows.length,
    closed: closed.length,
    verified: rows.filter((w) => w.status === 'CLOSED').length,
    open: rows.filter((w) => OPEN_WO.includes(w.status)).length,
    closure_rate: rows.length ? round((closed.length / rows.length) * 100, 1) : null,
    on_time_closure_rate: closed.length ? round((onTime.length / closed.length) * 100, 1) : null,
    avg_response_hours: responseHrs.length ? round(avg(responseHrs), 1) : null,
    response_within_target_rate: responded.length ? round((respOnTime.length / responded.length) * 100, 1) : null,
    avg_turnaround_hours: turnaround.length ? round(avg(turnaround), 1) : null,
    total_cost: round(sum(rows, (w) => w.labour_cost + w.parts_cost + w.vendor_cost)),
  };
}

// Uptime = 1 - downtime / (fleet hours in the period). Downtime comes from breakdown work orders.
export function uptimeFor(ctx, p, from, to) {
  const { where, params } = scope(ctx, p);
  const nowTs = ctx.now();
  const periodStart = `${from} 00:00:00`;
  const periodEndRaw = `${addDays(to, 1)} 00:00:00`;
  const periodEnd = periodEndRaw < nowTs ? periodEndRaw : nowTs;
  if (periodEnd <= periodStart) return { uptime: null, downtime_hours: 0, available_hours: 0, assets: [] };
  const assets = ctx.db.all(
    `SELECT a.id, a.tag_no, a.name, a.created_at, a.commissioning_date, a.disposed_at, a.status, d.name AS department_name
     FROM assets a JOIN departments d ON d.id = a.department_id
     WHERE (a.status IN ${FLEET} OR (a.status = 'DISPOSED' AND a.disposed_at >= ?))
     ${where.length ? `AND ${where.join(' AND ')}` : ''}`,
    [from, ...params],
  );
  const downs = ctx.db.all(
    `SELECT w.asset_id, w.downtime_start, w.downtime_end FROM work_orders w JOIN assets a ON a.id = w.asset_id
     WHERE w.equipment_down = 1 AND w.status != 'CANCELLED' AND w.downtime_start < ?
       AND (w.downtime_end IS NULL OR w.downtime_end > ?) ${where.length ? `AND ${where.join(' AND ')}` : ''}`,
    [periodEnd, periodStart, ...params],
  );
  const downBy = groupBy(downs, (d) => d.asset_id);
  let available = 0;
  let downtime = 0;
  const per = [];
  for (const a of assets) {
    const inService = a.commissioning_date ? `${a.commissioning_date} 00:00:00` : a.created_at;
    const start = inService > periodStart ? inService : periodStart;
    const endCap = a.disposed_at ? `${a.disposed_at} 00:00:00` : periodEnd;
    const end = endCap < periodEnd ? endCap : periodEnd;
    if (end <= start) continue;
    const hours = diffHours(start, end);
    // merge overlapping breakdowns so concurrent work orders are not double counted
    const spans = (downBy.get(a.id) || [])
      .map((d) => [d.downtime_start > start ? d.downtime_start : start, (d.downtime_end || nowTs) < end ? d.downtime_end || nowTs : end])
      .filter(([s, e]) => e > s)
      .sort((x, y) => (x[0] < y[0] ? -1 : 1));
    let dh = 0;
    let cur = null;
    for (const [s, e] of spans) {
      if (!cur || s > cur[1]) {
        if (cur) dh += diffHours(cur[0], cur[1]);
        cur = [s, e];
      } else if (e > cur[1]) cur[1] = e;
    }
    if (cur) dh += diffHours(cur[0], cur[1]);
    available += hours;
    downtime += dh;
    per.push({ id: a.id, tag_no: a.tag_no, name: a.name, department_name: a.department_name, hours: round(hours, 1), downtime_hours: round(dh, 1), uptime: round((1 - dh / hours) * 100, 2) });
  }
  return {
    uptime: available ? round((1 - downtime / available) * 100, 2) : null,
    downtime_hours: round(downtime, 1),
    available_hours: round(available, 1),
    assets: per.sort((x, y) => x.uptime - y.uptime),
  };
}

function ticketStats(ctx, p, from, to) {
  const where = ['t.created_at BETWEEN ? AND ?'];
  const params = [`${from} 00:00:00`, `${to} 23:59:59`];
  if (isScopedToDepartment(ctx.user)) {
    where.push('t.department_id = ?');
    params.push(ctx.user.department_id);
  } else if (p.department_id) {
    where.push('t.department_id = ?');
    params.push(id(p.department_id));
  }
  const rows = ctx.db.all(`SELECT * FROM tickets t WHERE ${where.join(' AND ')}`, params);
  const resolved = rows.filter((t) => t.resolved_at);
  const rated = rows.filter((t) => t.rating);
  return {
    raised: rows.length,
    open: rows.filter((t) => ['NEW', 'ASSIGNED'].includes(t.status)).length,
    resolved: resolved.length,
    closed: rows.filter((t) => t.status === 'CLOSED').length,
    avg_resolution_hours: resolved.length ? round(avg(resolved.map((t) => diffHours(t.created_at, t.resolved_at))), 1) : null,
    satisfaction: rated.length ? round(avg(rated.map((t) => t.rating)), 2) : null,
    rated: rated.length,
  };
}

export function kpiSummary(ctx, p = {}) {
  const { from, to, preset } = resolvePeriod(ctx, p);
  const s = ctx.settings;
  const ppm = ppmStats(ctx, p, from, to);
  const cm = summariseCm(ctx, cmRows(ctx, p, from, to));
  const up = uptimeFor(ctx, p, from, to);
  const tickets = ticketStats(ctx, p, from, to);
  const { where, params } = scope(ctx, p);
  const backlog = ctx.db.get(
    `SELECT COUNT(*) AS n FROM work_orders w JOIN assets a ON a.id = w.asset_id
     WHERE w.status IN ('OPEN','ASSIGNED','IN_PROGRESS','ON_HOLD') ${where.length ? `AND ${where.join(' AND ')}` : ''}`,
    params,
  ).n;
  const met = (v, target) => (v === null ? null : v >= target);
  return {
    period: { from, to, preset },
    targets: {
      ppm: s.kpi_ppm_target,
      cm_closure: s.kpi_cm_closure_target,
      uptime: s.kpi_uptime_target,
      response_target_hours: s.response_target_hours,
      repair_target_days: s.repair_target_days,
    },
    ppm,
    cm: { ...cm, backlog },
    uptime: { value: up.uptime, downtime_hours: up.downtime_hours, available_hours: up.available_hours, worst: up.assets.slice(0, 10) },
    tickets,
    status: {
      ppm: met(ppm.completion_rate, s.kpi_ppm_target),
      cm_closure: met(cm.closure_rate, s.kpi_cm_closure_target),
      uptime: met(up.uptime, s.kpi_uptime_target),
    },
  };
}

export function kpiTrend(ctx, p = {}) {
  const months = int(p.months, { min: 3, max: 36, def: 12, name: 'Months' });
  const today = ctx.today();
  const out = [];
  for (let i = months - 1; i >= 0; i--) {
    const m0 = startOfMonth(addMonths(today, -i));
    const m1 = endOfMonth(m0);
    const ppm = ppmStats(ctx, p, m0, m1);
    const cm = summariseCm(ctx, cmRows(ctx, p, m0, m1));
    const up = uptimeFor(ctx, p, m0, m1 < today ? m1 : today);
    out.push({
      month: m0.slice(0, 7),
      ppm_completion: ppm.completion_rate,
      ppm_scheduled: ppm.scheduled,
      ppm_completed: ppm.completed,
      cm_raised: cm.raised,
      cm_closed: cm.closed,
      cm_closure: cm.closure_rate,
      uptime: up.uptime,
    });
  }
  return { months: out, targets: { ppm: ctx.settings.kpi_ppm_target, cm_closure: ctx.settings.kpi_cm_closure_target, uptime: ctx.settings.kpi_uptime_target } };
}

export function kpiByDepartment(ctx, p = {}) {
  const { from, to } = resolvePeriod(ctx, p);
  const depts = ctx.db.all('SELECT id, code, name FROM departments WHERE active = 1 ORDER BY name');
  const rows = [];
  for (const d of depts) {
    if (isScopedToDepartment(ctx.user) && d.id !== ctx.user.department_id) continue;
    const q = { ...p, department_id: d.id };
    const count = ctx.db.get(`SELECT COUNT(*) AS n FROM assets WHERE department_id = ? AND status IN ${FLEET}`, [d.id]).n;
    if (!count) continue;
    const ppm = ppmStats(ctx, q, from, to);
    const cm = summariseCm(ctx, cmRows(ctx, q, from, to));
    const up = uptimeFor(ctx, q, from, to);
    rows.push({
      department_id: d.id,
      department: d.name,
      code: d.code,
      assets: count,
      ppm_scheduled: ppm.scheduled,
      ppm_completion: ppm.completion_rate,
      ppm_overdue: ppm.overdue,
      cm_raised: cm.raised,
      cm_closure: cm.closure_rate,
      avg_response_hours: cm.avg_response_hours,
      uptime: up.uptime,
    });
  }
  return { period: { from, to }, rows };
}

// ---------------- costs ----------------

export function maintenanceCostByAsset(db, { assetId = null, from = null, to = null } = {}) {
  const m = new Map();
  const add = (aid, key, v) => {
    if (!m.has(aid)) m.set(aid, { cm: 0, ppm: 0, total: 0, cm_parts: 0, cm_labour: 0, cm_vendor: 0, ppm_parts: 0, ppm_labour: 0, ppm_vendor: 0 });
    const o = m.get(aid);
    o[key] += v;
  };
  const wf = [];
  const wp = [];
  if (assetId) { wf.push('asset_id = ?'); wp.push(assetId); }
  if (from) { wf.push("substr(COALESCE(completed_at, reported_at), 1, 10) >= ?"); wp.push(from); }
  if (to) { wf.push("substr(COALESCE(completed_at, reported_at), 1, 10) <= ?"); wp.push(to); }
  for (const w of db.all(
    `SELECT asset_id, labour_cost, parts_cost, vendor_cost FROM work_orders WHERE status != 'CANCELLED' ${wf.length ? `AND ${wf.join(' AND ')}` : ''}`,
    wp,
  )) {
    add(w.asset_id, 'cm_parts', w.parts_cost);
    add(w.asset_id, 'cm_labour', w.labour_cost);
    add(w.asset_id, 'cm_vendor', w.vendor_cost);
    add(w.asset_id, 'cm', w.parts_cost + w.labour_cost + w.vendor_cost);
  }
  const sf = [];
  const sp = [];
  if (assetId) { sf.push('asset_id = ?'); sp.push(assetId); }
  if (from) { sf.push('completed_date >= ?'); sp.push(from); }
  if (to) { sf.push('completed_date <= ?'); sp.push(to); }
  for (const s of db.all(
    `SELECT asset_id, labour_cost, parts_cost, vendor_cost FROM ppm_schedules WHERE status = 'COMPLETED' ${sf.length ? `AND ${sf.join(' AND ')}` : ''}`,
    sp,
  )) {
    add(s.asset_id, 'ppm_parts', s.parts_cost);
    add(s.asset_id, 'ppm_labour', s.labour_cost);
    add(s.asset_id, 'ppm_vendor', s.vendor_cost);
    add(s.asset_id, 'ppm', s.parts_cost + s.labour_cost + s.vendor_cost);
  }
  for (const o of m.values()) o.total = o.cm + o.ppm;
  return m;
}

// ---------------- lifespan ----------------

export function assetLifecycle(ctx, a, maintenanceCost = 0) {
  const today = ctx.today();
  const start = a.commissioning_date || a.purchase_date || a.created_at.slice(0, 10);
  const life = a.lifespan_years || a.category_lifespan || 8;
  const end = a.disposed_at || today;
  const age = Math.max(0, yearsBetween(start, end));
  const used = age / life;
  const cost = a.purchase_cost || 0;
  const salvage = Math.min(a.salvage_value || 0, cost);
  const bookValue = cost - (cost - salvage) * Math.min(1, used);
  const eolDate = addMonths(start, Math.round(life * 12));
  const yearsToEol = Math.max(0, yearsBetween(today, eolDate));
  const replacementCost = cost * (1 + ctx.settings.inflation_rate / 100) ** (age + yearsToEol);
  const ratio = cost ? (maintenanceCost / cost) * 100 : null;
  let state = 'OK';
  if (used >= 1) state = 'BEYOND_LIFE';
  else if (used >= 0.8) state = 'NEAR_END';
  return {
    in_service_date: start,
    lifespan_years: life,
    age_years: round(age, 1),
    remaining_years: round(Math.max(0, life - age), 1),
    life_used_pct: round(used * 100, 1),
    end_of_life_date: eolDate,
    end_of_life_year: Number(eolDate.slice(0, 4)),
    book_value: round(bookValue),
    replacement_cost: round(replacementCost),
    maintenance_cost: round(maintenanceCost),
    maintenance_cost_ratio: ratio === null ? null : round(ratio, 1),
    state,
    replacement_flag: state === 'BEYOND_LIFE' || (ratio !== null && ratio >= ctx.settings.replacement_cost_ratio),
  };
}

const ASSET_FIELDS = `
  SELECT a.id, a.tag_no, a.name, a.status, a.model, a.manufacturer, a.purchase_cost, a.salvage_value, a.purchase_date,
         a.commissioning_date, a.created_at, a.disposed_at, a.lifespan_years, a.risk_class, a.criticality,
         a.department_id, a.category_id, c.lifespan_years AS category_lifespan, c.name AS category_name, c.code AS category_code,
         d.name AS department_name
  FROM assets a JOIN categories c ON c.id = a.category_id JOIN departments d ON d.id = a.department_id`;

export function lifespanReport(ctx, p = {}) {
  const { where, params } = scope(ctx, p);
  where.push(`a.status IN ${FLEET}`);
  const assets = ctx.db.all(`${ASSET_FIELDS} WHERE ${where.join(' AND ')} ORDER BY a.tag_no`, params);
  const costs = maintenanceCostByAsset(ctx.db);
  const rows = assets.map((a) => ({ ...a, ...assetLifecycle(ctx, a, costs.get(a.id)?.total || 0) }));
  const filtered = p.state ? rows.filter((r) => r.state === oneOf(p.state, ['OK', 'NEAR_END', 'BEYOND_LIFE'], { name: 'State' })) : rows;
  const thisYear = Number(ctx.today().slice(0, 4));
  const plan = [];
  const overdue = rows.filter((r) => r.end_of_life_year < thisYear);
  plan.push({ year: `Before ${thisYear}`, count: overdue.length, cost: round(sum(overdue, (r) => r.replacement_cost)) });
  for (let y = thisYear; y <= thisYear + 5; y++) {
    const due = rows.filter((r) => r.end_of_life_year === y);
    plan.push({ year: String(y), count: due.length, cost: round(sum(due, (r) => r.replacement_cost)) });
  }
  return {
    rows: filtered.sort((x, y) => y.life_used_pct - x.life_used_pct),
    summary: {
      assets: rows.length,
      beyond_life: rows.filter((r) => r.state === 'BEYOND_LIFE').length,
      near_end: rows.filter((r) => r.state === 'NEAR_END').length,
      purchase_value: round(sum(rows, (r) => r.purchase_cost)),
      book_value: round(sum(rows, (r) => r.book_value)),
      avg_age: rows.length ? round(avg(rows.map((r) => r.age_years)), 1) : null,
      replacement_5y_cost: round(sum(plan, (x) => x.cost)),
    },
    replacement_plan: plan,
  };
}

// ---------------- expenses ----------------

export function expensesReport(ctx, p = {}) {
  const { from, to } = resolvePeriod(ctx, { ...p, period: p.period || 'ytd' });
  const groupByKey = oneOf(p.group_by, ['department', 'category', 'asset', 'month'], { def: 'department', name: 'Group by' });
  const { where, params } = scope(ctx, p);
  const assets = ctx.db.all(`${ASSET_FIELDS} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}`, params);
  const byId = new Map(assets.map((a) => [a.id, a]));
  const items = [];
  for (const w of ctx.db.all(
    `SELECT asset_id, substr(COALESCE(completed_at, reported_at), 1, 10) AS d, labour_cost, parts_cost, vendor_cost
     FROM work_orders WHERE status != 'CANCELLED' AND substr(COALESCE(completed_at, reported_at), 1, 10) BETWEEN ? AND ?`,
    [from, to],
  )) if (byId.has(w.asset_id)) items.push({ kind: 'CM', ...w });
  for (const s of ctx.db.all(
    `SELECT asset_id, completed_date AS d, labour_cost, parts_cost, vendor_cost FROM ppm_schedules
     WHERE status = 'COMPLETED' AND completed_date BETWEEN ? AND ?`,
    [from, to],
  )) if (byId.has(s.asset_id)) items.push({ kind: 'PPM', ...s });

  const keyOf = (it) => {
    const a = byId.get(it.asset_id);
    if (groupByKey === 'department') return a.department_name;
    if (groupByKey === 'category') return a.category_name;
    if (groupByKey === 'asset') return `${a.tag_no} — ${a.name}`;
    return it.d.slice(0, 7);
  };
  const groups = new Map();
  for (const it of items) {
    const k = keyOf(it);
    if (!groups.has(k)) groups.set(k, { group: k, cm: 0, ppm: 0, parts: 0, labour: 0, vendor: 0, total: 0, jobs: 0 });
    const g = groups.get(k);
    const t = it.labour_cost + it.parts_cost + it.vendor_cost;
    g[it.kind === 'CM' ? 'cm' : 'ppm'] += t;
    g.parts += it.parts_cost;
    g.labour += it.labour_cost;
    g.vendor += it.vendor_cost;
    g.total += t;
    g.jobs++;
  }
  const rows = [...groups.values()]
    .map((g) => Object.fromEntries(Object.entries(g).map(([k, v]) => [k, typeof v === 'number' && k !== 'jobs' ? round(v) : v])))
    .sort((x, y) => (groupByKey === 'month' ? (x.group < y.group ? -1 : 1) : y.total - x.total));

  const perAsset = new Map();
  for (const it of items) perAsset.set(it.asset_id, (perAsset.get(it.asset_id) || 0) + it.labour_cost + it.parts_cost + it.vendor_cost);
  const top = [...perAsset.entries()].sort((x, y) => y[1] - x[1]).slice(0, 10).map(([aid, total]) => {
    const a = byId.get(aid);
    return { id: aid, tag_no: a.tag_no, name: a.name, department_name: a.department_name, total: round(total), purchase_cost: a.purchase_cost };
  });

  const total = sum(items, (it) => it.labour_cost + it.parts_cost + it.vendor_cost);
  const fleetValue = sum(assets.filter((a) => a.status !== 'DISPOSED' && a.status !== 'REJECTED' && a.status !== 'PENDING'), (a) => a.purchase_cost);
  const years = Math.max(diffDays(from, to) + 1, 1) / 365.25;
  return {
    period: { from, to },
    group_by: groupByKey,
    rows,
    top_assets: top,
    summary: {
      total: round(total),
      cm: round(sum(items.filter((i) => i.kind === 'CM'), (it) => it.labour_cost + it.parts_cost + it.vendor_cost)),
      ppm: round(sum(items.filter((i) => i.kind === 'PPM'), (it) => it.labour_cost + it.parts_cost + it.vendor_cost)),
      parts: round(sum(items, (i) => i.parts_cost)),
      labour: round(sum(items, (i) => i.labour_cost)),
      vendor: round(sum(items, (i) => i.vendor_cost)),
      jobs: items.length,
      fleet_value: round(fleetValue),
      // Cost of service ratio: annualised maintenance spend as % of acquisition value.
      cost_of_service_ratio: fleetValue ? round(((total / years) / fleetValue) * 100, 2) : null,
    },
  };
}

// ---------------- predictive maintenance ----------------
//
// Reliability-based prediction from the asset's own breakdown history:
//  1. Failure rate per year with a category prior (empirical Bayes, 1 asset-year of prior weight),
//     so a new pump with no history inherits the behaviour of its category.
//  2. Adjusted for recent trend, ageing beyond 70% of expected life, and recent failed PPMs.
//  3. P(failure within horizon) from a Poisson model: 1 - exp(-rate * horizon).
//  4. Risk score blends likelihood, clinical criticality, age, cost and PPM findings.
// It does not read sensors. Treat it as a ranking for planning, not a guarantee.

const RISK_CLASS = { A: 0.25, B: 0.5, C: 0.75, D: 1 };
const CRIT = { Low: 0.3, Medium: 0.6, High: 1 };

function failureRows(db) {
  return db.all(
    `SELECT w.id, w.asset_id, w.reported_at, w.failure_cause, w.result FROM work_orders w
     WHERE w.status != 'CANCELLED' AND IFNULL(w.result, '') != 'NO_FAULT_FOUND'
       AND IFNULL(w.failure_cause, '') != 'No fault found'
     ORDER BY w.reported_at`,
  );
}

export function riskLevel(score) {
  if (score >= 70) return 'CRITICAL';
  if (score >= 55) return 'HIGH';
  if (score >= 35) return 'MEDIUM';
  return 'LOW';
}

export function predictAll(ctx, p = {}) {
  const today = ctx.today();
  const horizon = int(p.horizon_days, { min: 7, max: 730, def: ctx.settings.pdm_horizon_days, name: 'Horizon' });
  const assets = ctx.db.all(`${ASSET_FIELDS} WHERE a.status IN ${FLEET}`);
  const failures = groupBy(failureRows(ctx.db), (f) => f.asset_id);
  const costs = maintenanceCostByAsset(ctx.db);
  const ppmFails = groupBy(
    ctx.db.all("SELECT asset_id, completed_date FROM ppm_schedules WHERE status = 'COMPLETED' AND overall_result = 'FAIL' AND completed_date >= ?", [addDays(today, -365)]),
    (r) => r.asset_id,
  );
  const plans = new Map(ctx.db.all('SELECT asset_id, frequency_months FROM ppm_plans WHERE active = 1').map((r) => [r.asset_id, r.frequency_months]));
  const partsBy = groupBy(
    ctx.db.all(`SELECT w.asset_id, p.description, SUM(p.qty) AS qty FROM wo_parts p JOIN work_orders w ON w.id = p.work_order_id
                WHERE w.status != 'CANCELLED' GROUP BY w.asset_id, p.description`),
    (r) => r.asset_id,
  );

  // category prior: failures per asset-year across the fleet
  // Breakdowns before the hospital started recording them are unknown, so exposure only counts
  // the period covered by records (from the first work order in the system).
  const firstRecord = ctx.db.get("SELECT MIN(reported_at) AS d FROM work_orders WHERE status != 'CANCELLED'")?.d;
  const recordsFrom = firstRecord ? firstRecord.slice(0, 10) : today;
  const exposure = (a) => {
    const inService = a.commissioning_date || a.purchase_date || a.created_at.slice(0, 10);
    return Math.max(0.25, yearsBetween(inService > recordsFrom ? inService : recordsFrom, today));
  };
  const cat = new Map();
  for (const a of assets) {
    const c = cat.get(a.category_id) || { n: 0, years: 0 };
    c.n += (failures.get(a.id) || []).length;
    c.years += exposure(a);
    cat.set(a.category_id, c);
  }
  const yearAgo = `${addDays(today, -365)} 00:00:00`;
  const twoYearsAgo = `${addDays(today, -730)} 00:00:00`;
  const out = [];
  for (const a of assets) {
    if (isScopedToDepartment(ctx.user) && a.department_id !== ctx.user.department_id) continue;
    if (p.department_id && a.department_id !== Number(p.department_id)) continue;
    if (p.category_id && a.category_id !== Number(p.category_id)) continue;
    if (p.asset_id && a.id !== Number(p.asset_id)) continue;
    const fl = failures.get(a.id) || [];
    const T = exposure(a);
    const c = cat.get(a.category_id);
    const prior = Math.max(0.05, c.years ? c.n / c.years : 0.3);
    const base = (fl.length + prior * 1) / (T + 1);
    const n12 = fl.filter((f) => f.reported_at >= yearAgo).length;
    const nPrev = fl.filter((f) => f.reported_at >= twoYearsAgo && f.reported_at < yearAgo).length;
    const trend = T >= 2 ? clamp((n12 + 1) / (nPrev + 1), 0.5, 2) : 1;
    const life = assetLifecycle(ctx, a, costs.get(a.id)?.total || 0);
    const used = life.life_used_pct / 100;
    const wear = used <= 0.7 ? 1 : clamp(1 + (used - 0.7) * 2, 1, 3);
    const pf = (ppmFails.get(a.id) || []).length;
    const ppmFactor = clamp(1 + 0.25 * pf, 1, 2);
    const rate = base * trend * wear * ppmFactor;
    const prob = 1 - Math.exp(-rate * (horizon / 365.25));
    const last = fl.length ? fl[fl.length - 1].reported_at.slice(0, 10) : null;
    const mtbfDays = fl.length ? (T * 365.25) / fl.length : null;
    const expectedGap = 365.25 / rate;
    const anchor = last || life.in_service_date;
    let nextFailure = addDays(anchor, Math.round(expectedGap));
    if (nextFailure < today) nextFailure = today;
    const crit = 0.5 * (RISK_CLASS[a.risk_class] ?? 0.5) + 0.5 * (CRIT[a.criticality] ?? 0.6);
    const costRatio = life.maintenance_cost_ratio || 0;
    const parts = {
      likelihood: clamp(prob / 0.5, 0, 1),
      criticality: crit,
      age: clamp(used, 0, 1),
      cost: clamp(costRatio / ctx.settings.replacement_cost_ratio, 0, 1),
      ppm: clamp(pf / 2, 0, 1),
    };
    const score = round(100 * (0.35 * parts.likelihood + 0.2 * parts.criticality + 0.2 * parts.age + 0.15 * parts.cost + 0.1 * parts.ppm), 0);

    const recs = [];
    if (prob >= 0.5) recs.push(`High chance of breakdown within ${horizon} days — schedule a predictive inspection`);
    else if (prob >= 0.3) recs.push(`Moderate chance of breakdown within ${horizon} days — check at next PPM`);
    if (n12 >= 2 && trend >= 1.5) recs.push(`Breakdowns rising: ${n12} in the last 12 months vs ${nPrev} the year before`);
    if (life.state === 'BEYOND_LIFE') recs.push(`Beyond expected life (${life.age_years} of ${life.lifespan_years} yrs) — include in replacement budget`);
    else if (life.state === 'NEAR_END') recs.push(`Near end of life — plan replacement for ${life.end_of_life_year}`);
    if (costRatio >= ctx.settings.replacement_cost_ratio) recs.push(`Maintenance spend is ${round(costRatio, 0)}% of purchase cost — assess for BER / replacement`);
    if (pf) recs.push(`${pf} failed PPM(s) in the last 12 months — confirm corrective action was effective`);
    const userErr = fl.filter((f) => f.failure_cause === 'User error / mishandling').length;
    if (userErr >= 2) recs.push(`${userErr} breakdowns caused by user handling — arrange user training`);
    const freq = plans.get(a.id);
    if (score >= 55 && freq && freq > 6) recs.push(`Consider shortening the PPM interval from ${freq} to 6 months`);
    if (score >= 55 && !freq) recs.push('No active PPM plan — create one');
    const topPart = (partsBy.get(a.id) || []).sort((x, y) => y.qty - x.qty)[0];
    if (topPart && topPart.qty >= 2) recs.push(`Keep spare in stock: ${topPart.description} (used ${topPart.qty}×)`);

    out.push({
      id: a.id,
      tag_no: a.tag_no,
      name: a.name,
      model: a.model,
      status: a.status,
      department_id: a.department_id,
      department_name: a.department_name,
      category_name: a.category_name,
      risk_class: a.risk_class,
      criticality: a.criticality,
      failures: fl.length,
      failures_12m: n12,
      failures_prev_12m: nPrev,
      failure_rate_per_year: round(rate, 2),
      mtbf_days: mtbfDays === null ? null : round(mtbfDays, 0),
      last_failure: last,
      predicted_next_failure: rate > 0.02 ? nextFailure : null,
      probability: round(prob * 100, 1),
      age_years: life.age_years,
      life_used_pct: life.life_used_pct,
      maintenance_cost_ratio: life.maintenance_cost_ratio,
      ppm_fails_12m: pf,
      score,
      level: riskLevel(score),
      components: Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, round(v * 100, 0)])),
      recommendations: recs,
    });
  }
  out.sort((x, y) => y.score - x.score || y.probability - x.probability);
  const levels = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
  for (const r of out) levels[r.level]++;
  return { horizon_days: horizon, rows: out, levels, threshold: ctx.settings.pdm_risk_threshold };
}

export function assetRisk(ctx, assetId) {
  return predictAll(ctx, { asset_id: assetId }).rows[0] || null;
}
