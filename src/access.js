// Verifies the Cloudflare Access JWT (Cf-Access-Jwt-Assertion header) with
// WebCrypto: RS256 signature against the team's published keys, audience,
// issuer and expiry. Returns the signed-in email, or null.

const KEY_TTL_MS = 60 * 60 * 1000;
const keyCache = new Map(); // teamDomain → { keys, fetchedAt }

function b64urlBytes(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=');
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

const b64urlJson = (s) => JSON.parse(new TextDecoder().decode(b64urlBytes(s)));

async function teamKeys(teamDomain, fetchImpl, force) {
  const cached = keyCache.get(teamDomain);
  if (!force && cached && Date.now() - cached.fetchedAt < KEY_TTL_MS) return cached.keys;
  const res = await fetchImpl(`https://${teamDomain}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error(`Access certs ${res.status}`);
  const { keys } = await res.json();
  keyCache.set(teamDomain, { keys, fetchedAt: Date.now() });
  return keys;
}

export function clearKeyCache() {
  keyCache.clear();
}

export async function verifyAccessJwt(token, { teamDomain, aud, fetchImpl = fetch, now = Date.now() }) {
  if (!token || !teamDomain || !aud) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  let header, payload;
  try {
    header = b64urlJson(parts[0]);
    payload = b64urlJson(parts[1]);
  } catch {
    return null;
  }
  if (header.alg !== 'RS256' || !header.kid) return null;

  let jwk = (await teamKeys(teamDomain, fetchImpl, false)).find((k) => k.kid === header.kid);
  if (!jwk) jwk = (await teamKeys(teamDomain, fetchImpl, true)).find((k) => k.kid === header.kid); // keys rotated
  if (!jwk) return null;

  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlBytes(parts[2]),
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  if (!ok) return null;

  const seconds = now / 1000;
  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!audiences.includes(aud)) return null;
  if (payload.iss !== `https://${teamDomain}`) return null;
  if (typeof payload.exp !== 'number' || payload.exp < seconds) return null;
  if (typeof payload.nbf === 'number' && payload.nbf > seconds + 60) return null;
  return typeof payload.email === 'string' ? payload.email.toLowerCase() : null;
}
