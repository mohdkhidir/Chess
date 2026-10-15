import { bad, clone, num, int, str, oneOf } from './util.js';

export const APPROVAL_TYPES = {
  ASSET_REGISTRATION: 'New asset registration',
  ASSET_TRANSFER: 'Asset transfer (department/location)',
  ASSET_DISPOSAL: 'Asset disposal / condemnation',
  PPM_DEFERRAL: 'PPM deferral',
  WO_COST: 'Repair cost (work order)',
};

export const DEFAULT_SETTINGS = {
  hospital_name: 'My Hospital',
  hospital_code: 'HOSP',
  hospital_address: '',
  state: '',
  currency: 'RM',
  timezone: 'Asia/Kuala_Lumpur',
  // Tokens: {HOSP} {CAT} {DEPT} {YYYY} {YY} {MM} {CLS} {SEQ3}..{SEQ8} ({SEQ} = 5 digits)
  tag_format: '{HOSP}/{CAT}/{YYYY}/{SEQ5}',
  capital_threshold: 2000,
  labour_rate: 50,
  ppm_grace_days: 0,
  ppm_horizon_months: 12,
  kpi_ppm_target: 95,
  kpi_cm_closure_target: 90,
  kpi_uptime_target: 95,
  response_target_hours: { P1: 1, P2: 4, P3: 24, P4: 72 },
  repair_target_days: { P1: 2, P2: 5, P3: 10, P4: 20 },
  approval_level_names: {
    1: 'Supervisor / Biomedical Engineer',
    2: 'Head of Department / Manager',
    3: 'Hospital Director',
  },
  approval_rules: {
    ASSET_REGISTRATION: 1,
    ASSET_TRANSFER: 1,
    ASSET_DISPOSAL: 2,
    PPM_DEFERRAL: 1,
  },
  wo_cost_level1_max: 5000,
  wo_cost_level2_max: 20000,
  allow_self_approval: false,
  replacement_cost_ratio: 50,
  inflation_rate: 3,
  pdm_risk_threshold: 55,
  pdm_horizon_days: 90,
  session_hours: 12,
};

export const PRIORITIES = ['P1', 'P2', 'P3', 'P4'];

export function getSettings(db) {
  const s = clone(DEFAULT_SETTINGS);
  for (const row of db.all('SELECT key, value FROM settings')) {
    if (!(row.key in DEFAULT_SETTINGS)) continue;
    try {
      const v = JSON.parse(row.value);
      const d = DEFAULT_SETTINGS[row.key];
      s[row.key] = d && typeof d === 'object' && !Array.isArray(d) ? { ...d, ...v } : v;
    } catch {
      /* keep default */
    }
  }
  return s;
}

const level = (v, name) => int(v, { min: 0, max: 3, name });

// Validates a partial settings object; unknown keys are rejected so typos surface.
export function validateSettings(patch) {
  const out = {};
  for (const [key, v] of Object.entries(patch || {})) {
    switch (key) {
      case 'hospital_name': out[key] = str(v, { required: true, max: 120, name: 'Hospital name' }); break;
      case 'hospital_code': {
        const code = str(v, { required: true, max: 12, name: 'Hospital code' }).toUpperCase();
        if (!/^[A-Z0-9-]+$/.test(code)) throw bad('Hospital code may only contain letters, digits and -');
        out[key] = code;
        break;
      }
      case 'hospital_address': out[key] = str(v, { max: 300, name: 'Address' }) || ''; break;
      case 'state': out[key] = str(v, { max: 60, name: 'State' }) || ''; break;
      case 'currency': out[key] = str(v, { required: true, max: 6, name: 'Currency' }); break;
      case 'timezone': {
        const tz = str(v, { required: true, max: 60, name: 'Time zone' });
        try {
          new Intl.DateTimeFormat('en-GB', { timeZone: tz });
        } catch {
          throw bad(`Unknown time zone: ${tz}`);
        }
        out[key] = tz;
        break;
      }
      case 'tag_format': {
        const f = str(v, { required: true, max: 80, name: 'Tag format' });
        if (!/\{SEQ[3-8]?\}/.test(f)) throw bad('Tag format must contain a running number token such as {SEQ5}');
        const unknown = (f.match(/\{[^}]*\}/g) || []).filter((t) => !/^\{(HOSP|CAT|DEPT|YYYY|YY|MM|CLS|SEQ[3-8]?)\}$/.test(t));
        if (unknown.length) throw bad(`Unknown tag token(s): ${unknown.join(', ')}`);
        out[key] = f;
        break;
      }
      case 'capital_threshold': out[key] = num(v, { min: 0, max: 1e9, name: 'Capital asset threshold' }); break;
      case 'labour_rate': out[key] = num(v, { min: 0, max: 10000, name: 'Labour rate' }); break;
      case 'ppm_grace_days': out[key] = int(v, { min: 0, max: 90, name: 'PPM grace days' }); break;
      case 'ppm_horizon_months': out[key] = int(v, { min: 1, max: 36, name: 'PPM planning horizon' }); break;
      case 'kpi_ppm_target':
      case 'kpi_cm_closure_target':
      case 'kpi_uptime_target':
        out[key] = num(v, { min: 0, max: 100, name: 'KPI target' });
        break;
      case 'response_target_hours':
      case 'repair_target_days': {
        const o = {};
        for (const p of PRIORITIES) o[p] = num(v?.[p], { min: 0, max: 10000, name: `${p} target`, required: true });
        out[key] = o;
        break;
      }
      case 'approval_level_names': {
        const o = {};
        for (const l of [1, 2, 3]) o[l] = str(v?.[l], { required: true, max: 60, name: `Level ${l} name` });
        out[key] = o;
        break;
      }
      case 'approval_rules': {
        const o = {};
        for (const t of ['ASSET_REGISTRATION', 'ASSET_TRANSFER', 'ASSET_DISPOSAL', 'PPM_DEFERRAL']) {
          o[t] = level(v?.[t] ?? DEFAULT_SETTINGS.approval_rules[t], `${t} approval level`);
        }
        out[key] = o;
        break;
      }
      case 'wo_cost_level1_max': out[key] = num(v, { min: 0, max: 1e9, name: 'Level 1 cost limit' }); break;
      case 'wo_cost_level2_max': out[key] = num(v, { min: 0, max: 1e9, name: 'Level 2 cost limit' }); break;
      case 'allow_self_approval': out[key] = !!v; break;
      case 'replacement_cost_ratio': out[key] = num(v, { min: 1, max: 500, name: 'Replacement cost ratio' }); break;
      case 'inflation_rate': out[key] = num(v, { min: 0, max: 50, name: 'Inflation rate' }); break;
      case 'pdm_risk_threshold': out[key] = num(v, { min: 1, max: 100, name: 'Risk threshold' }); break;
      case 'pdm_horizon_days': out[key] = int(oneOf(Number(v), [30, 60, 90, 180, 365], { name: 'Prediction horizon' })); break;
      case 'session_hours': out[key] = int(v, { min: 1, max: 720, name: 'Session length' }); break;
      default:
        throw bad(`Unknown setting: ${key}`);
    }
  }
  if (out.wo_cost_level1_max !== undefined && out.wo_cost_level2_max !== undefined && out.wo_cost_level2_max < out.wo_cost_level1_max) {
    throw bad('Level 2 cost limit must be greater than or equal to the Level 1 limit');
  }
  return out;
}

export function writeSettings(db, values) {
  for (const [k, v] of Object.entries(values)) {
    db.run(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      [k, JSON.stringify(v)],
    );
  }
}

// Approval level needed for a repair cost under the configured thresholds.
export function costApprovalLevel(settings, amount) {
  if (amount <= settings.wo_cost_level1_max) return 1;
  if (amount <= settings.wo_cost_level2_max) return 2;
  return 3;
}
