import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { rpc, getToken, setToken } from './transport.js';
import { setHospitalTimeZone } from './format.js';

const Ctx = createContext(null);

export function AppProvider({ children }) {
  const [auth, setAuth] = useState('checking'); // checking | anonymous | password | ready
  const [user, setUser] = useState(null);
  const [lookups, setLookups] = useState(null);
  const [settings, setSettings] = useState(null);
  const [badges, setBadges] = useState({ approvals: 0, tickets: 0, my_work: 0 });
  const [toasts, setToasts] = useState([]);
  const toastId = useRef(0);

  const toast = useCallback((message, tone = 'info') => {
    const id = ++toastId.current;
    setToasts((t) => [...t.slice(-2), { id, message, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === 'critical' ? 7000 : 4000);
  }, []);

  const signOutLocal = useCallback(() => {
    setToken(null);
    setUser(null);
    setLookups(null);
    setSettings(null);
    setAuth('anonymous');
  }, []);

  const call = useCallback(
    async (method, params) => {
      try {
        return await rpc(method, params);
      } catch (e) {
        if (e.status === 401 && method !== 'auth.login') signOutLocal();
        if (e.code === 'PASSWORD_CHANGE_REQUIRED') setAuth('password');
        throw e;
      }
    },
    [signOutLocal],
  );

  const refreshBadges = useCallback(async () => {
    try {
      setBadges(await rpc('dashboard.badges'));
    } catch {
      /* non-critical */
    }
  }, []);

  const enter = useCallback(
    async (u) => {
      setUser(u);
      if (u.must_change_password) {
        setAuth('password');
        return;
      }
      const [lk, st] = await Promise.all([rpc('master.lookups'), rpc('settings.get')]);
      setHospitalTimeZone(st.settings.timezone);
      setLookups(lk);
      setSettings(st.settings);
      setAuth('ready');
      refreshBadges();
    },
    [refreshBadges],
  );

  const restore = useCallback(async () => {
    if (!getToken()) {
      setAuth('anonymous');
      return;
    }
    try {
      await enter(await rpc('auth.me'));
    } catch {
      signOutLocal();
    }
  }, [enter, signOutLocal]);

  const login = useCallback(
    async (username, password) => {
      const r = await rpc('auth.login', { username, password });
      setToken(r.token);
      await enter(r.user);
      return r.user;
    },
    [enter],
  );

  const adopt = useCallback(
    async (token, u) => {
      setToken(token);
      await enter(u);
    },
    [enter],
  );

  const logout = useCallback(async () => {
    try {
      await rpc('auth.logout');
    } catch {
      /* ignore */
    }
    signOutLocal();
  }, [signOutLocal]);

  const value = useMemo(
    () => ({
      auth,
      user,
      lookups,
      settings,
      badges,
      toasts,
      toast,
      call,
      login,
      adopt,
      logout,
      restore,
      can: (perm) => !!user?.permissions?.includes(perm),
      refreshBadges,
      refreshLookups: async () => setLookups(await call('master.lookups')),
      refreshSettings: async () => {
        const st = (await call('settings.get')).settings;
        setHospitalTimeZone(st.timezone);
        setSettings(st);
      },
      refreshMe: async () => {
        const me = await call('auth.me');
        setUser(me);
        if (!me.must_change_password && auth === 'password') await enter(me);
        return me;
      },
    }),
    [auth, user, lookups, settings, badges, toasts, toast, call, login, adopt, logout, restore, refreshBadges, enter],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useApp = () => useContext(Ctx);

// Loads data for a screen. While reloading, the previous data stays on screen.
export function useQuery(method, params, { enabled = true } = {}) {
  const { call } = useApp();
  const key = `${method}:${JSON.stringify(params ?? {})}`;
  const [state, setState] = useState({ data: null, error: null, loading: enabled });
  const [tick, setTick] = useState(0);
  const paramsRef = useRef(params);
  paramsRef.current = params;
  useEffect(() => {
    if (!enabled) return undefined;
    let alive = true;
    setState((s) => ({ ...s, loading: true }));
    call(method, paramsRef.current ?? {}).then(
      (data) => alive && setState({ data, error: null, loading: false }),
      (error) => alive && setState((s) => ({ data: s.data, error, loading: false })),
    );
    return () => {
      alive = false;
    };
  }, [key, tick, enabled, call, method]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { ...state, reload };
}

// Runs an action with busy state and a toast on success or failure.
export function useAction() {
  const { call, toast, refreshBadges } = useApp();
  const [busy, setBusy] = useState(false);
  const run = useCallback(
    async (method, params, { success, onDone } = {}) => {
      setBusy(true);
      try {
        const r = await call(method, params);
        if (success) toast(typeof success === 'function' ? success(r) : success, 'good');
        refreshBadges();
        if (onDone) await onDone(r);
        return r;
      } catch (e) {
        toast(e.message, 'critical');
        throw e;
      } finally {
        setBusy(false);
      }
    },
    [call, toast, refreshBadges],
  );
  return [run, busy];
}

export function useDebounced(value, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}
