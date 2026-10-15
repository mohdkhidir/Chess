import { docNo, insert, update } from './db.js';
import {
  addDays, addMonths, bad, dateOrNull, endOfMonth, escapeLike, forbidden, id, int, notFound, num, oneOf, optId,
  parseJson, round, startOfMonth, str, bool,
} from './util.js';
import { createApproval, registerApprovalEffect } from './approvals.js';
import { createWorkOrder } from './workorders.js';
import { isScopedToDepartment } from './permissions.js';

export const PPM_DISPLAY = {
  UPCOMING: 'Upcoming',
  DUE: 'Due',
  IN_PROGRESS: 'In progress',
  OVERDUE: 'Overdue',
  COMPLETED: 'Completed',
  COMPLETED_LATE: 'Completed late',
  DEFERRED: 'Deferred',
  CANCELLED: 'Cancelled',
};

const GENERATE_FOR = ['ACTIVE', 'BREAKDOWN', 'STANDBY'];

// A PPM is on time if done by the end of its scheduled month (+ grace days).
// Predictive inspections (PDM) get a fixed 14-day window from their date.
export function windowEnd(row, graceDays = 0) {
  if (row.type === 'PDM') return addDays(row.scheduled_date, 14 + graceDays);
  return addDays(endOfMonth(row.scheduled_date), graceDays);
}

export function displayStatus(row, today, graceDays = 0) {
  const end = windowEnd(row, graceDays);
  switch (row.status) {
    case 'COMPLETED':
      return row.completed_date && row.completed_date > end ? 'COMPLETED_LATE' : 'COMPLETED';
    case 'DEFERRED':
    case 'CANCELLED':
      return row.status;
    default: {
      if (today > end) return 'OVERDUE';
      if (row.status === 'IN_PROGRESS') return 'IN_PROGRESS';
      const dueFrom = row.type === 'PDM' ? addDays(row.scheduled_date, -7) : startOfMonth(row.scheduled_date);
      return today >= dueFrom ? 'DUE' : 'UPCOMING';
    }
  }
}

export function firstDueDate(base, frequency, today) {
  const floor = startOfMonth(today);
  for (let k = 1; k < 2000; k++) {
    const d = addMonths(base, k * frequency);
    if (d >= floor) return d;
  }
  return addMonths(today, frequency);
}

export function ensurePlan(ctx, asset, { frequency, category, startDate = null }) {
  const existing = ctx.db.get('SELECT id FROM ppm_plans WHERE asset_id = ?', [asset.id]);
  if (existing) return existing.id;
  const base = asset.commissioning_date || asset.purchase_date || ctx.today();
  const checklist = category ? parseJson(category.checklist, category.checklist || []) : [];
  return insert(ctx.db, 'ppm_plans', {
    asset_id: asset.id,
    frequency_months: frequency,
    start_date: startDate || firstDueDate(base, frequency, ctx.today()),
    checklist: JSON.stringify(Array.isArray(checklist) ? checklist : []),
    est_required: category ? category.est_required : 1,
    performed_by: asset.service_vendor_id ? 'VENDOR' : 'IN_HOUSE',
    vendor_id: asset.service_vendor_id || null,
    assigned_to: null,
    estimated_hours: 1,
    active: 1,
    created_at: ctx.now(),
  });
}

export function generateForPlan(ctx, plan, from, to) {
  if (!plan.active || plan.frequency_months <= 0) return 0;
  const asset = ctx.db.get('SELECT status FROM assets WHERE id = ?', [plan.asset_id]);
  if (!asset || !GENERATE_FOR.includes(asset.status)) return 0;
  let created = 0;
  for (let k = 0; k < 2000; k++) {
    const d = addMonths(plan.start_date, k * plan.frequency_months);
    if (d > to) break;
    if (d < from) continue;
    const exists = ctx.db.get(
      "SELECT 1 FROM ppm_schedules WHERE plan_id = ? AND scheduled_date = ? AND type = 'PPM'",
      [plan.id, d],
    );
    if (exists) continue;
    insert(ctx.db, 'ppm_schedules', {
      ppm_no: docNo(ctx.db, 'PPM', d),
      plan_id: plan.id,
      asset_id: plan.asset_id,
      type: 'PPM',
      scheduled_date: d,
      status: 'SCHEDULED',
      assigned_to: plan.assigned_to,
      created_at: ctx.now(),
    });
    created++;
  }
  return created;
}

function horizon(ctx) {
  const today = ctx.today();
  return [startOfMonth(today), endOfMonth(addMonths(today, ctx.settings.ppm_horizon_months))];
}

export function activatePlanSchedules(ctx, assetId) {
  const plan = ctx.db.get('SELECT * FROM ppm_plans WHERE asset_id = ?', [assetId]);
  if (!plan) return 0;
  const [from, to] = horizon(ctx);
  return generateForPlan(ctx, plan, from, to);
}

export function generateAll(ctx, from, to) {
  let created = 0;
  for (const plan of ctx.db.all('SELECT * FROM ppm_plans WHERE active = 1')) created += generateForPlan(ctx, plan, from, to);
  return created;
}

// Keeps the rolling 12-month PPM calendar filled; runs at most once a day (called at login).
export function rollingGenerate(ctx) {
  const today = ctx.today();
  const last = ctx.db.get("SELECT value FROM meta WHERE key = 'ppm_rolled_on'");
  if (last && last.value === today) return 0;
  const [from, to] = horizon(ctx);
  const n = generateAll(ctx, from, to);
  ctx.db.run("INSERT OR REPLACE INTO meta (key, value) VALUES ('ppm_rolled_on', ?)", [today]);
  return n;
}

export function cancelFutureSchedules(ctx, assetId, reason, { includePast = false } = {}) {
  const params = [ctx.now(), reason, assetId];
  let sql = `UPDATE ppm_schedules SET status = 'CANCELLED', updated_at = ?, remarks = ?
             WHERE asset_id = ? AND status IN ('SCHEDULED', 'IN_PROGRESS')`;
  if (!includePast) {
    sql += ' AND scheduled_date >= ?';
    params.push(ctx.today());
  }
  return ctx.db.run(sql, params).changes;
}

const SCHED_SELECT = `
  SELECT s.*, a.tag_no, a.name AS asset_name, a.department_id, a.category_id, a.status AS asset_status,
         a.criticality, a.model, a.manufacturer, a.serial_no,
         d.name AS department_name, c.name AS category_name, c.code AS category_code,
         l.name AS location_name,
         u.full_name AS assigned_name, pb.full_name AS performed_by_name,
         p.frequency_months, p.performed_by AS plan_performed_by, v.name AS plan_vendor_name
  FROM ppm_schedules s
  JOIN assets a ON a.id = s.asset_id
  JOIN departments d ON d.id = a.department_id
  JOIN categories c ON c.id = a.category_id
  LEFT JOIN locations l ON l.id = a.location_id
  LEFT JOIN ppm_plans p ON p.id = s.plan_id
  LEFT JOIN vendors v ON v.id = p.vendor_id
  LEFT JOIN users u ON u.id = s.assigned_to
  LEFT JOIN users pb ON pb.id = s.performed_by`;

function decorate(ctx, s) {
  const grace = ctx.settings.ppm_grace_days;
  return {
    ...s,
    window_end: windowEnd(s, grace),
    display_status: displayStatus(s, ctx.today(), grace),
  };
}

function getSchedule(ctx, schedId) {
  const s = ctx.db.get(`${SCHED_SELECT} WHERE s.id = ?`, [id(schedId, 'PPM')]);
  if (!s) throw notFound('PPM');
  if (isScopedToDepartment(ctx.user) && s.department_id !== ctx.user.department_id) throw forbidden();
  return s;
}

export function listSchedules(ctx, p = {}) {
  const where = [];
  const params = [];
  if (p.month) {
    if (!/^\d{4}-\d{2}$/.test(p.month)) throw bad('Month must be YYYY-MM');
    where.push('s.scheduled_date BETWEEN ? AND ?');
    params.push(`${p.month}-01`, endOfMonth(`${p.month}-01`));
  }
  if (p.from) {
    where.push('s.scheduled_date >= ?');
    params.push(dateOrNull(p.from, 'From'));
  }
  if (p.to) {
    where.push('s.scheduled_date <= ?');
    params.push(dateOrNull(p.to, 'To'));
  }
  if (isScopedToDepartment(ctx.user)) {
    where.push('a.department_id = ?');
    params.push(ctx.user.department_id);
  } else if (p.department_id) {
    where.push('a.department_id = ?');
    params.push(id(p.department_id));
  }
  if (p.category_id) {
    where.push('a.category_id = ?');
    params.push(id(p.category_id));
  }
  if (p.asset_id) {
    where.push('s.asset_id = ?');
    params.push(id(p.asset_id));
  }
  if (p.type) {
    where.push('s.type = ?');
    params.push(oneOf(p.type, ['PPM', 'PDM'], { name: 'Type' }));
  }
  if (p.assigned_to === 'me') {
    where.push('s.assigned_to = ?');
    params.push(ctx.user.id);
  } else if (p.assigned_to) {
    where.push('s.assigned_to = ?');
    params.push(id(p.assigned_to));
  }
  if (p.q) {
    const q = `%${escapeLike(String(p.q).trim())}%`;
    where.push("(a.tag_no LIKE ? ESCAPE '\\' OR a.name LIKE ? ESCAPE '\\' OR s.ppm_no LIKE ? ESCAPE '\\')");
    params.push(q, q, q);
  }
  const open = p.display_status === 'OPEN';
  if (open || ['OVERDUE', 'DUE', 'UPCOMING', 'IN_PROGRESS'].includes(p.display_status)) {
    where.push("s.status IN ('SCHEDULED','IN_PROGRESS')");
  }
  const sql = `${SCHED_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY s.scheduled_date, a.tag_no`;
  let rows = ctx.db.all(sql, params).map((s) => decorate(ctx, s));
  if (p.display_status && !open) {
    const want = oneOf(p.display_status, Object.keys(PPM_DISPLAY), { name: 'Status' });
    rows = rows.filter((r) => r.display_status === want);
  } else if (open) {
    rows = rows.filter((r) => ['OVERDUE', 'DUE', 'IN_PROGRESS'].includes(r.display_status));
  }
  const total = rows.length;
  const limit = int(p.page_size, { min: 1, max: 10000, def: 50, name: 'Page size' });
  const page = int(p.page, { min: 1, max: 100000, def: 1, name: 'Page' });
  return { rows: rows.slice((page - 1) * limit, page * limit), total, page, page_size: limit };
}

function applyDeferral(ctx, s, newDate, reason, approvalId = null) {
  const now = ctx.now();
  const clash = ctx.db.get(
    "SELECT ppm_no FROM ppm_schedules WHERE plan_id = ? AND scheduled_date = ? AND type = ? AND id != ?",
    [s.plan_id, newDate, s.type, s.id],
  );
  if (clash && s.plan_id && s.type === 'PPM') throw bad(`${clash.ppm_no} is already scheduled on ${newDate}`);
  update(ctx.db, 'ppm_schedules', s.id, { status: 'DEFERRED', deferred_to: newDate, defer_reason: reason, updated_at: now });
  const newId = insert(ctx.db, 'ppm_schedules', {
    ppm_no: docNo(ctx.db, 'PPM', newDate),
    plan_id: s.plan_id,
    asset_id: s.asset_id,
    type: s.type,
    scheduled_date: newDate,
    status: 'SCHEDULED',
    assigned_to: s.assigned_to,
    reason: s.reason,
    remarks: `Deferred from ${s.ppm_no}`,
    created_at: now,
  });
  ctx.event(s.asset_id, 'PPM_DEFERRED', `${s.ppm_no} deferred to ${newDate}: ${reason}`, approvalId ? 'approvals' : 'ppm_schedules', approvalId || s.id);
  return newId;
}

registerApprovalEffect('PPM_DEFERRAL', {
  onApproved(ctx, a, payload) {
    const s = ctx.db.get('SELECT * FROM ppm_schedules WHERE id = ?', [a.ref_id]);
    if (!s || !['SCHEDULED', 'IN_PROGRESS'].includes(s.status)) return;
    applyDeferral(ctx, s, payload.new_date, payload.reason, a.id);
  },
  onRejected(ctx, a, _p, remarks) {
    const s = ctx.db.get('SELECT asset_id, ppm_no FROM ppm_schedules WHERE id = ?', [a.ref_id]);
    if (s) ctx.event(s.asset_id, 'PPM_DEFERRAL_REJECTED', `Deferral of ${s.ppm_no} rejected: ${remarks}`, 'approvals', a.id);
  },
});

function readPlan(p) {
  return {
    frequency_months: int(p.frequency_months, { min: 1, max: 60, required: true, name: 'Frequency (months)' }),
    start_date: dateOrNull(p.start_date, 'First due date'),
    checklist: (Array.isArray(p.checklist) ? p.checklist : String(p.checklist || '').split('\n'))
      .map((x) => String(x).trim())
      .filter(Boolean)
      .slice(0, 60),
    est_required: p.est_required === undefined ? 1 : bool(p.est_required),
    performed_by: oneOf(p.performed_by, ['IN_HOUSE', 'VENDOR'], { def: 'IN_HOUSE', name: 'Performed by' }),
    vendor_id: optId(p.vendor_id, 'Vendor'),
    assigned_to: optId(p.assigned_to, 'Assigned technician'),
    estimated_hours: num(p.estimated_hours, { min: 0, max: 200, def: 1, name: 'Estimated hours' }),
    active: p.active === undefined ? 1 : bool(p.active),
  };
}

export const handlers = {
  'ppm.plans.list': {
    perm: 'ppm.view',
    fn(ctx, p) {
      const where = ["a.status NOT IN ('DISPOSED','REJECTED')"];
      const params = [];
      if (p.department_id) {
        where.push('a.department_id = ?');
        params.push(id(p.department_id));
      }
      if (p.category_id) {
        where.push('a.category_id = ?');
        params.push(id(p.category_id));
      }
      if (p.q) {
        const q = `%${escapeLike(String(p.q).trim())}%`;
        where.push("(a.tag_no LIKE ? ESCAPE '\\' OR a.name LIKE ? ESCAPE '\\')");
        params.push(q, q);
      }
      if (p.without_plan) where.push('pp.id IS NULL AND a.ppm_required = 1');
      const rows = ctx.db.all(
        `SELECT a.id AS asset_id, a.tag_no, a.name, a.status AS asset_status, d.name AS department_name,
                c.name AS category_name, pp.id, pp.frequency_months, pp.start_date, pp.active, pp.performed_by,
                pp.assigned_to, u.full_name AS assigned_name, v.name AS vendor_name,
                (SELECT MIN(s.scheduled_date) FROM ppm_schedules s WHERE s.asset_id = a.id AND s.status IN ('SCHEDULED','IN_PROGRESS')) AS next_due,
                (SELECT MAX(s.completed_date) FROM ppm_schedules s WHERE s.asset_id = a.id AND s.status = 'COMPLETED') AS last_done
         FROM assets a
         JOIN departments d ON d.id = a.department_id
         JOIN categories c ON c.id = a.category_id
         LEFT JOIN ppm_plans pp ON pp.asset_id = a.id
         LEFT JOIN users u ON u.id = pp.assigned_to
         LEFT JOIN vendors v ON v.id = pp.vendor_id
         WHERE ${where.join(' AND ')}
         ORDER BY a.tag_no LIMIT 2000`,
        params,
      );
      return { rows };
    },
  },

  'ppm.plans.get': {
    perm: 'ppm.view',
    fn(ctx, p) {
      const assetId = id(p.asset_id, 'Asset');
      const asset = ctx.db.get(
        `SELECT a.id, a.tag_no, a.name, a.status, a.service_vendor_id, a.commissioning_date, a.purchase_date,
                c.ppm_frequency_months, c.checklist AS category_checklist, c.est_required AS category_est
         FROM assets a JOIN categories c ON c.id = a.category_id WHERE a.id = ?`,
        [assetId],
      );
      if (!asset) throw notFound('Asset');
      const plan = ctx.db.get('SELECT * FROM ppm_plans WHERE asset_id = ?', [assetId]);
      return {
        asset: { ...asset, category_checklist: parseJson(asset.category_checklist, []) },
        plan: plan ? { ...plan, checklist: parseJson(plan.checklist, []) } : null,
      };
    },
  },

  'ppm.plans.save': {
    perm: 'ppm.plan',
    write: true,
    fn(ctx, p) {
      const assetId = id(p.asset_id, 'Asset');
      const asset = ctx.db.get('SELECT * FROM assets WHERE id = ?', [assetId]);
      if (!asset) throw notFound('Asset');
      if (['DISPOSED', 'REJECTED'].includes(asset.status)) throw bad('This asset is not in service');
      const f = readPlan(p);
      if (f.performed_by === 'VENDOR' && !f.vendor_id) throw bad('Choose the service vendor');
      if (f.assigned_to && !ctx.db.get("SELECT id FROM users WHERE id = ? AND status = 'ACTIVE'", [f.assigned_to])) throw bad('Assigned user not found');
      const now = ctx.now();
      const existing = ctx.db.get('SELECT * FROM ppm_plans WHERE asset_id = ?', [assetId]);
      const base = asset.commissioning_date || asset.purchase_date || ctx.today();
      const startDate = f.start_date || (existing && existing.frequency_months === f.frequency_months
        ? existing.start_date
        : firstDueDate(base, f.frequency_months, ctx.today()));
      const data = { ...f, start_date: startDate, checklist: JSON.stringify(f.checklist), updated_at: now };
      let planId;
      if (existing) {
        planId = existing.id;
        update(ctx.db, 'ppm_plans', planId, data);
        const cadenceChanged = existing.frequency_months !== f.frequency_months || existing.start_date !== startDate;
        if (cadenceChanged || !f.active) {
          // Drop future, untouched PPMs so the calendar follows the new cadence.
          ctx.db.run(
            `DELETE FROM ppm_schedules WHERE plan_id = ? AND type = 'PPM' AND status = 'SCHEDULED' AND started_at IS NULL
             AND scheduled_date >= ?
             AND id NOT IN (SELECT ref_id FROM approvals WHERE type = 'PPM_DEFERRAL' AND status = 'PENDING')`,
            [planId, startOfMonth(ctx.today())],
          );
        }
        if (f.assigned_to !== existing.assigned_to) {
          ctx.db.run(
            "UPDATE ppm_schedules SET assigned_to = ? WHERE plan_id = ? AND status = 'SCHEDULED' AND scheduled_date >= ?",
            [f.assigned_to, planId, ctx.today()],
          );
        }
      } else {
        planId = insert(ctx.db, 'ppm_plans', { asset_id: assetId, ...data, created_at: now });
      }
      if (!asset.ppm_required) update(ctx.db, 'assets', assetId, { ppm_required: 1 });
      const created = activatePlanSchedules(ctx, assetId);
      ctx.event(assetId, 'PPM_PLAN', `PPM plan ${existing ? 'updated' : 'created'}: every ${f.frequency_months} month(s) from ${startDate}${f.active ? '' : ' (inactive)'}`);
      ctx.audit(`PPM plan ${existing ? 'updated' : 'created'}`, 'ppm_plans', planId, { asset_id: assetId, frequency: f.frequency_months });
      return { id: planId, created };
    },
  },

  'ppm.generate': {
    perm: 'ppm.plan',
    write: true,
    fn(ctx, p) {
      let from;
      let to;
      if (p.year) {
        const y = int(p.year, { min: 2000, max: 2100, name: 'Year' });
        from = `${y}-01-01`;
        to = `${y}-12-31`;
      } else {
        from = dateOrNull(p.from, 'From') || startOfMonth(ctx.today());
        to = dateOrNull(p.to, 'To') || endOfMonth(addMonths(ctx.today(), ctx.settings.ppm_horizon_months));
      }
      if (to < from) throw bad('End date is before start date');
      const created = generateAll(ctx, from, to);
      ctx.audit('PPM schedule generated', 'ppm_schedules', null, { from, to, created });
      return { created, from, to };
    },
  },

  'ppm.list': {
    perm: 'ppm.view',
    fn: (ctx, p) => listSchedules(ctx, p),
  },

  'ppm.get': {
    perm: 'ppm.view',
    fn(ctx, p) {
      const s = decorate(ctx, getSchedule(ctx, p.id));
      const plan = s.plan_id ? ctx.db.get('SELECT checklist, est_required, estimated_hours FROM ppm_plans WHERE id = ?', [s.plan_id]) : null;
      let checklist = plan ? parseJson(plan.checklist, []) : [];
      if (!checklist.length) {
        const cat = ctx.db.get('SELECT checklist FROM categories WHERE id = ?', [s.category_id]);
        checklist = parseJson(cat?.checklist, []);
      }
      const approvals = ctx.db.all(
        "SELECT id, status, title, current_level, required_level, requested_at FROM approvals WHERE type = 'PPM_DEFERRAL' AND ref_id = ? ORDER BY id DESC",
        [s.id],
      );
      return {
        ...s,
        checklist,
        est_required: plan ? plan.est_required : 1,
        estimated_hours: plan ? plan.estimated_hours : 1,
        checklist_results: parseJson(s.checklist_results, null),
        est_readings: parseJson(s.est_readings, null),
        approvals,
      };
    },
  },

  'ppm.assign': {
    perm: 'ppm.plan',
    write: true,
    fn(ctx, p) {
      const s = getSchedule(ctx, p.id);
      if (!['SCHEDULED', 'IN_PROGRESS'].includes(s.status)) throw bad('Only open PPMs can be assigned');
      const userId = optId(p.assigned_to, 'Technician');
      if (userId && !ctx.db.get("SELECT id FROM users WHERE id = ? AND status = 'ACTIVE'", [userId])) throw bad('User not found');
      update(ctx.db, 'ppm_schedules', s.id, { assigned_to: userId, updated_at: ctx.now() });
      return { ok: true };
    },
  },

  'ppm.start': {
    perm: 'ppm.execute',
    write: true,
    fn(ctx, p) {
      const s = getSchedule(ctx, p.id);
      if (s.status !== 'SCHEDULED') throw bad('Only scheduled PPMs can be started');
      if (['DISPOSED', 'PENDING', 'REJECTED'].includes(s.asset_status)) throw bad('This asset is not in service');
      update(ctx.db, 'ppm_schedules', s.id, {
        status: 'IN_PROGRESS',
        started_at: ctx.now(),
        assigned_to: s.assigned_to || ctx.user.id,
        updated_at: ctx.now(),
      });
      return { ok: true };
    },
  },

  'ppm.complete': {
    perm: 'ppm.execute',
    write: true,
    fn(ctx, p) {
      const s = getSchedule(ctx, p.id);
      if (!['SCHEDULED', 'IN_PROGRESS'].includes(s.status)) throw bad('This PPM is not open');
      if (['DISPOSED', 'PENDING', 'REJECTED'].includes(s.asset_status)) throw bad('This asset is not in service');
      const completed = dateOrNull(p.completed_date, 'Completion date') || ctx.today();
      if (completed > ctx.today()) throw bad('Completion date cannot be in the future');
      const results = (Array.isArray(p.checklist_results) ? p.checklist_results : []).slice(0, 80).map((r) => ({
        item: str(r.item, { required: true, max: 200, name: 'Checklist item' }),
        result: oneOf(r.result, ['PASS', 'FAIL', 'NA'], { name: 'Checklist result' }),
        remark: str(r.remark, { max: 300, name: 'Remark' }),
      }));
      const estResult = oneOf(p.est_result, ['PASS', 'FAIL', 'NA'], { def: 'NA', name: 'Electrical safety result' });
      const readings = {};
      for (const k of ['earth_resistance', 'equipment_leakage', 'applied_part_leakage', 'insulation_resistance']) {
        if (p.est_readings && p.est_readings[k] !== undefined && p.est_readings[k] !== '') {
          readings[k] = num(p.est_readings[k], { min: 0, max: 1e7, name: k.replace(/_/g, ' ') });
        }
      }
      const failed = results.filter((r) => r.result === 'FAIL').map((r) => r.item);
      if (estResult === 'FAIL') failed.push('Electrical safety test');
      const overall = oneOf(p.overall_result, ['PASS', 'FAIL'], { def: failed.length ? 'FAIL' : 'PASS', name: 'Overall result' });
      if (overall === 'PASS' && failed.length && !str(p.remarks, { max: 1000 })) {
        throw bad('Explain in remarks why the PPM passes with failed items');
      }
      const hours = num(p.labour_hours, { min: 0, max: 500, def: 0, name: 'Labour hours' });
      const now = ctx.now();
      const patch = {
        status: 'COMPLETED',
        completed_date: completed,
        performed_by: ctx.user.id,
        vendor_name: str(p.vendor_name, { max: 120, name: 'Vendor' }),
        checklist_results: JSON.stringify(results),
        est_result: estResult,
        est_readings: Object.keys(readings).length ? JSON.stringify(readings) : null,
        overall_result: overall,
        labour_hours: hours,
        labour_cost: round(hours * ctx.settings.labour_rate),
        parts_cost: num(p.parts_cost, { min: 0, max: 1e9, def: 0, name: 'Parts cost' }),
        vendor_cost: num(p.vendor_cost, { min: 0, max: 1e9, def: 0, name: 'Vendor cost' }),
        remarks: str(p.remarks, { max: 1000, name: 'Remarks' }),
        started_at: s.started_at || now,
        updated_at: now,
      };
      update(ctx.db, 'ppm_schedules', s.id, patch);
      const label = s.type === 'PDM' ? 'Predictive inspection' : 'PPM';
      ctx.event(s.asset_id, 'PPM_COMPLETED', `${label} ${s.ppm_no} completed — ${overall}${failed.length ? ` (failed: ${failed.join('; ')})` : ''}`, 'ppm_schedules', s.id, `${completed} ${now.slice(11)}`);
      ctx.audit(`${label} completed`, 'ppm_schedules', s.id, { overall });

      let followup = null;
      if (overall === 'FAIL' && p.create_cm !== false) {
        followup = createWorkOrder(ctx, {
          asset_id: s.asset_id,
          source: s.type === 'PDM' ? 'PREDICTIVE' : 'PPM',
          priority: s.criticality === 'High' ? 'P2' : 'P3',
          problem: `${label} ${s.ppm_no} failed: ${failed.join('; ') || 'see PPM remarks'}`,
          equipment_down: p.equipment_down === undefined ? true : !!p.equipment_down,
          assigned_to: ctx.user.id,
        });
        update(ctx.db, 'ppm_schedules', s.id, { followup_wo_id: followup.id });
      }
      // keep the rolling calendar topped up
      if (s.plan_id) {
        const plan = ctx.db.get('SELECT * FROM ppm_plans WHERE id = ?', [s.plan_id]);
        const [from, to] = horizon(ctx);
        generateForPlan(ctx, plan, from, to);
      }
      return { ok: true, overall, followup_wo: followup };
    },
  },

  'ppm.defer': {
    perm: 'ppm.defer',
    write: true,
    fn(ctx, p) {
      const s = getSchedule(ctx, p.id);
      if (!['SCHEDULED', 'IN_PROGRESS'].includes(s.status)) throw bad('Only open PPMs can be deferred');
      const newDate = dateOrNull(p.new_date, 'New date');
      if (!newDate) throw bad('New date is required');
      if (newDate <= s.scheduled_date) throw bad('The new date must be after the scheduled date');
      if (newDate > addMonths(s.scheduled_date, 6)) throw bad('A PPM can be deferred by at most 6 months');
      const reason = str(p.reason, { required: true, max: 300, name: 'Reason' });
      const rule = ctx.settings.approval_rules.PPM_DEFERRAL || 0;
      if (!rule) {
        const newId = applyDeferral(ctx, s, newDate, reason);
        return { status: 'DEFERRED', new_id: newId };
      }
      const approvalId = createApproval(ctx, {
        type: 'PPM_DEFERRAL',
        refId: s.id,
        title: `Defer ${s.ppm_no} (${s.tag_no}) to ${newDate}`,
        payload: { new_date: newDate, reason },
        requiredLevel: rule,
      });
      ctx.event(s.asset_id, 'PPM_DEFERRAL_REQUESTED', `Deferral of ${s.ppm_no} to ${newDate} requested: ${reason}`, 'approvals', approvalId);
      return { status: 'PENDING', approval_id: approvalId };
    },
  },

  'ppm.cancel': {
    perm: 'ppm.plan',
    write: true,
    fn(ctx, p) {
      const s = getSchedule(ctx, p.id);
      if (!['SCHEDULED', 'IN_PROGRESS'].includes(s.status)) throw bad('Only open PPMs can be cancelled');
      const reason = str(p.reason, { required: true, max: 300, name: 'Reason' });
      update(ctx.db, 'ppm_schedules', s.id, { status: 'CANCELLED', remarks: reason, updated_at: ctx.now() });
      ctx.event(s.asset_id, 'PPM_CANCELLED', `${s.ppm_no} cancelled: ${reason}`, 'ppm_schedules', s.id);
      ctx.audit('PPM cancelled', 'ppm_schedules', s.id, { reason });
      return { ok: true };
    },
  },

  'ppm.masterlist': {
    perm: 'ppm.view',
    fn(ctx, p) {
      const year = int(p.year, { min: 2000, max: 2100, def: Number(ctx.today().slice(0, 4)), name: 'Year' });
      const where = ["s.type = 'PPM'", 's.scheduled_date BETWEEN ? AND ?'];
      const params = [`${year}-01-01`, `${year}-12-31`];
      if (isScopedToDepartment(ctx.user)) {
        where.push('a.department_id = ?');
        params.push(ctx.user.department_id);
      } else if (p.department_id) {
        where.push('a.department_id = ?');
        params.push(id(p.department_id));
      }
      if (p.category_id) {
        where.push('a.category_id = ?');
        params.push(id(p.category_id));
      }
      const sched = ctx.db.all(
        `SELECT s.id, s.asset_id, s.ppm_no, s.type, s.scheduled_date, s.status, s.completed_date, s.overall_result,
                a.tag_no, a.name, d.name AS department_name, c.code AS category_code, p.frequency_months
         FROM ppm_schedules s JOIN assets a ON a.id = s.asset_id
         JOIN departments d ON d.id = a.department_id JOIN categories c ON c.id = a.category_id
         LEFT JOIN ppm_plans p ON p.id = s.plan_id
         WHERE ${where.join(' AND ')} ORDER BY d.name, a.tag_no, s.scheduled_date`,
        params,
      );
      const today = ctx.today();
      const grace = ctx.settings.ppm_grace_days;
      const byAsset = new Map();
      const totals = { scheduled: 0, completed: 0, completed_late: 0, overdue: 0, pending: 0, deferred: 0, cancelled: 0 };
      for (const s of sched) {
        if (!byAsset.has(s.asset_id)) {
          byAsset.set(s.asset_id, {
            asset_id: s.asset_id,
            tag_no: s.tag_no,
            name: s.name,
            department_name: s.department_name,
            category_code: s.category_code,
            frequency_months: s.frequency_months,
            months: Array.from({ length: 12 }, () => []),
          });
        }
        const disp = displayStatus(s, today, grace);
        byAsset.get(s.asset_id).months[Number(s.scheduled_date.slice(5, 7)) - 1].push({
          id: s.id,
          ppm_no: s.ppm_no,
          date: s.scheduled_date,
          completed_date: s.completed_date,
          status: disp,
          result: s.overall_result,
        });
        if (disp === 'CANCELLED') totals.cancelled++;
        else if (disp === 'DEFERRED') totals.deferred++;
        else {
          totals.scheduled++;
          if (disp === 'COMPLETED') totals.completed++;
          else if (disp === 'COMPLETED_LATE') totals.completed_late++;
          else if (disp === 'OVERDUE') totals.overdue++;
          else totals.pending++;
        }
      }
      return { year, rows: [...byAsset.values()], totals };
    },
  },
};
