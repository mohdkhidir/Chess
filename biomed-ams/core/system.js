import { insert } from './db.js';
import { ApiError, bad, escapeLike, int, oneOf, optId, str, dateOrNull } from './util.js';
import { DEFAULT_SETTINGS, getSettings, validateSettings, writeSettings, APPROVAL_TYPES } from './settings.js';
import { hashPassword, checkPasswordStrength } from './auth.js';
import { DEFAULT_CATEGORIES, DEFAULT_DEPARTMENTS } from './library.js';
import { seedLibrary } from './masterdata.js';
import { TAG_TOKENS, previewTag } from './tagging.js';
import { createSession, sessionUser } from './users.js';
import { loadDemo } from './demo.js';

export const APP_VERSION = '1.0.0';

function userCount(db) {
  return db.get('SELECT COUNT(*) AS n FROM users').n;
}

function setupGuard(ctx, p) {
  if (userCount(ctx.db) > 0) throw bad('This system has already been set up');
  if (ctx.env.setupCode && String(p.setup_code || '').trim() !== ctx.env.setupCode) {
    throw new ApiError(403, 'Setup code is incorrect. It is printed in the server console.', 'SETUP_CODE');
  }
}

export const handlers = {
  'meta.bootstrap': {
    public: true,
    fn(ctx) {
      const s = getSettings(ctx.db);
      const demo = ctx.db.get("SELECT value FROM meta WHERE key = 'demo'");
      return {
        app: 'biomed-ams',
        version: APP_VERSION,
        mode: ctx.env.mode,
        needs_setup: userCount(ctx.db) === 0,
        setup_code_required: !!ctx.env.setupCode,
        demo_allowed: ctx.env.mode === 'local' || !!ctx.env.allowDemo,
        demo: !!demo,
        hospital_name: s.hospital_name,
        hospital_code: s.hospital_code,
        departments: userCount(ctx.db)
          ? ctx.db.all('SELECT id, code, name FROM departments WHERE active = 1 ORDER BY name')
          : [],
      };
    },
  },

  'setup.init': {
    public: true,
    write: true,
    async fn(ctx, p) {
      setupGuard(ctx, p);
      const settings = validateSettings({
        hospital_name: p.hospital_name,
        hospital_code: p.hospital_code,
        ...(p.state ? { state: p.state } : {}),
      });
      writeSettings(ctx.db, settings);
      ctx.invalidateSettings();
      if (!ctx.db.get('SELECT COUNT(*) AS n FROM categories').n && p.load_library !== false) {
        seedLibrary(ctx.db, { departments: DEFAULT_DEPARTMENTS, categories: DEFAULT_CATEGORIES });
      }
      const name = str(p.admin_username, { required: true, max: 40, name: 'Admin username' }).toLowerCase();
      if (!/^[a-z0-9._-]{3,40}$/.test(name)) throw bad('Username must be 3-40 letters, digits, dot, dash or underscore');
      const problem = checkPasswordStrength(p.admin_password);
      if (problem) throw bad(problem);
      const bme = ctx.db.get("SELECT id FROM departments WHERE code = 'BME'");
      const adminId = insert(ctx.db, 'users', {
        username: name,
        full_name: str(p.admin_full_name, { required: true, max: 120, name: 'Full name' }),
        email: str(p.admin_email, { max: 120, name: 'Email' }),
        role: 'ADMIN',
        approval_level: 3,
        department_id: bme?.id ?? null,
        designation: 'System Administrator',
        status: 'ACTIVE',
        password_hash: await hashPassword(p.admin_password, ctx.env.hashIterations),
        created_at: ctx.now(),
      });
      ctx.user = ctx.db.get('SELECT * FROM users WHERE id = ?', [adminId]);
      ctx.audit('Initial setup completed', 'system', null, { hospital: settings.hospital_name });
      const token = await createSession(ctx, adminId);
      return { token, user: sessionUser(ctx) };
    },
  },

  'setup.demo': {
    public: true,
    write: true,
    async fn(ctx, p) {
      if (ctx.env.mode !== 'local' && !ctx.env.allowDemo) throw bad('Demo data can only be loaded in standalone mode');
      setupGuard(ctx, { ...p, setup_code: ctx.env.setupCode });
      const info = await loadDemo(ctx);
      return info;
    },
  },

  'settings.get': {
    fn(ctx) {
      return {
        settings: ctx.settings,
        defaults: DEFAULT_SETTINGS,
        tag_tokens: TAG_TOKENS,
        tag_preview: previewTag(ctx.settings),
        approval_types: APPROVAL_TYPES,
      };
    },
  },

  'settings.previewTag': {
    fn(ctx, p) {
      const v = validateSettings({ tag_format: p.tag_format });
      return { preview: previewTag({ ...ctx.settings, ...v, hospital_code: p.hospital_code || ctx.settings.hospital_code }) };
    },
  },

  'settings.save': {
    perm: 'settings.manage',
    write: true,
    fn(ctx, p) {
      const values = validateSettings(p.settings || {});
      const merged = { ...ctx.settings, ...values };
      if (merged.wo_cost_level2_max < merged.wo_cost_level1_max) {
        throw bad('Level 2 cost limit must be greater than or equal to the Level 1 limit');
      }
      writeSettings(ctx.db, values);
      ctx.invalidateSettings();
      ctx.audit('Settings changed', 'settings', null, values);
      return { settings: ctx.settings };
    },
  },

  'audit.list': {
    perm: 'audit.view',
    fn(ctx, p) {
      const where = [];
      const params = [];
      const from = dateOrNull(p.from, 'From');
      const to = dateOrNull(p.to, 'To');
      if (from) {
        where.push('g.created_at >= ?');
        params.push(`${from} 00:00:00`);
      }
      if (to) {
        where.push('g.created_at <= ?');
        params.push(`${to} 23:59:59`);
      }
      const userId = optId(p.user_id, 'User');
      if (userId) {
        where.push('g.user_id = ?');
        params.push(userId);
      }
      if (p.entity) {
        where.push('g.entity = ?');
        params.push(oneOf(p.entity, ['assets', 'work_orders', 'ppm_schedules', 'ppm_plans', 'tickets', 'approvals', 'users', 'settings', 'system', 'departments', 'locations', 'categories', 'vendors'], { name: 'Record type' }));
      }
      if (p.q) {
        const q = `%${escapeLike(String(p.q).trim())}%`;
        where.push("(g.action LIKE ? ESCAPE '\\' OR g.details LIKE ? ESCAPE '\\')");
        params.push(q, q);
      }
      const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const total = ctx.db.get(`SELECT COUNT(*) AS n FROM audit_log g ${w}`, params).n;
      const limit = int(p.page_size, { min: 1, max: 1000, def: 50, name: 'Page size' });
      const page = int(p.page, { min: 1, max: 100000, def: 1, name: 'Page' });
      const rows = ctx.db.all(
        `SELECT g.*, u.full_name AS user_name, u.username FROM audit_log g LEFT JOIN users u ON u.id = g.user_id
         ${w} ORDER BY g.created_at DESC, g.id DESC LIMIT ? OFFSET ?`,
        [...params, limit, (page - 1) * limit],
      );
      return { rows, total, page, page_size: limit };
    },
  },

  'system.stats': {
    perm: 'system.backup',
    fn(ctx) {
      const tables = ['assets', 'ppm_plans', 'ppm_schedules', 'work_orders', 'tickets', 'approvals', 'users', 'audit_log', 'asset_events'];
      return {
        version: APP_VERSION,
        mode: ctx.env.mode,
        counts: Object.fromEntries(tables.map((t) => [t, ctx.db.get(`SELECT COUNT(*) AS n FROM ${t}`).n])),
        schema_version: ctx.db.get("SELECT value FROM meta WHERE key = 'schema_version'")?.value,
      };
    },
  },
};
