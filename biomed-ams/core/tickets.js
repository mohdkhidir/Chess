import { docNo, insert, update } from './db.js';
import { bad, escapeLike, forbidden, id, int, notFound, oneOf, optId, str } from './util.js';
import { PRIORITIES } from './settings.js';
import { TICKET_CATEGORIES } from './library.js';
import { createWorkOrder, reopen, woMetrics } from './workorders.js';
import { isScopedToDepartment } from './permissions.js';

export const TICKET_STATUS = {
  NEW: 'New',
  ASSIGNED: 'Work order raised',
  RESOLVED: 'Resolved — please confirm',
  CLOSED: 'Closed',
  CANCELLED: 'Cancelled',
};

const SELECT = `
  SELECT t.*, a.tag_no, a.name AS asset_name, d.name AS department_name, r.full_name AS reporter_name,
         w.wo_no, w.status AS wo_status, w.assigned_to AS wo_assigned_to, wu.full_name AS wo_assigned_name
  FROM tickets t
  JOIN departments d ON d.id = t.department_id
  LEFT JOIN assets a ON a.id = t.asset_id
  LEFT JOIN users r ON r.id = t.reporter_id
  LEFT JOIN work_orders w ON w.id = t.work_order_id
  LEFT JOIN users wu ON wu.id = w.assigned_to`;

function canSee(ctx, t) {
  if (!isScopedToDepartment(ctx.user)) return true;
  return t.department_id === ctx.user.department_id || t.reporter_id === ctx.user.id;
}

function getTicket(ctx, ticketId) {
  const t = ctx.db.get(`${SELECT} WHERE t.id = ?`, [id(ticketId, 'Ticket')]);
  if (!t || !canSee(ctx, t)) throw notFound('Ticket');
  return t;
}

const isReporterOrStaff = (ctx, t) => t.reporter_id === ctx.user.id || ctx.can('ticket.manage');

export const handlers = {
  'tickets.list': {
    perm: 'ticket.view',
    fn(ctx, p) {
      const where = [];
      const params = [];
      if (isScopedToDepartment(ctx.user)) {
        where.push('(t.department_id = ? OR t.reporter_id = ?)');
        params.push(ctx.user.department_id, ctx.user.id);
      } else if (p.department_id) {
        where.push('t.department_id = ?');
        params.push(id(p.department_id));
      }
      if (p.mine) {
        where.push('t.reporter_id = ?');
        params.push(ctx.user.id);
      }
      if (p.status === 'OPEN') where.push("t.status IN ('NEW','ASSIGNED','RESOLVED')");
      else if (p.status) {
        where.push('t.status = ?');
        params.push(oneOf(p.status, Object.keys(TICKET_STATUS), { name: 'Status' }));
      }
      if (p.from) {
        where.push('t.created_at >= ?');
        params.push(`${p.from} 00:00:00`);
      }
      if (p.to) {
        where.push('t.created_at <= ?');
        params.push(`${p.to} 23:59:59`);
      }
      if (p.q) {
        const q = `%${escapeLike(String(p.q).trim())}%`;
        where.push("(t.ticket_no LIKE ? ESCAPE '\\' OR t.subject LIKE ? ESCAPE '\\' OR a.tag_no LIKE ? ESCAPE '\\')");
        params.push(q, q, q);
      }
      const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const total = ctx.db.get(`SELECT COUNT(*) AS n FROM tickets t LEFT JOIN assets a ON a.id = t.asset_id ${w}`, params).n;
      const limit = int(p.page_size, { min: 1, max: 5000, def: 50, name: 'Page size' });
      const page = int(p.page, { min: 1, max: 100000, def: 1, name: 'Page' });
      const rows = ctx.db.all(
        `${SELECT} ${w} ORDER BY CASE t.status WHEN 'NEW' THEN 0 WHEN 'RESOLVED' THEN 1 WHEN 'ASSIGNED' THEN 2 ELSE 3 END,
         t.priority, t.created_at DESC LIMIT ? OFFSET ?`,
        [...params, limit, (page - 1) * limit],
      );
      return { rows, total, page, page_size: limit };
    },
  },

  'tickets.get': {
    perm: 'ticket.view',
    fn(ctx, p) {
      const t = getTicket(ctx, p.id);
      let wo = null;
      if (t.work_order_id) {
        const w = ctx.db.get('SELECT * FROM work_orders WHERE id = ?', [t.work_order_id]);
        wo = {
          id: w.id,
          wo_no: w.wo_no,
          status: w.status,
          result: w.result,
          action_taken: w.action_taken,
          response_at: w.response_at,
          completed_at: w.completed_at,
          ...woMetrics(ctx, w),
          logs: ctx.db.all(
            `SELECT g.action, g.note, g.created_at, u.full_name AS user_name FROM wo_logs g
             LEFT JOIN users u ON u.id = g.user_id WHERE g.work_order_id = ? ORDER BY g.created_at, g.id`,
            [w.id],
          ),
        };
      }
      return {
        ...t,
        work_order: wo,
        can_confirm: t.status === 'RESOLVED' && isReporterOrStaff(ctx, t),
        can_manage: ctx.can('ticket.manage'),
      };
    },
  },

  'tickets.create': {
    perm: 'ticket.create',
    write: true,
    fn(ctx, p) {
      const assetId = optId(p.asset_id, 'Asset');
      let deptId = optId(p.department_id, 'Department');
      if (assetId) {
        const a = ctx.db.get('SELECT department_id, status FROM assets WHERE id = ?', [assetId]);
        if (!a) throw bad('Asset not found');
        if (['DISPOSED', 'REJECTED'].includes(a.status)) throw bad('This asset is no longer in service');
        deptId = deptId || a.department_id;
      }
      if (isScopedToDepartment(ctx.user)) deptId = deptId || ctx.user.department_id;
      deptId = deptId || ctx.user.department_id;
      if (!deptId) throw bad('Department is required');
      if (!ctx.db.get('SELECT id FROM departments WHERE id = ?', [deptId])) throw bad('Department not found');
      const now = ctx.now();
      const ticketNo = docNo(ctx.db, 'HD', now);
      const ticketId = insert(ctx.db, 'tickets', {
        ticket_no: ticketNo,
        asset_id: assetId,
        department_id: deptId,
        location_text: str(p.location_text, { max: 160, name: 'Location' }),
        category: oneOf(p.category, Object.keys(TICKET_CATEGORIES), { def: 'BREAKDOWN', name: 'Category' }),
        priority: oneOf(p.priority, PRIORITIES, { def: 'P3', name: 'Priority' }),
        subject: str(p.subject, { required: true, max: 160, name: 'Subject' }),
        description: str(p.description, { max: 2000, name: 'Description' }),
        reporter_id: ctx.user.id,
        contact_name: str(p.contact_name, { max: 120, name: 'Contact name' }) || ctx.user.full_name,
        contact_phone: str(p.contact_phone, { max: 40, name: 'Contact phone' }) || ctx.user.phone,
        status: 'NEW',
        created_at: now,
      });
      if (assetId) ctx.event(assetId, 'TICKET', `Helpdesk ticket ${ticketNo}: ${p.subject}`, 'tickets', ticketId);
      ctx.audit('Ticket created', 'tickets', ticketId, { ticket_no: ticketNo });
      return { id: ticketId, ticket_no: ticketNo };
    },
  },

  'tickets.convert': {
    perm: 'ticket.manage',
    write: true,
    fn(ctx, p) {
      const t = getTicket(ctx, p.id);
      if (t.status !== 'NEW') throw bad('Only new tickets can be converted to a work order');
      const assetId = optId(p.asset_id, 'Asset') || t.asset_id;
      if (!assetId) throw bad('Select the equipment for this work order');
      if (p.assigned_to && !ctx.can('wo.assign') && Number(p.assigned_to) !== ctx.user.id) {
        throw forbidden('Only supervisors can assign work orders to others');
      }
      const wo = createWorkOrder(ctx, {
        asset_id: assetId,
        ticket_id: t.id,
        source: 'HELPDESK',
        priority: p.priority || t.priority,
        problem: `${t.subject}${t.description ? ` — ${t.description}` : ''}`.slice(0, 1000),
        equipment_down: p.equipment_down === undefined ? ['BREAKDOWN', 'MALFUNCTION', 'DAMAGE'].includes(t.category) : !!p.equipment_down,
        reported_at: t.created_at,
        assigned_to: p.assigned_to,
      });
      const now = ctx.now();
      update(ctx.db, 'tickets', t.id, {
        status: 'ASSIGNED',
        asset_id: assetId,
        work_order_id: wo.id,
        acknowledged_at: now,
        updated_at: now,
      });
      ctx.audit('Ticket converted to work order', 'tickets', t.id, { wo_no: wo.wo_no });
      return { work_order: wo };
    },
  },

  'tickets.cancel': {
    perm: 'ticket.view',
    write: true,
    fn(ctx, p) {
      const t = getTicket(ctx, p.id);
      if (t.status !== 'NEW') throw bad('Only new tickets can be cancelled here; cancel the work order instead');
      if (!isReporterOrStaff(ctx, t)) throw forbidden();
      const reason = str(p.reason, { required: true, max: 300, name: 'Reason' });
      update(ctx.db, 'tickets', t.id, { status: 'CANCELLED', feedback: reason, closed_at: ctx.now(), updated_at: ctx.now() });
      ctx.audit('Ticket cancelled', 'tickets', t.id, { reason });
      return { ok: true };
    },
  },

  'tickets.confirm': {
    perm: 'ticket.view',
    write: true,
    fn(ctx, p) {
      const t = getTicket(ctx, p.id);
      if (t.status !== 'RESOLVED') throw bad('Only resolved tickets can be confirmed');
      if (!isReporterOrStaff(ctx, t)) throw forbidden();
      const rating = p.rating === undefined || p.rating === null || p.rating === '' ? null : int(p.rating, { min: 1, max: 5, name: 'Rating' });
      update(ctx.db, 'tickets', t.id, {
        status: 'CLOSED',
        rating,
        feedback: str(p.feedback, { max: 500, name: 'Feedback' }),
        closed_at: ctx.now(),
        updated_at: ctx.now(),
      });
      ctx.audit('Ticket confirmed and closed', 'tickets', t.id, { rating });
      return { ok: true };
    },
  },

  'tickets.notFixed': {
    perm: 'ticket.view',
    write: true,
    fn(ctx, p) {
      const t = getTicket(ctx, p.id);
      if (t.status !== 'RESOLVED') throw bad('Only resolved tickets can be reported as not fixed');
      if (!isReporterOrStaff(ctx, t)) throw forbidden();
      const reason = str(p.reason, { required: true, max: 500, name: 'What is still wrong' });
      const w = ctx.db.get('SELECT * FROM work_orders WHERE id = ?', [t.work_order_id]);
      if (!w) throw bad('No work order is linked to this ticket');
      reopen(ctx, w, `Requester reports problem persists: ${reason}`);
      return { ok: true };
    },
  },
};
