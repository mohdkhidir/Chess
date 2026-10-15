// Shared helpers used by both the Node server and the in-app (standalone) engine.
// Dates are stored as plain strings in the hospital's local time:
//   dates      -> 'YYYY-MM-DD'
//   timestamps -> 'YYYY-MM-DD HH:MM:SS'
// Malaysia has no daylight saving, so naive local arithmetic is exact.

export class ApiError extends Error {
  constructor(status, message, code = 'ERROR') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const bad = (msg) => new ApiError(400, msg, 'BAD_REQUEST');
export const notFound = (what = 'Record') => new ApiError(404, `${what} not found`, 'NOT_FOUND');
export const forbidden = (msg = 'You do not have permission to do this') => new ApiError(403, msg, 'FORBIDDEN');
export const conflict = (msg) => new ApiError(409, msg, 'CONFLICT');

const pad = (n, w = 2) => String(n).padStart(w, '0');
const DAY = 86400000;

export function nowLocal(timeZone = 'Asia/Kuala_Lumpur', date = new Date()) {
  try {
    const fmt = new Intl.DateTimeFormat('en-GB', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    });
    const p = {};
    for (const part of fmt.formatToParts(date)) p[part.type] = part.value;
    const hour = p.hour === '24' ? '00' : p.hour;
    return `${p.year}-${p.month}-${p.day} ${hour}:${p.minute}:${p.second}`;
  } catch {
    // Unknown time zone: fall back to Malaysia time (UTC+8).
    return fmtDateTime(date.getTime() + 8 * 3600000);
  }
}

// Parses 'YYYY-MM-DD' or 'YYYY-MM-DD HH:MM[:SS]' (also with 'T') as a naive UTC instant.
export function parseDate(s) {
  if (!s || typeof s !== 'string') return NaN;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(s);
  if (!m) return NaN;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
}

export function fmtDate(ms) {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function fmtDateTime(ms) {
  const d = new Date(ms);
  return `${fmtDate(ms)} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

export const addDays = (s, n) => fmtDate(parseDate(s) + n * DAY);
export const addHours = (s, h) => fmtDateTime(parseDate(s) + h * 3600000);

export function addMonths(s, n) {
  const d = new Date(parseDate(s));
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + n;
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return fmtDate(Date.UTC(y, m, Math.min(d.getUTCDate(), last)));
}

export function endOfMonth(s) {
  const d = new Date(parseDate(s));
  return fmtDate(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
}

export const startOfMonth = (s) => `${s.slice(0, 7)}-01`;
export const diffDays = (a, b) => (parseDate(b) - parseDate(a)) / DAY;
export const diffHours = (a, b) => (parseDate(b) - parseDate(a)) / 3600000;
export const yearsBetween = (a, b) => diffDays(a, b) / 365.25;

export function monthsBetween(a, b) {
  const da = new Date(parseDate(a));
  const db = new Date(parseDate(b));
  return (db.getUTCFullYear() - da.getUTCFullYear()) * 12 + (db.getUTCMonth() - da.getUTCMonth());
}

export function isDate(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && fmtDate(parseDate(s)) === s;
}

export function normDateTime(s) {
  const ms = parseDate(s);
  return Number.isNaN(ms) ? null : fmtDateTime(ms);
}

// ---------- validation ----------

export function str(v, { max = 500, required = false, name = 'Field' } = {}) {
  if (v === undefined || v === null) v = '';
  if (typeof v !== 'string') v = String(v);
  v = v.trim();
  if (required && !v) throw bad(`${name} is required`);
  if (v.length > max) throw bad(`${name} is too long (max ${max} characters)`);
  return v || null;
}

export function num(v, { min = -Infinity, max = Infinity, name = 'Value', def = 0, required = false } = {}) {
  if (v === '' || v === null || v === undefined) {
    if (required) throw bad(`${name} is required`);
    return def;
  }
  const n = Number(v);
  if (!Number.isFinite(n)) throw bad(`${name} must be a number`);
  if (n < min || n > max) throw bad(`${name} must be between ${min} and ${max}`);
  return n;
}

export function int(v, opts = {}) {
  const n = num(v, opts);
  if (n !== null && n !== undefined && !Number.isInteger(n)) throw bad(`${opts.name || 'Value'} must be a whole number`);
  return n;
}

export function oneOf(v, list, { name = 'Value', def, required = true } = {}) {
  if ((v === undefined || v === null || v === '') && def !== undefined) return def;
  if ((v === undefined || v === null || v === '') && !required) return null;
  if (!list.includes(v)) throw bad(`${name} must be one of: ${list.join(', ')}`);
  return v;
}

export function dateOrNull(v, name = 'Date') {
  if (v === undefined || v === null || v === '') return null;
  if (!isDate(v)) throw bad(`${name} must be a valid date (YYYY-MM-DD)`);
  return v;
}

export function dateTimeOrNull(v, name = 'Date/time') {
  if (v === undefined || v === null || v === '') return null;
  const t = normDateTime(v);
  if (!t) throw bad(`${name} must be a valid date/time`);
  return t;
}

export function id(v, name = 'ID') {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw bad(`${name} is invalid`);
  return n;
}

export const optId = (v, name) => (v === undefined || v === null || v === '' ? null : id(v, name));
export const bool = (v) => (v === true || v === 1 || v === '1' || v === 'true' ? 1 : 0);

export function round(n, d = 2) {
  if (!Number.isFinite(n)) return n;
  const f = 10 ** d;
  return Math.round((n + Number.EPSILON) * f) / f;
}

export function parseJson(s, def) {
  if (s === null || s === undefined || s === '') return def;
  try {
    return JSON.parse(s);
  } catch {
    return def;
  }
}

export const clone = (o) => JSON.parse(JSON.stringify(o));
export const escapeLike = (s) => String(s).replace(/[\\%_]/g, (c) => `\\${c}`);
export const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
export const sum = (arr, f = (x) => x) => arr.reduce((a, x) => a + (Number(f(x)) || 0), 0);
export const avg = (arr) => (arr.length ? sum(arr) / arr.length : null);

export function groupBy(arr, keyFn) {
  const m = new Map();
  for (const x of arr) {
    const k = keyFn(x);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(x);
  }
  return m;
}
