import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateSkill, validateStation, validateStaff, validateClinic } from '../src/validate.js';

test('skill needs a name', () => {
  assert.deepEqual(validateSkill({ name: '  Triage ' }), { value: { name: 'Triage' }, errors: null });
  assert.ok(validateSkill({ name: '' }).errors.name);
});

test('station takes an optional skill and a front-desk flag', () => {
  const { value, errors } = validateStation({ name: 'Front desk', required_skill_id: '1', is_front_desk: true });
  assert.equal(errors, null);
  assert.deepEqual(value, { name: 'Front desk', required_skill_id: 1, is_front_desk: 1 });
  assert.equal(validateStation({ name: 'Rooms', required_skill_id: '' }).value.required_skill_id, null);
  assert.ok(validateStation({ name: 'X', required_skill_id: 'abc' }).errors.required_skill_id);
});

test('staff cleans email, defaults role and type, dedupes skills', () => {
  const { value, errors } = validateStaff({
    name: 'Ana', email: ' Ana@Example.test ', min_weekly_hours: '24', skills: [1, '2', 2],
  });
  assert.equal(errors, null);
  assert.deepEqual(value, {
    name: 'Ana', email: 'ana@example.test', role: 'staff', staff_type: 'FT', min_weekly_hours: 24, skills: [1, 2],
  });
});

test('staff rejects bad email, role, type and hours', () => {
  const { errors } = validateStaff({ name: 'X', email: 'nope', role: 'admin', staff_type: 'temp', min_weekly_hours: -1 });
  assert.deepEqual(Object.keys(errors).sort(), ['email', 'min_weekly_hours', 'role', 'staff_type']);
});

test('clinic checks open hours, ratio and week start', () => {
  const good = validateClinic({
    name: 'Clinic', open_hours: { 1: ['08:00', '20:00'], 6: ['09:00', '15:00'] }, coverage_ratio: '0.5', week_starts_on: 0,
  });
  assert.equal(good.errors, null);
  assert.deepEqual(good.value.open_hours, { 1: ['08:00', '20:00'], 6: ['09:00', '15:00'] });

  const bad = validateClinic({
    name: 'Clinic', open_hours: { 1: ['20:00', '08:00'], 9: ['08:00', '09:00'] }, coverage_ratio: 0, week_starts_on: 7,
  });
  assert.deepEqual(Object.keys(bad.errors).sort(), ['coverage_ratio', 'open_hours', 'week_starts_on']);
});
