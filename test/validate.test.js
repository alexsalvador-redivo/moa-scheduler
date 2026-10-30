import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateSkill, validateStation, validateStaff, validateClinic, validateShift } from '../src/validate.js';

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

test('shift needs staff, station, date and times; break is optional but must fit', () => {
  const base = { staff_id: 2, station_id: 1, date: '2026-11-02', start_time: '08:00', end_time: '16:30' };
  assert.equal(validateShift(base).errors, null);
  assert.equal(validateShift({ ...base, break_start: '12:00', break_end: '12:30' }).errors, null);
  assert.ok(validateShift({ ...base, break_start: '12:00' }).errors.break_end);
  assert.ok(validateShift({ ...base, break_start: '17:00', break_end: '17:30' }).errors.break_start);
  assert.ok(validateShift({ ...base, break_start: '12:30', break_end: '12:00' }).errors.break_start);
  assert.deepEqual(Object.keys(validateShift({ date: '2026-02-30', start_time: '9:00' }).errors).sort(),
    ['date', 'end_time', 'staff_id', 'start_time', 'station_id']);
});

test('overnight shift with a break after midnight is valid', () => {
  const night = { staff_id: 2, station_id: 1, date: '2026-11-02', start_time: '20:00', end_time: '04:00',
    break_start: '00:00', break_end: '00:30' };
  assert.equal(validateShift(night).errors, null);
});
