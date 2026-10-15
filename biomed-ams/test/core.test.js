import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../server/db-node.js';
import { createEngine } from '../core/api.js';
import { renderTag } from '../core/tagging.js';
import { displayStatus } from '../core/ppm.js';

const PW = 'Passw0rd1';

function setup(now = '2026-03-15 09:00:00') {
  const db = openDatabase(':memory:');
  const clock = { now };
  const eng = createEngine({ db, mode: 'local', hashIterations: 1000, clock: () => clock.now });
  return { db, eng, clock };
}

async function init(eng) {
  const r = await eng.call('setup.init', {
    hospital_name: 'Test Hospital', hospital_code: 'THX',
    admin_username: 'admin', admin_full_name: 'Admin User', admin_password: PW,
  });
  return r.token;
}

async function addUser(eng, admin, username, role, level = 0, extra = {}) {
  await eng.call('users.save', { username, full_name: username, role, approval_level: level, password: 'Temp1234x', ...extra }, admin);
  const { token } = await eng.call('auth.login', { username, password: 'Temp1234x' });
  await eng.call('auth.changePassword', { current_password: 'Temp1234x', new_password: PW }, token);
  return token;
}

async function lookups(eng, token) {
  const l = await eng.call('master.lookups', {}, token);
  const dept = (code) => l.departments.find((d) => d.code === code).id;
  const cat = (code) => l.categories.find((c) => c.code === code).id;
  return { l, dept, cat };
}

const ACCOUNTS = { admin: 'admin', engineer: 'eng', manager: 'mgr', director: 'dir', tech: 'tech', nurse: 'nurse', viewer: 'viewer' };

async function world() {
  const w = setup();
  w.admin = await init(w.eng);
  w.engineer = await addUser(w.eng, w.admin, 'eng', 'ENGINEER', 1);
  w.manager = await addUser(w.eng, w.admin, 'mgr', 'MANAGER', 2);
  w.director = await addUser(w.eng, w.admin, 'dir', 'MANAGER', 3);
  w.tech = await addUser(w.eng, w.admin, 'tech', 'TECHNICIAN', 0);
  const lk = await lookups(w.eng, w.admin);
  w.dept = lk.dept;
  w.cat = lk.cat;
  w.nurse = await addUser(w.eng, w.admin, 'nurse', 'REQUESTER', 0, { department_id: w.dept('ICU') });
  w.viewer = await addUser(w.eng, w.admin, 'viewer', 'VIEWER', 0);
  const users = (await w.eng.call('users.list', {}, w.admin)).rows;
  w.uid = (username) => users.find((u) => u.username === username).id;
  // Sessions expire after 12 h; tests that move the clock log everyone in again.
  w.travel = async (now) => {
    w.clock.now = now;
    for (const [key, username] of Object.entries(ACCOUNTS)) {
      w[key] = (await w.eng.call('auth.login', { username, password: PW })).token;
    }
  };
  return w;
}

async function activeAsset(w, extra = {}) {
  await w.eng.call('settings.save', { settings: { approval_rules: { ASSET_REGISTRATION: 0, ASSET_TRANSFER: 1, ASSET_DISPOSAL: 2, PPM_DEFERRAL: 1 } } }, w.admin);
  const r = await w.eng.call('assets.create', {
    name: 'Infusion Pump', category_id: w.cat('INF'), department_id: w.dept('ICU'),
    manufacturer: 'Acme', model: 'IP-1', serial_no: `SN${Math.random()}`, purchase_cost: 8000,
    purchase_date: '2025-01-10', commissioning_date: '2025-01-20', ...extra,
  }, w.engineer);
  return r;
}

test('tag numbers follow the configured format and restart per scope', async () => {
  assert.equal(renderTag('{HOSP}/{CAT}/{YYYY}/{SEQ5}', { hosp: 'HKL', cat: 'INF', date: '2026-02-03', seq: 7 }), 'HKL/INF/2026/00007');
  assert.equal(renderTag('KKM/{HOSP}/{CLS}/{YY}/{SEQ}', { hosp: 'HKL', cls: 'H', date: '2026-02-03', seq: 12 }), 'KKM/HKL/H/26/00012');
  const w = await world();
  const a = await activeAsset(w);
  const b = await activeAsset(w);
  const c = await activeAsset(w, { category_id: w.cat('MON'), name: 'Monitor' });
  assert.equal(a.tag_no, 'THX/INF/2026/00001');
  assert.equal(b.tag_no, 'THX/INF/2026/00002');
  assert.equal(c.tag_no, 'THX/MON/2026/00001');
  await assert.rejects(w.eng.call('settings.save', { settings: { tag_format: '{HOSP}-{CAT}' } }, w.admin), /running number/);
  await assert.rejects(w.eng.call('settings.save', { settings: { tag_format: '{HOSP}-{FOO}-{SEQ}' } }, w.admin), /Unknown tag token/);
  // an existing (legacy) tag is kept and must be unique
  const legacy = await activeAsset(w, { tag_no: 'old-123' });
  assert.equal(legacy.tag_no, 'OLD-123');
  await assert.rejects(activeAsset(w, { tag_no: 'OLD-123' }), /already exists/);
});

test('duplicate serial numbers are rejected', async () => {
  const w = await world();
  await activeAsset(w, { serial_no: 'ABC1' });
  await assert.rejects(activeAsset(w, { serial_no: 'abc1' }), /already registered/);
});

test('asset registration needs level 1 approval and blocks self-approval', async () => {
  const w = await world();
  const r = await w.eng.call('assets.create', {
    name: 'Ventilator', category_id: w.cat('VEN'), department_id: w.dept('ICU'), purchase_cost: 120000,
    commissioning_date: '2026-03-01', purchase_date: '2026-02-01',
  }, w.tech);
  assert.equal(r.status, 'PENDING');
  const techBox = await w.eng.call('approvals.list', { box: 'mine' }, w.tech);
  assert.equal(techBox.rows.length, 0, 'level 0 users have nothing to approve');
  const box = await w.eng.call('approvals.list', { box: 'mine' }, w.engineer);
  assert.equal(box.rows.length, 1);
  await assert.rejects(w.eng.call('approvals.decide', { id: box.rows[0].id, decision: 'APPROVED' }, w.tech), /approval authority/);
  await w.eng.call('approvals.decide', { id: box.rows[0].id, decision: 'APPROVED', remarks: 'ok' }, w.engineer);
  const a = await w.eng.call('assets.get', { id: r.id }, w.engineer);
  assert.equal(a.status, 'ACTIVE');
  assert.ok(a.plan, 'PPM plan created');
  assert.equal(a.plan.frequency_months, 6);
  assert.equal(a.next_ppm.scheduled_date, '2026-09-01');

  // engineer registers -> cannot approve own request
  const own = await w.eng.call('assets.create', { name: 'Monitor', category_id: w.cat('MON'), department_id: w.dept('ICU') }, w.engineer);
  const pending = (await w.eng.call('approvals.list', { box: 'requested' }, w.engineer)).rows.find((x) => x.ref_id === own.id);
  await assert.rejects(w.eng.call('approvals.decide', { id: pending.id, decision: 'APPROVED' }, w.engineer), /own request/);
  await assert.rejects(w.eng.call('approvals.decide', { id: pending.id, decision: 'REJECTED' }, w.manager), /reason/);
  await w.eng.call('approvals.decide', { id: pending.id, decision: 'REJECTED', remarks: 'wrong category' }, w.manager);
  assert.equal((await w.eng.call('assets.get', { id: own.id }, w.engineer)).status, 'REJECTED');
  const re = await w.eng.call('assets.resubmit', { id: own.id }, w.engineer);
  assert.equal(re.status, 'PENDING');
});

test('repair cost approval escalates through levels; higher level can approve lower steps', async () => {
  const w = await world();
  const a = await activeAsset(w);
  const wo = await w.eng.call('wo.create', { asset_id: a.id, priority: 'P2', problem: 'Not pumping', equipment_down: true }, w.engineer);
  await w.eng.call('wo.assign', { id: wo.id, assigned_to: w.uid('tech') }, w.engineer);
  await w.eng.call('wo.start', { id: wo.id }, w.tech);
  const req = await w.eng.call('wo.requestCost', { id: wo.id, estimated_cost: 12000, justification: 'Main board' }, w.tech);
  assert.equal(req.level, 2);
  let wd = await w.eng.call('wo.get', { id: wo.id }, w.tech);
  assert.equal(wd.status, 'ON_HOLD');
  await assert.rejects(w.eng.call('wo.complete', { id: wo.id, result: 'REPAIRED', action_taken: 'x', failure_cause: 'Component failure' }, w.tech), /cost approval/);
  const step1 = await w.eng.call('approvals.decide', { id: req.approval_id, decision: 'APPROVED' }, w.engineer);
  assert.deepEqual(step1, { status: 'PENDING', current_level: 2 });
  await assert.rejects(w.eng.call('approvals.decide', { id: req.approval_id, decision: 'APPROVED' }, w.engineer), /Level 2/);
  const step2 = await w.eng.call('approvals.decide', { id: req.approval_id, decision: 'APPROVED' }, w.manager);
  assert.equal(step2.status, 'APPROVED');
  wd = await w.eng.call('wo.get', { id: wo.id }, w.tech);
  assert.equal(wd.status, 'IN_PROGRESS');
  assert.equal(wd.cost_approval_status, 'APPROVED');

  // RM 50,000 needs level 3; the director's single approval covers all levels
  const wo2 = await w.eng.call('wo.create', { asset_id: a.id, priority: 'P3', problem: 'Cracked housing' }, w.engineer);
  await w.eng.call('wo.start', { id: wo2.id }, w.engineer);
  const req2 = await w.eng.call('wo.requestCost', { id: wo2.id, estimated_cost: 50000, justification: 'Replace' }, w.engineer);
  assert.equal(req2.level, 3);
  const d = await w.eng.call('approvals.decide', { id: req2.approval_id, decision: 'APPROVED' }, w.director);
  assert.equal(d.status, 'APPROVED');
});

test('corrective work order lifecycle drives asset status, downtime and helpdesk ticket', async () => {
  const w = await world();
  const a = await activeAsset(w);
  const t = await w.eng.call('tickets.create', { asset_id: a.id, subject: 'Pump alarm', priority: 'P2', category: 'BREAKDOWN' }, w.nurse);
  await assert.rejects(w.eng.call('tickets.convert', { id: t.id }, w.nurse), /permission/);
  w.clock.now = '2026-03-15 10:00:00';
  const conv = await w.eng.call('tickets.convert', { id: t.id, assigned_to: w.uid('tech') }, w.engineer);
  let asset = await w.eng.call('assets.get', { id: a.id }, w.engineer);
  assert.equal(asset.status, 'BREAKDOWN');
  w.clock.now = '2026-03-15 11:00:00';
  await w.eng.call('wo.start', { id: conv.work_order.id }, w.tech);
  await w.travel('2026-03-16 09:00:00');
  await assert.rejects(w.eng.call('wo.complete', { id: conv.work_order.id, result: 'REPAIRED' }, w.tech), /action taken/);
  await w.eng.call('wo.complete', {
    id: conv.work_order.id, result: 'REPAIRED', failure_cause: 'Battery failure', action_taken: 'Replaced battery',
    labour_hours: 2, parts: [{ description: 'Battery', qty: 1, unit_cost: 350 }],
  }, w.tech);
  const wo = await w.eng.call('wo.get', { id: conv.work_order.id }, w.engineer);
  assert.equal(wo.status, 'COMPLETED');
  assert.equal(wo.response_hours, 2); // ticket logged 09:00, attended 11:00
  assert.equal(wo.downtime_hours, 24);
  assert.equal(wo.parts_cost, 350);
  assert.equal(wo.labour_cost, 100);
  assert.equal(wo.total_cost, 450);
  asset = await w.eng.call('assets.get', { id: a.id }, w.engineer);
  assert.equal(asset.status, 'ACTIVE');
  let ticket = await w.eng.call('tickets.get', { id: t.id }, w.nurse);
  assert.equal(ticket.status, 'RESOLVED');
  assert.ok(ticket.can_confirm);
  // requester says it is still faulty -> work order reopens
  await w.eng.call('tickets.notFixed', { id: t.id, reason: 'Alarm again' }, w.nurse);
  assert.equal((await w.eng.call('wo.get', { id: wo.id }, w.engineer)).status, 'IN_PROGRESS');
  assert.equal((await w.eng.call('assets.get', { id: a.id }, w.engineer)).status, 'BREAKDOWN');
  w.clock.now = '2026-03-16 12:00:00';
  await w.eng.call('wo.complete', { id: wo.id, result: 'REPAIRED' }, w.tech);
  await w.eng.call('tickets.confirm', { id: t.id, rating: 5 }, w.nurse);
  ticket = await w.eng.call('tickets.get', { id: t.id }, w.nurse);
  assert.equal(ticket.status, 'CLOSED');
  await w.eng.call('wo.close', { id: wo.id }, w.engineer);
  assert.equal((await w.eng.call('wo.get', { id: wo.id }, w.engineer)).status, 'CLOSED');
});

test('typed times tolerate minute precision and small phone clock skew', async () => {
  const w = await world();
  w.clock.now = '2026-03-15 10:00:40';
  const a = await activeAsset(w);
  const wo = await w.eng.call('wo.create', { asset_id: a.id, priority: 'P3', problem: 'x' }, w.engineer);
  // attended "10:00" (minute precision) for a report logged at 10:00:40 is accepted as 10:00:40
  await w.eng.call('wo.start', { id: wo.id, response_at: '2026-03-15T10:00' }, w.engineer);
  assert.equal((await w.eng.call('wo.get', { id: wo.id }, w.engineer)).response_at, '2026-03-15 10:00:40');
  // a phone 3 minutes fast is clamped to now; 10 minutes ahead is rejected
  await assert.rejects(w.eng.call('wo.complete', { id: wo.id, result: 'REPAIRED', failure_cause: 'Other', action_taken: 'ok', completed_at: '2026-03-15T10:11' }, w.engineer), /future/);
  await w.eng.call('wo.complete', { id: wo.id, result: 'REPAIRED', failure_cause: 'Other', action_taken: 'ok', completed_at: '2026-03-15T10:03' }, w.engineer);
  assert.equal((await w.eng.call('wo.get', { id: wo.id }, w.engineer)).completed_at, '2026-03-15 10:00:40');
});

test('uptime and closure KPIs are computed from breakdown history', async () => {
  const w = await world();
  await w.travel('2026-04-01 00:00:00');
  const a = await activeAsset(w, { commissioning_date: '2025-01-01', purchase_date: '2025-01-01' });
  await w.travel('2026-04-30 23:00:00');
  const wo = await w.eng.call('wo.create', { asset_id: a.id, priority: 'P3', problem: 'x', equipment_down: true, reported_at: '2026-04-10 08:00' }, w.engineer);
  await w.eng.call('wo.start', { id: wo.id, response_at: '2026-04-10 09:00' }, w.engineer);
  await w.eng.call('wo.complete', { id: wo.id, result: 'REPAIRED', failure_cause: 'Wear and tear', action_taken: 'fixed', completed_at: '2026-04-11 08:00' }, w.engineer);
  await w.eng.call('wo.create', { asset_id: a.id, priority: 'P3', problem: 'second, still open', equipment_down: false, reported_at: '2026-04-20 08:00' }, w.engineer);
  await w.travel('2026-05-02 10:00:00');
  const k = await w.eng.call('kpi.summary', { period: 'last_month' }, w.engineer);
  assert.equal(k.period.from, '2026-04-01');
  assert.equal(k.cm.raised, 2);
  assert.equal(k.cm.closed, 1);
  assert.equal(k.cm.closure_rate, 50);
  assert.equal(k.cm.avg_response_hours, 1);
  // 24h down out of 720h in April
  assert.equal(k.uptime.value, Math.round((1 - 24 / 720) * 10000) / 100);
});

test('PPM windows, completion, KPI and deferral approval', async () => {
  const w = await world();
  assert.equal(displayStatus({ type: 'PPM', scheduled_date: '2026-03-10', status: 'SCHEDULED' }, '2026-03-20', 0), 'DUE');
  assert.equal(displayStatus({ type: 'PPM', scheduled_date: '2026-03-10', status: 'SCHEDULED' }, '2026-04-01', 0), 'OVERDUE');
  assert.equal(displayStatus({ type: 'PPM', scheduled_date: '2026-03-10', status: 'SCHEDULED' }, '2026-04-01', 5), 'DUE');
  assert.equal(displayStatus({ type: 'PPM', scheduled_date: '2026-03-10', status: 'COMPLETED', completed_date: '2026-04-02' }, '2026-05-01', 0), 'COMPLETED_LATE');
  assert.equal(displayStatus({ type: 'PPM', scheduled_date: '2026-05-10', status: 'SCHEDULED' }, '2026-04-20', 0), 'UPCOMING');

  const a = await activeAsset(w, { commissioning_date: '2025-03-05', purchase_date: '2025-03-01' });
  await w.eng.call('ppm.plans.save', { asset_id: a.id, frequency_months: 3, start_date: '2026-03-05', checklist: ['Visual check', 'Flow test'] }, w.engineer);
  const list = await w.eng.call('ppm.list', { asset_id: a.id }, w.engineer);
  assert.deepEqual(list.rows.map((r) => r.scheduled_date), ['2026-03-05', '2026-06-05', '2026-09-05', '2026-12-05', '2027-03-05']);
  const first = list.rows[0];
  assert.equal(first.display_status, 'DUE');
  await assert.rejects(w.eng.call('ppm.complete', { id: first.id, overall_result: 'PASS' }, w.nurse), /permission/);
  const done = await w.eng.call('ppm.complete', {
    id: first.id,
    checklist_results: [{ item: 'Visual check', result: 'PASS' }, { item: 'Flow test', result: 'FAIL', remark: '7% high' }],
    est_result: 'PASS', est_readings: { earth_resistance: 0.1 }, labour_hours: 1,
  }, w.tech);
  assert.equal(done.overall, 'FAIL', 'any failed item fails the PPM');
  assert.ok(done.followup_wo, 'a corrective work order is raised for a failed PPM');
  const g = await w.eng.call('ppm.get', { id: first.id }, w.tech);
  assert.equal(g.labour_cost, 50);

  // deferral needs level 1 approval and creates a replacement entry
  const second = list.rows[1];
  const d = await w.eng.call('ppm.defer', { id: second.id, new_date: '2026-07-20', reason: 'Unit on loan' }, w.tech);
  assert.equal(d.status, 'PENDING');
  await w.eng.call('approvals.decide', { id: d.approval_id, decision: 'APPROVED' }, w.engineer);
  const after = await w.eng.call('ppm.list', { asset_id: a.id }, w.engineer);
  assert.ok(after.rows.some((r) => r.scheduled_date === '2026-07-20' && r.status === 'SCHEDULED'));
  assert.ok(after.rows.some((r) => r.id === second.id && r.status === 'DEFERRED'));

  // KPI: March has one PPM, completed on time -> 100 %
  await w.travel('2026-04-02 09:00:00');
  const k = await w.eng.call('kpi.summary', { period: 'last_month' }, w.engineer);
  assert.equal(k.ppm.scheduled, 1);
  assert.equal(k.ppm.completion_rate, 100);

  // changing the frequency rebuilds future, untouched PPMs
  await w.eng.call('ppm.plans.save', { asset_id: a.id, frequency_months: 6, start_date: '2026-03-05' }, w.engineer);
  const rebuilt = (await w.eng.call('ppm.list', { asset_id: a.id, display_status: 'UPCOMING' }, w.engineer)).rows.map((r) => r.scheduled_date);
  assert.ok(rebuilt.includes('2026-09-05') && !rebuilt.includes('2026-12-05'), rebuilt.join(','));
});

test('role permissions and department scoping', async () => {
  const w = await world();
  const icu = await activeAsset(w);
  const ot = await activeAsset(w, { department_id: w.dept('OT') });
  const seen = await w.eng.call('assets.list', {}, w.nurse);
  assert.deepEqual(seen.rows.map((r) => r.id), [icu.id]);
  await assert.rejects(w.eng.call('assets.get', { id: ot.id }, w.nurse), /permission/);
  await assert.rejects(w.eng.call('wo.create', { asset_id: icu.id, problem: 'x' }, w.nurse), /permission/);
  await assert.rejects(w.eng.call('assets.create', { name: 'x', category_id: 1, department_id: 1 }, w.viewer), /permission/);
  await assert.rejects(w.eng.call('settings.save', { settings: { labour_rate: 1 } }, w.engineer), /permission/);
  await assert.rejects(w.eng.call('users.list', {}, w.manager), /permission/);
  await assert.rejects(w.eng.call('assets.list', {}), /log in/);
  // last administrator cannot be demoted
  await assert.rejects(w.eng.call('users.save', { id: 1, full_name: 'Admin User', role: 'ENGINEER', approval_level: 1 }, w.admin), /at least one active administrator/);
});

test('login lockout, pending registration and forced password change', async () => {
  const w = setup();
  w.admin = await init(w.eng);
  for (let i = 0; i < 5; i++) {
    await assert.rejects(w.eng.call('auth.login', { username: 'admin', password: 'wrong' }), /Invalid/);
  }
  await assert.rejects(w.eng.call('auth.login', { username: 'admin', password: PW }), /Too many failed attempts/);
  w.clock.now = '2026-03-15 09:20:00';
  await w.eng.call('auth.login', { username: 'admin', password: PW });

  const lk = await lookups(w.eng, w.admin);
  await w.eng.call('auth.register', { username: 'newbie', full_name: 'New Person', password: 'Abcdefg1', department_id: lk.dept('ICU') });
  await assert.rejects(w.eng.call('auth.login', { username: 'newbie', password: 'Abcdefg1' }), /waiting for administrator approval/);
  const pending = (await w.eng.call('users.list', { status: 'PENDING' }, w.admin)).rows[0];
  await w.eng.call('users.approve', { id: pending.id, role: 'TECHNICIAN', approval_level: 1 }, w.admin);
  const { token, user } = await w.eng.call('auth.login', { username: 'newbie', password: 'Abcdefg1' });
  assert.equal(user.approval_level, 1);
  assert.equal(user.role, 'TECHNICIAN');
  assert.ok(token);

  await w.eng.call('users.save', { username: 'temp', full_name: 'Temp', role: 'TECHNICIAN', approval_level: 0, password: 'Temp1234x' }, w.admin);
  const t = await w.eng.call('auth.login', { username: 'temp', password: 'Temp1234x' });
  await assert.rejects(w.eng.call('assets.list', {}, t.token), /change your password/);
  await assert.rejects(w.eng.call('auth.changePassword', { current_password: 'Temp1234x', new_password: 'short' }, t.token), /at least 8/);
});

test('transfer and disposal follow the approval matrix', async () => {
  const w = await world();
  const a = await activeAsset(w);
  const tr = await w.eng.call('assets.transfer', { id: a.id, department_id: w.dept('OT'), reason: 'Needed in OT' }, w.tech);
  assert.equal(tr.status, 'PENDING');
  await w.eng.call('approvals.decide', { id: tr.approval_id, decision: 'APPROVED' }, w.engineer);
  assert.equal((await w.eng.call('assets.get', { id: a.id }, w.engineer)).department_id, w.dept('OT'));

  const dp = await w.eng.call('assets.dispose', { id: a.id, reason: 'BER', method: 'Scrap' }, w.engineer);
  assert.equal((await w.eng.call('assets.get', { id: a.id }, w.engineer)).status, 'DISPOSAL_PENDING');
  const s1 = await w.eng.call('approvals.decide', { id: dp.approval_id, decision: 'APPROVED' }, w.director);
  assert.equal(s1.status, 'APPROVED');
  const after = await w.eng.call('assets.get', { id: a.id }, w.engineer);
  assert.equal(after.status, 'DISPOSED');
  const open = await w.eng.call('ppm.list', { asset_id: a.id, display_status: 'OPEN' }, w.engineer);
  assert.equal(open.total, 0, 'open PPMs are cancelled on disposal');
});

test('CSV import accepts Malaysian date format and reports bad rows', async () => {
  const w = await world();
  const r = await w.eng.call('assets.import', {
    rows: [
      { name: 'Pump A', category_code: 'INF', department_code: 'ICU', serial_no: 'X1', purchase_date: '05/02/2021', purchase_cost: 'RM 7,500.00' },
      { name: 'Pump B', category_code: 'NOPE', department_code: 'ICU', serial_no: 'X2' },
      { name: 'Pump C', category_code: 'INF', department_code: 'ICU', serial_no: 'X1' },
    ],
  }, w.engineer);
  assert.equal(r.created, 1);
  assert.equal(r.errors.length, 2);
  assert.match(r.errors[0].message, /Unknown category/);
  assert.match(r.errors[1].message, /already registered/);
  const list = await w.eng.call('assets.list', {}, w.engineer);
  assert.equal(list.total, 1);
  assert.equal(list.rows[0].purchase_date, '2021-02-05');
  assert.equal(list.rows[0].purchase_cost, 7500);
});

test('predictive model ranks unreliable equipment higher and generates inspections once', async () => {
  const w = await world();
  await w.travel('2026-06-30 09:00:00');
  const good = await activeAsset(w, { commissioning_date: '2024-01-01', purchase_date: '2024-01-01' });
  const bad = await activeAsset(w, { commissioning_date: '2024-01-01', purchase_date: '2024-01-01' });
  for (const day of ['2026-01-05', '2026-02-10', '2026-03-15', '2026-04-20', '2026-05-25', '2026-06-20']) {
    const wo = await w.eng.call('wo.create', { asset_id: bad.id, priority: 'P2', problem: 'fault', reported_at: `${day} 08:00` }, w.engineer);
    await w.eng.call('wo.complete', { id: wo.id, result: 'REPAIRED', failure_cause: 'Component failure', action_taken: 'fixed', completed_at: `${day} 15:00`, parts: [{ description: 'Sensor', qty: 1, unit_cost: 900 }] }, w.engineer);
  }
  const p = await w.eng.call('predictive.list', {}, w.engineer);
  const rb = p.rows.find((r) => r.id === bad.id);
  const rg = p.rows.find((r) => r.id === good.id);
  assert.ok(rb.score > rg.score, `${rb.score} > ${rg.score}`);
  assert.ok(rb.probability > rg.probability);
  assert.ok(rb.probability <= 100 && rg.probability >= 0);
  assert.ok(rb.recommendations.some((x) => /Keep spare in stock: Sensor/.test(x)));
  const gen = await w.eng.call('predictive.generate', { threshold: rb.score }, w.engineer);
  assert.equal(gen.created.length, 1);
  assert.equal(gen.created[0].tag_no, rb.tag_no);
  const again = await w.eng.call('predictive.generate', { threshold: rb.score }, w.engineer);
  assert.equal(again.created.length, 0);
});

test('lifespan uses straight-line book value and flags end of life', async () => {
  const w = await world();
  await w.travel('2026-01-01 09:00:00');
  const a = await activeAsset(w, { commissioning_date: '2018-01-01', purchase_date: '2018-01-01', purchase_cost: 10000, salvage_value: 0, lifespan_years: 8 });
  const ls = await w.eng.call('lifecycle.lifespan', {}, w.engineer);
  const r = ls.rows.find((x) => x.id === a.id);
  assert.equal(r.end_of_life_year, 2026);
  assert.equal(r.state, 'BEYOND_LIFE');
  assert.equal(r.book_value, 0);
});

test('demo data loads cleanly and every report runs', async () => {
  const w = setup('2026-10-15 10:00:00');
  const info = await w.eng.call('setup.demo', {});
  assert.ok(info.assets > 150);
  const { token } = await w.eng.call('auth.login', { username: 'admin', password: 'demo1234' });
  assert.equal(w.db.all('PRAGMA foreign_key_check').length, 0);
  const types = await w.eng.call('reports.types', {}, token);
  for (const type of Object.keys(types)) {
    const r = await w.eng.call('reports.run', { type, asset_id: 1, period: 'last_12_months' }, token);
    assert.ok(Array.isArray(r.rows) && r.columns.length, type);
  }
  const dash = await w.eng.call('dashboard.get', {}, token);
  assert.ok(dash.approvals_pending >= 4);
});
