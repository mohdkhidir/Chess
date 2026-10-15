import { Link, useNavigate } from 'react-router-dom';
import { useApp, useQuery } from '../lib/api.jsx';
import { Badge, Card, Empty, ErrorBox, LinkButton, Loading, RowLink, StatusBadge } from '../components/ui.jsx';
import { KpiTile, LineChart, Meter, StatTile } from '../components/charts.jsx';
import { RISK_LEVEL, TICKET_STATUS, ago, date, monthLabel, nowLocalInput } from '../lib/format.js';

function greeting() {
  const h = Number(nowLocalInput().slice(11, 13));
  return h < 12 ? 'Selamat pagi' : h < 15 ? 'Selamat tengah hari' : h < 19 ? 'Selamat petang' : 'Selamat malam';
}

export default function Dashboard() {
  const { user, can } = useApp();
  const nav = useNavigate();
  const { data: d, error, loading, reload } = useQuery('dashboard.get', {});

  if (!d && loading) return <Loading />;
  if (!d) return <ErrorBox error={error} onRetry={reload} />;
  const requester = user.role === 'REQUESTER';

  return (
    <div className={loading ? 'is-stale' : ''}>
      <div className="page-head">
        <div>
          <h1>{greeting()}, {user.full_name.split(' ')[0]}</h1>
          <p className="muted">{date(d.today)} · {user.role_label}{user.approval_level ? ` · Level ${user.approval_level} approver` : ''}</p>
        </div>
        <div className="page-actions">
          {can('ticket.create') ? <LinkButton to="/tickets/new" variant="primary" icon="headset">Report a fault</LinkButton> : null}
          {can('asset.create') ? <LinkButton to="/assets/new" icon="tag">Register asset</LinkButton> : null}
          {can('wo.create') ? <LinkButton to="/wo/new" icon="wrench">New work order</LinkButton> : null}
        </div>
      </div>
      <ErrorBox error={error} onRetry={reload} />

      <div className="grid-stats">
        <StatTile label={requester ? 'Equipment in my department' : 'Assets in service'} value={d.assets.fleet || 0} sub={`${d.assets.STANDBY || 0} standby`} onClick={() => nav('/assets')} />
        <StatTile label="Breakdown now" value={d.assets.BREAKDOWN || 0} tone={d.assets.BREAKDOWN ? 'critical' : undefined} sub="Awaiting repair" onClick={() => nav('/assets?status=BREAKDOWN')} />
        <StatTile label="PPM due this month" value={d.ppm.due} tone={d.ppm.due ? 'warning' : undefined} sub={`${d.ppm.done_this_month} done`} onClick={() => nav('/ppm?view=OPEN')} />
        <StatTile label="PPM overdue" value={d.ppm.overdue} tone={d.ppm.overdue ? 'critical' : 'good'} sub="Past due window" onClick={() => nav('/ppm?view=OVERDUE')} />
        {d.wo ? (
          <StatTile label="Open work orders" value={d.wo.open} tone={d.wo.p1 ? 'critical' : undefined} sub={`${d.wo.p1} P1 · ${d.wo.on_hold} on hold`} onClick={() => nav('/wo?status=ACTIVE')} />
        ) : (
          <StatTile label="My open tickets" value={d.my_tickets.length} onClick={() => nav('/tickets?mine=1')} />
        )}
        <StatTile
          label={can('ticket.manage') ? 'New helpdesk tickets' : 'Tickets to confirm'}
          value={can('ticket.manage') ? d.tickets.new : d.tickets.awaiting_confirmation}
          tone={(can('ticket.manage') ? d.tickets.new : d.tickets.awaiting_confirmation) ? 'warning' : undefined}
          sub={`${d.tickets.in_progress} in progress`}
          onClick={() => nav('/tickets')}
        />
      </div>

      {d.approvals_pending || (d.wo && (d.wo.mine || d.wo.awaiting_verification)) || d.ppm.mine || d.assets.warranty_expiring ? (
        <Card className="section-gap" title="Needs your attention">
          <div className="list">
            {d.approvals_pending ? <RowLink to="/approvals"><span className="row-title">{d.approvals_pending} request(s) waiting for your approval</span></RowLink> : null}
            {d.wo && d.wo.mine ? <RowLink to="/wo?assigned=me"><span className="row-title">{d.wo.mine} work order(s) assigned to you</span></RowLink> : null}
            {d.ppm.mine ? <RowLink to="/ppm?view=OPEN&assigned=me"><span className="row-title">{d.ppm.mine} PPM(s) due or overdue for you</span></RowLink> : null}
            {d.wo && d.wo.awaiting_verification && can('wo.close') ? <RowLink to="/wo?status=COMPLETED"><span className="row-title">{d.wo.awaiting_verification} completed repair(s) to verify and close</span></RowLink> : null}
            {d.wo && d.wo.unassigned && can('wo.assign') ? <RowLink to="/wo?assigned=none"><span className="row-title">{d.wo.unassigned} work order(s) not yet assigned</span></RowLink> : null}
            {d.assets.warranty_expiring ? <RowLink to="/assets"><span className="row-title">{d.assets.warranty_expiring} warranty(ies) ending within 90 days</span></RowLink> : null}
          </div>
        </Card>
      ) : null}

      {d.kpi ? (
        <>
          <h2 className="section-gap" style={{ margin: '20px 0 10px' }}>KPI — this month</h2>
          <div className="grid-3">
            <KpiTile label="PPM completion" value={d.kpi.ppm} target={d.kpi.targets.ppm} hint="PPMs done ÷ PPMs due" />
            <KpiTile label="Work order closure" value={d.kpi.cm_closure} target={d.kpi.targets.cm_closure} hint="Corrective WOs closed ÷ raised" />
            <KpiTile label="Equipment uptime" value={d.kpi.uptime} target={d.kpi.targets.uptime} hint="Hours available ÷ hours in service" />
          </div>
          <Card className="section-gap" title="Last 6 months" subtitle="PPM completion and work order closure rate" actions={<LinkButton to="/kpi" variant="ghost">KPI details</LinkButton>}>
            <LineChart
              labels={d.trend.months.map((m) => monthLabel(m.month))}
              series={[
                { key: 'ppm', label: 'PPM completion %', color: 'var(--s1)', values: d.trend.months.map((m) => m.ppm_completion) },
                { key: 'cm', label: 'WO closure %', color: 'var(--s2)', values: d.trend.months.map((m) => m.cm_closure) },
              ]}
              yMax={100}
              unit="%"
              target={{ value: d.trend.targets.ppm, label: `PPM target ${d.trend.targets.ppm}%` }}
              ariaLabel="PPM completion and work order closure over the last six months"
            />
          </Card>
        </>
      ) : null}

      <div className="grid-2 section-gap">
        {d.risk ? (
          <Card title="Highest breakdown risk" subtitle="From maintenance history, age and cost" actions={<LinkButton to="/predictive" variant="ghost">All</LinkButton>}>
            {d.risk.top.length ? (
              <div className="list">
                {d.risk.top.map((r) => (
                  <RowLink key={r.id} to={`/assets/${r.id}`}>
                    <div className="row-top">
                      <span className="row-title">{r.tag_no}</span>
                      <StatusBadge map={RISK_LEVEL} value={r.level} />
                    </div>
                    <div className="row-meta"><span>{r.name}</span><span>{r.department_name}</span></div>
                    <div className="risk-bar"><Meter value={r.score} tone={RISK_LEVEL[r.level][1]} label={`Risk score ${r.score}`} /><span className="score">{r.score}</span></div>
                  </RowLink>
                ))}
              </div>
            ) : (
              <Empty title="No assets yet" />
            )}
          </Card>
        ) : null}

        {requester || d.my_tickets.length ? (
          <Card title="My helpdesk tickets" actions={<LinkButton to="/tickets/new" variant="ghost" icon="plus">New</LinkButton>}>
            {d.my_tickets.length ? (
              <div className="list">
                {d.my_tickets.map((t) => (
                  <RowLink key={t.id} to={`/tickets/${t.id}`}>
                    <div className="row-top"><span className="row-title">{t.subject}</span><StatusBadge map={TICKET_STATUS} value={t.status} /></div>
                    <div className="row-meta"><span className="mono">{t.ticket_no}</span>{t.tag_no ? <span>{t.tag_no}</span> : null}<span>{ago(t.created_at)}</span></div>
                  </RowLink>
                ))}
              </div>
            ) : (
              <Empty icon="headset" title="No open tickets">Report a faulty device and the biomedical team is notified.</Empty>
            )}
          </Card>
        ) : null}

        <Card title="Recent activity">
          {d.recent.length ? (
            <ul className="timeline">
              {d.recent.map((e) => (
                <li key={e.id}>
                  <div className="t-when">{ago(e.created_at)}{e.user_name ? ` · ${e.user_name}` : ''}</div>
                  <div className="t-what"><Link to={`/assets/${e.asset_id}`}>{e.tag_no}</Link> <Badge>{e.event_type.replace(/_/g, ' ').toLowerCase()}</Badge></div>
                  <div className="t-desc">{e.description}</div>
                </li>
              ))}
            </ul>
          ) : (
            <Empty title="Nothing yet" />
          )}
        </Card>
      </div>
    </div>
  );
}
