import { insert, update } from './db.js';
import {
  bad, conflict, dateOrNull, escapeLike, forbidden, id, int, notFound, num, oneOf, optId, str, bool, round,
} from './util.js';
import { generateTag, assetClass } from './tagging.js';
import { createApproval, registerApprovalEffect } from './approvals.js';
import { ensurePlan, activatePlanSchedules, cancelFutureSchedules } from './ppm.js';
import { isScopedToDepartment } from './permissions.js';
import { assetLifecycle, assetRisk, maintenanceCostByAsset } from './analytics.js';

export const ASSET_STATUS = {
  PENDING: 'Pending approval',
  ACTIVE: 'In service',
  BREAKDOWN: 'Breakdown',
  OUT_OF_SERVICE: 'Out of service',
  STANDBY: 'Standby / spare',
  DISPOSAL_PENDING: 'Pending disposal',
  DISPOSED: 'Disposed / condemned',
  REJECTED: 'Registration rejected',
};

// Statuses for equipment that is still owned and counted in service metrics.
export const IN_FLEET = ['ACTIVE', 'BREAKDOWN', 'OUT_OF_SERVICE', 'STANDBY', 'DISPOSAL_PENDING'];

const RISK = ['A', 'B', 'C', 'D'];
const CRIT = ['High', 'Medium', 'Low'];

export const ASSET_SELECT = `
  SELECT a.*, c.name AS category_name, c.code AS category_code, c.lifespan_years AS category_lifespan,
         d.name AS department_name, d.code AS department_code,
         l.name AS location_name, l.code AS location_code,
         sv.name AS supplier_name, svc.name AS service_vendor_name
  FROM assets a
  JOIN categories c ON c.id = a.category_id
  JOIN departments d ON d.id = a.department_id
  LEFT JOIN locations l ON l.id = a.location_id
  LEFT JOIN vendors sv ON sv.id = a.supplier_id
  LEFT JOIN vendors svc ON svc.id = a.service_vendor_id`;

export function getAsset(db, assetId) {
  return db.get(`${ASSET_SELECT} WHERE a.id = ?`, [assetId]);
}

function mustGet(ctx, assetId) {
  const a = getAsset(ctx.db, id(assetId, 'Asset'));
  if (!a) throw notFound('Asset');
  if (isScopedToDepartment(ctx.user) && a.department_id !== ctx.user.department_id) throw forbidden();
  return a;
}

function readFields(ctx, p, { partial = false } = {}) {
  const f = {};
  const has = (k) => !partial || k in p;
  if (has('name')) f.name = str(p.name, { required: true, max: 160, name: 'Equipment name' });
  if (has('category_id')) f.category_id = id(p.category_id, 'Category');
  if (has('manufacturer')) f.manufacturer = str(p.manufacturer, { max: 120, name: 'Manufacturer' });
  if (has('model')) f.model = str(p.model, { max: 120, name: 'Model' });
  if (has('serial_no')) f.serial_no = str(p.serial_no, { max: 120, name: 'Serial number' });
  if (has('department_id')) f.department_id = id(p.department_id, 'Department');
  if (has('location_id')) f.location_id = optId(p.location_id, 'Location');
  if (has('supplier_id')) f.supplier_id = optId(p.supplier_id, 'Supplier');
  if (has('service_vendor_id')) f.service_vendor_id = optId(p.service_vendor_id, 'Service vendor');
  if (has('purchase_date')) f.purchase_date = dateOrNull(p.purchase_date, 'Purchase date');
  if (has('commissioning_date')) f.commissioning_date = dateOrNull(p.commissioning_date, 'Commissioning date');
  if (has('warranty_end')) f.warranty_end = dateOrNull(p.warranty_end, 'Warranty end');
  if (has('purchase_cost')) f.purchase_cost = num(p.purchase_cost, { min: 0, max: 1e10, name: 'Purchase cost' });
  if (has('po_no')) f.po_no = str(p.po_no, { max: 60, name: 'PO / LO number' });
  if (has('funding')) f.funding = str(p.funding, { max: 60, name: 'Funding' });
  if (has('mda_reg_no')) f.mda_reg_no = str(p.mda_reg_no, { max: 60, name: 'MDA registration no.' });
  if (has('risk_class')) f.risk_class = oneOf(p.risk_class, RISK, { name: 'Risk class', def: 'B' });
  if (has('criticality')) f.criticality = oneOf(p.criticality, CRIT, { name: 'Criticality', def: 'Medium' });
  if (has('lifespan_years')) f.lifespan_years = p.lifespan_years === '' || p.lifespan_years == null ? null : int(p.lifespan_years, { min: 1, max: 50, name: 'Lifespan' });
  if (has('salvage_value')) f.salvage_value = num(p.salvage_value, { min: 0, max: 1e10, name: 'Salvage value' });
  if (has('ppm_required')) f.ppm_required = p.ppm_required === undefined || p.ppm_required === '' ? 1 : bool(p.ppm_required);
  if (has('remarks')) f.remarks = str(p.remarks, { max: 1000, name: 'Remarks' });

  if (f.purchase_date && f.purchase_date > ctx.today()) throw bad('Purchase date cannot be in the future');
  if (f.commissioning_date && f.purchase_date && f.commissioning_date < f.purchase_date) {
    throw bad('Commissioning date cannot be before the purchase date');
  }
  if (f.salvage_value && f.purchase_cost !== undefined && f.salvage_value > f.purchase_cost) {
    throw bad('Salvage value cannot exceed the purchase cost');
  }
  for (const [key, table, label] of [
    ['category_id', 'categories', 'Category'],
    ['department_id', 'departments', 'Department'],
    ['location_id', 'locations', 'Location'],
    ['supplier_id', 'vendors', 'Supplier'],
    ['service_vendor_id', 'vendors', 'Service vendor'],
  ]) {
    if (f[key] && !ctx.db.get(`SELECT id FROM ${table} WHERE id = ?`, [f[key]])) throw bad(`${label} not found`);
  }
  return f;
}

// Spreadsheets exported in Malaysia usually carry DD/MM/YYYY dates.
export function importDate(v) {
  if (v === undefined || v === null) return v;
  const s = String(v).trim();
  if (!s) return null;
  const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return s.slice(0, 10);
}

function checkDuplicateSerial(ctx, f, selfId = null) {
  if (!f.serial_no) return;
  const dup = ctx.db.get(
    `SELECT tag_no FROM assets WHERE serial_no = ? COLLATE NOCASE AND IFNULL(model, '') = IFNULL(?, '') COLLATE NOCASE
     AND status NOT IN ('REJECTED') AND id != ?`,
    [f.serial_no, f.model, selfId || 0],
  );
  if (dup) throw conflict(`Serial number ${f.serial_no} (${f.model || 'no model'}) is already registered as ${dup.tag_no}`);
}

export async function registerAsset(ctx, p, { bypassApproval = false } = {}) {
  const f = readFields(ctx, p);
  if (!p.allow_duplicate_serial) checkDuplicateSerial(ctx, f);
  const cat = ctx.db.get('SELECT * FROM categories WHERE id = ?', [f.category_id]);
  const dept = ctx.db.get('SELECT * FROM departments WHERE id = ?', [f.department_id]);
  if (!cat.active) throw bad('This category is inactive');

  const regDate = ctx.today();
  let tag = str(p.tag_no, { max: 60, name: 'Tag number' });
  if (tag) {
    tag = tag.toUpperCase();
    if (ctx.db.get('SELECT id FROM assets WHERE tag_no = ?', [tag])) throw conflict(`Tag number ${tag} already exists`);
  } else {
    tag = generateTag(ctx.db, ctx.settings, {
      categoryCode: cat.code,
      departmentCode: dept.code,
      date: regDate,
      cost: f.purchase_cost || 0,
    });
  }

  const rule = ctx.settings.approval_rules.ASSET_REGISTRATION || 0;
  const initial = oneOf(p.initial_status, ['ACTIVE', 'STANDBY'], { def: 'ACTIVE', name: 'Initial status' });
  const needsApproval = rule > 0 && !bypassApproval;
  const now = ctx.now();
  const assetId = insert(ctx.db, 'assets', {
    ...f,
    tag_no: tag,
    risk_class: f.risk_class || cat.risk_class,
    criticality: f.criticality || cat.criticality,
    asset_class: assetClass(ctx.settings, f.purchase_cost || 0),
    status: needsApproval ? 'PENDING' : initial,
    created_by: ctx.user?.id ?? null,
    created_at: now,
  });
  ctx.event(assetId, 'REGISTERED', `Registered with tag ${tag}`, null, null, now);
  ctx.audit('Asset registered', 'assets', assetId, { tag_no: tag, name: f.name });

  const freq = p.ppm_frequency_months === undefined || p.ppm_frequency_months === ''
    ? cat.ppm_frequency_months
    : int(p.ppm_frequency_months, { min: 0, max: 60, name: 'PPM frequency' });
  if (f.ppm_required !== 0 && freq > 0) {
    ensurePlan(ctx, { id: assetId, ...f }, { frequency: freq, category: cat });
  }

  if (needsApproval) {
    createApproval(ctx, {
      type: 'ASSET_REGISTRATION',
      refId: assetId,
      title: `Register ${f.name} (${tag})`,
      amount: f.purchase_cost || null,
      payload: { initial_status: initial },
      requiredLevel: rule,
    });
    ctx.event(assetId, 'SUBMITTED', 'Submitted for registration approval');
  } else {
    activatePlanSchedules(ctx, assetId);
  }
  return { id: assetId, tag_no: tag, status: needsApproval ? 'PENDING' : initial };
}

function listWhere(ctx, p) {
  const where = [];
  const params = [];
  if (p.q) {
    const q = `%${escapeLike(String(p.q).trim())}%`;
    where.push(`(a.tag_no LIKE ? ESCAPE '\\' OR a.name LIKE ? ESCAPE '\\' OR a.serial_no LIKE ? ESCAPE '\\'
      OR a.model LIKE ? ESCAPE '\\' OR a.manufacturer LIKE ? ESCAPE '\\')`);
    params.push(q, q, q, q, q);
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
  if (p.location_id) {
    where.push('a.location_id = ?');
    params.push(id(p.location_id));
  }
  if (p.status === 'IN_FLEET') {
    where.push(`a.status IN (${IN_FLEET.map(() => '?').join(',')})`);
    params.push(...IN_FLEET);
  } else if (p.status) {
    where.push('a.status = ?');
    params.push(oneOf(p.status, Object.keys(ASSET_STATUS), { name: 'Status' }));
  }
  if (p.risk_class) {
    where.push('a.risk_class = ?');
    params.push(oneOf(p.risk_class, RISK, { name: 'Risk class' }));
  }
  if (p.criticality) {
    where.push('a.criticality = ?');
    params.push(oneOf(p.criticality, CRIT, { name: 'Criticality' }));
  }
  return { sql: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

const SORTS = {
  tag: 'a.tag_no',
  name: 'a.name, a.tag_no',
  department: 'd.name, a.tag_no',
  newest: 'a.id DESC',
  purchase: 'a.purchase_date',
};

export function listAssets(ctx, p = {}) {
  const { sql, params } = listWhere(ctx, p);
  const total = ctx.db.get(
    `SELECT COUNT(*) AS n FROM assets a JOIN categories c ON c.id = a.category_id
     JOIN departments d ON d.id = a.department_id ${sql}`,
    params,
  ).n;
  const limit = int(p.page_size, { min: 1, max: 5000, def: 50, name: 'Page size' });
  const page = int(p.page, { min: 1, max: 100000, def: 1, name: 'Page' });
  const order = SORTS[p.sort] || SORTS.tag;
  const rows = ctx.db.all(
    `${ASSET_SELECT.replace(
      'SELECT a.*,',
      `SELECT a.*, (SELECT MIN(s.scheduled_date) FROM ppm_schedules s
         WHERE s.asset_id = a.id AND s.status IN ('SCHEDULED','IN_PROGRESS')) AS next_ppm,`,
    )} ${sql} ORDER BY ${order} LIMIT ? OFFSET ?`,
    [...params, limit, (page - 1) * limit],
  );
  return { rows, total, page, page_size: limit };
}

registerApprovalEffect('ASSET_REGISTRATION', {
  onApproved(ctx, a, payload) {
    const asset = getAsset(ctx.db, a.ref_id);
    if (!asset || asset.status !== 'PENDING') return;
    update(ctx.db, 'assets', asset.id, { status: payload?.initial_status || 'ACTIVE', updated_at: ctx.now() });
    ctx.event(asset.id, 'APPROVED', 'Registration approved — asset is now in service', 'approvals', a.id);
    activatePlanSchedules(ctx, asset.id);
  },
  onRejected(ctx, a, _payload, remarks) {
    update(ctx.db, 'assets', a.ref_id, { status: 'REJECTED', updated_at: ctx.now() });
    ctx.event(a.ref_id, 'REJECTED', `Registration rejected: ${remarks}`, 'approvals', a.id);
  },
  onCancelled(ctx, a) {
    update(ctx.db, 'assets', a.ref_id, { status: 'REJECTED', updated_at: ctx.now() });
    ctx.event(a.ref_id, 'REJECTED', 'Registration request withdrawn', 'approvals', a.id);
  },
});

function applyTransfer(ctx, assetId, payload, refId = null) {
  const asset = getAsset(ctx.db, assetId);
  update(ctx.db, 'assets', assetId, {
    department_id: payload.department_id,
    location_id: payload.location_id || null,
    updated_at: ctx.now(),
  });
  const after = getAsset(ctx.db, assetId);
  ctx.event(
    assetId,
    'TRANSFERRED',
    `Moved from ${asset.department_name}${asset.location_name ? ` / ${asset.location_name}` : ''} to ${after.department_name}${after.location_name ? ` / ${after.location_name}` : ''}${payload.reason ? ` — ${payload.reason}` : ''}`,
    refId ? 'approvals' : null,
    refId,
  );
}

registerApprovalEffect('ASSET_TRANSFER', {
  onApproved(ctx, a, payload) {
    applyTransfer(ctx, a.ref_id, payload, a.id);
  },
  onRejected(ctx, a, _p, remarks) {
    ctx.event(a.ref_id, 'TRANSFER_REJECTED', `Transfer request rejected: ${remarks}`, 'approvals', a.id);
  },
});

function applyDisposal(ctx, assetId, payload, refId = null) {
  const now = ctx.now();
  update(ctx.db, 'assets', assetId, { status: 'DISPOSED', disposed_at: now.slice(0, 10), updated_at: now });
  ctx.db.run('UPDATE ppm_plans SET active = 0, updated_at = ? WHERE asset_id = ?', [now, assetId]);
  cancelFutureSchedules(ctx, assetId, 'Asset disposed', { includePast: true });
  ctx.event(
    assetId,
    'DISPOSED',
    `Disposed / condemned (${payload.method || 'method not stated'}): ${payload.reason}`,
    refId ? 'approvals' : null,
    refId,
  );
}

registerApprovalEffect('ASSET_DISPOSAL', {
  onApproved(ctx, a, payload) {
    applyDisposal(ctx, a.ref_id, payload, a.id);
  },
  onRejected(ctx, a, payload, remarks) {
    update(ctx.db, 'assets', a.ref_id, { status: payload?.previous_status || 'OUT_OF_SERVICE', updated_at: ctx.now() });
    ctx.event(a.ref_id, 'DISPOSAL_REJECTED', `Disposal rejected: ${remarks}`, 'approvals', a.id);
  },
  onCancelled(ctx, a, payload) {
    update(ctx.db, 'assets', a.ref_id, { status: payload?.previous_status || 'OUT_OF_SERVICE', updated_at: ctx.now() });
    ctx.event(a.ref_id, 'DISPOSAL_CANCELLED', 'Disposal request withdrawn', 'approvals', a.id);
  },
});

export const handlers = {
  'assets.list': {
    perm: 'asset.view',
    fn: (ctx, p) => listAssets(ctx, p),
  },

  'assets.get': {
    perm: 'asset.view',
    fn(ctx, p) {
      const a = mustGet(ctx, p.id);
      const plan = ctx.db.get(
        `SELECT pp.*, u.full_name AS assigned_name, v.name AS vendor_name FROM ppm_plans pp
         LEFT JOIN users u ON u.id = pp.assigned_to LEFT JOIN vendors v ON v.id = pp.vendor_id
         WHERE pp.asset_id = ?`,
        [a.id],
      );
      const nextPpm = ctx.db.get(
        `SELECT id, ppm_no, scheduled_date, status, type FROM ppm_schedules
         WHERE asset_id = ? AND status IN ('SCHEDULED','IN_PROGRESS') ORDER BY scheduled_date LIMIT 1`,
        [a.id],
      );
      const lastPpm = ctx.db.get(
        `SELECT id, ppm_no, completed_date, overall_result FROM ppm_schedules
         WHERE asset_id = ? AND status = 'COMPLETED' ORDER BY completed_date DESC LIMIT 1`,
        [a.id],
      );
      const openWos = ctx.db.all(
        `SELECT id, wo_no, status, priority, problem, reported_at FROM work_orders
         WHERE asset_id = ? AND status NOT IN ('CLOSED','CANCELLED','COMPLETED') ORDER BY reported_at DESC`,
        [a.id],
      );
      const pendingApprovals = ctx.db.all(
        "SELECT id, type, title, current_level, required_level FROM approvals WHERE ref_id = ? AND status = 'PENDING' AND type LIKE 'ASSET_%'",
        [a.id],
      );
      const costs = maintenanceCostByAsset(ctx.db, { assetId: a.id }).get(a.id) || { cm: 0, ppm: 0, total: 0 };
      return {
        ...a,
        status_label: ASSET_STATUS[a.status],
        plan: plan ? { ...plan, checklist: JSON.parse(plan.checklist || '[]') } : null,
        next_ppm: nextPpm || null,
        last_ppm: lastPpm || null,
        open_work_orders: openWos,
        pending_approvals: pendingApprovals,
        costs: { cm: round(costs.cm), ppm: round(costs.ppm), total: round(costs.total) },
        lifecycle: assetLifecycle(ctx, a, costs.total),
        risk: ['DISPOSED', 'REJECTED', 'PENDING'].includes(a.status) ? null : assetRisk(ctx, a.id),
      };
    },
  },

  'assets.lookup': {
    perm: 'asset.view',
    fn(ctx, p) {
      const tag = str(p.tag, { required: true, max: 200, name: 'Tag' });
      const a = ctx.db.get(
        'SELECT id, tag_no, name, department_id FROM assets WHERE tag_no = ? COLLATE NOCASE OR serial_no = ? COLLATE NOCASE ORDER BY tag_no = ? DESC LIMIT 1',
        [tag, tag, tag],
      );
      if (!a) throw notFound(`Asset "${tag}"`);
      if (isScopedToDepartment(ctx.user) && a.department_id !== ctx.user.department_id) throw forbidden();
      return a;
    },
  },

  'assets.history': {
    perm: 'asset.view',
    fn(ctx, p) {
      const a = mustGet(ctx, p.id);
      const events = ctx.db.all(
        `SELECT e.*, u.full_name AS user_name FROM asset_events e LEFT JOIN users u ON u.id = e.user_id
         WHERE e.asset_id = ? ORDER BY e.created_at DESC, e.id DESC`,
        [a.id],
      );
      const ppm = ctx.db.all(
        `SELECT s.id, s.ppm_no, s.type, s.scheduled_date, s.completed_date, s.status, s.overall_result,
                s.labour_cost + s.parts_cost + s.vendor_cost AS cost, u.full_name AS performed_by_name
         FROM ppm_schedules s LEFT JOIN users u ON u.id = s.performed_by
         WHERE s.asset_id = ? AND (s.status = 'COMPLETED' OR s.scheduled_date <= ?)
         ORDER BY s.scheduled_date DESC`,
        [a.id, ctx.today()],
      );
      const cm = ctx.db.all(
        `SELECT w.id, w.wo_no, w.status, w.priority, w.problem, w.reported_at, w.completed_at, w.failure_cause,
                w.result, w.labour_cost + w.parts_cost + w.vendor_cost AS cost, u.full_name AS assigned_name
         FROM work_orders w LEFT JOIN users u ON u.id = w.assigned_to
         WHERE w.asset_id = ? ORDER BY w.reported_at DESC`,
        [a.id],
      );
      return { asset: a, events, ppm, cm };
    },
  },

  'assets.create': {
    perm: 'asset.create',
    write: true,
    fn: (ctx, p) => registerAsset(ctx, p),
  },

  'assets.update': {
    perm: 'asset.edit',
    write: true,
    fn(ctx, p) {
      const a = mustGet(ctx, p.id);
      if (['DISPOSED'].includes(a.status)) throw bad('Disposed assets cannot be edited');
      const f = readFields(ctx, { ...p }, { partial: true });
      const moving = ('department_id' in f && f.department_id !== a.department_id) || ('location_id' in f && f.location_id !== a.location_id);
      if (moving && a.status !== 'PENDING' && !ctx.can('asset.status')) {
        throw forbidden('Use "Transfer" to move equipment to another department or location');
      }
      if (f.serial_no !== undefined || f.model !== undefined) {
        checkDuplicateSerial(ctx, { serial_no: f.serial_no ?? a.serial_no, model: f.model ?? a.model }, a.id);
      }
      if (p.tag_no !== undefined && p.tag_no !== a.tag_no) {
        if (ctx.user.role !== 'ADMIN') throw forbidden('Only an administrator can change a tag number');
        const tag = str(p.tag_no, { required: true, max: 60, name: 'Tag number' }).toUpperCase();
        if (ctx.db.get('SELECT id FROM assets WHERE tag_no = ? AND id != ?', [tag, a.id])) throw conflict(`Tag number ${tag} already exists`);
        f.tag_no = tag;
      }
      if (f.purchase_cost !== undefined) f.asset_class = assetClass(ctx.settings, f.purchase_cost);
      const changed = Object.keys(f).filter((k) => String(f[k] ?? '') !== String(a[k] ?? ''));
      if (!changed.length) return { id: a.id, changed: [] };
      const patch = Object.fromEntries(changed.map((k) => [k, f[k]]));
      update(ctx.db, 'assets', a.id, { ...patch, updated_at: ctx.now() });
      ctx.event(a.id, 'UPDATED', `Details updated: ${changed.join(', ')}`);
      ctx.audit('Asset updated', 'assets', a.id, patch);
      return { id: a.id, changed };
    },
  },

  'assets.resubmit': {
    perm: 'asset.create',
    write: true,
    fn(ctx, p) {
      const a = mustGet(ctx, p.id);
      if (a.status !== 'REJECTED') throw bad('Only rejected registrations can be resubmitted');
      const rule = ctx.settings.approval_rules.ASSET_REGISTRATION || 0;
      if (!rule) {
        update(ctx.db, 'assets', a.id, { status: 'ACTIVE', updated_at: ctx.now() });
        activatePlanSchedules(ctx, a.id);
        ctx.event(a.id, 'APPROVED', 'Registration resubmitted and activated (no approval required)');
        return { status: 'ACTIVE' };
      }
      update(ctx.db, 'assets', a.id, { status: 'PENDING', updated_at: ctx.now() });
      createApproval(ctx, {
        type: 'ASSET_REGISTRATION',
        refId: a.id,
        title: `Register ${a.name} (${a.tag_no}) — resubmitted`,
        amount: a.purchase_cost || null,
        payload: { initial_status: 'ACTIVE' },
        requiredLevel: rule,
      });
      ctx.event(a.id, 'SUBMITTED', 'Resubmitted for registration approval');
      return { status: 'PENDING' };
    },
  },

  'assets.transfer': {
    perm: 'asset.transfer',
    write: true,
    fn(ctx, p) {
      const a = mustGet(ctx, p.id);
      if (!IN_FLEET.includes(a.status)) throw bad('Only assets in the fleet can be transferred');
      const payload = {
        department_id: id(p.department_id, 'Department'),
        location_id: optId(p.location_id, 'Location'),
        reason: str(p.reason, { required: true, max: 300, name: 'Reason' }),
      };
      if (!ctx.db.get('SELECT id FROM departments WHERE id = ?', [payload.department_id])) throw bad('Department not found');
      if (payload.location_id && !ctx.db.get('SELECT id FROM locations WHERE id = ?', [payload.location_id])) throw bad('Location not found');
      if (payload.department_id === a.department_id && payload.location_id === a.location_id) throw bad('The asset is already at this location');
      const rule = ctx.settings.approval_rules.ASSET_TRANSFER || 0;
      if (!rule) {
        applyTransfer(ctx, a.id, payload);
        return { status: 'DONE' };
      }
      const dept = ctx.db.get('SELECT name FROM departments WHERE id = ?', [payload.department_id]);
      const approvalId = createApproval(ctx, {
        type: 'ASSET_TRANSFER',
        refId: a.id,
        title: `Transfer ${a.tag_no} to ${dept.name}`,
        payload,
        requiredLevel: rule,
      });
      ctx.event(a.id, 'TRANSFER_REQUESTED', `Transfer to ${dept.name} requested: ${payload.reason}`, 'approvals', approvalId);
      return { status: 'PENDING', approval_id: approvalId };
    },
  },

  'assets.setStatus': {
    perm: 'asset.status',
    write: true,
    fn(ctx, p) {
      const a = mustGet(ctx, p.id);
      const status = oneOf(p.status, ['ACTIVE', 'STANDBY', 'OUT_OF_SERVICE'], { name: 'Status' });
      const reason = str(p.reason, { required: true, max: 300, name: 'Reason' });
      if (!['ACTIVE', 'STANDBY', 'OUT_OF_SERVICE', 'BREAKDOWN'].includes(a.status)) {
        throw bad(`Status cannot be changed while the asset is "${ASSET_STATUS[a.status]}"`);
      }
      if (a.status === 'BREAKDOWN') {
        const open = ctx.db.get(
          "SELECT COUNT(*) AS n FROM work_orders WHERE asset_id = ? AND equipment_down = 1 AND status NOT IN ('COMPLETED','CLOSED','CANCELLED')",
          [a.id],
        ).n;
        if (open) throw bad('Close the open breakdown work order(s) first');
      }
      update(ctx.db, 'assets', a.id, { status, updated_at: ctx.now() });
      ctx.event(a.id, 'STATUS_CHANGED', `${ASSET_STATUS[a.status]} → ${ASSET_STATUS[status]}: ${reason}`);
      ctx.audit('Asset status changed', 'assets', a.id, { from: a.status, to: status, reason });
      return { status };
    },
  },

  'assets.dispose': {
    perm: 'asset.dispose',
    write: true,
    fn(ctx, p) {
      const a = mustGet(ctx, p.id);
      if (!['ACTIVE', 'STANDBY', 'OUT_OF_SERVICE', 'BREAKDOWN'].includes(a.status)) {
        throw bad(`An asset that is "${ASSET_STATUS[a.status]}" cannot be put up for disposal`);
      }
      const payload = {
        reason: str(p.reason, { required: true, max: 500, name: 'Reason' }),
        method: str(p.method, { max: 60, name: 'Disposal method' }),
        previous_status: a.status,
      };
      const rule = ctx.settings.approval_rules.ASSET_DISPOSAL || 0;
      if (!rule) {
        applyDisposal(ctx, a.id, payload);
        return { status: 'DISPOSED' };
      }
      update(ctx.db, 'assets', a.id, { status: 'DISPOSAL_PENDING', updated_at: ctx.now() });
      const approvalId = createApproval(ctx, {
        type: 'ASSET_DISPOSAL',
        refId: a.id,
        title: `Dispose ${a.name} (${a.tag_no})`,
        amount: a.purchase_cost || null,
        payload,
        requiredLevel: rule,
      });
      ctx.event(a.id, 'DISPOSAL_REQUESTED', `Disposal requested: ${payload.reason}`, 'approvals', approvalId);
      return { status: 'DISPOSAL_PENDING', approval_id: approvalId };
    },
  },

  'assets.import': {
    perm: 'asset.import',
    write: true,
    async fn(ctx, p) {
      const rows = Array.isArray(p.rows) ? p.rows : [];
      if (!rows.length) throw bad('No rows to import');
      if (rows.length > 5000) throw bad('Import at most 5000 rows at a time');
      const byCode = (table, code) => (code ? ctx.db.get(`SELECT id FROM ${table} WHERE code = ? COLLATE NOCASE`, [String(code).trim()]) : null);
      const vendorByName = (name) => (name ? ctx.db.get('SELECT id FROM vendors WHERE name = ? COLLATE NOCASE', [String(name).trim()]) : null);
      const results = { created: 0, errors: [] };
      for (let i = 0; i < rows.length; i++) {
        const r = { ...rows[i] };
        for (const k of ['purchase_cost', 'salvage_value']) {
          if (r[k] !== undefined && r[k] !== null) r[k] = String(r[k]).replace(/[^0-9.-]/g, '');
        }
        for (const k of ['purchase_date', 'commissioning_date', 'warranty_end']) r[k] = importDate(r[k]);
        ctx.db.exec('SAVEPOINT import_row');
        try {
          const cat = byCode('categories', r.category_code);
          if (!cat) throw bad(`Unknown category code "${r.category_code || ''}"`);
          const dept = byCode('departments', r.department_code);
          if (!dept) throw bad(`Unknown department code "${r.department_code || ''}"`);
          const loc = byCode('locations', r.location_code);
          if (r.location_code && !loc) throw bad(`Unknown location code "${r.location_code}"`);
          const sup = vendorByName(r.supplier);
          await registerAsset(
            ctx,
            {
              ...r,
              category_id: cat.id,
              department_id: dept.id,
              location_id: loc?.id ?? null,
              supplier_id: sup?.id ?? null,
              service_vendor_id: null,
              ppm_required: r.ppm_required === undefined || r.ppm_required === '' ? 1 : r.ppm_required,
            },
            { bypassApproval: true },
          );
          ctx.db.exec('RELEASE import_row');
          results.created++;
        } catch (e) {
          ctx.db.exec('ROLLBACK TO import_row');
          ctx.db.exec('RELEASE import_row');
          results.errors.push({ row: i + 2, message: e.message });
        }
      }
      if (results.errors.length && p.all_or_nothing) {
        throw bad(`Import cancelled: ${results.errors.length} row(s) have errors. First: row ${results.errors[0].row} — ${results.errors[0].message}`);
      }
      ctx.audit('Assets imported', 'assets', null, { created: results.created, errors: results.errors.length });
      return results;
    },
  },
};
