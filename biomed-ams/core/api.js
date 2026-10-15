// The RPC engine. The server calls it over HTTP; the standalone app calls it in-process.
// Same handlers, same rules, same database schema in both places.
import { migrate } from './schema.js';
import { makeCtx, publicUser } from './context.js';
import { can } from './permissions.js';
import { ApiError, forbidden, nowLocal } from './util.js';
import { getSettings } from './settings.js';
import { sha256Hex } from './auth.js';

import { handlers as master } from './masterdata.js';
import { handlers as approvals } from './approvals.js';
import { handlers as assets } from './assets.js';
import { handlers as ppm } from './ppm.js';
import { handlers as workorders } from './workorders.js';
import { handlers as tickets } from './tickets.js';
import { handlers as insights } from './insights.js';
import { handlers as users } from './users.js';
import { handlers as system } from './system.js';
import { handlers as reports } from './reports.js';

export const HANDLERS = {
  ...system, ...users, ...master, ...approvals, ...assets, ...ppm, ...workorders, ...tickets, ...insights, ...reports,
};

// Methods a user whose password must be changed may still call.
const ALLOWED_BEFORE_PASSWORD_CHANGE = new Set(['auth.me', 'auth.logout', 'auth.changePassword', 'meta.bootstrap']);

async function resolveUser(env, token) {
  if (!token) return null;
  const now = env.clock ? env.clock() : nowLocal(getSettings(env.db).timezone);
  const row = env.db.get('SELECT user_id, expires_at FROM sessions WHERE token_hash = ?', [await sha256Hex(token)]);
  if (!row || row.expires_at < now) return null;
  const u = env.db.get('SELECT * FROM users WHERE id = ?', [row.user_id]);
  if (!u || u.status !== 'ACTIVE') return null;
  return publicUser(u);
}

/**
 * @param {{ db: object, mode: 'server'|'local', hashIterations?: number, clock?: () => string,
 *           setupCode?: string|null, allowDemo?: boolean, onWrite?: () => void }} options
 */
export function createEngine(options) {
  const env = { hashIterations: 210000, ...options };
  migrate(env.db);
  let queue = Promise.resolve();

  async function run(method, params, token) {
    const h = Object.prototype.hasOwnProperty.call(HANDLERS, method) ? HANDLERS[method] : null;
    if (!h) throw new ApiError(404, `Unknown method: ${method}`, 'NOT_FOUND');
    const user = await resolveUser(env, token);
    if (!h.public && !user) throw new ApiError(401, 'Your session has expired. Please log in again.', 'UNAUTHENTICATED');
    if (user && user.must_change_password && !h.public && !ALLOWED_BEFORE_PASSWORD_CHANGE.has(method)) {
      throw new ApiError(403, 'Please change your password before continuing', 'PASSWORD_CHANGE_REQUIRED');
    }
    if (h.perm && !can(user, h.perm)) throw forbidden();
    const ctx = makeCtx(env, user);
    ctx.token = token || null;
    const p = params && typeof params === 'object' ? params : {};
    if (!h.write) return h.fn(ctx, p);
    env.db.exec('BEGIN');
    let committed = false;
    try {
      const out = await h.fn(ctx, p);
      env.db.exec('COMMIT');
      committed = true;
      return out;
    } catch (e) {
      if (ctx.commitOnError) {
        env.db.exec('COMMIT');
        committed = true;
      } else {
        env.db.exec('ROLLBACK');
      }
      throw e;
    } finally {
      if (committed && env.onWrite) env.onWrite();
    }
  }

  // Calls are serialised: SQLite work is synchronous, but handlers may await (password hashing),
  // and two interleaved handlers must never share one open transaction.
  function exclusive(fn) {
    const result = queue.then(fn);
    queue = result.then(() => undefined, () => undefined);
    return result;
  }

  const call = (method, params = {}, token = null) => exclusive(() => run(method, params, token));

  return { call, exclusive, env, methods: Object.keys(HANDLERS) };
}

export { ApiError };
