import { useCallback, useState } from 'react';
import { useApp, useDebounced, useQuery } from '../lib/api.jsx';
import { Button, Modal, SearchBox, StatusBadge } from './ui.jsx';
import { QrScanner } from './Scanner.jsx';
import { ASSET_STATUS } from '../lib/format.js';

export default function AssetPicker({ value, onChange, required, label = 'Equipment' }) {
  const { call, toast } = useApp();
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 250);
  const [scan, setScan] = useState(false);
  const { data } = useQuery('assets.list', { q: dq, status: 'IN_FLEET', page_size: 8 }, { enabled: !value && dq.length >= 2 });

  const onDetect = useCallback(
    async (text) => {
      setScan(false);
      try {
        const hit = await call('assets.lookup', { tag: text });
        const a = await call('assets.get', { id: hit.id });
        onChange(a);
      } catch (e) {
        toast(e.message, 'critical');
      }
    },
    [call, onChange, toast],
  );

  if (value) {
    return (
      <div className="choice-card is-on" style={{ cursor: 'default' }}>
        <div className="grow">
          <strong className="mono">{value.tag_no}</strong>
          <span style={{ display: 'block' }}>{value.name} · {value.department_name}{value.location_name ? ` / ${value.location_name}` : ''}</span>
          <StatusBadge map={ASSET_STATUS} value={value.status} />
        </div>
        <Button variant="ghost" size="sm" onClick={() => onChange(null)}>Change</Button>
      </div>
    );
  }
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="row" style={{ flexWrap: 'nowrap' }}>
        <div className="grow"><SearchBox value={q} onChange={setQ} placeholder={`${label}: type tag, serial or name${required ? ' *' : ''}`} /></div>
        <Button variant="secondary" icon="scan" onClick={() => setScan(true)} aria-label="Scan tag">Scan</Button>
      </div>
      {data && dq.length >= 2 ? (
        <div className="card card-flush">
          {data.rows.length ? (
            <div className="list">
              {data.rows.map((a) => (
                <button key={a.id} type="button" className="row-link" style={{ width: '100%', border: 0, background: 'none', textAlign: 'left', cursor: 'pointer' }} onClick={() => onChange(a)}>
                  <div className="row-main">
                    <div className="row-top"><span className="row-title mono">{a.tag_no}</span><StatusBadge map={ASSET_STATUS} value={a.status} /></div>
                    <div className="row-meta"><span>{a.name}</span><span>{a.department_name}</span>{a.serial_no ? <span>S/N {a.serial_no}</span> : null}</div>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <p className="pad muted">No matching equipment in service.</p>
          )}
        </div>
      ) : null}
      <Modal open={scan} title="Scan asset tag" onClose={() => setScan(false)}>
        {scan ? <QrScanner onDetect={onDetect} /> : null}
      </Modal>
    </div>
  );
}
