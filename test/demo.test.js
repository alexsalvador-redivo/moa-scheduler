import { test } from 'node:test';
import assert from 'node:assert/strict';
import { demoData, demoStatements } from '../src/demo.js';
import { checkSchedule, weekday, workedMinutes } from '../src/rules.js';
import { addDays } from '../src/schedule.js';

const TODAY = '2026-11-05'; // a Thursday
const data = demoData(TODAY);

// The rules engine's view of one demo week, built the way loadWeek builds it.
function ctxFor(week) {
  const end = addDays(week, 6);
  let id = 0;
  return {
    settings: data.clinic,
    dates: Array.from({ length: 7 }, (_, i) => addDays(week, i)),
    staff: data.staff.map((p) => ({
      id: p.id, name: p.name, staffType: p.staffType, minWeeklyHours: p.min, skills: p.skills,
      availability: data.availability.filter((a) => a.staffId === p.id),
      timeOff: data.timeOff.filter((t) => t.staffId === p.id),
    })),
    stations: data.stations.map((s) => ({ id: s.id, name: s.name, requiredSkillId: s.skill, isFrontDesk: s.frontDesk })),
    providerBlocks: data.providerBlocks.filter((b) => b.date >= week && b.date <= end)
      .map((b) => ({ ...b, providerCount: b.count })),
    shifts: data.shifts.filter((s) => s.date >= addDays(week, -1) && s.date <= end).map((s) => ({ ...s, id: ++id })),
  };
}

test('weeks are placed around the current week', () => {
  assert.deepEqual(data.weeks, ['2026-10-25', '2026-11-01', '2026-11-08', '2026-11-15']);
  assert.deepEqual(data.publishedWeeks, ['2026-10-25', '2026-11-01']);
  assert.deepEqual(data.draftWeeks, ['2026-11-08']);
  assert.ok(data.weeks.every((w) => weekday(w) === 0));
  assert.equal(demoData('2026-11-08').weeks[1], '2026-11-08');
});

test('published weeks pass every rule and meet minimum hours', () => {
  for (const week of data.publishedWeeks) {
    const ctx = ctxFor(week);
    assert.deepEqual(checkSchedule(ctx), [], `week of ${week}`);
    for (const p of data.staff) {
      const mins = ctx.shifts.filter((s) => s.staffId === p.id && s.date >= week).reduce((n, s) => n + workedMinutes(s), 0);
      assert.ok(mins >= p.min * 60, `${p.name} works ${mins / 60} h, minimum ${p.min}`);
    }
  }
});

test('the draft week shows one of each kind of mistake', () => {
  const codes = [...new Set(checkSchedule(ctxFor(data.draftWeeks[0])).map((w) => w.code))].sort();
  assert.deepEqual(codes, ['AVAIL', 'COVERAGE', 'DESK_EMPTY', 'MEAL_5H', 'OT_WEEK', 'SKILL']);
});

test('time off includes pending requests for the manager to approve', () => {
  assert.equal(data.timeOff.filter((t) => t.status === 'pending').length, 2);
});

test('only fictional, undeliverable emails', () => {
  assert.ok(data.staff.every((p) => p.email.endsWith('@example.test')));
});

test('reset keeps managers and fills every table', () => {
  const sql = demoStatements(data).map(([s]) => s);
  assert.ok(sql.includes("DELETE FROM staff WHERE clinic_id = ? AND role != 'manager'"));
  assert.ok(!sql.some((s) => /DELETE FROM staff WHERE clinic_id = \?$/.test(s)));
  for (const table of ['skills', 'stations', 'staff', 'staff_skills', 'availability', 'time_off', 'provider_blocks', 'shifts', 'schedule_weeks']) {
    assert.ok(sql.some((s) => s.includes(`INSERT INTO ${table} `)), table);
  }
  // Every statement's placeholders match its arguments.
  for (const [s, ...args] of demoStatements(data)) assert.equal((s.match(/\?/g) ?? []).length, args.length, s);
});
