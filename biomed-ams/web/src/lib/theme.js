const KEY = 'ams.theme';

export function getTheme() {
  try {
    return localStorage.getItem(KEY) || 'system';
  } catch {
    return 'system';
  }
}

// 'system' leaves the page alone at start-up, so a theme set by whatever hosts the page wins.
export function applyTheme(theme = getTheme(), { initial = true } = {}) {
  const root = document.documentElement;
  if (theme === 'light' || theme === 'dark') root.setAttribute('data-theme', theme);
  else if (!initial) root.removeAttribute('data-theme');
}

export function setTheme(theme) {
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* ignore */
  }
  applyTheme(theme, { initial: false });
}
