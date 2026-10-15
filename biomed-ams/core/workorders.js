import { docNo, insert, update } from './db.js';
import {
  bad, dateTimeOrNull, diffHours, escapeLike, forbidden, id, int, notFound, num, oneOf, optId, round, str,
} from './util.js';
import { createApproval, registerApprovalEffect } from './approvals.js';
import { PRIORITIES, costApprovalLevel } from './settings.js';
import { FAILURE_CAUSES } from './library.js';

export const WO_STATUS = {
  OPEN: 'Open',
  ASSIGNED: 'Assigned',
  IN_PROGRESS: 'In progress',
  ON_HOLD: 'On hold',
  COMPLETED: 'Completed — awaiting verification',
  CLOSED: 'Closed',
  CANCELLED: 'Cancelled',
};

export const WO_RESULTS = {
  REPAIRED: 'Repaired / restored to service',
  PARTIAL: 'Partially restored (restricted use)',
  NO_FAULT_FOUND: 'No fault found',
  REFERRED: 'Referred to vendor / manufacturer',
  BER: 'Beyond economical repair (BER)',
};

export const OPEN_WO = ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'ON_HOLD'];

// Times typed on a phone have minute precision and the phone clock may be slightly off:
// allow up to 5 minutes of clock skew and the same minute as the report time.
function userTime(ctx, value, name, notBefore = null) {
  const now = ctx.now();
  let t = dateTimeOrNull(value, name) || now;
  if (t > now) {
    if (diffHours(now, t) > 5 / 60) throw bad(`${name} cannot be in the future`);
    t = now;
  }
  if (notBefore && t < notBefore) {
    if (diffHours(t, notBefore) >= 1 / 60) throw bad(`${name} cannot be before the report time`);
    t = notBefore;
  }
  return t;
}

function log(ctx, woId, action, note = null) {
  insert(ctx.db, 'wo_logs', { work_order_id: woId, user_id: ctx.user?.id ?? null, action, note, created_at: ctx.now() });
}

function syncTicket(ctx, wo, patch, note) {
  if (!wo.ticket_id) return;
  update(ctx.db, 'tickets', wo.ticket_id, { ...patch, updated_at: ctx.now() });
  if (note) ctx.audit(note, 'tickets', wo.ticket_id);
}

function restoreAssetIfClear(ctx, assetId, result) {
  const asset = ctx.db.get('SELECT status FROM assets WHERE id = ?', [assetId]);
  if (!asset || asset.status !== 'BREAKDOWN') return;
  const stillDown = ctx.db.get(
    `SELECT COUNT(*) AS n FROM work_orders WHERE asset_id = ? AND equipment_down = 1
     AND status IN ('OPEN','ASSIGNED','IN_PROGRESS','ON_HOLD')`,
    [assetId],
  ).n;
  if (stillDown) return;
  const next = result === 'BER' ? 'OUT_OF_SERVICE' : 'ACTIVE';
  update(ctx.db, 'assets', assetId, { status: next, updated_at: ctx.now() });
  ctx.event(assetId, 'STATUS_CHANGED', next === 'ACTIVE' ? 'Back in service' : 'Out of service — beyond economical repair');
}

export function createWorkOrder(ctx, p) {
  const assetId = id(p.asset_id, 'Asset');
  const asset = ctx.db.get('SELECT id, tag_no, name, status FROM assets WHERE id = ?', [assetId]);
  if (!asset) throw notFound('Asset');
  if (['DISPOSED', 'REJECTED', 'PENDING'].includes(asset.status)) throw bad('This asset is not in service');
  const now = ctx.now();
  const reported = userTime(ctx, p.reported_at, 'Reported time');
  const priority = oneOf(p.priority, PRIORITIES, { def: 'P3', name: 'Priority' });
  const problem = str(p.problem, { required: true, max: 1000, name: 'Problem description' });
  const down = p.equipment_down ? 1 : 0;
  const assigned = optId(p.assigned_to, 'Technician');
  if (assigned && !ctx.db.get("SELECT id FROM users WHERE id = ? AND status = 'ACTIVE'", [assigned])) throw bad('Technician not found');
  const source = oneOf(p.source, ['DIRECT', 'HELPDESK', 'PPM', 'PREDICTIVE'], { def: 'DIRECT', name: 'Source' });
  const woNo = docNo(ctx.db, 'CM', reported);
  const woId = insert(ctx.db, 'work_orders', {
    wo_no: woNo,
    asset_id: assetId,
    ticket_id: p.ticket_id || null,
    source,
    priority,
    problem,
    equipment_down: down,
    reported_at: reported,
    assigned_to: assigned,
    assigned_at: assigned ? now : null,
    status: assigned ? 'ASSIGNED' : 'OPEN',
    downtime_start: down ? reported : null,
    created_by: ctx.user?.id ?? null,
    created_at: now,
  });
  log(ctx, woId, 'CREATED', source === 'DIRECT' ? null : `Raised from ${source.toLowerCase()}`);
  if (assigned) {
    const u = ctx.db.get('SELECT full_name FROM users WHERE id = ?', [assigned]);
    log(ctx, woId, 'ASSIGNED', `Assigned to ${u.full_name}`);
  }
  if (down && ['ACTIVE', 'STANDBY'].includes(asset.status)) {
    update(ctx.db, 'assets', assetId, { status: 'BREAKDOWN', updated_at: now });
  }
  ctx.event(assetId, 'CM_OPENED', `${woNo} opened (${priority}): ${problem}`, 'work_orders', woId, reported);
  ctx.audit('Work order created', 'work_orders', woId, { wo_no: woNo, asset: asset.tag_no });
  return { id: woId, wo_no: woNo };
}

const WO_SELECT = `
  SELECT w.*, a.tag_no, a.name AS asset_name, a.model, a.manufacturer, a.serial_no, a.department_id,
         a.status AS asset_status, a.criticality, a.purchase_cost,
         d.name AS department_name, l.name AS location_name, c.name AS category_name,
         u.full_name AS assigned_name, cb.full_name AS closed_by_name, cr.full_name AS created_by_name,
         t.ticket_no
  FROM work_orders w
  JOIN assets a ON a.id = w.asset_id
  JOIN departments d ON d.id = a.department_id
  JOIN categories c ON c.id = a.category_id
  LEFT JOIN locations l ON l.id = a.location_id
  LEFT JOIN users u ON u.id = w.assigned_to
  LEFT JOIN users cb ON cb.id = w.closed_by
  LEFT JOIN users cr ON cr.id = w.created_by
  LEFT JOIN tickets t ON t.id = w.ticket_id`;

export function woMetrics(ctx, w) {
  const now = ctx.now();
  const s = ctx.settings;
  const responseHours = w.response_at ? diffHours(w.reported_at, w.response_at) : null;
  const end = w.completed_at || (OPEN_WO.includes(w.status) ? now : null);
  const turnaroundHours = end ? diffHours(w.reported_at, end) : null;
  const downtimeHours = w.equipment_down && w.downtime_start && w.status !== 'CANCELLED'
    ? diffHours(w.downtime_start, w.downtime_end || now)
    : 0;
  const responseTarget = s.response_target_hours[w.priority];
  const repairTargetDays = s.repair_target_days[w.priority];
  return {
    response_hours: responseHours === null ? null : round(responseHours, 1),
    turnaround_hours: turnaroundHours === null ? null : round(turnaroundHours, 1),
    downtime_hours: round(Math.max(0, downtimeHours), 1),
    response_target_hours: responseTarget,
    repair_target_days: repairTargetDays,
    response_met: responseHours === null ? null : responseHours <= responseTarget,
    repair_met: w.completed_at ? diffHours(w.reported_at, w.completed_at) <= repairTargetDays * 24 : null,
    total_cost: round((w.labour_cost || 0) + (w.parts_cost || 0) + (w.vendor_cost || 0)),
  };
}

function getWo(ctx, woId) {
  const w = ctx.db.get(`${WO_SELECT} WHERE w.id = ?`, [id(woId, 'Work order')]);
  if (!w) throw notFound('Work order');
  return w;
}

function readParts(parts) {
  if (!Array.isArray(parts)) return null;
  return parts.slice(0, 100).map((x) => ({
    part_no: str(x.part_no, { max: 60, name: 'Part number' }),
    description: str(x.description, { required: true, max: 200, name: 'Part description' }),
    qty: num(x.qty, { min: 0.01, max: 100000, def: 1, name: 'Quantity' }),
    unit_cost: num(x.unit_cost, { min: 0, max: 1e9, def: 0, name: 'Unit cost' }),
  }));
}

function saveWorkDetails(ctx, w, p) {
  const patch = {};
  if ('failure_cause' in p) patch.failure_cause = p.failure_cause ? oneOf(p.failure_cause, FAILURE_CAUSES, { name: 'Failure cause' }) : null;
  if ('action_taken' in p) patch.action_taken = str(p.action_taken, { max: 2000, name: 'Action taken' });
  if ('labour_hours' in p) {
    patch.labour_hours = num(p.labour_hours, { min: 0, max: 2000, def: 0, name: 'Labour hours' });
    patch.labour_cost = round(patch.labour_hours * ctx.settings.labour_rate);
  }
  if ('vendor_cost' in p) patch.vendor_cost = num(p.vendor_cost, { min: 0, max: 1e9, def: 0, name: 'Vendor cost' });
  const parts = readParts(p.parts);
  if (parts) {
    ctx.db.run('DELETE FROM wo_parts WHERE work_order_id = ?', [w.id]);
    let total = 0;
    for (const part of parts) {
      insert(ctx.db, 'wo_parts', { work_order_id: w.id, ...part });
      total += part.qty * part.unit_cost;
    }
    patch.parts_cost = round(total);
  }
  if (Object.keys(patch).length) update(ctx.db, 'work_orders', w.id, { ...patch, updated_at: ctx.now() });
  return patch;
}

function requireOpen(w) {
  if (!OPEN_WO.includes(w.status)) throw bad(`This work order is ${WO_STATUS[w.status].toLowerCase()}`);
}

function requireExecutor(ctx, w) {
  if (w.assigned_to && w.assigned_to !== ctx.user.id && !ctx.can('wo.assign')) {
    throw forbidden('This work order is assigned to someone else');
  }
}

registerApprovalEffect('WO_COST', {
  onApproved(ctx, a) {
    const w = ctx.db.get('SELECT * FROM work_orders WHERE id = ?', [a.ref_id]);
    if (!w) return;
    const patch = { cost_approval_status: 'APPROVED', updated_at: ctx.now() };
    if (w.status === 'ON_HOLD') Object.assign(patch, { status: 'IN_PROGRESS', hold_reason: null });
    update(ctx.db, 'work_orders', w.id, patch);
    log(ctx, w.id, 'COST_APPROVED', `Repair cost RM ${a.amount} approved`);
  },
  onRejected(ctx, a, _p, remarks) {
    update(ctx.db, 'work_orders', a.ref_id, { cost_approval_status: 'REJECTED', updated_at: ctx.now() });
    log(ctx, a.ref_id, 'COST_REJECTED', remarks);
  },
  onCancelled(ctx, a) {
    update(ctx.db, 'work_orders', a.ref_id, { cost_approval_status: null, updated_at: ctx.now() });
    log(ctx, a.ref_id, 'COST_REQUEST_WITHDRAWN');
  },
});

export const handlers = {
  'wo.list': {
    perm: 'wo.view',
    fn(ctx, p) {
      const where = [];
      const params = [];
      if (p.status === 'ACTIVE') where.push(`w.status IN ('OPEN','ASSIGNED','IN_PROGRESS','ON_HOLD')`);
      else if (p.status === 'DONE') where.push(`w.status IN ('COMPLETED','CLOSED')`);
      else if (p.status) {
        where.push('w.status = ?');
        params.push(oneOf(p.status, Object.keys(WO_STATUS), { name: 'Status' }));
      }
      if (p.priority) {
        where.push('w.priority = ?');
        params.push(oneOf(p.priority, PRIORITIES, { name: 'Priority' }));
      }
      if (p.department_id) {
        where.push('a.department_id = ?');
        params.push(id(p.department_id));
      }
      if (p.asset_id) {
        where.push('w.asset_id = ?');
        params.push(id(p.asset_id));
      }
      if (p.assigned_to === 'me') {
        where.push('w.assigned_to = ?');
        params.push(ctx.user.id);
      } else if (p.assigned_to === 'none') {
        where.push('w.assigned_to IS NULL');
      } else if (p.assigned_to) {
        where.push('w.assigned_to = ?');
        params.push(id(p.assigned_to));
      }
      if (p.from) {
        where.push('w.reported_at >= ?');
        params.push(`${p.from} 00:00:00`);
      }
      if (p.to) {
        where.push('w.reported_at <= ?');
        params.push(`${p.to} 23:59:59`);
      }
      if (p.q) {
        const q = `%${escapeLike(String(p.q).trim())}%`;
        where.push("(w.wo_no LIKE ? ESCAPE '\\' OR a.tag_no LIKE ? ESCAPE '\\' OR a.name LIKE ? ESCAPE '\\' OR w.problem LIKE ? ESCAPE '\\')");
        params.push(q, q, q, q);
      }
      const sqlWhere = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const total = ctx.db.get(`SELECT COUNT(*) AS n FROM work_orders w JOIN assets a ON a.id = w.asset_id ${sqlWhere}`, params).n;
      const limit = int(p.page_size, { min: 1, max: 5000, def: 50, name: 'Page size' });
      const page = int(p.page, { min: 1, max: 100000, def: 1, name: 'Page' });
      const rows = ctx.db.all(
        `${WO_SELECT} ${sqlWhere}
         ORDER BY CASE WHEN w.status IN ('OPEN','ASSIGNED','IN_PROGRESS','ON_HOLD') THEN 0 ELSE 1 END, w.priority, w.reported_at DESC
         LIMIT ? OFFSET ?`,
        [...params, limit, (page - 1) * limit],
      ).map((w) => ({ ...w, ...woMetrics(ctx, w) }));
      return { rows, total, page, page_size: limit };
    },
  },

  'wo.get': {
    perm: 'wo.view',
    fn(ctx, p) {
      const w = getWo(ctx, p.id);
      return {
        ...w,
        ...woMetrics(ctx, w),
        parts: ctx.db.all('SELECT * FROM wo_parts WHERE work_order_id = ? ORDER BY id', [w.id]),
        logs: ctx.db.all(
          `SELECT g.*, u.full_name AS user_name FROM wo_logs g LEFT JOIN users u ON u.id = g.user_id
           WHERE g.work_order_id = ? ORDER BY g.created_at, g.id`,
          [w.id],
        ),
        approvals: ctx.db.all(
          "SELECT id, status, title, amount, current_level, required_level, requested_at FROM approvals WHERE type = 'WO_COST' AND ref_id = ? ORDER BY id DESC",
          [w.id],
        ),
      };
    },
  },

  'wo.create': {
    perm: 'wo.create',
    write: true,
    fn(ctx, p) {
      if (p.assigned_to && !ctx.can('wo.assign') && Number(p.assigned_to) !== ctx.user.id) {
        throw forbidden('Only supervisors can assign work orders to others');
      }
      return createWorkOrder(ctx, { ...p, ticket_id: null });
    },
  },

  'wo.assign': {
    perm: 'wo.assign',
    write: true,
    fn(ctx, p) {
      const w = getWo(ctx, p.id);
      requireOpen(w);
      const userId = id(p.assigned_to, 'Technician');
      const u = ctx.db.get("SELECT id, full_name FROM users WHERE id = ? AND status = 'ACTIVE'", [userId]);
      if (!u) throw bad('Technician not found');
      const now = ctx.now();
      update(ctx.db, 'work_orders', w.id, {
        assigned_to: u.id,
        assigned_at: now,
        status: w.status === 'OPEN' ? 'ASSIGNED' : w.status,
        updated_at: now,
      });
      log(ctx, w.id, 'ASSIGNED', `Assigned to ${u.full_name}`);
      return { ok: true };
    },
  },

  'wo.accept': {
    perm: 'wo.execute',
    write: true,
    fn(ctx, p) {
      const w = getWo(ctx, p.id);
      requireOpen(w);
      if (w.assigned_to && w.assigned_to !== ctx.user.id) throw bad('This work order is already assigned');
      const now = ctx.now();
      update(ctx.db, 'work_orders', w.id, { assigned_to: ctx.user.id, assigned_at: now, status: w.status === 'OPEN' ? 'ASSIGNED' : w.status, updated_at: now });
      log(ctx, w.id, 'ASSIGNED', `Accepted by ${ctx.user.full_name}`);
      return { ok: true };
    },
  },

  'wo.start': {
    perm: 'wo.execute',
    write: true,
    fn(ctx, p) {
      const w = getWo(ctx, p.id);
      if (!['OPEN', 'ASSIGNED'].includes(w.status)) throw bad('Only open or assigned work orders can be started');
      requireExecutor(ctx, w);
      const now = ctx.now();
      const responded = userTime(ctx, p.response_at, 'Attendance time', w.reported_at);
      update(ctx.db, 'work_orders', w.id, {
        status: 'IN_PROGRESS',
        response_at: w.response_at || responded,
        assigned_to: w.assigned_to || ctx.user.id,
        assigned_at: w.assigned_at || now,
        updated_at: now,
      });
      log(ctx, w.id, 'STARTED', 'Technician attended and started work');
      return { ok: true };
    },
  },

  'wo.hold': {
    perm: 'wo.execute',
    write: true,
    fn(ctx, p) {
      const w = getWo(ctx, p.id);
      if (w.status !== 'IN_PROGRESS') throw bad('Only work in progress can be put on hold');
      requireExecutor(ctx, w);
      const reason = str(p.reason, { required: true, max: 300, name: 'Reason' });
      update(ctx.db, 'work_orders', w.id, { status: 'ON_HOLD', hold_reason: reason, updated_at: ctx.now() });
      log(ctx, w.id, 'ON_HOLD', reason);
      return { ok: true };
    },
  },

  'wo.resume': {
    perm: 'wo.execute',
    write: true,
    fn(ctx, p) {
      const w = getWo(ctx, p.id);
      if (w.status !== 'ON_HOLD') throw bad('This work order is not on hold');
      if (w.cost_approval_status === 'PENDING') throw bad('Waiting for repair cost approval');
      requireExecutor(ctx, w);
      update(ctx.db, 'work_orders', w.id, { status: 'IN_PROGRESS', hold_reason: null, updated_at: ctx.now() });
      log(ctx, w.id, 'RESUMED');
      return { ok: true };
    },
  },

  'wo.update': {
    perm: 'wo.execute',
    write: true,
    fn(ctx, p) {
      const w = getWo(ctx, p.id);
      if (['CLOSED', 'CANCELLED'].includes(w.status)) throw bad('This work order can no longer be edited');
      requireExecutor(ctx, w);
      const patch = saveWorkDetails(ctx, w, p);
      if (Object.keys(patch).length) log(ctx, w.id, 'UPDATED', 'Work details saved');
      return { ok: true };
    },
  },

  'wo.note': {
    perm: 'wo.view',
    write: true,
    fn(ctx, p) {
      const w = getWo(ctx, p.id);
      const note = str(p.note, { required: true, max: 1000, name: 'Note' });
      log(ctx, w.id, 'NOTE', note);
      return { ok: true };
    },
  },

  'wo.requestCost': {
    perm: 'wo.execute',
    write: true,
    fn(ctx, p) {
      const w = getWo(ctx, p.id);
      if (!['IN_PROGRESS', 'ON_HOLD', 'ASSIGNED'].includes(w.status)) throw bad('Cost approval can only be requested for open work');
      if (w.cost_approval_status === 'PENDING') throw bad('A cost approval is already pending');
      const amount = num(p.estimated_cost, { min: 1, max: 1e9, required: true, name: 'Estimated cost' });
      const justification = str(p.justification, { required: true, max: 500, name: 'Justification' });
      const level = costApprovalLevel(ctx.settings, amount);
      const approvalId = createApproval(ctx, {
        type: 'WO_COST',
        refId: w.id,
        title: `${w.wo_no}: repair ${w.tag_no} — RM ${amount.toLocaleString('en-MY')}`,
        amount,
        payload: { justification },
        requiredLevel: level,
      });
      update(ctx.db, 'work_orders', w.id, {
        estimated_cost: amount,
        cost_approval_status: 'PENDING',
        status: 'ON_HOLD',
        hold_reason: 'Awaiting repair cost approval',
        updated_at: ctx.now(),
      });
      log(ctx, w.id, 'COST_REQUESTED', `RM ${amount} (needs level ${level}): ${justification}`);
      return { approval_id: approvalId, level };
    },
  },

  'wo.complete': {
    perm: 'wo.execute',
    write: true,
    fn(ctx, p) {
      const w = getWo(ctx, p.id);
      if (!['IN_PROGRESS', 'ASSIGNED', 'OPEN', 'ON_HOLD'].includes(w.status)) throw bad('This work order is not open');
      if (w.cost_approval_status === 'PENDING') throw bad('Waiting for repair cost approval');
      requireExecutor(ctx, w);
      const now = ctx.now();
      const completed = userTime(ctx, p.completed_at, 'Completion time', w.response_at && w.response_at > w.reported_at ? w.response_at : w.reported_at);
      const result = oneOf(p.result, Object.keys(WO_RESULTS), { name: 'Result' });
      if (!p.action_taken && !w.action_taken) throw bad('Describe the action taken');
      if (!p.failure_cause && !w.failure_cause) throw bad('Select the failure cause');
      saveWorkDetails(ctx, w, p);
      update(ctx.db, 'work_orders', w.id, {
        status: 'COMPLETED',
        result,
        completed_at: completed,
        response_at: w.response_at || completed,
        assigned_to: w.assigned_to || ctx.user.id,
        downtime_end: w.equipment_down ? completed : null,
        hold_reason: null,
        updated_at: now,
      });
      log(ctx, w.id, 'COMPLETED', WO_RESULTS[result]);
      restoreAssetIfClear(ctx, w.asset_id, result);
      ctx.event(w.asset_id, 'CM_COMPLETED', `${w.wo_no} completed — ${WO_RESULTS[result]}`, 'work_orders', w.id, completed);
      syncTicket(ctx, w, { status: 'RESOLVED', resolved_at: completed }, 'Ticket resolved by work order');
      ctx.audit('Work order completed', 'work_orders', w.id, { result });
      return { ok: true, suggest_disposal: result === 'BER' };
    },
  },

  'wo.close': {
    perm: 'wo.close',
    write: true,
    fn(ctx, p) {
      const w = getWo(ctx, p.id);
      if (w.status !== 'COMPLETED') throw bad('Only completed work orders can be verified and closed');
      const now = ctx.now();
      update(ctx.db, 'work_orders', w.id, { status: 'CLOSED', closed_at: now, closed_by: ctx.user.id, updated_at: now });
      log(ctx, w.id, 'CLOSED', str(p.remarks, { max: 500, name: 'Remarks' }) || 'Verified and closed');
      ctx.event(w.asset_id, 'CM_CLOSED', `${w.wo_no} verified and closed`, 'work_orders', w.id);
      ctx.audit('Work order closed', 'work_orders', w.id);
      return { ok: true };
    },
  },

  'wo.reopen': {
    perm: 'wo.close',
    write: true,
    fn(ctx, p) {
      const w = getWo(ctx, p.id);
      if (!['COMPLETED', 'CLOSED'].includes(w.status)) throw bad('Only completed or closed work orders can be reopened');
      const reason = str(p.reason, { required: true, max: 500, name: 'Reason' });
      reopen(ctx, w, reason);
      return { ok: true };
    },
  },

  'wo.cancel': {
    perm: 'wo.assign',
    write: true,
    fn(ctx, p) {
      const w = getWo(ctx, p.id);
      requireOpen(w);
      const reason = str(p.reason, { required: true, max: 500, name: 'Reason' });
      update(ctx.db, 'work_orders', w.id, { status: 'CANCELLED', downtime_end: w.downtime_start, updated_at: ctx.now() });
      ctx.db.run(
        "UPDATE approvals SET status = 'CANCELLED', decided_at = ? WHERE type = 'WO_COST' AND ref_id = ? AND status = 'PENDING'",
        [ctx.now(), w.id],
      );
      log(ctx, w.id, 'CANCELLED', reason);
      restoreAssetIfClear(ctx, w.asset_id, null);
      ctx.event(w.asset_id, 'CM_CANCELLED', `${w.wo_no} cancelled: ${reason}`, 'work_orders', w.id);
      syncTicket(ctx, w, { status: 'CANCELLED', closed_at: ctx.now() }, 'Ticket cancelled with work order');
      return { ok: true };
    },
  },
};

export function reopen(ctx, w, reason) {
  const now = ctx.now();
  update(ctx.db, 'work_orders', w.id, {
    status: 'IN_PROGRESS',
    completed_at: null,
    closed_at: null,
    closed_by: null,
    result: null,
    downtime_end: null,
    updated_at: now,
  });
  log(ctx, w.id, 'REOPENED', reason);
  if (w.equipment_down) {
    const a = ctx.db.get('SELECT status FROM assets WHERE id = ?', [w.asset_id]);
    if (['ACTIVE', 'STANDBY', 'OUT_OF_SERVICE'].includes(a.status)) {
      update(ctx.db, 'assets', w.asset_id, { status: 'BREAKDOWN', updated_at: now });
    }
  }
  ctx.event(w.asset_id, 'CM_REOPENED', `${w.wo_no} reopened: ${reason}`, 'work_orders', w.id);
  syncTicket(ctx, w, { status: 'ASSIGNED', resolved_at: null, closed_at: null }, 'Ticket reopened');
}
