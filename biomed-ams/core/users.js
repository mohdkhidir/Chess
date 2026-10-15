import { insert, update } from './db.js';
import { ApiError, addHours, bad, conflict, forbidden, id, int, notFound, oneOf, optId, str } from './util.js';
import { hashPassword, verifyPassword, randomToken, sha256Hex, checkPasswordStrength } from './auth.js';
import { ROLES, permissionsFor } from './permissions.js';
import { publicUser } from './context.js';
import { rollingGenerate } from './ppm.js';

const MAX_FAILED = 5;
const LOCK_MINUTES = 15;

function username(v) {
  const u = str(v, { required: true, max: 40, name: 'Username' });
  if (!/^[a-zA-Z0-9._-]{3,40}$/.test(u)) throw bad('Username must be 3-40 letters, digits, dot, dash or underscore');
  return u.toLowerCase();
}

function email(v) {
  const e = str(v, { max: 120, name: 'Email' });
  if (e && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) throw bad('Email address is not valid');
  return e;
}

function password(v) {
  const problem = checkPasswordStrength(v);
  if (problem) throw bad(problem);
  return v;
}

export function sessionUser(ctx) {
  const u = publicUser(ctx.user);
  const dept = u.department_id ? ctx.db.get('SELECT name FROM departments WHERE id = ?', [u.department_id]) : null;
  return {
    ...u,
    department_name: dept?.name ?? null,
    role_label: ROLES[u.role],
    approval_level_name: u.approval_level ? ctx.settings.approval_level_names[u.approval_level] : null,
    permissions: permissionsFor(u),
  };
}

export async function createSession(ctx, userId) {
  const token = randomToken();
  const now = ctx.now();
  ctx.db.run('DELETE FROM sessions WHERE expires_at < ?', [now]);
  insert(ctx.db, 'sessions', {
    token_hash: await sha256Hex(token),
    user_id: userId,
    created_at: now,
    expires_at: addHours(now, ctx.settings.session_hours),
  });
  return token;
}

function activeAdminCount(db, excludeId) {
  return db.get("SELECT COUNT(*) AS n FROM users WHERE role = 'ADMIN' AND status = 'ACTIVE' AND id != ?", [excludeId]).n;
}

function readProfile(ctx, p) {
  const deptId = optId(p.department_id, 'Department');
  if (deptId && !ctx.db.get('SELECT id FROM departments WHERE id = ?', [deptId])) throw bad('Department not found');
  return {
    full_name: str(p.full_name, { required: true, max: 120, name: 'Full name' }),
    staff_no: str(p.staff_no, { max: 40, name: 'Staff number' }),
    email: email(p.email),
    phone: str(p.phone, { max: 40, name: 'Phone' }),
    designation: str(p.designation, { max: 120, name: 'Designation' }),
    department_id: deptId,
  };
}

const USER_SELECT = `SELECT u.*, d.name AS department_name FROM users u LEFT JOIN departments d ON d.id = u.department_id`;

export const handlers = {
  'auth.login': {
    public: true,
    write: true,
    async fn(ctx, p) {
      const name = String(p.username || '').trim().toLowerCase();
      const pw = String(p.password || '');
      if (!name || !pw) throw bad('Enter your username and password');
      const u = ctx.db.get('SELECT * FROM users WHERE username = ?', [name]);
      const invalid = new ApiError(401, 'Invalid username or password', 'INVALID_LOGIN');
      if (!u) throw invalid;
      const now = ctx.now();
      if (u.locked_until && u.locked_until > now) {
        throw new ApiError(403, `Too many failed attempts. Try again after ${u.locked_until.slice(11, 16)}.`, 'LOCKED');
      }
      if (!(await verifyPassword(pw, u.password_hash))) {
        const failed = u.failed_logins + 1;
        if (failed >= MAX_FAILED) {
          update(ctx.db, 'users', u.id, { failed_logins: 0, locked_until: addHours(now, LOCK_MINUTES / 60) });
          ctx.audit('Account locked after failed logins', 'users', u.id);
        } else {
          update(ctx.db, 'users', u.id, { failed_logins: failed });
        }
        // Persist the failed-attempt counter even though the call fails.
        ctx.commitOnError = true;
        throw invalid;
      }
      if (u.status === 'PENDING') throw new ApiError(403, 'Your registration is waiting for administrator approval', 'PENDING');
      if (u.status !== 'ACTIVE') throw new ApiError(403, 'This account is disabled. Contact the administrator.', 'DISABLED');
      update(ctx.db, 'users', u.id, { failed_logins: 0, locked_until: null, last_login_at: now });
      const token = await createSession(ctx, u.id);
      ctx.user = { ...u, last_login_at: now };
      ctx.audit('Logged in', 'users', u.id);
      rollingGenerate(ctx);
      return { token, user: sessionUser(ctx) };
    },
  },

  'auth.logout': {
    public: true,
    write: true,
    async fn(ctx) {
      if (ctx.token) ctx.db.run('DELETE FROM sessions WHERE token_hash = ?', [await sha256Hex(ctx.token)]);
      return { ok: true };
    },
  },

  'auth.me': {
    fn: (ctx) => sessionUser(ctx),
  },

  'auth.changePassword': {
    write: true,
    async fn(ctx, p) {
      const u = ctx.db.get('SELECT * FROM users WHERE id = ?', [ctx.user.id]);
      if (!(await verifyPassword(String(p.current_password || ''), u.password_hash))) throw bad('Current password is incorrect');
      const next = password(p.new_password);
      if (next === p.current_password) throw bad('Choose a password different from the current one');
      update(ctx.db, 'users', u.id, {
        password_hash: await hashPassword(next, ctx.env.hashIterations),
        must_change_password: 0,
        updated_at: ctx.now(),
      });
      if (ctx.token) {
        ctx.db.run('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?', [u.id, await sha256Hex(ctx.token)]);
      }
      ctx.audit('Password changed', 'users', u.id);
      return { ok: true };
    },
  },

  'auth.updateProfile': {
    write: true,
    fn(ctx, p) {
      const patch = {
        full_name: str(p.full_name, { required: true, max: 120, name: 'Full name' }),
        email: email(p.email),
        phone: str(p.phone, { max: 40, name: 'Phone' }),
        updated_at: ctx.now(),
      };
      update(ctx.db, 'users', ctx.user.id, patch);
      ctx.audit('Profile updated', 'users', ctx.user.id);
      return { ok: true };
    },
  },

  'auth.register': {
    public: true,
    write: true,
    async fn(ctx, p) {
      if (!ctx.db.get('SELECT COUNT(*) AS n FROM users').n) throw bad('Complete the initial setup first');
      const name = username(p.username);
      if (ctx.db.get('SELECT id FROM users WHERE username = ?', [name])) throw conflict('That username is taken');
      const prof = readProfile(ctx, p);
      if (!prof.department_id) throw bad('Select your department');
      const requested = oneOf(p.requested_role, ['REQUESTER', 'TECHNICIAN', 'ENGINEER', 'MANAGER', 'VIEWER'], { def: 'REQUESTER', name: 'Role' });
      const userId = insert(ctx.db, 'users', {
        username: name,
        ...prof,
        role: requested,
        approval_level: 0,
        status: 'PENDING',
        password_hash: await hashPassword(password(p.password), ctx.env.hashIterations),
        created_at: ctx.now(),
      });
      ctx.audit('User self-registered (pending approval)', 'users', userId, { username: name, requested });
      return { ok: true, message: 'Registration received. An administrator must approve it before you can log in.' };
    },
  },

  'users.list': {
    perm: 'users.manage',
    fn(ctx, p) {
      const where = [];
      const params = [];
      if (p.status) {
        where.push('u.status = ?');
        params.push(oneOf(p.status, ['ACTIVE', 'PENDING', 'DISABLED', 'REJECTED'], { name: 'Status' }));
      }
      const rows = ctx.db.all(
        `${USER_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
         ORDER BY CASE u.status WHEN 'PENDING' THEN 0 WHEN 'ACTIVE' THEN 1 ELSE 2 END, u.full_name`,
        params,
      );
      return { rows: rows.map((u) => ({ ...publicUser(u), locked: !!(u.locked_until && u.locked_until > ctx.now()) })) };
    },
  },

  'users.save': {
    perm: 'users.manage',
    write: true,
    async fn(ctx, p) {
      const userId = optId(p.id, 'User');
      const prof = readProfile(ctx, p);
      const role = oneOf(p.role, Object.keys(ROLES), { name: 'Role' });
      const level = int(p.approval_level, { min: 0, max: 3, def: 0, name: 'Approval level' });
      if (userId) {
        const u = ctx.db.get('SELECT * FROM users WHERE id = ?', [userId]);
        if (!u) throw notFound('User');
        const status = oneOf(p.status, ['ACTIVE', 'DISABLED'], { def: u.status === 'PENDING' ? 'PENDING' : u.status, name: 'Status' });
        const losingAdmin = u.role === 'ADMIN' && u.status === 'ACTIVE' && (role !== 'ADMIN' || status !== 'ACTIVE');
        if (losingAdmin && activeAdminCount(ctx.db, u.id) === 0) throw bad('There must be at least one active administrator');
        update(ctx.db, 'users', u.id, { ...prof, role, approval_level: level, status, updated_at: ctx.now() });
        if (status !== 'ACTIVE') ctx.db.run('DELETE FROM sessions WHERE user_id = ?', [u.id]);
        ctx.audit('User updated', 'users', u.id, { role, approval_level: level, status });
        return { id: u.id };
      }
      const name = username(p.username);
      if (ctx.db.get('SELECT id FROM users WHERE username = ?', [name])) throw conflict('That username is taken');
      const newId = insert(ctx.db, 'users', {
        username: name,
        ...prof,
        role,
        approval_level: level,
        status: 'ACTIVE',
        password_hash: await hashPassword(password(p.password), ctx.env.hashIterations),
        must_change_password: 1,
        created_at: ctx.now(),
      });
      ctx.audit('User created', 'users', newId, { username: name, role, approval_level: level });
      return { id: newId };
    },
  },

  'users.approve': {
    perm: 'users.manage',
    write: true,
    fn(ctx, p) {
      const u = ctx.db.get('SELECT * FROM users WHERE id = ?', [id(p.id, 'User')]);
      if (!u) throw notFound('User');
      if (u.status !== 'PENDING') throw bad('This registration is not pending');
      const role = oneOf(p.role, Object.keys(ROLES), { def: u.role, name: 'Role' });
      const level = int(p.approval_level, { min: 0, max: 3, def: 0, name: 'Approval level' });
      const deptId = optId(p.department_id, 'Department') || u.department_id;
      update(ctx.db, 'users', u.id, { status: 'ACTIVE', role, approval_level: level, department_id: deptId, updated_at: ctx.now() });
      ctx.audit('User registration approved', 'users', u.id, { role, approval_level: level });
      return { ok: true };
    },
  },

  'users.reject': {
    perm: 'users.manage',
    write: true,
    fn(ctx, p) {
      const u = ctx.db.get('SELECT * FROM users WHERE id = ?', [id(p.id, 'User')]);
      if (!u) throw notFound('User');
      if (u.status !== 'PENDING') throw bad('This registration is not pending');
      update(ctx.db, 'users', u.id, { status: 'REJECTED', updated_at: ctx.now() });
      ctx.audit('User registration rejected', 'users', u.id, { reason: str(p.reason, { max: 300 }) });
      return { ok: true };
    },
  },

  'users.resetPassword': {
    perm: 'users.manage',
    write: true,
    async fn(ctx, p) {
      const u = ctx.db.get('SELECT * FROM users WHERE id = ?', [id(p.id, 'User')]);
      if (!u) throw notFound('User');
      if (u.id === ctx.user.id) throw forbidden('Use "Change password" for your own account');
      update(ctx.db, 'users', u.id, {
        password_hash: await hashPassword(password(p.new_password), ctx.env.hashIterations),
        must_change_password: 1,
        failed_logins: 0,
        locked_until: null,
        updated_at: ctx.now(),
      });
      ctx.db.run('DELETE FROM sessions WHERE user_id = ?', [u.id]);
      ctx.audit('Password reset by administrator', 'users', u.id);
      return { ok: true };
    },
  },
};
