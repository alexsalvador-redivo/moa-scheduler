// Password sign-in for a public demo copy of the app (AUTH_MODE = "password").
// Production uses Cloudflare Access instead and never turns this on.
//
// Everyone shares one password, kept as the Worker secret DEMO_PASSWORD (never in
// the repo or the database). The user ID is the part of a staff email before the @,
// so "manager" signs in as manager@example.test and "priya" as priya@example.test.
// A signed-in person gets an HttpOnly cookie holding their email and an expiry,
// signed with HMAC-SHA-256 under a key derived from the password: changing the
// password signs everyone out.

export const COOKIE = 'moa_session';
const SESSION_SECONDS = 7 * 24 * 60 * 60;
const enc = new TextEncoder();

export const passwordMode = (env) => env.AUTH_MODE === 'password' && Boolean(env.DEMO_PASSWORD);

const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)))
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

async function hmacKey(password) {
  const raw = await crypto.subtle.digest('SHA-256', enc.encode(`moa-session:${password}`));
  return crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

// Constant-time check of a typed password against the secret.
export async function passwordMatches(typed, secret) {
  if (typeof typed !== 'string' || !secret) return false;
  const key = await hmacKey(secret);
  const expected = await crypto.subtle.sign('HMAC', key, enc.encode(secret));
  return crypto.subtle.verify('HMAC', key, expected, enc.encode(typed));
}

export async function makeSession(email, secret, now = Date.now()) {
  const body = b64url(enc.encode(JSON.stringify({ e: email, x: Math.floor(now / 1000) + SESSION_SECONDS })));
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(body));
  return `${body}.${b64url(sig)}`;
}

// Returns the email in a valid, unexpired session token, or null.
export async function readSession(token, secret, now = Date.now()) {
  if (!token || !secret) return null;
  const [body, sig, extra] = token.split('.');
  if (!body || !sig || extra !== undefined) return null;
  try {
    const ok = await crypto.subtle.verify('HMAC', await hmacKey(secret), unb64url(sig), enc.encode(body));
    if (!ok) return null;
    const { e, x } = JSON.parse(new TextDecoder().decode(unb64url(body)));
    if (typeof e !== 'string' || typeof x !== 'number' || x < now / 1000) return null;
    return e;
  } catch {
    return null;
  }
}

export function cookieValue(request, name = COOKIE) {
  for (const part of (request.headers.get('cookie') ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return null;
}

export const sessionCookie = (token) =>
  `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_SECONDS}`;
export const clearCookie = () => `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;

// "manager" or "manager@example.test" → the matching active staff row, or null.
export async function findByUserId(db, userId) {
  const id = String(userId ?? '').trim().toLowerCase();
  if (!id) return null;
  const sql = id.includes('@')
    ? 'SELECT email FROM staff WHERE lower(email) = ? AND active = 1'
    : "SELECT email FROM staff WHERE lower(substr(email, 1, instr(email, '@') - 1)) = ? AND active = 1 ORDER BY id LIMIT 1";
  return db.prepare(sql).bind(id).first();
}
