// Display labels and status tones shared by every screen.

export const ASSET_STATUS = {
  PENDING: ['Pending approval', 'warning'],
  ACTIVE: ['In service', 'good'],
  BREAKDOWN: ['Breakdown', 'critical'],
  OUT_OF_SERVICE: ['Out of service', 'serious'],
  STANDBY: ['Standby / spare', 'info'],
  DISPOSAL_PENDING: ['Pending disposal', 'warning'],
  DISPOSED: ['Disposed', 'neutral'],
  REJECTED: ['Rejected', 'neutral'],
};

export const PPM_STATUS = {
  UPCOMING: ['Upcoming', 'neutral'],
  DUE: ['Due', 'warning'],
  IN_PROGRESS: ['In progress', 'info'],
  OVERDUE: ['Overdue', 'critical'],
  COMPLETED: ['Completed', 'good'],
  COMPLETED_LATE: ['Completed late', 'serious'],
  DEFERRED: ['Deferred', 'neutral'],
  CANCELLED: ['Cancelled', 'neutral'],
};

export const WO_STATUS = {
  OPEN: ['Open', 'warning'],
  ASSIGNED: ['Assigned', 'info'],
  IN_PROGRESS: ['In progress', 'info'],
  ON_HOLD: ['On hold', 'serious'],
  COMPLETED: ['Awaiting verification', 'info'],
  CLOSED: ['Closed', 'good'],
  CANCELLED: ['Cancelled', 'neutral'],
};

export const WO_RESULTS = {
  REPAIRED: 'Repaired / restored to service',
  PARTIAL: 'Partially restored (restricted use)',
  NO_FAULT_FOUND: 'No fault found',
  REFERRED: 'Referred to vendor / manufacturer',
  BER: 'Beyond economical repair (BER)',
};

export const TICKET_STATUS = {
  NEW: ['New', 'warning'],
  ASSIGNED: ['Work order raised', 'info'],
  RESOLVED: ['Resolved — confirm', 'good'],
  CLOSED: ['Closed', 'neutral'],
  CANCELLED: ['Cancelled', 'neutral'],
};

export const APPROVAL_STATUS = {
  PENDING: ['Pending', 'warning'],
  APPROVED: ['Approved', 'good'],
  REJECTED: ['Rejected', 'critical'],
  CANCELLED: ['Withdrawn', 'neutral'],
};

export const PRIORITY = {
  P1: ['P1 Critical', 'critical', 'Life support / immediate patient risk'],
  P2: ['P2 High', 'serious', 'Affects patient care, no backup unit'],
  P3: ['P3 Normal', 'warning', 'Backup unit available'],
  P4: ['P4 Low', 'neutral', 'Non-urgent / request'],
};

export const RISK_LEVEL = {
  CRITICAL: ['Critical', 'critical'],
  HIGH: ['High', 'serious'],
  MEDIUM: ['Medium', 'warning'],
  LOW: ['Low', 'good'],
};

export const LIFE_STATE = {
  OK: ['Within life', 'good'],
  NEAR_END: ['Near end of life', 'warning'],
  BEYOND_LIFE: ['Beyond life', 'critical'],
};

export const RISK_CLASS = { A: 'Class A (low)', B: 'Class B (low-moderate)', C: 'Class C (moderate-high)', D: 'Class D (high)' };

const nf0 = new Intl.NumberFormat('en-MY', { maximumFractionDigits: 0 });
const nf2 = new Intl.NumberFormat('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const money = (v) => (v === null || v === undefined || v === '' ? '—' : `RM ${nf2.format(Number(v))}`);
export const money0 = (v) => (v === null || v === undefined || v === '' ? '—' : `RM ${nf0.format(Number(v))}`);
export const num = (v, d = 0) => (v === null || v === undefined || v === '' ? '—' : new Intl.NumberFormat('en-MY', { maximumFractionDigits: d }).format(Number(v)));
export const pct = (v, d = 1) => (v === null || v === undefined ? '—' : `${num(v, d)}%`);

export function compact(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  const a = Math.abs(n);
  if (a >= 1e6) return `${num(n / 1e6, 1)}M`;
  if (a >= 1e3) return `${num(n / 1e3, a >= 1e4 ? 0 : 1)}K`;
  return num(n, 0);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const MONTH_NAMES = MONTHS;

// Malaysian convention: 15 Oct 2026 (day first).
export function date(s) {
  if (!s) return '—';
  const [y, m, d] = s.slice(0, 10).split('-');
  return `${Number(d)} ${MONTHS[Number(m) - 1]} ${y}`;
}

export function dateTime(s) {
  if (!s) return '—';
  return `${date(s)}, ${s.slice(11, 16)}`;
}

export function monthLabel(ym) {
  const [y, m] = ym.split('-');
  return `${MONTHS[Number(m) - 1]} ${y.slice(2)}`;
}

export function hours(h) {
  if (h === null || h === undefined) return '—';
  if (h < 1) return `${Math.round(h * 60)} min`;
  if (h < 48) return `${num(h, 1)} h`;
  return `${num(h / 24, 1)} days`;
}

const naive = (s) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10), +s.slice(11, 13) || 0, +s.slice(14, 16) || 0);

export function ago(ts) {
  if (!ts) return '';
  const mins = Math.round((naive(nowLocalInput()) - naive(ts)) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  if (mins < 1440) return `${Math.round(mins / 60)} h ago`;
  if (mins < 43200) return `${Math.round(mins / 1440)} days ago`;
  return date(ts);
}

// Default times follow the hospital's time zone (Settings), not the phone's, so a phone with a
// wrong time zone still records times the server accepts.
let hospitalTz = 'Asia/Kuala_Lumpur';
export function setHospitalTimeZone(tz) {
  if (tz) hospitalTz = tz;
}

export function nowLocalInput() {
  try {
    const parts = {};
    const fmt = new Intl.DateTimeFormat('en-GB', {
      timeZone: hospitalTz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    });
    for (const x of fmt.formatToParts(new Date())) parts[x.type] = x.value;
    return `${parts.year}-${parts.month}-${parts.day}T${parts.hour === '24' ? '00' : parts.hour}:${parts.minute}`;
  } catch {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  }
}

export function todayInput() {
  return nowLocalInput().slice(0, 10);
}

export const PERIODS = [
  ['this_month', 'This month'],
  ['last_month', 'Last month'],
  ['this_quarter', 'This quarter'],
  ['ytd', 'Year to date'],
  ['last_12_months', 'Last 12 months'],
  ['last_year', 'Last year'],
  ['custom', 'Custom range'],
];
