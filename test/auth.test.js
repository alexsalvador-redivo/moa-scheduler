import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requestEmail, clinicToday } from '../src/auth.js';

const req = (headers) => new Request('https://x/api/me', { headers });

test('Access header wins and is lower-cased', () => {
  assert.equal(requestEmail(req({ 'cf-access-authenticated-user-email': 'Ana@Example.test' }), {}), 'ana@example.test');
});

test('dev header only counts when DEV_LOGIN is on', () => {
  assert.equal(requestEmail(req({ 'x-dev-user': 'ana@example.test' }), {}), null);
  assert.equal(requestEmail(req({ 'x-dev-user': 'ana@example.test' }), { DEV_LOGIN: 'true' }), 'ana@example.test');
});

test('clinic date is Vancouver time', () => {
  // 06:30 UTC on Nov 2 is still Nov 1 in Vancouver.
  assert.equal(clinicToday(new Date('2026-11-02T06:30:00Z')), '2026-11-01');
});
