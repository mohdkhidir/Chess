import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useApp } from './lib/api.jsx';
import { detectServer, getConfig, rpc, setConfig } from './lib/transport.js';
import Layout from './components/Layout.jsx';
import { Loading, Toasts } from './components/ui.jsx';
import { ConnectionError, ForcedPasswordChange, Login, Setup, Splash, Welcome } from './pages/Auth.jsx';
import Dashboard from './pages/Dashboard.jsx';

const Assets = lazy(() => import('./pages/Assets.jsx'));
const AssetForm = lazy(() => import('./pages/AssetForm.jsx'));
const AssetDetail = lazy(() => import('./pages/AssetDetail.jsx'));
const AssetImport = lazy(() => import('./pages/AssetImport.jsx'));
const PpmSchedule = lazy(() => import('./pages/PpmSchedule.jsx'));
const PpmMasterlist = lazy(() => import('./pages/PpmMasterlist.jsx'));
const PpmPlans = lazy(() => import('./pages/PpmPlans.jsx'));
const PpmDetail = lazy(() => import('./pages/PpmDetail.jsx'));
const WorkOrders = lazy(() => import('./pages/WorkOrders.jsx'));
const WorkOrderNew = lazy(() => import('./pages/WorkOrderNew.jsx'));
const WorkOrderDetail = lazy(() => import('./pages/WorkOrderDetail.jsx'));
const Tickets = lazy(() => import('./pages/Tickets.jsx'));
const TicketNew = lazy(() => import('./pages/TicketNew.jsx'));
const TicketDetail = lazy(() => import('./pages/TicketDetail.jsx'));
const Approvals = lazy(() => import('./pages/Approvals.jsx'));
const Kpi = lazy(() => import('./pages/Kpi.jsx'));
const Predictive = lazy(() => import('./pages/Predictive.jsx'));
const Lifecycle = lazy(() => import('./pages/Lifecycle.jsx'));
const Expenses = lazy(() => import('./pages/Expenses.jsx'));
const Reports = lazy(() => import('./pages/Reports.jsx'));
const Settings = lazy(() => import('./pages/Settings.jsx'));
const MasterData = lazy(() => import('./pages/MasterData.jsx'));
const Users = lazy(() => import('./pages/Users.jsx'));
const AuditLog = lazy(() => import('./pages/AuditLog.jsx'));
const Profile = lazy(() => import('./pages/Profile.jsx'));
const Scan = lazy(() => import('./pages/Scan.jsx'));

export default function App() {
  const { auth, restore, toasts, logout } = useApp();
  const [boot, setBoot] = useState({ state: 'init' });

  const start = useCallback(async () => {
    setBoot({ state: 'init' });
    if (!getConfig().mode) {
      if (await detectServer()) setConfig({ mode: 'server', serverUrl: '' });
      else {
        setBoot({ state: 'choose' });
        return;
      }
    }
    try {
      const meta = await rpc('meta.bootstrap');
      setBoot({ state: 'ready', meta });
      if (!meta.needs_setup) await restore();
    } catch (error) {
      setBoot({ state: 'error', error });
    }
  }, [restore]);

  useEffect(() => {
    start();
  }, [start]);

  const changeMode = useCallback(async () => {
    await logout();
    setConfig({ mode: null });
    setBoot({ state: 'choose' });
  }, [logout]);

  let screen;
  if (boot.state === 'init') screen = <Splash />;
  else if (boot.state === 'choose') screen = <Welcome onDone={start} />;
  else if (boot.state === 'error') screen = <ConnectionError error={boot.error} onRetry={start} onReset={changeMode} />;
  else if (boot.meta.needs_setup) screen = <Setup meta={boot.meta} onDone={start} onChangeMode={changeMode} />;
  else if (auth === 'checking') screen = <Splash label="Signing in…" />;
  else if (auth === 'anonymous') screen = <Login meta={boot.meta} onChangeMode={changeMode} />;
  else if (auth === 'password') screen = <ForcedPasswordChange />;
  else {
    screen = (
      <Layout meta={boot.meta}>
        <Suspense fallback={<Loading />}>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/assets" element={<Assets />} />
            <Route path="/assets/new" element={<AssetForm />} />
            <Route path="/assets/import" element={<AssetImport />} />
            <Route path="/assets/:id" element={<AssetDetail />} />
            <Route path="/assets/:id/edit" element={<AssetForm />} />
            <Route path="/ppm" element={<PpmSchedule />} />
            <Route path="/ppm/masterlist" element={<PpmMasterlist />} />
            <Route path="/ppm/plans" element={<PpmPlans />} />
            <Route path="/ppm/:id" element={<PpmDetail />} />
            <Route path="/wo" element={<WorkOrders />} />
            <Route path="/wo/new" element={<WorkOrderNew />} />
            <Route path="/wo/:id" element={<WorkOrderDetail />} />
            <Route path="/tickets" element={<Tickets />} />
            <Route path="/tickets/new" element={<TicketNew />} />
            <Route path="/tickets/:id" element={<TicketDetail />} />
            <Route path="/approvals" element={<Approvals />} />
            <Route path="/kpi" element={<Kpi />} />
            <Route path="/predictive" element={<Predictive />} />
            <Route path="/lifecycle" element={<Lifecycle />} />
            <Route path="/expenses" element={<Expenses />} />
            <Route path="/reports" element={<Reports />} />
            <Route path="/settings" element={<Settings onChangeMode={changeMode} />} />
            <Route path="/masterdata" element={<MasterData />} />
            <Route path="/users" element={<Users />} />
            <Route path="/audit" element={<AuditLog />} />
            <Route path="/profile" element={<Profile onChangeMode={changeMode} />} />
            <Route path="/scan" element={<Scan />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </Layout>
    );
  }
  return (
    <>
      {screen}
      <Toasts toasts={toasts} />
    </>
  );
}
