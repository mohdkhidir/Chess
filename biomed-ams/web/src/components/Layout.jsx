import { useEffect, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { Icon } from './icons.jsx';
import { IconButton } from './ui.jsx';
import { useApp } from '../lib/api.jsx';
import { pushBackHandler } from '../lib/platform.js';

export const NAV = [
  {
    group: 'Overview',
    items: [
      { to: '/', label: 'Dashboard', icon: 'home', end: true },
      { to: '/kpi', label: 'KPI', icon: 'chart', perm: 'kpi.view' },
    ],
  },
  {
    group: 'Assets',
    items: [
      { to: '/assets', label: 'Asset masterlist', icon: 'box', perm: 'asset.view', end: true },
      { to: '/assets/new', label: 'Register asset', icon: 'tag', perm: 'asset.create' },
      { to: '/scan', label: 'Scan tag', icon: 'scan', perm: 'asset.view' },
    ],
  },
  {
    group: 'Maintenance',
    items: [
      { to: '/ppm', label: 'PPM schedule', icon: 'calendar', perm: 'ppm.view', end: true },
      { to: '/ppm/masterlist', label: 'PPM masterlist', icon: 'grid', perm: 'ppm.view' },
      { to: '/ppm/plans', label: 'PPM plans', icon: 'list', perm: 'ppm.plan' },
      { to: '/wo', label: 'Corrective (CM)', icon: 'wrench', perm: 'wo.view', badge: 'my_work' },
      { to: '/tickets', label: 'Helpdesk', icon: 'headset', perm: 'ticket.view', badge: 'tickets' },
    ],
  },
  {
    group: 'Approvals',
    items: [{ to: '/approvals', label: 'Approvals', icon: 'checkCircle', badge: 'approvals' }],
  },
  {
    group: 'Analytics & reports',
    items: [
      { to: '/predictive', label: 'Predictive', icon: 'trend', perm: 'analytics.view' },
      { to: '/lifecycle', label: 'Lifespan', icon: 'hourglass', perm: 'analytics.view' },
      { to: '/expenses', label: 'Expenses', icon: 'wallet', perm: 'analytics.view' },
      { to: '/reports', label: 'Reports', icon: 'file', perm: 'report.view' },
    ],
  },
  {
    group: 'Administration',
    items: [
      { to: '/masterdata', label: 'Master data', icon: 'database', perm: 'masterdata.manage' },
      { to: '/users', label: 'Users', icon: 'users', perm: 'users.manage' },
      { to: '/settings', label: 'Settings', icon: 'settings' },
      { to: '/audit', label: 'Audit log', icon: 'history', perm: 'audit.view' },
    ],
  },
];

function bottomItems(role) {
  if (role === 'REQUESTER') {
    return [
      { to: '/', label: 'Home', icon: 'home', end: true },
      { to: '/tickets', label: 'Helpdesk', icon: 'headset', badge: 'tickets' },
      { to: '/assets', label: 'Equipment', icon: 'box' },
    ];
  }
  if (role === 'VIEWER') {
    return [
      { to: '/', label: 'Home', icon: 'home', end: true },
      { to: '/assets', label: 'Assets', icon: 'box' },
      { to: '/kpi', label: 'KPI', icon: 'chart' },
    ];
  }
  return [
    { to: '/', label: 'Home', icon: 'home', end: true },
    { to: '/assets', label: 'Assets', icon: 'box' },
    { to: '/ppm', label: 'PPM', icon: 'calendar' },
    { to: '/wo', label: 'Repairs', icon: 'wrench', badge: 'my_work' },
  ];
}

const initials = (name = '') => name.split(/\s+/).filter((w) => /^[A-Za-z]/.test(w)).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?';

export default function Layout({ meta, children }) {
  const { user, can, badges, refreshBadges, settings } = useApp();
  const [drawer, setDrawer] = useState(false);
  const loc = useLocation();
  const nav = useNavigate();
  const visible = (it) => !it.perm || can(it.perm);
  const groups = NAV.map((g) => ({ ...g, items: g.items.filter(visible) })).filter((g) => g.items.length);
  const hospital = settings?.hospital_name || meta?.hospital_name || 'BioMed AMS';

  useEffect(() => {
    setDrawer(false);
    window.scrollTo(0, 0);
  }, [loc.pathname]);
  useEffect(() => {
    refreshBadges();
    const t = setInterval(refreshBadges, 60000);
    return () => clearInterval(t);
  }, [refreshBadges]);
  useEffect(() => (drawer ? pushBackHandler(() => setDrawer(false)) : undefined), [drawer]);

  const count = (it) => (it.badge ? badges[it.badge] || 0 : 0);

  return (
    <div className="app">
      <aside className="sidebar" aria-label="Main navigation">
        <Link to="/" className="brand" style={{ textDecoration: 'none', color: 'inherit' }}>
          <img src="./icon.svg" alt="" className="brand-mark" />
          <span>
            <span className="brand-name">BioMed AMS</span>
            <br />
            <span className="brand-sub">{hospital}</span>
          </span>
        </Link>
        {groups.map((g) => (
          <div key={g.group}>
            <div className="nav-group-title">{g.group}</div>
            {g.items.map((it) => (
              <NavLink key={it.to} to={it.to} end={it.end} className={({ isActive }) => `side-link${isActive ? ' is-active' : ''}`}>
                <Icon name={it.icon} size={19} />
                {it.label}
                {count(it) ? <span className="count">{count(it)}</span> : null}
              </NavLink>
            ))}
          </div>
        ))}
        <div className="side-foot">
          <NavLink to="/profile" className={({ isActive }) => `side-link${isActive ? ' is-active' : ''}`}>
            <span className="avatar" style={{ width: 28, height: 28, fontSize: '0.72rem' }}>{initials(user.full_name)}</span>
            <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user.full_name}</span>
          </NavLink>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div className="topbar-title">
            <span className="hide-desktop">BioMed AMS</span>
            <span className="topbar-sub hide-desktop">{hospital}</span>
            <span className="hide-mobile">{hospital}</span>
          </div>
          {can('asset.view') ? <IconButton icon="scan" label="Scan asset tag" onClick={() => nav('/scan')} /> : null}
          <IconButton icon="checkCircle" label="Approvals" badge={badges.approvals} onClick={() => nav('/approvals')} />
          <IconButton icon="user" label="My profile" className="hide-desktop" onClick={() => nav('/profile')} />
        </header>
        {meta?.demo ? <div className="demo-banner">Demo data — a fictional hospital for evaluation. Do not enter real patient or staff information.</div> : null}
        <main className="content">{children}</main>
      </div>

      <nav className="bottomnav" aria-label="Quick navigation">
        {bottomItems(user.role).map((it) => (
          <NavLink key={it.to} to={it.to} end={it.end} className={({ isActive }) => (isActive ? 'is-active' : '')}>
            <Icon name={it.icon} size={22} />
            {it.label}
            {count(it) ? <span className="nav-badge">{count(it)}</span> : null}
          </NavLink>
        ))}
        <button type="button" onClick={() => setDrawer(true)} aria-expanded={drawer}>
          <Icon name="menu" size={22} />
          More
          {badges.approvals ? <span className="nav-badge">{badges.approvals}</span> : null}
        </button>
      </nav>

      {drawer ? (
        <>
          <div className="drawer-backdrop" onClick={() => setDrawer(false)} />
          <div className="drawer" role="dialog" aria-label="All modules">
            <div className="drawer-handle" />
            <Link to="/profile" className="drawer-user" style={{ textDecoration: 'none', color: 'inherit' }}>
              <span className="avatar">{initials(user.full_name)}</span>
              <span>
                <strong>{user.full_name}</strong>
                <br />
                <span className="muted small">
                  {user.role_label}
                  {user.approval_level ? ` · Approver L${user.approval_level}` : ''}
                </span>
              </span>
            </Link>
            {groups.map((g) => (
              <div key={g.group}>
                <div className="nav-group-title">{g.group}</div>
                <div className="nav-grid">
                  {g.items.map((it) => (
                    <Link key={it.to} to={it.to} className="nav-tile">
                      <Icon name={it.icon} size={22} />
                      {it.label}
                      {count(it) ? <span className="nav-badge">{count(it)}</span> : null}
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
