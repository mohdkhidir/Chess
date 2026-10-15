import { Input, Select } from './ui.jsx';
import { PERIODS } from '../lib/format.js';
import { catOptions, deptOptions } from '../lib/options.js';
import { useApp } from '../lib/api.jsx';

/** Period + department (+ category) filter row used by KPI, expense and report screens. */
export function PeriodFilters({ value, onChange, category = false, periods = PERIODS }) {
  const { lookups, user } = useApp();
  const set = (k) => (e) => onChange({ ...value, [k]: e.target.value });
  return (
    <div className="toolbar">
      <Select value={value.period} onChange={set('period')} options={periods} aria-label="Period" />
      {value.period === 'custom' ? (
        <>
          <Input type="date" value={value.from || ''} onChange={set('from')} aria-label="From" />
          <Input type="date" value={value.to || ''} onChange={set('to')} aria-label="To" />
        </>
      ) : null}
      {user.role !== 'REQUESTER' ? (
        <Select value={value.department_id || ''} onChange={set('department_id')} placeholder="All departments" options={deptOptions(lookups)} aria-label="Department" />
      ) : null}
      {category ? (
        <Select value={value.category_id || ''} onChange={set('category_id')} placeholder="All categories" options={catOptions(lookups)} aria-label="Category" />
      ) : null}
    </div>
  );
}

export const cleanParams = (f) => Object.fromEntries(Object.entries(f).filter(([, v]) => v !== '' && v !== undefined && v !== null));
