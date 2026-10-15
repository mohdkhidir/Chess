// Thin helpers over a synchronous SQLite adapter. Two adapters implement the same
// interface: server/db-node.js (node:sqlite) and web/src/lib/localdb.js (sql.js).
//
//   adapter.all(sql, params)  -> array of row objects
//   adapter.get(sql, params)  -> first row or undefined
//   adapter.run(sql, params)  -> { changes, lastInsertRowid }
//   adapter.exec(sql)         -> runs one or more statements, no result

// node:sqlite rejects booleans/undefined; sql.js silently mangles them. Normalise once here.
export function normalizeParams(params = []) {
  return params.map((v) => {
    if (v === undefined) return null;
    if (typeof v === 'boolean') return v ? 1 : 0;
    if (typeof v === 'bigint') return Number(v);
    return v;
  });
}

export function insert(db, table, obj) {
  const keys = Object.keys(obj);
  const sql = `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`;
  return Number(db.run(sql, keys.map((k) => obj[k])).lastInsertRowid);
}

export function update(db, table, rowId, obj) {
  const keys = Object.keys(obj);
  if (!keys.length) return 0;
  const sql = `UPDATE ${table} SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`;
  return db.run(sql, [...keys.map((k) => obj[k]), rowId]).changes;
}

export function nextSeq(db, key) {
  const row = db.get('SELECT value FROM sequences WHERE key = ?', [key]);
  const value = (row ? Number(row.value) : 0) + 1;
  db.run(
    'INSERT INTO sequences (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    [key, value],
  );
  return value;
}

// Running document numbers, e.g. CM-2026-00042, PPM-2026-00117, HD-2026-00009.
export function docNo(db, prefix, date) {
  const year = String(date).slice(0, 4);
  const n = nextSeq(db, `${prefix}-${year}`);
  return `${prefix}-${year}-${String(n).padStart(5, '0')}`;
}

export function transaction(db, fn) {
  db.exec('BEGIN');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
