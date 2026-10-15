#!/usr/bin/env node
// BioMed AMS hospital server: one Node.js process, one SQLite file, no other dependencies.
//   node server/index.js [--port 8080] [--host 0.0.0.0] [--db ./data/biomed-ams.sqlite] [--demo]
//   node server/index.js --reset-password <username>
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, rm, stat } from 'node:fs/promises';
import { randomInt, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { openDatabase } from './db-node.js';
import { createEngine, ApiError } from '../core/api.js';
import { hashPassword } from '../core/auth.js';
import { APP_VERSION } from '../core/system.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'web', 'dist');
const HASH_ITERATIONS = 310000;
const MAX_BODY = 15 * 1024 * 1024;

const { values: args } = parseArgs({
  options: {
    port: { type: 'string', default: process.env.PORT || '8080' },
    host: { type: 'string', default: process.env.HOST || '0.0.0.0' },
    db: { type: 'string', default: process.env.AMS_DB || path.join(ROOT, 'data', 'biomed-ams.sqlite') },
    demo: { type: 'boolean', default: false },
    'reset-password': { type: 'string' },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

if (args.help) {
  console.log(`BioMed AMS server ${APP_VERSION}
  --port <n>                 HTTP port (default 8080, env PORT)
  --host <addr>              Bind address (default 0.0.0.0, env HOST)
  --db <file>                SQLite database file (env AMS_DB)
  --demo                     Load the demo hospital if the database is empty
  --reset-password <user>    Issue a temporary password for a user and exit`);
  process.exit(0);
}

const dbFile = path.resolve(args.db);
await mkdir(path.dirname(dbFile), { recursive: true });
const db = openDatabase(dbFile);
const engine = createEngine({ db, mode: 'server', hashIterations: HASH_ITERATIONS, allowDemo: args.demo });

if (args['reset-password']) {
  const u = db.get('SELECT id, username FROM users WHERE username = ?', [args['reset-password'].toLowerCase()]);
  if (!u) {
    console.error(`No user named "${args['reset-password']}"`);
    process.exit(1);
  }
  const temp = `${randomBytes(4).toString('hex')}A${randomInt(10, 99)}`;
  db.run('UPDATE users SET password_hash = ?, must_change_password = 1, failed_logins = 0, locked_until = NULL, status = ? WHERE id = ?', [
    await hashPassword(temp, HASH_ITERATIONS),
    'ACTIVE',
    u.id,
  ]);
  db.run('DELETE FROM sessions WHERE user_id = ?', [u.id]);
  console.log(`Temporary password for ${u.username}: ${temp}\nThey will be asked to change it at the next login.`);
  db.close();
  process.exit(0);
}

const userCount = () => db.get('SELECT COUNT(*) AS n FROM users').n;
if (args.demo && userCount() === 0) {
  const info = await engine.call('setup.demo', {});
  console.log(`Demo hospital loaded: ${info.assets} assets. Log in as admin / ${info.password}`);
}
if (userCount() === 0) {
  engine.env.setupCode = String(randomInt(100000, 1000000));
}

// ---------------- HTTP ----------------

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
};

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(self), microphone=(), geolocation=()',
};

const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "media-src 'self' blob:",
  "worker-src 'self' blob:",
  "font-src 'self' data:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Max-Age': '600',
};

function send(res, status, body, headers = {}) {
  const data = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    'Content-Type': typeof body === 'object' && !Buffer.isBuffer(body) ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(data);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new ApiError(413, 'Request is too large', 'TOO_LARGE'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// Simple fixed-window limiter for unauthenticated endpoints (login, register, setup).
const hits = new Map();
function rateLimited(ip, limit = 20) {
  const now = Date.now();
  const w = hits.get(ip);
  if (!w || now - w.start > 60000) {
    hits.set(ip, { start: now, n: 1 });
    if (hits.size > 10000) hits.clear();
    return false;
  }
  w.n++;
  return w.n > limit;
}

const PUBLIC_LIMITED = new Set(['auth.login', 'auth.register', 'setup.init', 'setup.demo']);

function bearer(req) {
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7).trim() : null;
}

async function handleRpc(req, res, method) {
  const ip = req.socket.remoteAddress || 'unknown';
  if (PUBLIC_LIMITED.has(method) && rateLimited(ip)) {
    return send(res, 429, { ok: false, error: { code: 'RATE_LIMITED', message: 'Too many attempts. Wait a minute and try again.' } }, CORS);
  }
  let params = {};
  try {
    const raw = await readBody(req);
    if (raw) params = JSON.parse(raw).params || {};
  } catch (e) {
    const status = e instanceof ApiError ? e.status : 400;
    return send(res, status, { ok: false, error: { code: 'BAD_REQUEST', message: e.message || 'Invalid JSON' } }, CORS);
  }
  try {
    const data = await engine.call(method, params, bearer(req));
    send(res, 200, { ok: true, data }, CORS);
  } catch (e) {
    if (e instanceof ApiError) {
      send(res, e.status, { ok: false, error: { code: e.code, message: e.message } }, CORS);
    } else {
      console.error(`[${new Date().toISOString()}] ${method} failed:`, e);
      send(res, 500, { ok: false, error: { code: 'SERVER_ERROR', message: 'Unexpected server error. It has been logged.' } }, CORS);
    }
  }
}

async function handleBackup(req, res) {
  let me;
  try {
    me = await engine.call('auth.me', {}, bearer(req));
  } catch (e) {
    return send(res, e.status || 401, { ok: false, error: { code: e.code, message: e.message } }, CORS);
  }
  if (!me.permissions.includes('system.backup')) {
    return send(res, 403, { ok: false, error: { code: 'FORBIDDEN', message: 'Administrators only' } }, CORS);
  }
  const tmp = path.join(os.tmpdir(), `biomed-ams-backup-${Date.now()}-${randomInt(1e6)}.sqlite`);
  try {
    // VACUUM INTO writes a consistent, compacted copy; run it between RPC calls.
    await engine.exclusive(() => db.raw.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`));
    const { size } = await stat(tmp);
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '');
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      ...CORS,
      'Content-Type': 'application/vnd.sqlite3',
      'Content-Length': size,
      'Content-Disposition': `attachment; filename="biomed-ams-backup-${stamp}.sqlite"`,
      'Cache-Control': 'no-store',
    });
    const stream = createReadStream(tmp);
    stream.pipe(res);
    stream.on('close', () => rm(tmp, { force: true }));
    console.log(`[${new Date().toISOString()}] backup downloaded by ${me.username}`);
  } catch (e) {
    await rm(tmp, { force: true });
    console.error('Backup failed:', e);
    send(res, 500, { ok: false, error: { code: 'SERVER_ERROR', message: 'Backup failed' } }, CORS);
  }
}

async function serveStatic(req, res, urlPath) {
  let rel = decodeURIComponent(urlPath);
  if (rel === '/' || rel === '') rel = '/index.html';
  const file = path.resolve(DIST, `.${rel}`);
  if (!file.startsWith(DIST + path.sep)) return send(res, 403, 'Forbidden');
  let target = file;
  try {
    const st = await stat(target);
    if (st.isDirectory()) target = path.join(target, 'index.html');
  } catch {
    // unknown path: hand the SPA its index (the app uses hash routes, so this is just a fallback)
    if (path.extname(rel) && rel !== '/index.html') return send(res, 404, 'Not found');
    target = path.join(DIST, 'index.html');
  }
  try {
    const ext = path.extname(target).toLowerCase();
    const body = await readFile(target);
    const immutable = target.includes(`${path.sep}assets${path.sep}`);
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
      ...(ext === '.html' ? { 'Content-Security-Policy': CSP } : {}),
    });
    res.end(body);
  } catch {
    send(
      res,
      503,
      `<!doctype html><meta charset="utf-8"><title>BioMed AMS</title><body style="font-family:sans-serif;padding:2rem">
       <h1>BioMed AMS server is running</h1><p>The web app has not been built yet. Run <code>npm run build</code> in the project folder, then reload.</p>`,
      { 'Content-Type': 'text/html; charset=utf-8' },
    );
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const p = url.pathname;
    if (p.startsWith('/api/')) {
      if (req.method === 'OPTIONS') {
        res.writeHead(204, { ...CORS, ...SECURITY_HEADERS });
        return res.end();
      }
      if (p === '/api/health' && req.method === 'GET') {
        return send(res, 200, { ok: true, app: 'biomed-ams', version: APP_VERSION }, CORS);
      }
      if (p === '/api/backup' && req.method === 'GET') return handleBackup(req, res);
      const m = /^\/api\/rpc\/([a-zA-Z.]+)$/.exec(p);
      if (m && req.method === 'POST') return handleRpc(req, res, m[1]);
      return send(res, 404, { ok: false, error: { code: 'NOT_FOUND', message: 'Unknown API path' } }, CORS);
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
    return serveStatic(req, res, p);
  } catch (e) {
    console.error('Request failed:', e);
    if (!res.headersSent) send(res, 500, 'Server error');
  }
});

server.listen(Number(args.port), args.host, () => {
  const addrs = Object.values(os.networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => `http://${i.address}:${args.port}`);
  console.log(`\nBioMed AMS ${APP_VERSION} — database: ${dbFile}`);
  console.log(`Open on this computer:  http://localhost:${args.port}`);
  if (addrs.length) console.log(`Open on phones (same Wi-Fi / hospital network):\n  ${addrs.join('\n  ')}`);
  if (engine.env.setupCode) {
    console.log(`\nFirst run: open the app and complete setup with this one-time code: ${engine.env.setupCode}\n`);
  }
});

function shutdown() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
