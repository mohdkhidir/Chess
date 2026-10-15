// Dropdown option builders from the cached master data.
export const deptOptions = (lk) => (lk?.departments || []).filter((d) => d.active).map((d) => [d.id, d.name]);
export const catOptions = (lk) => (lk?.categories || []).filter((c) => c.active).map((c) => [c.id, `${c.name} (${c.code})`]);
export const locOptions = (lk, deptId) =>
  (lk?.locations || [])
    .filter((l) => l.active && (!deptId || !l.department_id || String(l.department_id) === String(deptId)))
    .map((l) => [l.id, l.name]);
export const vendorOptions = (lk) => (lk?.vendors || []).filter((v) => v.active).map((v) => [v.id, `${v.name} (${v.type})`]);
export const techOptions = (lk) =>
  (lk?.users || []).filter((u) => ['TECHNICIAN', 'ENGINEER', 'ADMIN', 'MANAGER'].includes(u.role)).map((u) => [u.id, u.full_name]);
export const statusOptions = (map) => Object.entries(map).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]);
