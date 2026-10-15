// Role decides what a user can do; approval_level (0-3) decides what they can approve.
// The two are separate on purpose: a technician can be a Level 1 approver in a small unit.

export const ROLES = {
  ADMIN: 'System Administrator',
  MANAGER: 'Manager / Head of Department',
  ENGINEER: 'Biomedical Engineer / Supervisor',
  TECHNICIAN: 'Technician / Assistant Engineer',
  REQUESTER: 'Clinical User / Requester',
  VIEWER: 'Viewer / Auditor',
};

const STAFF = ['ADMIN', 'MANAGER', 'ENGINEER', 'TECHNICIAN'];
const ALL = Object.keys(ROLES);

const MATRIX = {
  'asset.view': ALL,
  'asset.create': STAFF,
  'asset.edit': STAFF,
  'asset.import': ['ADMIN', 'MANAGER', 'ENGINEER'],
  'asset.transfer': STAFF,
  'asset.status': ['ADMIN', 'MANAGER', 'ENGINEER'],
  'asset.dispose': ['ADMIN', 'MANAGER', 'ENGINEER'],
  'ppm.view': ALL,
  'ppm.plan': ['ADMIN', 'MANAGER', 'ENGINEER'],
  'ppm.execute': ['ADMIN', 'ENGINEER', 'TECHNICIAN'],
  'ppm.defer': STAFF,
  'wo.view': ['ADMIN', 'MANAGER', 'ENGINEER', 'TECHNICIAN', 'VIEWER'],
  'wo.create': STAFF,
  'wo.assign': ['ADMIN', 'MANAGER', 'ENGINEER'],
  'wo.execute': ['ADMIN', 'ENGINEER', 'TECHNICIAN'],
  'wo.close': ['ADMIN', 'MANAGER', 'ENGINEER'],
  'ticket.view': ALL,
  'ticket.create': ['ADMIN', 'MANAGER', 'ENGINEER', 'TECHNICIAN', 'REQUESTER'],
  'ticket.manage': STAFF,
  'kpi.view': ['ADMIN', 'MANAGER', 'ENGINEER', 'TECHNICIAN', 'VIEWER'],
  'report.view': ['ADMIN', 'MANAGER', 'ENGINEER', 'TECHNICIAN', 'VIEWER'],
  'analytics.view': ['ADMIN', 'MANAGER', 'ENGINEER', 'VIEWER'],
  'predictive.generate': ['ADMIN', 'MANAGER', 'ENGINEER'],
  'masterdata.manage': ['ADMIN', 'MANAGER', 'ENGINEER'],
  'users.manage': ['ADMIN'],
  'settings.manage': ['ADMIN'],
  'audit.view': ['ADMIN', 'MANAGER', 'VIEWER'],
  'system.backup': ['ADMIN'],
};

export function can(user, perm) {
  if (!user) return false;
  const roles = MATRIX[perm];
  if (!roles) throw new Error(`Unknown permission ${perm}`);
  return roles.includes(user.role);
}

export function permissionsFor(user) {
  return Object.keys(MATRIX).filter((p) => can(user, p));
}

// Requesters only see their own department's equipment and tickets.
export const isScopedToDepartment = (user) => user?.role === 'REQUESTER' && !!user.department_id;
