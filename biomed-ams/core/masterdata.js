import { insert, update } from './db.js';
import { bad, conflict, int, oneOf, optId, parseJson, str, bool } from './util.js';
import { VENDOR_TYPES, FAILURE_CAUSES, FUNDING_SOURCES, TICKET_CATEGORIES } from './library.js';
import { ROLES } from './permissions.js';
import { APPROVAL_TYPES } from './settings.js';

const RISK = ['A', 'B', 'C', 'D'];
const CRIT = ['High', 'Medium', 'Low'];
const DEPT_TYPES = ['Clinical', 'Clinical Support', 'Non-Clinical'];

function code(v, name) {
  const c = str(v, { required: true, max: 12, name }).toUpperCase();
  if (!/^[A-Z0-9&_-]+$/.test(c)) throw bad(`${name} may only contain letters, digits, &, _ and -`);
  return c;
}

function uniqueCheck(db, table, column, value, selfId) {
  const row = db.get(`SELECT id FROM ${table} WHERE ${column} = ? COLLATE NOCASE`, [value]);
  if (row && row.id !== selfId) throw conflict(`${value} is already used`);
}

function save(ctx, table, rowId, data, label) {
  if (rowId) {
    if (!ctx.db.get(`SELECT id FROM ${table} WHERE id = ?`, [rowId])) throw bad(`${label} not found`);
    update(ctx.db, table, rowId, data);
    ctx.audit(`${label} updated`, table, rowId, data);
    return rowId;
  }
  const newId = insert(ctx.db, table, data);
  ctx.audit(`${label} created`, table, newId, data);
  return newId;
}

export function lookups(db) {
  return {
    departments: db.all('SELECT * FROM departments ORDER BY active DESC, name'),
    locations: db.all(
      `SELECT l.*, d.name AS department_name FROM locations l
       LEFT JOIN departments d ON d.id = l.department_id ORDER BY l.active DESC, l.name`,
    ),
    categories: db.all('SELECT * FROM categories ORDER BY active DESC, name').map((c) => ({
      ...c,
      checklist: parseJson(c.checklist, []),
    })),
    vendors: db.all('SELECT * FROM vendors ORDER BY active DESC, name'),
    users: db.all(
      `SELECT id, username, full_name, role, approval_level, department_id, designation
       FROM users WHERE status = 'ACTIVE' ORDER BY full_name`,
    ),
    roles: ROLES,
    vendor_types: VENDOR_TYPES,
    failure_causes: FAILURE_CAUSES,
    funding_sources: FUNDING_SOURCES,
    ticket_categories: TICKET_CATEGORIES,
    approval_types: APPROVAL_TYPES,
  };
}

export const handlers = {
  'master.lookups': {
    perm: 'asset.view',
    fn: (ctx) => lookups(ctx.db),
  },

  'departments.save': {
    perm: 'masterdata.manage',
    write: true,
    fn(ctx, p) {
      const rowId = optId(p.id);
      const data = {
        code: code(p.code, 'Department code'),
        name: str(p.name, { required: true, max: 120, name: 'Department name' }),
        type: oneOf(p.type, DEPT_TYPES, { name: 'Department type', def: 'Clinical' }),
        head_name: str(p.head_name, { max: 120, name: 'Head of department' }),
        phone: str(p.phone, { max: 40, name: 'Phone' }),
        active: p.active === undefined ? 1 : bool(p.active),
      };
      uniqueCheck(ctx.db, 'departments', 'code', data.code, rowId);
      return { id: save(ctx, 'departments', rowId, data, 'Department') };
    },
  },

  'locations.save': {
    perm: 'masterdata.manage',
    write: true,
    fn(ctx, p) {
      const rowId = optId(p.id);
      const data = {
        code: code(p.code, 'Location code'),
        name: str(p.name, { required: true, max: 160, name: 'Location name' }),
        block: str(p.block, { max: 60, name: 'Block' }),
        floor: str(p.floor, { max: 30, name: 'Floor' }),
        department_id: optId(p.department_id, 'Department'),
        active: p.active === undefined ? 1 : bool(p.active),
      };
      uniqueCheck(ctx.db, 'locations', 'code', data.code, rowId);
      return { id: save(ctx, 'locations', rowId, data, 'Location') };
    },
  },

  'categories.save': {
    perm: 'masterdata.manage',
    write: true,
    fn(ctx, p) {
      const rowId = optId(p.id);
      const checklist = Array.isArray(p.checklist) ? p.checklist : String(p.checklist || '').split('\n');
      const items = checklist.map((s) => String(s).trim()).filter(Boolean).slice(0, 60);
      if (items.some((s) => s.length > 200)) throw bad('Checklist items must be 200 characters or fewer');
      const data = {
        code: code(p.code, 'Category code'),
        name: str(p.name, { required: true, max: 120, name: 'Category name' }),
        risk_class: oneOf(p.risk_class, RISK, { name: 'Risk class', def: 'B' }),
        criticality: oneOf(p.criticality, CRIT, { name: 'Criticality', def: 'Medium' }),
        ppm_frequency_months: int(p.ppm_frequency_months, { min: 0, max: 60, name: 'PPM frequency', def: 12 }),
        lifespan_years: int(p.lifespan_years, { min: 1, max: 50, name: 'Lifespan', def: 8 }),
        est_required: p.est_required === undefined ? 1 : bool(p.est_required),
        checklist: JSON.stringify(items),
        active: p.active === undefined ? 1 : bool(p.active),
      };
      uniqueCheck(ctx.db, 'categories', 'code', data.code, rowId);
      return { id: save(ctx, 'categories', rowId, data, 'Category') };
    },
  },

  'vendors.save': {
    perm: 'masterdata.manage',
    write: true,
    fn(ctx, p) {
      const rowId = optId(p.id);
      const email = str(p.email, { max: 120, name: 'Email' });
      if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw bad('Email address is not valid');
      const data = {
        name: str(p.name, { required: true, max: 160, name: 'Vendor name' }),
        type: oneOf(p.type, VENDOR_TYPES, { name: 'Vendor type', def: 'Supplier' }),
        contact_person: str(p.contact_person, { max: 120, name: 'Contact person' }),
        phone: str(p.phone, { max: 40, name: 'Phone' }),
        email,
        address: str(p.address, { max: 300, name: 'Address' }),
        active: p.active === undefined ? 1 : bool(p.active),
      };
      return { id: save(ctx, 'vendors', rowId, data, 'Vendor') };
    },
  },
};

export function seedLibrary(db, { departments, categories }) {
  for (const d of departments) insert(db, 'departments', { code: d.code, name: d.name, type: d.type, active: 1 });
  for (const c of categories) {
    insert(db, 'categories', {
      code: c.code,
      name: c.name,
      risk_class: c.risk_class,
      criticality: c.criticality,
      ppm_frequency_months: c.ppm_frequency_months,
      lifespan_years: c.lifespan_years,
      est_required: c.est_required ?? 1,
      checklist: JSON.stringify(c.checklist || []),
      active: 1,
    });
  }
}
