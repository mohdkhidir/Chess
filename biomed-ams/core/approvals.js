import { insert, update } from './db.js';
import { ApiError, bad, forbidden, id, notFound, oneOf, parseJson, str } from './util.js';
import { APPROVAL_TYPES } from './settings.js';

// Modules register what happens when a request of their type is finally approved or rejected.
const EFFECTS = {};
export function registerApprovalEffect(type, effect) {
  EFFECTS[type] = effect;
}

export function createApproval(ctx, { type, refId, title, amount = null, payload = null, requiredLevel }) {
  if (!APPROVAL_TYPES[type]) throw new Error(`Unknown approval type ${type}`);
  if (requiredLevel < 1 || requiredLevel > 3) throw new Error('Approval level must be 1-3');
  const open = ctx.db.get("SELECT id FROM approvals WHERE type = ? AND ref_id = ? AND status = 'PENDING'", [type, refId]);
  if (open) throw new ApiError(409, 'An approval request is already pending for this item', 'CONFLICT');
  const approvalId = insert(ctx.db, 'approvals', {
    type,
    ref_id: refId,
    title,
    amount,
    payload: payload ? JSON.stringify(payload) : null,
    required_level: requiredLevel,
    current_level: 1,
    status: 'PENDING',
    requested_by: ctx.user?.id ?? null,
    requested_at: ctx.now(),
  });
  ctx.audit('Approval requested', 'approvals', approvalId, { type, title, requiredLevel });
  return approvalId;
}

function canAct(ctx, a) {
  const u = ctx.user;
  if (!u || a.status !== 'PENDING') return false;
  if (u.approval_level < a.current_level) return false;
  if (!ctx.settings.allow_self_approval && a.requested_by === u.id) return false;
  return true;
}

function decorate(ctx, a) {
  return {
    ...a,
    payload: parseJson(a.payload, null),
    type_label: APPROVAL_TYPES[a.type] || a.type,
    can_act: canAct(ctx, a),
    current_level_name: ctx.settings.approval_level_names[a.current_level],
    required_level_name: ctx.settings.approval_level_names[a.required_level],
  };
}

const SELECT = `
  SELECT a.*, u.full_name AS requested_by_name
  FROM approvals a LEFT JOIN users u ON u.id = a.requested_by`;

export function pendingForUserCount(ctx) {
  const u = ctx.user;
  if (!u || !u.approval_level) return 0;
  const self = ctx.settings.allow_self_approval ? '' : 'AND (requested_by IS NULL OR requested_by != ?)';
  const params = ctx.settings.allow_self_approval ? [u.approval_level] : [u.approval_level, u.id];
  return ctx.db.get(`SELECT COUNT(*) AS n FROM approvals WHERE status = 'PENDING' AND current_level <= ? ${self}`, params).n;
}

export const handlers = {
  'approvals.list': {
    fn(ctx, p) {
      const box = oneOf(p.box, ['mine', 'requested', 'all'], { def: 'mine', name: 'Box' });
      const where = [];
      const params = [];
      if (box === 'mine') {
        where.push("a.status = 'PENDING'", 'a.current_level <= ?');
        params.push(ctx.user.approval_level || 0);
        if (!ctx.settings.allow_self_approval) {
          where.push('(a.requested_by IS NULL OR a.requested_by != ?)');
          params.push(ctx.user.id);
        }
        if (!ctx.user.approval_level) return { rows: [] };
      } else if (box === 'requested') {
        where.push('a.requested_by = ?');
        params.push(ctx.user.id);
      } else {
        if (!['ADMIN', 'MANAGER', 'VIEWER'].includes(ctx.user.role) && !ctx.user.approval_level) throw forbidden();
        if (p.status) {
          where.push('a.status = ?');
          params.push(oneOf(p.status, ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'], { name: 'Status' }));
        }
      }
      if (p.type) {
        where.push('a.type = ?');
        params.push(oneOf(p.type, Object.keys(APPROVAL_TYPES), { name: 'Type' }));
      }
      const sql = `${SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY a.status = 'PENDING' DESC, a.requested_at DESC LIMIT 300`;
      return { rows: ctx.db.all(sql, params).map((a) => decorate(ctx, a)) };
    },
  },

  'approvals.get': {
    fn(ctx, p) {
      const a = ctx.db.get(`${SELECT} WHERE a.id = ?`, [id(p.id)]);
      if (!a) throw notFound('Approval request');
      const u = ctx.user;
      if (a.requested_by !== u.id && !u.approval_level && !['ADMIN', 'MANAGER', 'VIEWER', 'ENGINEER'].includes(u.role)) {
        throw forbidden();
      }
      const steps = ctx.db.all(
        `SELECT s.*, u.full_name AS approver_name FROM approval_steps s
         JOIN users u ON u.id = s.approver_id WHERE s.approval_id = ? ORDER BY s.id`,
        [a.id],
      );
      return { ...decorate(ctx, a), steps };
    },
  },

  'approvals.decide': {
    write: true,
    async fn(ctx, p) {
      const a = ctx.db.get('SELECT * FROM approvals WHERE id = ?', [id(p.id)]);
      if (!a) throw notFound('Approval request');
      const decision = oneOf(p.decision, ['APPROVED', 'REJECTED'], { name: 'Decision' });
      const remarks = str(p.remarks, { max: 500, name: 'Remarks' });
      if (a.status !== 'PENDING') throw bad('This request has already been decided');
      if (!ctx.user.approval_level || ctx.user.approval_level < a.current_level) {
        throw forbidden(`Level ${a.current_level} approval authority is required`);
      }
      if (!ctx.settings.allow_self_approval && a.requested_by === ctx.user.id) {
        throw forbidden('You cannot approve your own request');
      }
      if (decision === 'REJECTED' && !remarks) throw bad('Please give a reason for rejecting');

      const now = ctx.now();
      // A higher-level approver covers every level up to their own.
      const level = Math.min(ctx.user.approval_level, a.required_level);
      insert(ctx.db, 'approval_steps', {
        approval_id: a.id,
        level,
        approver_id: ctx.user.id,
        decision,
        remarks,
        decided_at: now,
      });

      const effect = EFFECTS[a.type] || {};
      const payload = parseJson(a.payload, null);
      if (decision === 'REJECTED') {
        update(ctx.db, 'approvals', a.id, { status: 'REJECTED', decided_at: now });
        if (effect.onRejected) await effect.onRejected(ctx, a, payload, remarks);
        ctx.audit('Approval rejected', 'approvals', a.id, { type: a.type, remarks });
        return { status: 'REJECTED' };
      }
      if (level >= a.required_level) {
        update(ctx.db, 'approvals', a.id, { status: 'APPROVED', current_level: a.required_level, decided_at: now });
        if (effect.onApproved) await effect.onApproved(ctx, a, payload, remarks);
        ctx.audit('Approval granted (final)', 'approvals', a.id, { type: a.type, level });
        return { status: 'APPROVED' };
      }
      update(ctx.db, 'approvals', a.id, { current_level: level + 1 });
      ctx.audit(`Approval granted at level ${level}`, 'approvals', a.id, { type: a.type });
      return { status: 'PENDING', current_level: level + 1 };
    },
  },

  'approvals.cancel': {
    write: true,
    async fn(ctx, p) {
      const a = ctx.db.get('SELECT * FROM approvals WHERE id = ?', [id(p.id)]);
      if (!a) throw notFound('Approval request');
      if (a.status !== 'PENDING') throw bad('Only pending requests can be cancelled');
      if (a.requested_by !== ctx.user.id && ctx.user.role !== 'ADMIN') throw forbidden('Only the requester can cancel');
      update(ctx.db, 'approvals', a.id, { status: 'CANCELLED', decided_at: ctx.now() });
      const effect = EFFECTS[a.type] || {};
      if (effect.onCancelled) await effect.onCancelled(ctx, a, parseJson(a.payload, null));
      ctx.audit('Approval cancelled', 'approvals', a.id, { type: a.type });
      return { status: 'CANCELLED' };
    },
  },
};
