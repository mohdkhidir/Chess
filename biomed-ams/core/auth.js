// Password hashing and session tokens built on WebCrypto, which exists in Node 22
// (globalThis.crypto) and in the Android WebView (secure context: https://localhost).

const enc = new TextEncoder();

function toB64(bytes) {
  let s = '';
  const arr = new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]);
  return btoa(s);
}

function fromB64(s) {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function toHex(buf) {
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

function subtle() {
  const c = globalThis.crypto;
  if (!c || !c.subtle) {
    throw new Error('Secure crypto is unavailable. Open the app over https:// or http://localhost.');
  }
  return c.subtle;
}

async function derive(password, salt, iterations) {
  const key = await subtle().importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  return subtle().deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
}

export async function hashPassword(password, iterations = 210000) {
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const bits = await derive(password, salt, iterations);
  return `pbkdf2-sha256$${iterations}$${toB64(salt)}$${toB64(bits)}`;
}

export async function verifyPassword(password, stored) {
  const [alg, it, saltB64, hashB64] = String(stored || '').split('$');
  if (alg !== 'pbkdf2-sha256' || !it || !saltB64 || !hashB64) return false;
  const bits = new Uint8Array(await derive(password, fromB64(saltB64), Number(it)));
  const expected = fromB64(hashB64);
  if (bits.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < bits.length; i++) diff |= bits[i] ^ expected[i];
  return diff === 0;
}

export function randomToken() {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(32));
  return toB64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function sha256Hex(s) {
  return toHex(await subtle().digest('SHA-256', enc.encode(s)));
}

export function checkPasswordStrength(pw) {
  if (typeof pw !== 'string' || pw.length < 8) return 'Password must be at least 8 characters';
  if (pw.length > 128) return 'Password is too long';
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return 'Password must contain letters and numbers';
  return null;
}
