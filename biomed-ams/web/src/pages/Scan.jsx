import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../lib/api.jsx';
import { QrScanner } from '../components/Scanner.jsx';
import { Button, Card, Field, Input, PageHeader } from '../components/ui.jsx';

export default function Scan() {
  const { call, toast } = useApp();
  const nav = useNavigate();
  const [manual, setManual] = useState('');
  const [active, setActive] = useState(true);

  const open = useCallback(
    async (tag) => {
      try {
        const a = await call('assets.lookup', { tag });
        nav(`/assets/${a.id}`, { replace: true });
      } catch (e) {
        toast(e.message, 'critical');
        setActive(false);
        setTimeout(() => setActive(true), 1500);
      }
    },
    [call, nav, toast],
  );

  return (
    <>
      <PageHeader back="/" title="Scan asset tag" subtitle="Opens the asset record: history, PPM, report a fault" />
      <Card>
        {active ? <QrScanner onDetect={open} /> : <p className="muted">Ready to scan again…</p>}
      </Card>
      <Card title="Or type the tag / serial number">
        <form className="row" onSubmit={(e) => { e.preventDefault(); if (manual.trim()) open(manual.trim()); }}>
          <Field className="grow"><Input value={manual} onChange={(e) => setManual(e.target.value)} placeholder="e.g. HDS/INF/2024/00003" autoCapitalize="characters" /></Field>
          <Button type="submit" icon="search">Find</Button>
        </form>
      </Card>
    </>
  );
}
