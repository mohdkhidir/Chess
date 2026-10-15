// One schema for both the hospital server and the standalone phone database, so a
// backup taken on a phone can be opened by the server unchanged.

export const SCHEMA_VERSION = 1;

const V1 = `
CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE sequences (
  key   TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);

CREATE TABLE departments (
  id        INTEGER PRIMARY KEY,
  code      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name      TEXT NOT NULL,
  type      TEXT NOT NULL DEFAULT 'Clinical',
  head_name TEXT,
  phone     TEXT,
  active    INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE locations (
  id            INTEGER PRIMARY KEY,
  code          TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name          TEXT NOT NULL,
  block         TEXT,
  floor         TEXT,
  department_id INTEGER REFERENCES departments(id),
  active        INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE categories (
  id                   INTEGER PRIMARY KEY,
  code                 TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name                 TEXT NOT NULL,
  risk_class           TEXT NOT NULL DEFAULT 'B',
  criticality          TEXT NOT NULL DEFAULT 'Medium',
  ppm_frequency_months INTEGER NOT NULL DEFAULT 12,
  lifespan_years       INTEGER NOT NULL DEFAULT 8,
  est_required         INTEGER NOT NULL DEFAULT 1,
  checklist            TEXT NOT NULL DEFAULT '[]',
  active               INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE vendors (
  id             INTEGER PRIMARY KEY,
  name           TEXT NOT NULL,
  type           TEXT NOT NULL DEFAULT 'Supplier',
  contact_person TEXT,
  phone          TEXT,
  email          TEXT,
  address        TEXT,
  active         INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE users (
  id                   INTEGER PRIMARY KEY,
  username             TEXT NOT NULL UNIQUE COLLATE NOCASE,
  full_name            TEXT NOT NULL,
  staff_no             TEXT,
  email                TEXT,
  phone                TEXT,
  designation          TEXT,
  role                 TEXT NOT NULL,
  approval_level       INTEGER NOT NULL DEFAULT 0,
  department_id        INTEGER REFERENCES departments(id),
  status               TEXT NOT NULL DEFAULT 'ACTIVE',
  password_hash        TEXT NOT NULL,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  failed_logins        INTEGER NOT NULL DEFAULT 0,
  locked_until         TEXT,
  last_login_at        TEXT,
  created_at           TEXT NOT NULL,
  updated_at           TEXT
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE assets (
  id                 INTEGER PRIMARY KEY,
  tag_no             TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name               TEXT NOT NULL,
  category_id        INTEGER NOT NULL REFERENCES categories(id),
  manufacturer       TEXT,
  model              TEXT,
  serial_no          TEXT,
  department_id      INTEGER NOT NULL REFERENCES departments(id),
  location_id        INTEGER REFERENCES locations(id),
  supplier_id        INTEGER REFERENCES vendors(id),
  service_vendor_id  INTEGER REFERENCES vendors(id),
  purchase_date      TEXT,
  commissioning_date TEXT,
  warranty_end       TEXT,
  purchase_cost      REAL NOT NULL DEFAULT 0,
  po_no              TEXT,
  funding            TEXT,
  mda_reg_no         TEXT,
  risk_class         TEXT NOT NULL DEFAULT 'B',
  criticality        TEXT NOT NULL DEFAULT 'Medium',
  lifespan_years     INTEGER,
  salvage_value      REAL NOT NULL DEFAULT 0,
  ppm_required       INTEGER NOT NULL DEFAULT 1,
  asset_class        TEXT,
  status             TEXT NOT NULL,
  remarks            TEXT,
  created_by         INTEGER REFERENCES users(id),
  created_at         TEXT NOT NULL,
  updated_at         TEXT,
  disposed_at        TEXT
);
CREATE INDEX idx_assets_department ON assets(department_id);
CREATE INDEX idx_assets_category ON assets(category_id);
CREATE INDEX idx_assets_status ON assets(status);

CREATE TABLE asset_events (
  id          INTEGER PRIMARY KEY,
  asset_id    INTEGER NOT NULL REFERENCES assets(id),
  event_type  TEXT NOT NULL,
  description TEXT NOT NULL,
  ref_type    TEXT,
  ref_id      INTEGER,
  user_id     INTEGER REFERENCES users(id),
  created_at  TEXT NOT NULL
);
CREATE INDEX idx_asset_events_asset ON asset_events(asset_id, created_at);

CREATE TABLE ppm_plans (
  id               INTEGER PRIMARY KEY,
  asset_id         INTEGER NOT NULL UNIQUE REFERENCES assets(id),
  frequency_months INTEGER NOT NULL,
  start_date       TEXT NOT NULL,
  checklist        TEXT NOT NULL DEFAULT '[]',
  est_required     INTEGER NOT NULL DEFAULT 1,
  performed_by     TEXT NOT NULL DEFAULT 'IN_HOUSE',
  vendor_id        INTEGER REFERENCES vendors(id),
  assigned_to      INTEGER REFERENCES users(id),
  estimated_hours  REAL NOT NULL DEFAULT 1,
  active           INTEGER NOT NULL DEFAULT 1,
  created_at       TEXT NOT NULL,
  updated_at       TEXT
);

CREATE TABLE work_orders (
  id                   INTEGER PRIMARY KEY,
  wo_no                TEXT NOT NULL UNIQUE,
  asset_id             INTEGER NOT NULL REFERENCES assets(id),
  ticket_id            INTEGER REFERENCES tickets(id),
  source               TEXT NOT NULL DEFAULT 'DIRECT',
  priority             TEXT NOT NULL DEFAULT 'P3',
  problem              TEXT NOT NULL,
  equipment_down       INTEGER NOT NULL DEFAULT 1,
  reported_at          TEXT NOT NULL,
  assigned_to          INTEGER REFERENCES users(id),
  assigned_at          TEXT,
  response_at          TEXT,
  completed_at         TEXT,
  closed_at            TEXT,
  closed_by            INTEGER REFERENCES users(id),
  status               TEXT NOT NULL DEFAULT 'OPEN',
  hold_reason          TEXT,
  failure_cause        TEXT,
  action_taken         TEXT,
  result               TEXT,
  labour_hours         REAL NOT NULL DEFAULT 0,
  labour_cost          REAL NOT NULL DEFAULT 0,
  parts_cost           REAL NOT NULL DEFAULT 0,
  vendor_cost          REAL NOT NULL DEFAULT 0,
  estimated_cost       REAL,
  cost_approval_status TEXT,
  downtime_start       TEXT,
  downtime_end         TEXT,
  created_by           INTEGER REFERENCES users(id),
  created_at           TEXT NOT NULL,
  updated_at           TEXT
);
CREATE INDEX idx_wo_asset ON work_orders(asset_id);
CREATE INDEX idx_wo_status ON work_orders(status);
CREATE INDEX idx_wo_reported ON work_orders(reported_at);

CREATE TABLE wo_parts (
  id            INTEGER PRIMARY KEY,
  work_order_id INTEGER NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  part_no       TEXT,
  description   TEXT NOT NULL,
  qty           REAL NOT NULL DEFAULT 1,
  unit_cost     REAL NOT NULL DEFAULT 0
);
CREATE INDEX idx_wo_parts_wo ON wo_parts(work_order_id);

CREATE TABLE wo_logs (
  id            INTEGER PRIMARY KEY,
  work_order_id INTEGER NOT NULL REFERENCES work_orders(id),
  user_id       INTEGER REFERENCES users(id),
  action        TEXT NOT NULL,
  note          TEXT,
  created_at    TEXT NOT NULL
);
CREATE INDEX idx_wo_logs_wo ON wo_logs(work_order_id);

CREATE TABLE ppm_schedules (
  id                INTEGER PRIMARY KEY,
  ppm_no            TEXT NOT NULL UNIQUE,
  plan_id           INTEGER REFERENCES ppm_plans(id),
  asset_id          INTEGER NOT NULL REFERENCES assets(id),
  type              TEXT NOT NULL DEFAULT 'PPM',
  scheduled_date    TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'SCHEDULED',
  assigned_to       INTEGER REFERENCES users(id),
  started_at        TEXT,
  completed_date    TEXT,
  performed_by      INTEGER REFERENCES users(id),
  vendor_name       TEXT,
  checklist_results TEXT,
  est_result        TEXT,
  est_readings      TEXT,
  overall_result    TEXT,
  labour_hours      REAL NOT NULL DEFAULT 0,
  labour_cost       REAL NOT NULL DEFAULT 0,
  parts_cost        REAL NOT NULL DEFAULT 0,
  vendor_cost       REAL NOT NULL DEFAULT 0,
  remarks           TEXT,
  reason            TEXT,
  deferred_to       TEXT,
  defer_reason      TEXT,
  followup_wo_id    INTEGER REFERENCES work_orders(id),
  created_at        TEXT NOT NULL,
  updated_at        TEXT
);
CREATE INDEX idx_ppm_scheduled ON ppm_schedules(scheduled_date);
CREATE INDEX idx_ppm_asset ON ppm_schedules(asset_id);
CREATE UNIQUE INDEX idx_ppm_plan_date ON ppm_schedules(plan_id, scheduled_date) WHERE plan_id IS NOT NULL AND type = 'PPM';

CREATE TABLE tickets (
  id              INTEGER PRIMARY KEY,
  ticket_no       TEXT NOT NULL UNIQUE,
  asset_id        INTEGER REFERENCES assets(id),
  department_id   INTEGER NOT NULL REFERENCES departments(id),
  location_text   TEXT,
  category        TEXT NOT NULL,
  priority        TEXT NOT NULL,
  subject         TEXT NOT NULL,
  description     TEXT,
  reporter_id     INTEGER REFERENCES users(id),
  contact_name    TEXT,
  contact_phone   TEXT,
  status          TEXT NOT NULL DEFAULT 'NEW',
  work_order_id   INTEGER REFERENCES work_orders(id),
  created_at      TEXT NOT NULL,
  acknowledged_at TEXT,
  resolved_at     TEXT,
  closed_at       TEXT,
  rating          INTEGER,
  feedback        TEXT,
  updated_at      TEXT
);
CREATE INDEX idx_tickets_status ON tickets(status);
CREATE INDEX idx_tickets_created ON tickets(created_at);

CREATE TABLE approvals (
  id             INTEGER PRIMARY KEY,
  type           TEXT NOT NULL,
  ref_id         INTEGER NOT NULL,
  title          TEXT NOT NULL,
  amount         REAL,
  payload        TEXT,
  required_level INTEGER NOT NULL,
  current_level  INTEGER NOT NULL DEFAULT 1,
  status         TEXT NOT NULL DEFAULT 'PENDING',
  requested_by   INTEGER REFERENCES users(id),
  requested_at   TEXT NOT NULL,
  decided_at     TEXT
);
CREATE INDEX idx_approvals_status ON approvals(status);
CREATE INDEX idx_approvals_ref ON approvals(type, ref_id);

CREATE TABLE approval_steps (
  id          INTEGER PRIMARY KEY,
  approval_id INTEGER NOT NULL REFERENCES approvals(id),
  level       INTEGER NOT NULL,
  approver_id INTEGER NOT NULL REFERENCES users(id),
  decision    TEXT NOT NULL,
  remarks     TEXT,
  decided_at  TEXT NOT NULL
);
CREATE INDEX idx_approval_steps ON approval_steps(approval_id);

CREATE TABLE audit_log (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER REFERENCES users(id),
  action     TEXT NOT NULL,
  entity     TEXT,
  entity_id  INTEGER,
  details    TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_audit_created ON audit_log(created_at);
`;

const MIGRATIONS = [V1];

export function migrate(db) {
  db.exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)');
  const row = db.get("SELECT value FROM meta WHERE key = 'schema_version'");
  const current = row ? Number(row.value) : 0;
  if (current > SCHEMA_VERSION) {
    throw new Error(`Database schema v${current} is newer than this app (v${SCHEMA_VERSION}). Update the app.`);
  }
  for (let v = current; v < SCHEMA_VERSION; v++) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[v]);
      db.run("INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', ?)", [String(v + 1)]);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
}
