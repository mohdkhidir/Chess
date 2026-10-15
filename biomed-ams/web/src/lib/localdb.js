// Standalone mode: the whole SQLite database lives on the phone (sql.js / WebAssembly),
// saved to IndexedDB after every change. Same schema as the hospital server.
import initSqlJs from 'sql.js';
import wasmUrl from 'sql.js/dist/sql-wasm-browser.wasm?url';
import { normalizeParams } from '../../../core/db.js';
import { migrate } from '../../../core/schema.js';

const IDB_NAME = 'biomed-ams';
const STORE = 'files';
const KEY = 'main.sqlite';

function openIdb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idb(mode, fn) {
  const db = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req && req.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

const idbGet = (key) => idb('readonly', (s) => s.get(key));
const idbPut = (key, value) => idb('readwrite', (s) => s.put(value, key));
const idbDel = (key) => idb('readwrite', (s) => s.delete(key));

// WebAssembly first; if the WebView or page policy refuses it, fall back to the (slower, larger)
// pure-JavaScript build so the app still works.
async function loadSqlEngine() {
  try {
    return await initSqlJs({ locateFile: () => wasmUrl });
  } catch (e) {
    console.warn('WebAssembly SQLite unavailable, using the JavaScript build', e);
    const mod = await import('sql.js/dist/sql-asm.js');
    const init = mod.default || mod;
    return init();
  }
}

export async function openLocalDatabase() {
  const SQL = await loadSqlEngine();
  let bytes = null;
  try {
    bytes = await idbGet(KEY);
  } catch (e) {
    console.warn('Could not read saved database', e);
  }
  let db = bytes ? new SQL.Database(new Uint8Array(bytes)) : new SQL.Database();
  const pragmas = () => db.exec('PRAGMA foreign_keys = ON');
  pragmas();

  let pending = null;
  let saving = null;
  const queueSave = (data) => {
    pending = data;
    if (saving) return saving;
    saving = (async () => {
      try {
        while (pending) {
          const d = pending;
          pending = null;
          await idbPut(KEY, d);
        }
      } catch (e) {
        console.error('Saving the database failed', e);
      } finally {
        saving = null;
      }
    })();
    return saving;
  };

  // sql.js export() closes and reopens the connection (resetting pragmas), so it must only run
  // between transactions. The engine calls persist() synchronously right after COMMIT.
  const snapshot = () => {
    const data = db.export();
    pragmas();
    return data;
  };

  const adapter = {
    all(sql, params = []) {
      const st = db.prepare(sql);
      try {
        st.bind(normalizeParams(params));
        const out = [];
        while (st.step()) out.push(st.getAsObject());
        return out;
      } finally {
        st.free();
      }
    },
    get(sql, params = []) {
      return adapter.all(sql, params)[0];
    },
    run(sql, params = []) {
      db.run(sql, normalizeParams(params));
      const changes = db.getRowsModified();
      const r = db.exec('SELECT last_insert_rowid()');
      return { changes, lastInsertRowid: r.length ? Number(r[0].values[0][0]) : 0 };
    },
    exec(sql) {
      db.exec(sql);
    },
    persist() {
      return queueSave(snapshot());
    },
    flush() {
      return saving || Promise.resolve();
    },
    exportBytes: snapshot,
    async replace(bytes) {
      const next = new SQL.Database(new Uint8Array(bytes));
      const ok = next.exec("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('assets','users','meta')");
      if (!ok.length || ok[0].values.length < 3) {
        next.close();
        throw new Error('This file is not a BioMed AMS backup');
      }
      db.close();
      db = next;
      pragmas();
      migrate(adapter);
      await queueSave(snapshot());
    },
    async wipe() {
      db.close();
      db = new SQL.Database();
      pragmas();
      await idbDel(KEY);
    },
  };
  return adapter;
}
