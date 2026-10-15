// node:sqlite adapter (Node.js 22.13+). Synchronous, single connection, WAL journal.
import { DatabaseSync } from 'node:sqlite';
import { normalizeParams } from '../core/db.js';

export function openDatabase(file) {
  const db = new DatabaseSync(file);
  if (file !== ':memory:') db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  const cache = new Map();
  const stmt = (sql) => {
    let s = cache.get(sql);
    if (!s) {
      s = db.prepare(sql);
      if (cache.size > 500) cache.clear();
      cache.set(sql, s);
    }
    return s;
  };
  return {
    raw: db,
    all: (sql, params = []) => stmt(sql).all(...normalizeParams(params)),
    get: (sql, params = []) => stmt(sql).get(...normalizeParams(params)),
    run: (sql, params = []) => {
      const r = stmt(sql).run(...normalizeParams(params));
      return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) };
    },
    exec: (sql) => db.exec(sql),
    close: () => db.close(),
  };
}
