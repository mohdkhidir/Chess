import { nextSeq } from './db.js';

export const TAG_TOKENS = [
  ['{HOSP}', 'Hospital code'],
  ['{CAT}', 'Equipment category code'],
  ['{DEPT}', 'Department code at registration (not recommended: equipment moves, tags should not)'],
  ['{YYYY}', 'Registration year, 4 digits'],
  ['{YY}', 'Registration year, 2 digits'],
  ['{MM}', 'Registration month'],
  ['{CLS}', 'H = capital asset (cost at or above threshold), I = inventory item'],
  ['{SEQ5}', 'Running number with 5 digits ({SEQ3} to {SEQ8} also allowed)'],
];

export function renderTag(format, v) {
  return format.replace(/\{(HOSP|CAT|DEPT|YYYY|YY|MM|CLS|SEQ([3-8])?)\}/g, (_m, tok, digits) => {
    switch (tok) {
      case 'HOSP': return v.hosp || '';
      case 'CAT': return v.cat || '';
      case 'DEPT': return v.dept || '';
      case 'YYYY': return v.date.slice(0, 4);
      case 'YY': return v.date.slice(2, 4);
      case 'MM': return v.date.slice(5, 7);
      case 'CLS': return v.cls || '';
      default:
        return v.seq == null ? '#' : String(v.seq).padStart(Number(digits || 5), '0');
    }
  });
}

export function assetClass(settings, cost) {
  return Number(cost) >= Number(settings.capital_threshold) ? 'H' : 'I';
}

// The running number is scoped by everything else in the rendered tag, so a format such as
// {HOSP}/{CAT}/{YYYY}/{SEQ5} restarts at 00001 for each category every year.
export function generateTag(db, settings, { categoryCode, departmentCode, date, cost }) {
  const vals = {
    hosp: settings.hospital_code,
    cat: categoryCode,
    dept: departmentCode,
    date,
    cls: assetClass(settings, cost),
  };
  const key = `TAG:${renderTag(settings.tag_format, { ...vals, seq: null })}`;
  for (let i = 0; i < 10000; i++) {
    const tag = renderTag(settings.tag_format, { ...vals, seq: nextSeq(db, key) });
    if (!db.get('SELECT 1 FROM assets WHERE tag_no = ?', [tag])) return tag;
  }
  throw new Error('Could not allocate a unique tag number');
}

export function previewTag(settings, sample = {}) {
  return renderTag(settings.tag_format, {
    hosp: settings.hospital_code,
    cat: sample.cat || 'INF',
    dept: sample.dept || 'ICU',
    date: sample.date || '2026-01-15',
    cls: sample.cls || 'H',
    seq: 1,
  });
}
