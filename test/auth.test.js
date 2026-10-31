import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { requestEmail, clinicToday } from '../src/auth.js';
import { verifyAccessJwt, clearKeyCache } from '../src/access.js';

const TEAM = 'clinic.cloudflareaccess.com';
const AUD = 'aud-tag-123';
const NOW = Date.parse('2026-11-02T17:00:00Z');

const b64url = (bytes) => Buffer.from(bytes).toString('base64url');
const { publicKey, privateKey } = await crypto.subtle.generateKey(
  { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
  true, ['sign', 'verify']);
const jwk = { ...(await crypto.subtle.exportKey('jwk', publicKey)), kid: 'k1' };

async function sign(payload, { kid = 'k1', key = privateKey } = {}) {
  const head = b64url(JSON.stringify({ alg: 'RS256', kid, typ: 'JWT' }));
  const body = b64url(JSON.stringify(payload));
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${head}.${body}`));
  return `${head}.${body}.${b64url(new Uint8Array(sig))}`;
}

const claims = (extra = {}) => ({
  aud: [AUD], iss: `https://${TEAM}`, email: 'Ana@Example.test',
  iat: NOW / 1000 - 60, exp: NOW / 1000 + 3600, ...extra,
});

let certFetches = 0;
const fakeFetch = async (url) => {
  certFetches++;
  assert.equal(url, `https://${TEAM}/cdn-cgi/access/certs`);
  return { ok: true, json: async () => ({ keys: [jwk] }) };
};
const verify = (token) => verifyAccessJwt(token, { teamDomain: TEAM, aud: AUD, fetchImpl: fakeFetch, now: NOW });

beforeEach(() => {
  clearKeyCache();
  certFetches = 0;
});

test('valid Access token gives the lower-cased email', async () => {
  assert.equal(await verify(await sign(claims())), 'ana@example.test');
});

test('keys are cached between requests', async () => {
  await verify(await sign(claims()));
  await verify(await sign(claims()));
  assert.equal(certFetches, 1);
});

test('rejects wrong audience, issuer, expired, unknown key and bad signature', async () => {
  assert.equal(await verify(await sign(claims({ aud: ['someone-else'] }))), null);
  assert.equal(await verify(await sign(claims({ iss: 'https://evil.cloudflareaccess.com' }))), null);
  assert.equal(await verify(await sign(claims({ exp: NOW / 1000 - 1 }))), null);
  assert.equal(await verify(await sign(claims(), { kid: 'other' })), null);
  const other = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true, ['sign', 'verify']);
  assert.equal(await verify(await sign(claims(), { key: other.privateKey })), null);
});

test('rejects tampered payload and garbage', async () => {
  const [h, , s] = (await sign(claims())).split('.');
  const forged = b64url(JSON.stringify(claims({ email: 'manager@example.test' })));
  assert.equal(await verify(`${h}.${forged}.${s}`), null);
  assert.equal(await verify('not-a-jwt'), null);
  assert.equal(await verify(null), null);
});

const req = (headers) => new Request('https://x/api/me', { headers });

test('with Access configured, only a verified token counts; plain headers are ignored', async () => {
  const env = { ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD, DEV_LOGIN: 'true' };
  const spoof = req({ 'cf-access-authenticated-user-email': 'manager@example.test', 'x-dev-user': 'manager@example.test' });
  assert.equal(await requestEmail(spoof, env, fakeFetch), null);
});

test('fails closed when Access keys cannot be fetched', async () => {
  const env = { ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD };
  const down = async () => ({ ok: false, status: 503 });
  const token = await sign(claims({ exp: Date.now() / 1000 + 3600 }));
  assert.equal(await requestEmail(req({ 'cf-access-jwt-assertion': token }), env, down), null);
});

test('dev header only counts when DEV_LOGIN is on and Access is not configured', async () => {
  assert.equal(await requestEmail(req({ 'x-dev-user': 'ana@example.test' }), {}), null);
  assert.equal(await requestEmail(req({ 'x-dev-user': 'Ana@example.test' }), { DEV_LOGIN: 'true' }), 'ana@example.test');
});

test('clinic date is Vancouver time', () => {
  // 06:30 UTC on Nov 2 is still Nov 1 in Vancouver.
  assert.equal(clinicToday(new Date('2026-11-02T06:30:00Z')), '2026-11-01');
});

test('route access levels', async () => {
  const { accessFor } = await import('../src/worker.js');
  assert.equal(accessFor('/api/health'), 'public');
  assert.equal(accessFor('/api/dev/users'), 'dev');
  assert.equal(accessFor('/api/me'), 'staff');
  assert.equal(accessFor('/api/me/time-off/3'), 'staff');
  assert.equal(accessFor('/api/media'), 'manager');
  for (const p of ['/api/week', '/api/shifts/1', '/api/staff', '/api/clinic', '/api/time-off', '/api/week/publish', '/api/check']) {
    assert.equal(accessFor(p), 'manager', p);
  }
});
