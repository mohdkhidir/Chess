// Decides where calls go: the in-app engine (standalone, data on this device) or the hospital
// server over HTTP. Both expose the same RPC methods, so the screens never need to know.
import { isNative } from './platform.js';

const MODE_KEY = 'ams.mode';
const URL_KEY = 'ams.serverUrl';
const TOKEN_KEY = 'ams.token';

export class AppError extends Error {
  constructor(status, message, code = 'ERROR') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const store = {
  get(k) {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k, v) {
    try {
      if (v === null || v === undefined) localStorage.removeItem(k);
      else localStorage.setItem(k, v);
    } catch {
      /* private mode: keep going for this session */
    }
  },
};

export function getConfig() {
  return { mode: store.get(MODE_KEY), serverUrl: store.get(URL_KEY) || '' };
}

export function setConfig({ mode, serverUrl }) {
  store.set(MODE_KEY, mode);
  store.set(URL_KEY, mode === 'server' ? normaliseUrl(serverUrl || '') : null);
  engine = null;
}

export function normaliseUrl(u) {
  let s = String(u || '').trim().replace(/\/+$/, '');
  if (s && !/^https?:\/\//i.test(s)) s = `http://${s}`;
  return s;
}

export const getToken = () => store.get(TOKEN_KEY);
export const setToken = (t) => store.set(TOKEN_KEY, t);

let engine = null;
let enginePromise = null;
let localDb = null;

async function localEngine() {
  if (engine) return engine;
  if (!enginePromise) {
    enginePromise = (async () => {
      const [{ openLocalDatabase }, { createEngine }] = await Promise.all([
        import('./localdb.js'),
        import('../../../core/api.js'),
      ]);
      localDb = await openLocalDatabase();
      engine = createEngine({
        db: localDb,
        mode: 'local',
        hashIterations: 100000,
        onWrite: () => localDb.persist(),
      });
      return engine;
    })().catch((e) => {
      enginePromise = null;
      throw e;
    });
  }
  return enginePromise;
}

// Is this page being served by a BioMed AMS server? Then use it without asking.
export async function detectServer() {
  if (isNative() || !/^https?:$/.test(window.location.protocol)) return false;
  try {
    const res = await fetch('./api/health', { cache: 'no-store' });
    const json = await res.json();
    return json && json.app === 'biomed-ams';
  } catch {
    return false;
  }
}

export async function checkServer(url) {
  const base = normaliseUrl(url);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(`${base}/api/health`, { cache: 'no-store', signal: ctrl.signal });
    const json = await res.json();
    if (json.app !== 'biomed-ams') throw new Error('not ours');
    return json;
  } catch (e) {
    throw new AppError(0, e.name === 'AbortError'
      ? `No answer from ${base}. Check the address and that this phone is on the hospital network.`
      : `Could not reach a BioMed AMS server at ${base}.`, 'NETWORK');
  } finally {
    clearTimeout(timer);
  }
}

export async function rpc(method, params = {}) {
  const { mode, serverUrl } = getConfig();
  const token = getToken();
  if (mode === 'local') {
    const e = await localEngine();
    try {
      return await e.call(method, params, token);
    } catch (err) {
      if (err && err.status) throw new AppError(err.status, err.message, err.code);
      console.error(err);
      throw new AppError(500, err?.message || 'Unexpected error', 'ERROR');
    }
  }
  let res;
  try {
    res = await fetch(`${serverUrl}/api/rpc/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ params }),
    });
  } catch {
    throw new AppError(0, 'Cannot reach the server. Check your network connection.', 'NETWORK');
  }
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* fall through */
  }
  if (!json) throw new AppError(res.status, `Server error (${res.status})`, 'SERVER_ERROR');
  if (!json.ok) throw new AppError(res.status, json.error?.message || 'Request failed', json.error?.code);
  return json.data;
}

// ---- backup / restore ----

export async function downloadBackup() {
  const { mode, serverUrl } = getConfig();
  if (mode === 'local') {
    const e = await localEngine();
    return e.exclusive(() => localDb.exportBytes());
  }
  const res = await fetch(`${serverUrl}/api/backup`, { headers: { Authorization: `Bearer ${getToken()}` } });
  if (!res.ok) {
    let msg = `Backup failed (${res.status})`;
    try {
      msg = (await res.json()).error.message;
    } catch {
      /* keep default */
    }
    throw new AppError(res.status, msg);
  }
  return new Uint8Array(await res.arrayBuffer());
}

export async function restoreLocal(bytes) {
  const e = await localEngine();
  await e.exclusive(() => localDb.replace(bytes));
}

export async function wipeLocal() {
  const e = await localEngine();
  await e.exclusive(() => localDb.wipe());
  engine = null;
  enginePromise = null;
}
