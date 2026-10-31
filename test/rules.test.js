// Test cases 1–12 from the spec's F – Feedback table, plus edge cases.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as R from '../src/rules.js';

// Week of Sun 2026-11-01 to Sat 2026-11-07.
const SUN = '2026-11-01', MON = '2026-11-02', TUE = '2026-11-03', WED = '2026-11-04',
  THU = '2026-11-05', FRI = '2026-11-06', SAT = '2026-11-07';

const SKILL = { DESK: 1, TRIAGE: 2, EMR: 3, BILLING: 4 };
const stations = [
  { id: 1, name: 'Front desk', requiredSkillId: SKILL.DESK, isFrontDesk: true },
  { id: 3, name: 'Back office', requiredSkillId: SKILL.EMR },
  { id: 4, name: 'Billing', requiredSkillId: SKILL.BILLING },
];
const person = (id, extra = {}) => ({ id, name: `MOA ${id}`, skills: [1, 2, 3], ...extra });

let nextId = 1;
const shift = (staffId, date, start, end, extra = {}) =>
  ({ id: nextId++, staffId, stationId: 1, date, start, end, ...extra });

const codes = (warnings) => warnings.map((w) => w.code);

test('1 REST_8H: 23:00 Mon then 06:00 Tue (7 h off) warns on both shifts', () => {
  const a = shift(1, MON, '15:00', '23:00'), b = shift(1, TUE, '06:00', '14:00');
  const w = R.rest8h({ shifts: [a, b], staff: [person(1)] });
  assert.equal(w.length, 1);
  assert.deepEqual(w[0].shiftIds, [a.id, b.id]);
  assert.match(w[0].message, /7 h off/);
});

test('2 REST_8H: evening 12:00–20:00 Mon then day 08:00–16:30 Tue (12 h off) is fine', () => {
  const w = R.rest8h({ shifts: [shift(1, MON, '12:00', '20:00'), shift(1, TUE, '08:00', '16:30')] });
  assert.deepEqual(w, []);
});

test('3 SPLIT_12H: 08:00–12:00 and 17:00–21:00 (13 h span) warns', () => {
  const w = R.split12h({ shifts: [shift(1, MON, '08:00', '12:00'), shift(1, MON, '17:00', '21:00')] });
  assert.deepEqual(codes(w), ['SPLIT_12H']);
  assert.match(w[0].message, /13 h/);
});

test('4 SPLIT_12H: 08:00–12:00 and 15:00–19:30 (11.5 h span) is fine', () => {
  const shifts = [shift(1, MON, '08:00', '12:00'), shift(1, MON, '15:00', '19:30')];
  assert.deepEqual(R.split12h({ shifts }), []);
  // The gap inside a split day is not "rest between shifts".
  assert.deepEqual(R.rest8h({ shifts }), []);
});

test('5 MIN_2H: 09:00–10:30 warns', () => {
  assert.deepEqual(codes(R.min2h({ shifts: [shift(1, MON, '09:00', '10:30')] })), ['MIN_2H']);
  assert.deepEqual(R.min2h({ shifts: [shift(1, MON, '09:00', '11:00')] }), []);
});

test('6 MEAL_5H: 08:00–16:30 warns with no break, not with 12:00–12:30 break', () => {
  assert.deepEqual(codes(R.meal5h({ shifts: [shift(1, MON, '08:00', '16:30')] })), ['MEAL_5H']);
  const withBreak = shift(1, MON, '08:00', '16:30', { breakStart: '12:00', breakEnd: '12:30' });
  assert.deepEqual(R.meal5h({ shifts: [withBreak] }), []);
});

test('MEAL_5H: a break that leaves more than 5 h in a row still warns', () => {
  const late = shift(1, MON, '08:00', '16:30', { breakStart: '14:00', breakEnd: '14:30' });
  assert.match(R.meal5h({ shifts: [late] })[0].message, /more than 5 h in a row/);
});

test('7 OT_DAY: 08:00–18:00 with 30-min break (9.5 h) is 1.5 h overtime', () => {
  const s = shift(1, MON, '08:00', '18:00', { breakStart: '12:00', breakEnd: '12:30' });
  const w = R.otDay({ shifts: [s] });
  assert.deepEqual(codes(w), ['OT_DAY']);
  assert.match(w[0].message, /9\.5 h .*1\.5 h daily overtime/);
});

const fullWeek = (staffId) => [MON, TUE, WED, THU, FRI].map((d) =>
  shift(staffId, d, '08:00', '16:30', { breakStart: '12:00', breakEnd: '12:30' }));

test('8 OT_WEEK: five 08:00–16:30 shifts with 30-min breaks (40 h) is fine', () => {
  const shifts = fullWeek(1);
  assert.equal(shifts.reduce((t, s) => t + R.workedMinutes(s), 0), 2400);
  assert.deepEqual(R.otWeek({ shifts }), []);
  assert.deepEqual(R.otDay({ shifts }), []);
});

test('OT_WEEK: adding a Saturday goes over 40 h', () => {
  const shifts = [...fullWeek(1), shift(1, SAT, '09:00', '12:00')];
  assert.match(R.otWeek({ shifts })[0].message, /43 h .*3 h weekly overtime/);
});

test('OT_WEEK: weeks split on Sunday by default, Monday when configured', () => {
  const shifts = [...fullWeek(1), shift(1, '2026-11-08', '09:00', '12:00')]; // next Sunday
  assert.deepEqual(R.otWeek({ shifts }), []);
  assert.equal(R.otWeek({ shifts, settings: { weekStartsOn: 1 } }).length, 1);
});

test('9 SKILL: MOA without MSP billing on Billing station warns', () => {
  const s = shift(1, MON, '08:00', '12:00', { stationId: 4 });
  assert.deepEqual(codes(R.skill({ shifts: [s], staff: [person(1)], stations })), ['SKILL']);
  const biller = person(1, { skills: [SKILL.BILLING] });
  assert.deepEqual(R.skill({ shifts: [s], staff: [biller], stations }), []);
});

test('10 AVAIL: casual available Sat only scheduled Tue, and another on approved time off', () => {
  const casual = person(1, { availability: [{ weekday: 6, start: '09:00', end: '15:00' }] });
  const away = person(2, { timeOff: [{ startDate: TUE, endDate: TUE, status: 'approved' }] });
  const pending = person(3, { timeOff: [{ startDate: TUE, endDate: TUE, status: 'pending' }] });
  const shifts = [shift(1, TUE, '09:00', '15:00'), shift(2, TUE, '09:00', '15:00'),
    shift(3, TUE, '09:00', '15:00'), shift(1, SAT, '09:00', '15:00')];
  const w = R.avail({ shifts, staff: [casual, away, pending] });
  assert.deepEqual(codes(w), ['AVAIL', 'AVAIL']);
  assert.deepEqual(w.map((x) => x.shiftIds[0]), [shifts[0].id, shifts[1].id]);
});

test('11 COVERAGE: 4 providers at ratio 0.5 with 1 MOA is short by 1', () => {
  const ctx = {
    shifts: [shift(1, MON, '08:00', '16:30')],
    providerBlocks: [{ date: MON, start: '08:00', end: '16:30', providerCount: 4 }],
    settings: { coverageRatio: 0.5 },
  };
  const w = R.coverage(ctx);
  assert.deepEqual(codes(w), ['COVERAGE']);
  assert.match(w[0].message, /08:00–16:30: 1 of 2 .*short by 1/);
});

test('COVERAGE: someone on break does not count', () => {
  const ctx = {
    shifts: [shift(1, MON, '08:00', '16:30'), shift(2, MON, '08:00', '16:30', { breakStart: '12:00', breakEnd: '12:30' })],
    providerBlocks: [{ date: MON, start: '08:00', end: '16:30', providerCount: 4 }],
  };
  const w = R.coverage(ctx);
  assert.equal(w.length, 1);
  assert.match(w[0].message, /12:00–12:30: 1 of 2/);
});

test('12 DESK_EMPTY: only front-desk MOA on lunch 12:00–12:30 flags that gap', () => {
  const ctx = {
    shifts: [shift(1, MON, '08:00', '16:30', { breakStart: '12:00', breakEnd: '12:30' })],
    stations,
    settings: { openHours: { 1: ['08:00', '16:30'] } },
  };
  const w = R.deskEmpty(ctx);
  assert.deepEqual(codes(w), ['DESK_EMPTY']);
  assert.match(w[0].message, /12:00–12:30/);
});

test('DESK_EMPTY: lunch covered by a second desk MOA is fine; back office does not count', () => {
  const open = { openHours: { 1: ['08:00', '16:30'] } };
  const lunch = { breakStart: '12:00', breakEnd: '12:30' };
  const covered = [shift(1, MON, '08:00', '16:30', lunch), shift(2, MON, '10:00', '14:00')];
  assert.deepEqual(R.deskEmpty({ shifts: covered, stations, settings: open }), []);
  const backOffice = [shift(1, MON, '08:00', '16:30', lunch), shift(2, MON, '10:00', '14:00', { stationId: 3 })];
  assert.equal(R.deskEmpty({ shifts: backOffice, stations, settings: open }).length, 1);
});

test('overnight shift ending after midnight counts its real length', () => {
  const s = shift(1, MON, '20:00', '02:00');
  assert.equal(R.workedMinutes(s), 360);
  assert.equal(R.rest8h({ shifts: [s, shift(1, TUE, '09:00', '17:00')] }).length, 1);
});

test('checkSchedule runs every rule and returns a clean result for a clean week', () => {
  const ctx = {
    shifts: fullWeek(1).concat(fullWeek(2).map((s) => ({ ...s, breakStart: '12:30', breakEnd: '13:00' }))),
    staff: [person(1), person(2)],
    stations,
    providerBlocks: [{ date: MON, start: '08:00', end: '16:30', providerCount: 4 }],
    settings: { coverageRatio: 0.5, openHours: { 1: ['08:00', '16:30'] } },
  };
  assert.deepEqual(R.checkSchedule(ctx).filter((w) => w.code !== 'COVERAGE'), []);
  // Staggered lunches: 2 needed, 1 on the floor from 12:00 to 13:00.
  const short = R.checkSchedule(ctx).filter((w) => w.code === 'COVERAGE');
  assert.equal(short.length, 1);
  assert.match(short[0].message, /12:00–13:00: 1 of 2/);
  assert.equal(short[0].shiftIds.length, 2);
});

test('weekStart and weekday helpers', () => {
  assert.equal(R.weekday(SUN), 0);
  assert.equal(R.weekday(SAT), 6);
  assert.equal(R.weekStart(WED), SUN);
  assert.equal(R.weekStart(SUN, 1), '2026-10-26');
});

test('coverageBar splits the day by provider blocks and breaks', () => {
  const ctx = {
    shifts: [
      shift(1, MON, '08:00', '16:30', { breakStart: '12:00', breakEnd: '12:30' }),
      shift(2, MON, '08:00', '16:30', { breakStart: '12:30', breakEnd: '13:00' }),
      shift(3, MON, '12:00', '20:00', { breakStart: '16:00', breakEnd: '16:30' }),
    ],
    providerBlocks: [
      { date: MON, start: '08:00', end: '16:30', providerCount: 4 },
      { date: MON, start: '16:30', end: '20:00', providerCount: 2 },
    ],
    settings: { coverageRatio: 0.5, openHours: { 1: ['08:00', '20:00'] } },
  };
  // Staggered lunches keep 2 on the floor from 08:00 to 13:00.
  assert.deepEqual(R.coverageBar(ctx, MON), [
    { from: '08:00', to: '13:00', count: 2, required: 2 },
    { from: '13:00', to: '16:00', count: 3, required: 2 },
    { from: '16:00', to: '16:30', count: 2, required: 2 },
    { from: '16:30', to: '20:00', count: 1, required: 1 },
  ]);
});

test('coverageBar is empty on a closed day with no providers', () => {
  assert.deepEqual(R.coverageBar({ shifts: [], settings: { openHours: {} } }, SUN), []);
});
