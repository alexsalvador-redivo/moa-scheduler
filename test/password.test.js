import { test } from 'node:test';
import assert from 'node:assert/strict';
import { passwordMode, passwordMatches, makeSession, readSession, cookieValue, sessionCookie } from '../src/password.js';
import { requestEmail } from '../src/auth.js';

const SECRET = 'correct horse battery staple';
const NOW = Date.parse('2026-11-06T17:00:00Z');

test('password mode needs AUTH_MODE=password and a DEMO_PASSWORD secret', () => {
  assert.equal(passwordMode({ AUTH_MODE: 'password', DEMO_PASSWORD: SECRET }), true);
  assert.equal(passwordMode({ AUTH_MODE: 'password' }), false);
  assert.equal(passwordMode({ DEMO_PASSWORD: SECRET }), false);
});

test('only the exact password matches', async () => {
  assert.equal(await passwordMatches(SECRET, SECRET), true);
  assert.equal(await passwordMatches('correct horse battery stapl', SECRET), false);
  assert.equal(await passwordMatches('', SECRET), false);
  assert.equal(await passwordMatches(undefined, SECRET), false);
  assert.equal(await passwordMatches(SECRET, ''), false);
});

test('a session round-trips, expires after a week, and rejects tampering', async () => {
  const token = await makeSession('priya@example.test', SECRET, NOW);
  assert.equal(await readSession(token, SECRET, NOW), 'priya@example.test');
  assert.equal(await readSession(token, SECRET, NOW + 6 * 86400e3), 'priya@example.test');
  assert.equal(await readSession(token, SECRET, NOW + 8 * 86400e3), null);
  assert.equal(await readSession(token, 'a new password', NOW), null);

  const [, sig] = token.split('.');
  const forged = `${Buffer.from(JSON.stringify({ e: 'manager@example.test', x: NOW / 1000 + 999 })).toString('base64url')}.${sig}`;
  assert.equal(await readSession(forged, SECRET, NOW), null);
  assert.equal(await readSession('garbage', SECRET, NOW), null);
  assert.equal(await readSession(`${token}.x`, SECRET, NOW), null);
  assert.equal(await readSession(null, SECRET, NOW), null);
});

test('the cookie is HttpOnly, Secure and read back from the header', async () => {
  const token = await makeSession('ana@example.test', SECRET, NOW);
  const set = sessionCookie(token);
  assert.match(set, /HttpOnly/);
  assert.match(set, /Secure/);
  assert.match(set, /SameSite=Lax/);
  const request = new Request('https://demo.test/api/me', { headers: { cookie: `other=1; ${set.split(';')[0]}` } });
  assert.equal(cookieValue(request), token);
});

test('requestEmail uses the cookie in password mode, but never when Access is configured', async () => {
  const token = await makeSession('ana@example.test', SECRET);
  const request = new Request('https://demo.test/api/me', { headers: { cookie: `moa_session=${token}` } });
  assert.equal(await requestEmail(request, { AUTH_MODE: 'password', DEMO_PASSWORD: SECRET }), 'ana@example.test');
  assert.equal(await requestEmail(request, { AUTH_MODE: 'password' }), null);
  const production = { AUTH_MODE: 'password', DEMO_PASSWORD: SECRET, ACCESS_TEAM_DOMAIN: 'x.cloudflareaccess.com', ACCESS_AUD: 'aud' };
  assert.equal(await requestEmail(request, production, async () => ({ ok: false, status: 500 })), null);
});
