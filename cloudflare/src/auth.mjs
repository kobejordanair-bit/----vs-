import { HttpError } from './contracts.mjs';
export const TOKEN_TTL_SECONDS = 7 * 24 * 3600;
const encoder = new TextEncoder();
async function hmac(secret, message) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(message)));
  return btoa(String.fromCharCode(...signature)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}
export async function secureEqual(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const [one, two] = await Promise.all([left, right].map(value => crypto.subtle.digest('SHA-256', encoder.encode(value))));
  const a = new Uint8Array(one), b = new Uint8Array(two);
  let different = 0; for (let i = 0; i < a.length; i++) different |= a[i] ^ b[i];
  return different === 0;
}
export async function createToken(secret, now = Date.now()) {
  if (!secret) throw new HttpError(503, '登入服務尚未完成設定');
  const issued = Math.floor(now / 1000);
  return `v1.${issued}.${await hmac(secret, `dynasty-auth-v1:${issued}`)}`;
}
export async function verifyToken(token, secret, now = Date.now()) {
  if (!secret) throw new HttpError(503, '登入服務尚未完成設定');
  if (!token) throw new HttpError(403, '無效的存取金鑰');
  let issued;
  const signed = token.match(/^v1\.(\d{1,13})\.([A-Za-z0-9_-]{43})$/);
  if (signed) {
    issued = Number(signed[1]);
    if (!await secureEqual(signed[2], await hmac(secret, `dynasty-auth-v1:${signed[1]}`))) throw new HttpError(403, '無效的存取金鑰');
  } else {
    // Existing browsers can finish the old seven-day login period after the
    // move. Newly issued tokens contain a signature instead of the password.
    const legacy = token.match(/^(.+)\.(\d{1,13})$/);
    if (!legacy) throw new HttpError(401, '登入已過期，請重新登入');
    issued = Number(legacy[2]);
    if (!await secureEqual(legacy[1], secret)) throw new HttpError(403, '無效的存取金鑰');
  }
  if (!Number.isSafeInteger(issued) || issued > Math.floor(now / 1000) || Math.floor(now / 1000) - issued > TOKEN_TTL_SECONDS) throw new HttpError(401, '登入已過期，請重新登入');
}
export async function rateKey(request, scope, secret) {
  // CF supplies the client IP. Store only a keyed hash, never a password,
  // token, prompt, or raw address in the rate-limit database.
  const client = request.headers.get('cf-connecting-ip') || 'local-preview';
  return `${scope}:${await hmac(secret || 'unconfigured-preview', client)}`;
}
