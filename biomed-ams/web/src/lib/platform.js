import { Capacitor, SystemBars, SystemBarsStyle, SystemBarType } from '@capacitor/core';

export const isNative = () => Capacitor.isNativePlatform();

// Android hardware back button: close the top-most dialog first, then go back, then exit.
const backHandlers = [];

export function pushBackHandler(fn) {
  backHandlers.push(fn);
  return () => {
    const i = backHandlers.lastIndexOf(fn);
    if (i >= 0) backHandlers.splice(i, 1);
  };
}

export async function initNative() {
  if (!isNative()) return;
  try {
    // Light status-bar icons over the blue app bar.
    await SystemBars.setStyle({ style: SystemBarsStyle.Dark, bar: SystemBarType.StatusBar });
  } catch {
    /* older shells: ignore */
  }
  const { App } = await import('@capacitor/app');
  App.addListener('backButton', ({ canGoBack }) => {
    const top = backHandlers[backHandlers.length - 1];
    if (top) {
      top();
      return;
    }
    if (canGoBack && window.location.hash && window.location.hash !== '#/') window.history.back();
    else App.exitApp();
  });
}

function toBase64(bytes) {
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) s += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  return btoa(s);
}

// Saves a generated file. On Android it opens the share sheet (Drive, WhatsApp, e-mail, Files);
// in a browser it downloads.
export async function saveFile(filename, data, mime) {
  const bytes = typeof data === 'string'
    ? new TextEncoder().encode(data)
    : data instanceof ArrayBuffer ? new Uint8Array(data) : data;
  if (isNative()) {
    const [{ Filesystem, Directory }, { Share }] = await Promise.all([import('@capacitor/filesystem'), import('@capacitor/share')]);
    const res = await Filesystem.writeFile({ path: filename, data: toBase64(bytes), directory: Directory.Cache });
    await Share.share({ title: filename, files: [res.uri], dialogTitle: 'Save or share' });
    return;
  }
  const blob = new Blob([bytes], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
