// Demo mode: one click wipes the clinic's schedule data and loads a believable
// sample clinic, with dates placed around the current week so it never looks stale.
// Only on when DEMO_MODE = "true". Managers are kept (so whoever is signed in
// stays signed in); everyone else is replaced by fictional staff.
//
// demoData() is pure (tested in test/demo.test.js); resetDemo() writes it to D1.
import { weekStart as startOfWeek } from './rules.js';
import { addDays } from './schedule.js';

const CLINIC = 1;

export const demoEnabled = (env) => env.DEMO_MODE === 'true';

// Fictional people only. example.test is a reserved domain, so no email can ever be delivered.
const STAFF = [
  { id: 1001, name: 'Priya Sandhu', email: 'priya@example.test', staffType: 'FT', min: 37.5, skills: [1, 2, 3, 4, 5] },
  { id: 1002, name: 'Jordan Chen', email: 'jordan@example.test', staffType: 'FT', min: 37.5, skills: [1, 3, 5] },
  { id: 1003, name: 'Ana Ferreira', email: 'ana@example.test', staffType: 'PT', min: 24, skills: [1, 2] },
  { id: 1004, name: 'Sam Okafor', email: 'sam@example.test', staffType: 'PT', min: 20, skills: [3, 4] },
  { id: 1005, name: 'Riley Tremblay', email: 'riley@example.test', staffType: 'casual', min: 0, skills: [1] },
  { id: 1006, name: 'Dee Nguyen', email: 'dee@example.test', staffType: 'casual', min: 0, skills: [1, 3] },
];
const [PRIYA, JORDAN, ANA, SAM, RILEY, DEE] = STAFF.map((p) => p.id);

const SKILLS = ['Front desk', 'Triage', 'EMR', 'MSP billing', 'Open/close'].map((name, i) => ({ id: i + 1, name }));
const DESK = 1, PHONES = 2, BACK = 3, BILLING = 4;
const STATIONS = [
  { id: DESK, name: 'Front desk', skill: 1, frontDesk: true },
  { id: PHONES, name: 'Phones / triage', skill: 2, frontDesk: false },
  { id: BACK, name: 'Back office', skill: 3, frontDesk: false },
  { id: BILLING, name: 'Billing', skill: 4, frontDesk: false },
];

// Weekday 0 = Sunday. Full-time staff have none, meaning "any time".
const AVAILABILITY = [
  ...[1, 2, 4].map((d) => [ANA, d, '08:00', '16:30']),
  ...[1, 3, 5].map((d) => [SAM, d, '08:00', '16:30']),
  ...[2, 4].map((d) => [RILEY, d, '12:00', '20:00']), [RILEY, 6, '09:00', '15:00'],
  ...[1, 3, 5].map((d) => [DEE, d, '12:00', '20:00']), [DEE, 6, '09:00', '15:00'],
];

const OPEN_HOURS = { 1: ['08:00', '20:00'], 2: ['08:00', '20:00'], 3: ['08:00', '20:00'], 4: ['08:00', '20:00'], 5: ['08:00', '20:00'], 6: ['09:00', '15:00'] };

// Shift patterns: [start, end, breakStart, breakEnd].
const EARLY = ['08:00', '16:30', '12:00', '12:30'];
const DAYTIME = ['08:00', '16:30', '11:30', '12:00'];
const OFFICE = ['08:00', '16:30', '12:30', '13:00'];
const LATE = ['12:00', '20:00', '16:00', '16:30'];
const SAT_A = ['09:00', '15:00', '12:00', '12:30'];
const SAT_B = ['09:00', '15:00', '12:30', '13:00'];

// A clean week: every rule passes. [weekday, staff, station, pattern]
const CLEAN_WEEK = [
  [1, JORDAN, DESK, EARLY], [1, DEE, DESK, LATE], [1, ANA, PHONES, DAYTIME], [1, SAM, BILLING, OFFICE], [1, PRIYA, BACK, OFFICE],
  [2, JORDAN, DESK, EARLY], [2, RILEY, DESK, LATE], [2, ANA, PHONES, DAYTIME], [2, PRIYA, BACK, OFFICE],
  [3, JORDAN, DESK, EARLY], [3, DEE, DESK, LATE], [3, PRIYA, PHONES, DAYTIME], [3, SAM, BILLING, OFFICE],
  [4, JORDAN, DESK, EARLY], [4, RILEY, DESK, LATE], [4, ANA, PHONES, DAYTIME], [4, PRIYA, BACK, OFFICE],
  [5, JORDAN, DESK, EARLY], [5, DEE, DESK, LATE], [5, PRIYA, PHONES, DAYTIME], [5, SAM, BILLING, OFFICE],
  [6, RILEY, DESK, SAT_A], [6, DEE, DESK, SAT_B],
];

// Next week's draft, half-fixed, with the kinds of mistakes the app catches:
// Sam on triage without the skill, nobody on Thursday's late desk, Jordan
// booked on an approved day off, and Priya picking up an extra Saturday with no break.
const DRAFT_WEEK = [
  ...CLEAN_WEEK.filter(([d, who, station]) =>
    !(d === 3 && (who === PRIYA || who === SAM)) && !(d === 4 && who === RILEY)),
  [3, SAM, PHONES, OFFICE], [3, PRIYA, BILLING, DAYTIME],
  [6, PRIYA, BACK, ['09:00', '15:00', null, null]],
];

// Providers on site: 4 in the day, 2 in the evening, 2 on Saturday.
const PROVIDERS = [
  ...[1, 2, 3, 4, 5].flatMap((d) => [[d, '08:00', '16:30', 4], [d, '16:30', '20:00', 2]]),
  [6, '09:00', '15:00', 2],
];

// Everything the demo clinic holds, for the week containing `today` (Sunday weeks).
export function demoData(today) {
  const thisWeek = startOfWeek(today, 0);
  const weeks = [-1, 0, 1, 2].map((n) => addDays(thisWeek, n * 7));
  const [lastWeek, , nextWeek, weekAfter] = weeks;
  const on = (week, weekday) => addDays(week, weekday);

  const shifts = [];
  const add = (week, rows, status) => {
    for (const [d, staffId, stationId, [start, end, breakStart, breakEnd]] of rows) {
      shifts.push({ staffId, stationId, date: on(week, d), start, end, breakStart, breakEnd, status });
    }
  };
  add(lastWeek, CLEAN_WEEK, 'published');
  add(thisWeek, CLEAN_WEEK, 'published');
  add(nextWeek, DRAFT_WEEK, 'draft');
  // The week after is left empty so "Copy last week" has something to do.

  return {
    clinic: { openHours: OPEN_HOURS, coverageRatio: 0.5, weekStartsOn: 0 },
    skills: SKILLS,
    stations: STATIONS,
    staff: STAFF,
    availability: AVAILABILITY.map(([staffId, weekday, start, end]) => ({ staffId, weekday, start, end })),
    timeOff: [
      { staffId: JORDAN, startDate: on(nextWeek, 5), endDate: on(nextWeek, 5), reason: 'Appointment', status: 'approved' },
      { staffId: RILEY, startDate: on(weekAfter, 6), endDate: on(weekAfter, 6), reason: 'Family event', status: 'pending' },
      { staffId: ANA, startDate: on(weekAfter, 1), endDate: on(weekAfter, 2), reason: 'Long weekend away', status: 'pending' },
    ],
    providerBlocks: weeks.flatMap((w) => PROVIDERS.map(([d, start, end, count]) => ({ date: on(w, d), start, end, count }))),
    shifts,
    publishedWeeks: [lastWeek, thisWeek],
    draftWeeks: [nextWeek],
    weeks,
  };
}

// SQL to wipe the clinic (keeping managers) and load `data`, as [sql, ...args] rows.
export function demoStatements(data, now = new Date().toISOString()) {
  const c = data.clinic;
  return [
    ['DELETE FROM shifts WHERE clinic_id = ?', CLINIC],
    ['DELETE FROM schedule_weeks WHERE clinic_id = ?', CLINIC],
    ['DELETE FROM provider_blocks WHERE clinic_id = ?', CLINIC],
    ["DELETE FROM time_off WHERE staff_id IN (SELECT id FROM staff WHERE clinic_id = ? AND role != 'manager')", CLINIC],
    ["DELETE FROM availability WHERE staff_id IN (SELECT id FROM staff WHERE clinic_id = ? AND role != 'manager')", CLINIC],
    ['DELETE FROM staff_skills'],
    ["DELETE FROM staff WHERE clinic_id = ? AND role != 'manager'", CLINIC],
    // A manager row someone edited to use a demo email would block the insert below.
    [`DELETE FROM staff WHERE email IN (${data.staff.map(() => '?').join(', ')})`, ...data.staff.map((p) => p.email)],
    ['DELETE FROM stations WHERE clinic_id = ?', CLINIC],
    ['DELETE FROM skills'],
    // The clinic keeps its name; hours and settings go back to the sample's.
    ['UPDATE clinics SET open_hours = ?, coverage_ratio = ?, week_starts_on = ? WHERE id = ?',
      JSON.stringify(c.openHours), c.coverageRatio, c.weekStartsOn, CLINIC],
    ...data.skills.map((k) => ['INSERT INTO skills (id, name) VALUES (?, ?)', k.id, k.name]),
    ...data.stations.map((s) => ['INSERT INTO stations (id, clinic_id, name, required_skill_id, is_front_desk) VALUES (?, ?, ?, ?, ?)',
      s.id, CLINIC, s.name, s.skill, s.frontDesk ? 1 : 0]),
    ...data.staff.map((p) => ["INSERT INTO staff (id, clinic_id, name, email, role, staff_type, min_weekly_hours) VALUES (?, ?, ?, ?, 'staff', ?, ?)",
      p.id, CLINIC, p.name, p.email, p.staffType, p.min]),
    ...data.staff.flatMap((p) => p.skills.map((k) => ['INSERT INTO staff_skills (staff_id, skill_id) VALUES (?, ?)', p.id, k])),
    ...data.availability.map((a) => ['INSERT INTO availability (staff_id, weekday, start_time, end_time) VALUES (?, ?, ?, ?)',
      a.staffId, a.weekday, a.start, a.end]),
    ...data.timeOff.map((t) => ['INSERT INTO time_off (staff_id, start_date, end_date, reason, status) VALUES (?, ?, ?, ?, ?)',
      t.staffId, t.startDate, t.endDate, t.reason, t.status]),
    ...data.providerBlocks.map((b) => ['INSERT INTO provider_blocks (clinic_id, date, start_time, end_time, provider_count) VALUES (?, ?, ?, ?, ?)',
      CLINIC, b.date, b.start, b.end, b.count]),
    ...data.shifts.map((s) => [`INSERT INTO shifts (clinic_id, staff_id, station_id, date, start_time, end_time, break_start, break_end, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, CLINIC, s.staffId, s.stationId, s.date, s.start, s.end, s.breakStart, s.breakEnd, s.status]),
    ...data.publishedWeeks.map((w) => ['INSERT INTO schedule_weeks (clinic_id, week_start, published_at) VALUES (?, ?, ?)', CLINIC, w, now]),
    ...data.draftWeeks.map((w) => ['INSERT INTO schedule_weeks (clinic_id, week_start, published_at) VALUES (?, ?, NULL)', CLINIC, w]),
  ];
}

// Runs the whole reset as one D1 batch (all or nothing).
export async function resetDemo(db, today) {
  const data = demoData(today);
  await db.batch(demoStatements(data).map(([sql, ...args]) => db.prepare(sql).bind(...args)));
  return { ok: true, staff: data.staff.length, shifts: data.shifts.length, thisWeek: data.weeks[1] };
}

// A brand-new demo database (the password-login demo copy) starts empty: give it a
// clinic, a manager who signs in as "manager", and the sample data. Does nothing
// once a clinic exists, so it never overwrites anything.
export async function ensureDemoClinic(db, today) {
  if (await db.prepare('SELECT id FROM clinics WHERE id = ?').bind(CLINIC).first()) return false;
  await db.batch([
    db.prepare("INSERT INTO clinics (id, name) VALUES (?, 'Maple Grove Clinic (demo)')").bind(CLINIC),
    db.prepare("INSERT INTO staff (clinic_id, name, email, role, staff_type) VALUES (?, 'Morgan Lee', 'manager@example.test', 'manager', 'FT')")
      .bind(CLINIC),
  ]);
  await resetDemo(db, today);
  return true;
}
