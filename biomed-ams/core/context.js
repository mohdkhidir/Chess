import { getSettings } from './settings.js';
import { can } from './permissions.js';
import { forbidden, nowLocal } from './util.js';
import { insert } from './db.js';

// Per-call context handed to every handler.
export function makeCtx(env, user) {
  const { db } = env;
  let cached = null;
  const ctx = {
    db,
    env,
    user,
    get settings() {
      if (!cached) cached = getSettings(db);
      return cached;
    },
    invalidateSettings() {
      cached = null;
    },
    now() {
      return env.clock ? env.clock() : nowLocal(ctx.settings.timezone);
    },
    today() {
      return ctx.now().slice(0, 10);
    },
    can(perm) {
      return can(user, perm);
    },
    require(perm) {
      if (!can(user, perm)) throw forbidden();
    },
    audit(action, entity = null, entityId = null, details = null) {
      insert(db, 'audit_log', {
        user_id: user?.id ?? null,
        action,
        entity,
        entity_id: entityId,
        details: details == null ? null : typeof details === 'string' ? details : JSON.stringify(details),
        created_at: ctx.now(),
      });
    },
    event(assetId, type, description, refType = null, refId = null, at = null) {
      insert(db, 'asset_events', {
        asset_id: assetId,
        event_type: type,
        description,
        ref_type: refType,
        ref_id: refId,
        user_id: user?.id ?? null,
        created_at: at || ctx.now(),
      });
    },
  };
  return ctx;
}

export function publicUser(u) {
  if (!u) return null;
  const { password_hash, failed_logins, locked_until, ...rest } = u;
  return rest;
}
