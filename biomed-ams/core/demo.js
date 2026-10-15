// Generates a realistic, clearly-labelled demo hospital so every screen has data to show.
// Dates are relative to "today", so the demo always looks current.
import { docNo, insert, update } from './db.js';
import { hashPassword } from './auth.js';
import { writeSettings } from './settings.js';
import { DEFAULT_CATEGORIES, DEFAULT_DEPARTMENTS, FAILURE_CAUSES } from './library.js';
import { seedLibrary } from './masterdata.js';
import { generateTag, assetClass } from './tagging.js';
import { addDays, addMonths, endOfMonth, fmtDate, fmtDateTime, parseDate, round, startOfMonth } from './util.js';
import { windowEnd } from './ppm.js';

const H = 3600000;
const D = 86400000;

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MODELS = {
  INF: [['B. Braun', 'Infusomat Space'], ['Fresenius Kabi', 'Agilia VP'], ['Terumo', 'TE-171'], ['Mindray', 'BeneFusion VP5']],
  SYR: [['B. Braun', 'Perfusor Space'], ['Terumo', 'TE-331'], ['Fresenius Kabi', 'Agilia SP']],
  MON: [['Philips', 'IntelliVue MX450'], ['Mindray', 'BeneVision N12'], ['GE Healthcare', 'CARESCAPE B450'], ['Nihon Kohden', 'Life Scope BSM-3500']],
  VEN: [['Hamilton Medical', 'HAMILTON-C3'], ['Dräger', 'Evita V500'], ['Mindray', 'SV800']],
  DEF: [['ZOLL', 'R Series'], ['Philips', 'HeartStart XL+'], ['Mindray', 'BeneHeart D6']],
  ECG: [['GE Healthcare', 'MAC 2000'], ['Schiller', 'CARDIOVIT AT-102 G2'], ['Nihon Kohden', 'ECG-2350']],
  ESU: [['Medtronic', 'Valleylab FT10'], ['Erbe', 'VIO 3']],
  ANA: [['GE Healthcare', 'Aisys CS2'], ['Dräger', 'Fabius plus'], ['Mindray', 'WATO EX-65 Pro']],
  SUC: [['Medela', 'Basic 30'], ['ATMOS', 'C 341']],
  USG: [['GE Healthcare', 'LOGIQ E10'], ['Philips', 'Affiniti 50'], ['Mindray', 'Resona 7']],
  XRM: [['Shimadzu', 'MobileDaRt Evolution MX8'], ['Siemens Healthineers', 'Mobilett Mira Max'], ['Fujifilm', 'FDR Go PLUS']],
  INC: [['Dräger', 'Isolette 8000 plus'], ['GE Healthcare', 'Giraffe Incubator'], ['Atom Medical', 'Incu i']],
  PHO: [['Natus', 'neoBLUE'], ['GE Healthcare', 'Lullaby LED']],
  DIA: [['Fresenius Medical Care', '4008S'], ['Nipro', 'Surdial X'], ['B. Braun', 'Dialog+']],
  AUT: [['Getinge', 'HS66'], ['Steelco', 'VS 1']],
  CEN: [['Eppendorf', '5810 R'], ['Hettich', 'Rotina 380 R']],
  SPO: [['Masimo', 'Rad-97'], ['Medtronic', 'Nellcor PM10N']],
  BPM: [['Welch Allyn', 'Connex Spot Monitor'], ['Omron', 'HBP-1320']],
  BWM: [['3M', 'Ranger 245'], ['Smiths Medical', 'Level 1 H-1200']],
  OTL: [['Getinge', 'Maquet PowerLED II'], ['Dräger', 'Polaris 600']],
  OTT: [['Getinge', 'Maquet Alphamaxx'], ['STERIS', 'CMAX']],
};

// [cost min, cost max, breakdowns per year]
const PROFILE = {
  INF: [6000, 9000, 0.6], SYR: [5000, 8000, 0.5], MON: [15000, 40000, 0.4], VEN: [80000, 150000, 0.7],
  DEF: [25000, 45000, 0.3], ECG: [8000, 20000, 0.3], ESU: [40000, 70000, 0.4], ANA: [150000, 250000, 0.5],
  SUC: [2000, 5000, 0.6], USG: [120000, 300000, 0.3], XRM: [250000, 450000, 0.5], INC: [30000, 60000, 0.5],
  PHO: [10000, 20000, 0.3], DIA: [50000, 80000, 0.9], AUT: [80000, 200000, 0.8], CEN: [10000, 30000, 0.3],
  SPO: [1500, 4000, 0.4], BPM: [2500, 6000, 0.4], BWM: [8000, 15000, 0.3], OTL: [60000, 120000, 0.2], OTT: [80000, 150000, 0.2],
};

const PARTS = {
  INF: [['Pressure sensor assembly', 450], ['Door latch assembly', 280], ['Battery pack', 380], ['Main PCB', 1900]],
  SYR: [['Plunger clamp assembly', 300], ['Battery pack', 350], ['Drive motor', 900]],
  MON: [['SpO2 sensor', 650], ['NIBP cuff and hose', 180], ['ECG trunk cable', 420], ['Battery', 520], ['Display panel', 2800]],
  VEN: [['Flow sensor', 950], ['O2 cell', 780], ['Exhalation valve', 1200], ['Blower assembly', 6800]],
  DEF: [['Battery', 1600], ['Therapy cable', 2200], ['Recorder module', 1400]],
  ECG: [['Patient cable', 650], ['Thermal print head', 1300]],
  ESU: [['Footswitch', 1100], ['Power module', 4800], ['REM cable', 450]],
  ANA: [['O2 sensor', 750], ['Bellows', 1800], ['Flow sensor', 1100]],
  SUC: [['Vacuum gauge', 220], ['Regulator', 380]],
  USG: [['Convex transducer', 18500], ['Trackball', 900], ['Power supply board', 5200]],
  XRM: [['High-voltage cable', 6500], ['Collimator lamp', 450], ['Drive battery set', 9800]],
  INC: [['Skin temperature probe', 650], ['Heater element', 1400], ['Fan motor', 800], ['Door gasket', 260]],
  PHO: [['LED module', 2400], ['Cooling fan', 300]],
  DIA: [['Conductivity cell', 1600], ['Blood pump segment', 900], ['Air detector', 2100], ['Heater rod', 750]],
  AUT: [['Door gasket', 1200], ['Steam trap', 850], ['Pressure transducer', 2300], ['Solenoid valve', 980]],
  CEN: [['Lid lock', 650], ['Motor brushes', 320]],
  SPO: [['SpO2 sensor', 550], ['Battery', 180]],
  BPM: [['Cuff and hose', 150], ['Pump assembly', 600]],
  BWM: [['Temperature sensor', 450], ['Heating plate', 1200]],
  OTL: [['LED module', 3800], ['Handle sensor', 600]],
  OTT: [['Hydraulic pump', 4200], ['Hand control', 1600]],
};

const PROBLEMS = {
  INF: ['Occlusion alarm keeps sounding', 'Pump does not power on', 'Door cannot close properly', 'Flow rate appears inaccurate'],
  SYR: ['Syringe not detected', 'Occlusion alarm during infusion', 'Battery drains quickly'],
  MON: ['NIBP not taking readings', 'SpO2 shows no signal', 'Screen goes blank intermittently', 'ECG trace very noisy'],
  VEN: ['Persistent high-pressure alarm', 'Failed pre-use self-test', 'O2 sensor error message'],
  DEF: ['Failed daily user check', 'Battery low message although charged', 'Unit not charging to selected energy'],
  ECG: ['Printout faint', 'Lead-off message with new electrodes'],
  ESU: ['Return electrode alarm during surgery', 'No output on monopolar cut'],
  ANA: ['Leak test failed', 'O2 sensor reading low', 'Ventilator bellows not rising'],
  SUC: ['Weak suction', 'Unit very noisy'],
  USG: ['Image has lines / dropouts', 'System freezes on start-up'],
  XRM: ['Exposure error code', 'Unit cannot be driven'],
  INC: ['Temperature not reaching set point', 'Fan alarm', 'Door seal damaged'],
  PHO: ['Several LEDs not lighting', 'Overheating warning'],
  DIA: ['Conductivity alarm', 'Blood leak alarm without leak', 'Temperature fluctuating'],
  AUT: ['Bowie-Dick test failed', 'Door seal leaking steam', 'Cycle aborted mid-way'],
  CEN: ['Lid will not unlock', 'Imbalance error at low load'],
  SPO: ['Readings unstable', 'Probe connector loose'],
  BPM: ['Readings inconsistent', 'Cuff does not inflate'],
  BWM: ['Over-temperature alarm', 'Slow to warm'],
  OTL: ['Light flickering', 'Arm drifts out of position'],
  OTT: ['Table will not tilt', 'Hand control unresponsive'],
};

const ACTIONS = {
  'Wear and tear': 'Replaced worn component; performance and safety test passed',
  'Component failure': 'Diagnosed failed component, replaced and verified performance',
  'Accessory / probe damage': 'Replaced damaged accessory; verified with simulator',
  'Battery failure': 'Replaced battery; verified operation on battery',
  'Power supply issue': 'Repaired power supply / mains inlet; electrical safety test passed',
  'Software / firmware': 'Updated firmware and restored configuration; functional check passed',
  'User error / mishandling': 'No defect after reset; user briefed on correct operation',
  'Physical damage / dropped': 'Replaced damaged housing parts; full performance and safety test',
  'Liquid spill / environmental': 'Cleaned and dried internal boards, replaced corroded part',
  'Calibration drift': 'Recalibrated against reference analyser',
  'No fault found': 'No fault found after extended testing; returned to user',
  Other: 'Rectified and tested',
};

const CAUSE_WEIGHTS = [
  ['Wear and tear', 20], ['Component failure', 18], ['Accessory / probe damage', 15], ['Battery failure', 10],
  ['Power supply issue', 6], ['Software / firmware', 5], ['User error / mishandling', 10], ['Physical damage / dropped', 6],
  ['Liquid spill / environmental', 3], ['Calibration drift', 4], ['No fault found', 3],
];

// department code -> [category code, count]
const FLEET = {
  ETD: [['MON', 4], ['DEF', 2], ['VEN', 2], ['INF', 4], ['SUC', 3], ['ECG', 1], ['SPO', 2]],
  ICU: [['MON', 8], ['VEN', 6], ['INF', 8], ['SYR', 6], ['DEF', 1], ['SUC', 4], ['BWM', 1]],
  OT: [['ANA', 4], ['ESU', 3], ['MON', 4], ['OTL', 3], ['OTT', 3], ['SUC', 3], ['DEF', 1], ['BWM', 2]],
  RAD: [['XRM', 3], ['USG', 2]],
  PATH: [['CEN', 4]],
  MW: [['INF', 6], ['MON', 3], ['SUC', 2], ['ECG', 1], ['BPM', 4], ['SPO', 2], ['DEF', 1]],
  SW: [['INF', 4], ['MON', 2], ['SUC', 2], ['BPM', 3], ['SPO', 2]],
  PAED: [['INF', 3], ['SYR', 3], ['MON', 2], ['PHO', 2]],
  NICU: [['INC', 5], ['PHO', 3], ['VEN', 2], ['SYR', 4], ['MON', 3]],
  OG: [['MON', 2], ['INC', 1], ['SUC', 2], ['USG', 1], ['DEF', 1]],
  HD: [['DIA', 8]],
  CSSU: [['AUT', 3]],
  SOPD: [['ECG', 2], ['BPM', 3], ['USG', 1]],
  REHAB: [['BPM', 1]],
  BME: [['INF', 2], ['MON', 1]],
};

const LOCATIONS = {
  ETD: [['ETD-RESUS', 'ETD Resuscitation Zone', 'A', '1'], ['ETD-YZ', 'ETD Yellow Zone', 'A', '1']],
  ICU: [['ICU-B1', 'ICU Bay 1', 'B', '3'], ['ICU-B2', 'ICU Bay 2', 'B', '3']],
  OT: [['OT-1', 'Operating Theatre 1', 'C', '2'], ['OT-2', 'Operating Theatre 2', 'C', '2'], ['OT-REC', 'OT Recovery', 'C', '2']],
  RAD: [['RAD-XR', 'General X-Ray Room', 'A', 'G'], ['RAD-US', 'Ultrasound Room', 'A', 'G']],
  PATH: [['LAB-CHEM', 'Chemical Pathology Lab', 'D', '1']],
  MW: [['MW-5A', 'Medical Ward 5A', 'E', '5'], ['MW-5B', 'Medical Ward 5B', 'E', '5']],
  SW: [['SW-6A', 'Surgical Ward 6A', 'E', '6']],
  PAED: [['PAED-7A', 'Paediatric Ward 7A', 'E', '7']],
  NICU: [['NICU-1', 'NICU Main Nursery', 'B', '4']],
  OG: [['OG-LR', 'Labour Room', 'B', '2']],
  HD: [['HD-UNIT', 'Haemodialysis Unit', 'D', 'G']],
  CSSU: [['CSSU-STER', 'CSSU Sterilisation Area', 'D', 'LG']],
  SOPD: [['SOPD-CLIN', 'Specialist Clinic Suite', 'F', '1']],
  REHAB: [['REHAB-GYM', 'Physiotherapy Gym', 'F', 'G']],
  BME: [['BME-WS', 'Biomedical Workshop', 'D', 'LG'], ['BME-STORE', 'Biomedical Equipment Store', 'D', 'LG']],
};

const VENDORS = [
  ['Demo Medik Supplies Sdn Bhd', 'Supplier'],
  ['Demo Biomedical Services Sdn Bhd', 'Service Contractor'],
  ['Demo Imaging Care Sdn Bhd', 'Service Contractor'],
  ['Demo Renal Tech Sdn Bhd', 'Service Contractor'],
  ['Demo Healthcare Distributors Sdn Bhd', 'Authorised Representative'],
  ['Demo Sterile Systems Sdn Bhd', 'Service Contractor'],
];

const USERS = [
  ['admin', 'Siti Aminah binti Hassan', 'ADMIN', 3, 'BME', 'System Administrator'],
  ['director', 'Dr. Kamal Ariffin', 'MANAGER', 3, null, 'Hospital Director'],
  ['manager', 'Ir. Lim Wei Jie', 'MANAGER', 2, 'BME', 'Head of Biomedical Engineering'],
  ['engineer', 'Nurul Huda binti Zakaria', 'ENGINEER', 1, 'BME', 'Biomedical Engineer'],
  ['tech1', 'Ahmad Faizal bin Rahman', 'TECHNICIAN', 0, 'BME', 'Assistant Engineer (Biomedical)'],
  ['tech2', 'Rajesh Kumar a/l Muthu', 'TECHNICIAN', 0, 'BME', 'Biomedical Technician'],
  ['nurse', 'Tan Mei Ling', 'REQUESTER', 0, 'ICU', 'Nursing Sister, ICU'],
  ['nurse.etd', 'Farah Nadia binti Osman', 'REQUESTER', 0, 'ETD', 'Staff Nurse, ETD'],
  ['auditor', 'Wong Kar Yee', 'VIEWER', 0, 'BME', 'Quality Officer'],
];

export const DEMO_PASSWORD = 'demo1234';

export async function loadDemo(ctx) {
  const db = ctx.db;
  const r = rng(20260101);
  const pick = (arr) => arr[Math.floor(r() * arr.length)];
  const between = (a, b) => a + (b - a) * r();
  const chance = (p) => r() < p;
  const nowTs = ctx.now();
  const now = parseDate(nowTs);
  const today = nowTs.slice(0, 10);
  const ts = (ms) => fmtDateTime(Math.min(ms, now));
  const weighted = (pairs) => {
    const total = pairs.reduce((s, [, w]) => s + w, 0);
    let x = r() * total;
    for (const [v, w] of pairs) {
      x -= w;
      if (x <= 0) return v;
    }
    return pairs[0][0];
  };

  writeSettings(db, {
    hospital_name: 'Hospital Demo Sejahtera',
    hospital_code: 'HDS',
    state: 'Selangor',
    hospital_address: 'Jalan Demo 1, 40000 Shah Alam, Selangor (fictional)',
  });
  ctx.invalidateSettings();
  seedLibrary(db, { departments: DEFAULT_DEPARTMENTS, categories: DEFAULT_CATEGORIES });

  const dept = Object.fromEntries(db.all('SELECT * FROM departments').map((d) => [d.code, d]));
  const cats = Object.fromEntries(db.all('SELECT * FROM categories').map((c) => [c.code, c]));
  const locs = {};
  for (const [code, list] of Object.entries(LOCATIONS)) {
    locs[code] = list.map(([lc, name, block, floor]) =>
      insert(db, 'locations', { code: lc, name, block, floor, department_id: dept[code].id, active: 1 }));
  }
  const vendorIds = VENDORS.map(([name, type]) =>
    insert(db, 'vendors', { name, type, contact_person: 'Customer Service', phone: '03-0000 0000', email: 'service@example.com', active: 1 }));
  const [vSupply, vBio, vImaging, vRenal, vDistrib, vSterile] = vendorIds;

  const users = {};
  for (const [username, name, role, level, deptCode, designation] of USERS) {
    users[username] = insert(db, 'users', {
      username,
      full_name: name,
      role,
      approval_level: level,
      department_id: deptCode ? dept[deptCode].id : null,
      designation,
      email: `${username.replace('.', '')}@example.com`,
      phone: '012-000 0000',
      status: 'ACTIVE',
      password_hash: await hashPassword(DEMO_PASSWORD, ctx.env.hashIterations),
      created_at: fmtDateTime(now - 1100 * D),
    });
  }
  insert(db, 'users', {
    username: 'hafiz.ot',
    full_name: 'Mohd Hafiz bin Ismail',
    role: 'REQUESTER',
    approval_level: 0,
    department_id: dept.OT.id,
    designation: 'Staff Nurse, OT',
    status: 'PENDING',
    password_hash: await hashPassword(DEMO_PASSWORD, ctx.env.hashIterations),
    created_at: fmtDateTime(now - 2 * D),
  });
  const techs = [users.tech1, users.tech2];
  const asUser = (uid, fn) => {
    const saved = ctx.user;
    ctx.user = { id: uid };
    try {
      return fn();
    } finally {
      ctx.user = saved;
    }
  };

  // ---------- assets ----------
  const assets = [];
  const serviceVendor = { XRM: vImaging, USG: vImaging, DIA: vRenal, AUT: vSterile };
  for (const [deptCode, list] of Object.entries(FLEET)) {
    for (const [catCode, count] of list) {
      for (let i = 0; i < count; i++) {
        const cat = cats[catCode];
        const [lo, hi, rate] = PROFILE[catCode];
        const [manufacturer, model] = pick(MODELS[catCode]);
        const ageYears = Math.pow(r(), 1.15) * Math.min(cat.lifespan_years * 1.25, 14) + 0.3;
        const purchase = fmtDate(now - ageYears * 365.25 * D);
        const commissioning = addDays(purchase, Math.floor(between(7, 45)));
        if (commissioning > today) continue;
        const cost = Math.round(between(lo, hi) / 10) * 10;
        const settings = ctx.settings;
        const tag = generateTag(db, settings, { categoryCode: catCode, departmentCode: deptCode, date: commissioning, cost });
        const created = `${commissioning} ${String(8 + Math.floor(r() * 8)).padStart(2, '0')}:${String(Math.floor(r() * 60)).padStart(2, '0')}:00`;
        const status = deptCode === 'BME' ? 'STANDBY' : 'ACTIVE';
        const id = insert(db, 'assets', {
          tag_no: tag,
          name: cat.name,
          category_id: cat.id,
          manufacturer,
          model,
          serial_no: `${manufacturer.replace(/[^A-Z]/g, '').slice(0, 2) || 'SN'}${Math.floor(between(1000000, 9999999))}`,
          department_id: dept[deptCode].id,
          location_id: pick(locs[deptCode]),
          supplier_id: chance(0.6) ? vSupply : vDistrib,
          service_vendor_id: serviceVendor[catCode] || null,
          purchase_date: purchase,
          commissioning_date: commissioning,
          warranty_end: addMonths(commissioning, pick([12, 24, 36, 60])),
          purchase_cost: cost,
          po_no: `PO-${purchase.slice(0, 4)}-${String(Math.floor(between(100, 9999))).padStart(4, '0')}`,
          funding: weighted([['Government', 80], ['Development fund', 12], ['Donation', 8]]),
          mda_reg_no: `G${cat.risk_class}${Math.floor(between(10000000, 99999999))}-${Math.floor(between(10000, 99999))}`,
          risk_class: cat.risk_class,
          criticality: cat.criticality,
          lifespan_years: null,
          salvage_value: 0,
          ppm_required: 1,
          asset_class: assetClass(settings, cost),
          status,
          created_by: users.engineer,
          created_at: created,
        });
        asUser(users.engineer, () => ctx.event(id, 'REGISTERED', `Registered with tag ${tag}`, null, null, created));
        assets.push({
          id, tag, catCode, cat, deptCode, cost, commissioning, created, status,
          rate: rate * (chance(0.08) ? 3 : 1) * (ageYears / cat.lifespan_years > 0.8 ? 1.6 : 1),
          tech: pick(techs),
          vendor: serviceVendor[catCode] || null,
        });
      }
    }
  }

  // ---------- PPM plans and history ----------
  const histStart = startOfMonth(addMonths(today, -24));
  const horizonEnd = endOfMonth(addMonths(today, ctx.settings.ppm_horizon_months));
  const schedules = [];
  for (const a of assets) {
    const freq = a.cat.ppm_frequency_months;
    const start = addMonths(a.commissioning, freq);
    const planId = insert(db, 'ppm_plans', {
      asset_id: a.id,
      frequency_months: freq,
      start_date: start,
      checklist: a.cat.checklist,
      est_required: 1,
      performed_by: a.vendor ? 'VENDOR' : 'IN_HOUSE',
      vendor_id: a.vendor,
      assigned_to: a.tech,
      estimated_hours: a.vendor ? 3 : 1,
      active: 1,
      created_at: a.created,
    });
    a.planId = planId;
    for (let k = 0; k < 500; k++) {
      const d = addMonths(start, k * freq);
      if (d > horizonEnd) break;
      if (d < histStart) continue;
      schedules.push({ a, planId, date: d });
    }
  }
  schedules.sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : x.a.id - y.a.id));
  const checklistFor = (a) => JSON.parse(a.cat.checklist);
  const cmQueue = [];
  for (const s of schedules) {
    const end = windowEnd({ type: 'PPM', scheduled_date: s.date }, 0);
    const monthsAgo = (now - parseDate(end)) / (30 * D);
    let status = 'SCHEDULED';
    let completed = null;
    if (end < today) {
      const overdueP = monthsAgo < 3 ? 0.09 : 0.015;
      const x = r();
      if (x < overdueP) status = 'SCHEDULED';
      else if (x < overdueP + 0.06) {
        status = 'COMPLETED';
        completed = addDays(end, Math.floor(between(3, 40)));
        if (completed > today) completed = today;
      } else {
        status = 'COMPLETED';
        const from = parseDate(startOfMonth(s.date));
        completed = fmtDate(between(from, Math.min(parseDate(end), now - D)));
      }
    } else if (s.date <= endOfMonth(today) && s.date >= startOfMonth(today) && chance(0.5)) {
      status = 'COMPLETED';
      const from = parseDate(startOfMonth(today));
      completed = fmtDate(between(from, now - 0.2 * D));
      if (completed < startOfMonth(today)) completed = startOfMonth(today);
    }
    const ppmNo = docNo(db, 'PPM', s.date);
    const row = {
      ppm_no: ppmNo,
      plan_id: s.planId,
      asset_id: s.a.id,
      type: 'PPM',
      scheduled_date: s.date,
      status,
      assigned_to: s.a.tech,
      created_at: s.a.created > `${histStart} 00:00:00` ? s.a.created : `${addDays(s.date, -60)} 08:00:00`,
    };
    if (status === 'COMPLETED') {
      const fail = chance(0.04);
      const items = checklistFor(s.a);
      const failIdx = fail ? Math.floor(r() * items.length) : -1;
      const hours = round(between(0.5, s.a.vendor ? 4 : 2.5), 1);
      Object.assign(row, {
        completed_date: completed,
        started_at: `${completed} 09:00:00`,
        performed_by: s.a.tech,
        vendor_name: s.a.vendor ? VENDORS[vendorIds.indexOf(s.a.vendor)][0] : null,
        checklist_results: JSON.stringify(items.map((item, i) => ({ item, result: i === failIdx ? 'FAIL' : 'PASS', remark: i === failIdx ? 'Out of tolerance' : null }))),
        est_result: 'PASS',
        est_readings: JSON.stringify({ earth_resistance: round(between(0.04, 0.25), 2), equipment_leakage: Math.round(between(15, 180)) }),
        overall_result: fail ? 'FAIL' : 'PASS',
        labour_hours: hours,
        labour_cost: round(hours * ctx.settings.labour_rate),
        parts_cost: chance(0.1) ? Math.round(between(50, 600)) : 0,
        vendor_cost: s.a.vendor ? Math.round(between(400, 2500)) : 0,
        remarks: fail ? `Failed: ${items[failIdx]}` : null,
        updated_at: `${completed} 16:00:00`,
      });
    }
    const sid = insert(db, 'ppm_schedules', row);
    if (status === 'COMPLETED') {
      asUser(s.a.tech, () => ctx.event(s.a.id, 'PPM_COMPLETED', `PPM ${ppmNo} completed — ${row.overall_result}`, 'ppm_schedules', sid, `${completed} 16:00:00`));
      if (row.overall_result === 'FAIL') {
        cmQueue.push({ a: s.a, at: parseDate(`${completed} 16:30:00`), source: 'PPM', ppmId: sid, problem: `PPM ${ppmNo} failed: ${row.remarks.replace('Failed: ', '')}` });
      }
    }
  }

  // ---------- breakdowns ----------
  const windowStart = parseDate(addMonths(today, -36));
  for (const a of assets) {
    let t = Math.max(windowStart, parseDate(a.commissioning) + 20 * D);
    for (let guard = 0; guard < 60; guard++) {
      t += (-Math.log(1 - r()) * 365.25 * D) / a.rate;
      if (t >= now - 2 * H) break;
      const hour = 7 + Math.floor(r() * 15);
      const at = parseDate(fmtDate(t)) + hour * H + Math.floor(r() * 60) * 60000;
      if (at >= now - H) break;
      cmQueue.push({ a, at, source: chance(0.72) ? 'HELPDESK' : 'DIRECT', problem: pick(PROBLEMS[a.catCode]) });
    }
  }
  cmQueue.sort((x, y) => x.at - y.at);
  const requesterFor = (code) => (code === 'ETD' ? users['nurse.etd'] : code === 'ICU' ? users.nurse : pick([users.nurse, users['nurse.etd']]));
  for (const f of cmQueue) {
    const a = f.a;
    const crit = a.cat.criticality;
    const priority = crit === 'High' ? weighted([['P1', 15], ['P2', 50], ['P3', 35]]) : crit === 'Medium' ? weighted([['P2', 30], ['P3', 60], ['P4', 10]]) : weighted([['P3', 70], ['P4', 30]]);
    const respTarget = ctx.settings.response_target_hours[priority];
    const reported = f.at;
    const ageDays = (now - reported) / D;
    const response = reported + respTarget * H * (chance(0.88) ? between(0.1, 0.95) : between(1.1, 3));
    const waitParts = chance(0.15);
    const repairDays = waitParts ? between(6, 28) : Math.pow(r(), 2) * 4 + 0.1;
    const completedAt = response + repairDays * D;
    const cause = f.source === 'PPM' ? weighted([['Wear and tear', 3], ['Component failure', 3], ['Calibration drift', 4]]) : weighted(CAUSE_WEIGHTS);
    const result = cause === 'No fault found' ? 'NO_FAULT_FOUND' : weighted([['REPAIRED', 90], ['REFERRED', 6], ['PARTIAL', 2]]);
    let status;
    if (completedAt > now) {
      status = response > now ? (chance(0.5) ? 'OPEN' : 'ASSIGNED') : waitParts ? 'ON_HOLD' : 'IN_PROGRESS';
    } else if (ageDays < 6 && chance(0.6)) status = 'COMPLETED';
    else status = 'CLOSED';
    const done = ['COMPLETED', 'CLOSED'].includes(status);
    const assigned = status === 'OPEN' ? null : a.tech;
    const parts = [];
    if (done && result !== 'NO_FAULT_FOUND' && cause !== 'User error / mishandling' && chance(0.6)) {
      const [desc, unit] = pick(PARTS[a.catCode]);
      parts.push({ part_no: `P-${Math.floor(between(10000, 99999))}`, description: desc, qty: 1, unit_cost: Math.round(unit * between(0.9, 1.15)) });
    }
    const hours = done ? round(between(0.5, 6), 1) : 0;
    const vendorCost = done && (result === 'REFERRED' || (a.vendor && chance(0.4))) ? Math.round(between(500, Math.min(9000, a.cost * 0.08))) : 0;
    const woNo = docNo(db, 'CM', fmtDateTime(reported));
    const equipmentDown = f.source === 'PPM' ? 1 : chance(0.85) ? 1 : 0;
    const woId = insert(db, 'work_orders', {
      wo_no: woNo,
      asset_id: a.id,
      source: f.source,
      priority,
      problem: f.problem,
      equipment_down: equipmentDown,
      reported_at: ts(reported),
      assigned_to: assigned,
      assigned_at: assigned ? ts(reported + 0.3 * (response - reported)) : null,
      response_at: response <= now && status !== 'OPEN' && status !== 'ASSIGNED' ? ts(response) : null,
      completed_at: done ? ts(completedAt) : null,
      closed_at: status === 'CLOSED' ? ts(completedAt + between(0.2, 3) * D) : null,
      closed_by: status === 'CLOSED' ? users.engineer : null,
      status,
      hold_reason: status === 'ON_HOLD' ? 'Awaiting spare part from supplier' : null,
      failure_cause: done ? cause : null,
      action_taken: done ? ACTIONS[cause] : null,
      result: done ? result : null,
      labour_hours: hours,
      labour_cost: round(hours * ctx.settings.labour_rate),
      parts_cost: round(parts.reduce((s, p) => s + p.qty * p.unit_cost, 0)),
      vendor_cost: vendorCost,
      downtime_start: equipmentDown ? ts(reported) : null,
      downtime_end: equipmentDown && done ? ts(completedAt) : null,
      created_by: f.source === 'HELPDESK' ? users.engineer : a.tech,
      created_at: ts(reported),
    });
    for (const p of parts) insert(db, 'wo_parts', { work_order_id: woId, ...p });
    const logs = [['CREATED', null, reported, users.engineer]];
    if (assigned) logs.push(['ASSIGNED', `Assigned to ${USERS.find((u) => users[u[0]] === assigned)[1]}`, reported + 0.3 * (response - reported), users.engineer]);
    if (response <= now && !['OPEN', 'ASSIGNED'].includes(status)) logs.push(['STARTED', 'Technician attended and started work', response, assigned]);
    if (waitParts && (status === 'ON_HOLD' || done)) logs.push(['ON_HOLD', 'Awaiting spare part from supplier', response + 0.5 * D, assigned]);
    if (waitParts && done) logs.push(['RESUMED', 'Part received', completedAt - 0.4 * D, assigned]);
    if (done) logs.push(['COMPLETED', ACTIONS[cause], completedAt, assigned]);
    if (status === 'CLOSED') logs.push(['CLOSED', 'Verified and closed', completedAt + 0.5 * D, users.engineer]);
    for (const [action, note, at, uid] of logs) {
      if (at <= now) insert(db, 'wo_logs', { work_order_id: woId, user_id: uid, action, note, created_at: ts(at) });
    }
    asUser(users.engineer, () => ctx.event(a.id, 'CM_OPENED', `${woNo} opened (${priority}): ${f.problem}`, 'work_orders', woId, ts(reported)));
    if (done) asUser(assigned, () => ctx.event(a.id, 'CM_COMPLETED', `${woNo} completed — ${result.replace(/_/g, ' ').toLowerCase()}`, 'work_orders', woId, ts(completedAt)));
    if (f.ppmId) update(db, 'ppm_schedules', f.ppmId, { followup_wo_id: woId });

    if (f.source === 'HELPDESK') {
      const reporter = requesterFor(a.deptCode);
      const tStatus = status === 'CLOSED' ? (ageDays > 10 || chance(0.7) ? 'CLOSED' : 'RESOLVED') : status === 'COMPLETED' ? 'RESOLVED' : 'ASSIGNED';
      const ticketNo = docNo(db, 'HD', fmtDateTime(reported));
      const tid = insert(db, 'tickets', {
        ticket_no: ticketNo,
        asset_id: a.id,
        department_id: dept[a.deptCode].id,
        location_text: null,
        category: f.problem.toLowerCase().includes('damage') ? 'DAMAGE' : 'BREAKDOWN',
        priority,
        subject: f.problem,
        description: `${a.cat.name} ${a.tag} — reported by ward`,
        reporter_id: reporter,
        contact_name: USERS.find((u) => users[u[0]] === reporter)[1],
        contact_phone: 'Ext. 2101',
        status: tStatus,
        work_order_id: woId,
        created_at: ts(reported - 5 * 60000),
        acknowledged_at: ts(reported),
        resolved_at: done ? ts(completedAt) : null,
        closed_at: tStatus === 'CLOSED' ? ts(completedAt + between(0.3, 2) * D) : null,
        rating: tStatus === 'CLOSED' ? weighted([[5, 55], [4, 35], [3, 8], [2, 2]]) : null,
      });
      update(db, 'work_orders', woId, { ticket_id: tid });
    }
  }

  // open breakdowns -> asset status
  db.run(
    `UPDATE assets SET status = 'BREAKDOWN' WHERE status IN ('ACTIVE','STANDBY') AND id IN
     (SELECT asset_id FROM work_orders WHERE equipment_down = 1 AND status IN ('OPEN','ASSIGNED','IN_PROGRESS','ON_HOLD'))`,
  );

  // ---------- new helpdesk tickets waiting for triage ----------
  const icuMon = assets.find((a) => a.deptCode === 'ICU' && a.catCode === 'MON');
  const mwInf = assets.find((a) => a.deptCode === 'MW' && a.catCode === 'INF');
  for (const [a, subject, prio, reporter, minsAgo] of [
    [icuMon, 'Monitor alarm volume very low', 'P2', users.nurse, 35],
    [mwInf, 'Infusion pump shows Error 23', 'P3', users['nurse.etd'], 80],
    [null, 'Request training on new syringe pumps', 'P4', users.nurse, 240],
  ]) {
    const at = ts(now - minsAgo * 60000);
    insert(db, 'tickets', {
      ticket_no: docNo(db, 'HD', at),
      asset_id: a ? a.id : null,
      department_id: a ? dept[a.deptCode].id : dept.ICU.id,
      category: a ? 'MALFUNCTION' : 'TRAINING',
      priority: prio,
      subject,
      description: a ? `Tag ${a.tag}` : 'Ward staff need refresher training',
      reporter_id: reporter,
      contact_name: USERS.find((u) => users[u[0]] === reporter)[1],
      contact_phone: 'Ext. 3302',
      status: 'NEW',
      created_at: at,
    });
  }

  // ---------- approvals ----------
  const approval = (type, refId, title, level, requestedBy, at, extra = {}) =>
    insert(db, 'approvals', {
      type,
      ref_id: refId,
      title,
      required_level: level,
      current_level: 1,
      status: 'PENDING',
      requested_by: requestedBy,
      requested_at: at,
      ...extra,
    });
  const step = (approvalId, level, approver, decision, remarks, at) =>
    insert(db, 'approval_steps', { approval_id: approvalId, level, approver_id: approver, decision, remarks, decided_at: at });

  // history: registrations in the last year were approved by the engineer
  for (const a of assets.filter((x) => x.created > fmtDateTime(now - 365 * D))) {
    const decided = ts(parseDate(a.created) + between(2, 30) * H);
    const ap = approval('ASSET_REGISTRATION', a.id, `Register ${a.cat.name} (${a.tag})`, 1, a.tech, a.created, { status: 'APPROVED', current_level: 1, decided_at: decided, amount: a.cost });
    step(ap, 1, users.engineer, 'APPROVED', null, decided);
    asUser(users.engineer, () => ctx.event(a.id, 'APPROVED', 'Registration approved — asset is now in service', 'approvals', ap, decided));
  }

  // pending: two new infusion pumps registered by a technician
  const pendingAssets = [];
  for (let i = 0; i < 2; i++) {
    const cat = cats.INF;
    const tag = generateTag(db, ctx.settings, { categoryCode: 'INF', departmentCode: 'MW', date: today, cost: 7800 });
    const created = ts(now - (2 - i) * 5 * H);
    const id = insert(db, 'assets', {
      tag_no: tag, name: cat.name, category_id: cat.id, manufacturer: 'B. Braun', model: 'Infusomat Space',
      serial_no: `BB${Math.floor(between(1000000, 9999999))}`, department_id: dept.MW.id, location_id: locs.MW[0],
      supplier_id: vSupply, purchase_date: addDays(today, -20), commissioning_date: addDays(today, -3),
      warranty_end: addMonths(today, 24), purchase_cost: 7800, po_no: `PO-${today.slice(0, 4)}-0412`, funding: 'Government',
      risk_class: 'C', criticality: 'High', ppm_required: 1, asset_class: assetClass(ctx.settings, 7800), status: 'PENDING',
      created_by: users.tech1, created_at: created,
    });
    insert(db, 'ppm_plans', {
      asset_id: id, frequency_months: 12, start_date: addMonths(addDays(today, -3), 12), checklist: cat.checklist,
      est_required: 1, performed_by: 'IN_HOUSE', assigned_to: users.tech1, estimated_hours: 1, active: 1, created_at: created,
    });
    asUser(users.tech1, () => ctx.event(id, 'REGISTERED', `Registered with tag ${tag}`, null, null, created));
    approval('ASSET_REGISTRATION', id, `Register ${cat.name} (${tag})`, 1, users.tech1, created, { amount: 7800, payload: JSON.stringify({ initial_status: 'ACTIVE' }) });
    pendingAssets.push(id);
  }

  // pending: transfer of a surgical-ward monitor to the medical ward
  const swMon = assets.find((a) => a.deptCode === 'SW' && a.catCode === 'MON');
  if (swMon) {
    const at = ts(now - 26 * H);
    const ap = approval('ASSET_TRANSFER', swMon.id, `Transfer ${swMon.tag} to ${dept.MW.name}`, 1, users.tech2, at, {
      payload: JSON.stringify({ department_id: dept.MW.id, location_id: locs.MW[1], reason: 'Medical Ward 5B needs extra monitoring during bed expansion' }),
    });
    asUser(users.tech2, () => ctx.event(swMon.id, 'TRANSFER_REQUESTED', `Transfer to ${dept.MW.name} requested`, 'approvals', ap, at));
  }

  // pending: disposal of the oldest idle asset (level 1 already approved, waiting for level 2)
  const busy = new Set(db.all("SELECT DISTINCT asset_id FROM work_orders WHERE status IN ('OPEN','ASSIGNED','IN_PROGRESS','ON_HOLD')").map((x) => x.asset_id));
  const disposal = assets
    .filter((a) => !busy.has(a.id) && (now - parseDate(a.commissioning)) / (365.25 * D) > a.cat.lifespan_years)
    .sort((x, y) => (x.commissioning < y.commissioning ? -1 : 1))[0];
  if (disposal) {
    const at = ts(now - 3 * D);
    update(db, 'assets', disposal.id, { status: 'DISPOSAL_PENDING' });
    const ap = approval('ASSET_DISPOSAL', disposal.id, `Dispose ${disposal.cat.name} (${disposal.tag})`, 2, users.engineer, at, {
      amount: disposal.cost,
      current_level: 2,
      payload: JSON.stringify({ reason: 'Beyond economical repair; spare parts discontinued by manufacturer', method: 'Condemnation / scrap', previous_status: 'OUT_OF_SERVICE' }),
    });
    step(ap, 1, users.engineer, 'APPROVED', 'Verified BER by technical assessment', ts(now - 2 * D));
    asUser(users.engineer, () => ctx.event(disposal.id, 'DISPOSAL_REQUESTED', 'Disposal requested: beyond economical repair', 'approvals', ap, at));
    db.run("UPDATE ppm_schedules SET status = 'CANCELLED', remarks = 'Asset pending disposal' WHERE asset_id = ? AND status = 'SCHEDULED' AND scheduled_date >= ?", [disposal.id, today]);
  }

  // pending: ventilator repair needing level 2 cost approval
  const vent = db.get(
    `SELECT w.* FROM work_orders w JOIN assets a ON a.id = w.asset_id JOIN categories c ON c.id = a.category_id
     WHERE c.code = 'VEN' AND w.status IN ('IN_PROGRESS','ASSIGNED','OPEN','ON_HOLD') ORDER BY w.reported_at DESC LIMIT 1`,
  );
  let ventWo = vent;
  if (!ventWo) {
    const ventAsset = assets.find((a) => a.catCode === 'VEN' && a.deptCode === 'ICU');
    const at = ts(now - 30 * H);
    const wid = insert(db, 'work_orders', {
      wo_no: docNo(db, 'CM', at), asset_id: ventAsset.id, source: 'DIRECT', priority: 'P2', problem: 'Blower noise and intermittent low-pressure alarm',
      equipment_down: 1, reported_at: at, assigned_to: ventAsset.tech, assigned_at: at, response_at: ts(now - 28 * H), status: 'IN_PROGRESS',
      downtime_start: at, created_by: users.engineer, created_at: at,
    });
    insert(db, 'wo_logs', { work_order_id: wid, user_id: users.engineer, action: 'CREATED', created_at: at });
    update(db, 'assets', ventAsset.id, { status: 'BREAKDOWN' });
    ventWo = db.get('SELECT * FROM work_orders WHERE id = ?', [wid]);
  }
  {
    const at = ts(now - 20 * H);
    const ventTag = db.get('SELECT tag_no FROM assets WHERE id = ?', [ventWo.asset_id]).tag_no;
    approval('WO_COST', ventWo.id, `${ventWo.wo_no}: repair ${ventTag} — RM 12,500`, 2, ventWo.assigned_to || users.tech1, at, {
      amount: 12500,
      payload: JSON.stringify({ justification: 'Replace blower assembly and exhalation valve (quotation from authorised service)' }),
    });
    update(db, 'work_orders', ventWo.id, { status: 'ON_HOLD', hold_reason: 'Awaiting repair cost approval', estimated_cost: 12500, cost_approval_status: 'PENDING' });
    insert(db, 'wo_logs', { work_order_id: ventWo.id, user_id: ventWo.assigned_to || users.tech1, action: 'COST_REQUESTED', note: 'RM 12500 (needs level 2): blower assembly and exhalation valve', created_at: at });
  }

  // pending: PPM deferral for an anaesthesia machine (theatre fully booked)
  const anaPpm = db.get(
    `SELECT s.* FROM ppm_schedules s JOIN assets a ON a.id = s.asset_id JOIN categories c ON c.id = a.category_id
     WHERE c.code = 'ANA' AND s.status = 'SCHEDULED' AND s.scheduled_date >= ? ORDER BY s.scheduled_date LIMIT 1`,
    [startOfMonth(today)],
  );
  if (anaPpm) {
    const newDate = addDays(anaPpm.scheduled_date, 21);
    const tag = db.get('SELECT tag_no FROM assets WHERE id = ?', [anaPpm.asset_id]).tag_no;
    approval('PPM_DEFERRAL', anaPpm.id, `Defer ${anaPpm.ppm_no} (${tag}) to ${newDate}`, 1, users.tech2, ts(now - 6 * H), {
      payload: JSON.stringify({ new_date: newDate, reason: 'Theatre fully booked for elective lists; machine cannot be released' }),
    });
  }

  db.run("INSERT OR REPLACE INTO meta (key, value) VALUES ('demo', '1')");
  db.run("INSERT OR REPLACE INTO meta (key, value) VALUES ('ppm_rolled_on', ?)", [today]);
  asUser(users.admin, () => ctx.audit('Demo data loaded', 'system', null, { assets: assets.length + pendingAssets.length }));
  return {
    ok: true,
    assets: assets.length + pendingAssets.length,
    users: USERS.map(([username, name, role, level]) => ({ username, name, role, approval_level: level })),
    password: DEMO_PASSWORD,
    causes: FAILURE_CAUSES.length,
  };
}
