// Schedule API: the manager's weekly grid, shifts and provider blocks.
// Every write answers with the whole refreshed week, so the grid's warnings
// and coverage bars are always the rules engine's latest word.
import { checkSchedule, coverageBar, weekStart as startOfWeek, workedMinutes } from './rules.js';
import { validateShift, isDate } from './validate.js';

const CLINIC = 1;

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
const invalid = (errors) => json({ error: 'Please fix the highlighted fields.', fields: errors }, 400);

export const addDays = (date, n) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

// Load everything the rules engine needs for one clinic week.
export async function loadWeek(db, clinicId, weekStart) {
  const weekEnd = addDays(weekStart, 6);
  const [clinic, staff, skills, avail, timeOff, stations, blocks, shifts, week] = await Promise.all([
    db.prepare('SELECT * FROM clinics WHERE id = ?').bind(clinicId).first(),
    db.prepare('SELECT id, name, staff_type, min_weekly_hours FROM staff WHERE clinic_id = ? AND active = 1 ORDER BY name')
      .bind(clinicId).all(),
    db.prepare('SELECT staff_id, skill_id FROM staff_skills').all(),
    db.prepare('SELECT staff_id, weekday, start_time, end_time FROM availability').all(),
    db.prepare('SELECT staff_id, start_date, end_date, status FROM time_off WHERE end_date >= ? AND start_date <= ?')
      .bind(weekStart, weekEnd).all(),
    db.prepare('SELECT * FROM stations WHERE clinic_id = ? ORDER BY id').bind(clinicId).all(),
    db.prepare('SELECT * FROM provider_blocks WHERE clinic_id = ? AND date BETWEEN ? AND ? ORDER BY date, start_time')
      .bind(clinicId, weekStart, weekEnd).all(),
    // Include the day before so REST_8H sees a late shift at the end of last week.
    db.prepare('SELECT * FROM shifts WHERE clinic_id = ? AND date BETWEEN ? AND ? ORDER BY date, start_time')
      .bind(clinicId, addDays(weekStart, -1), weekEnd).all(),
    db.prepare('SELECT published_at FROM schedule_weeks WHERE clinic_id = ? AND week_start = ?').bind(clinicId, weekStart).first(),
  ]);
  if (!clinic) return null;

  const of = (rows, id) => rows.results.filter((r) => r.staff_id === id);
  return {
    publishedAt: week?.published_at ?? null,
    settings: {
      coverageRatio: clinic.coverage_ratio,
      weekStartsOn: clinic.week_starts_on,
      openHours: JSON.parse(clinic.open_hours),
    },
    dates: Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    staff: staff.results.map((p) => ({
      id: p.id,
      name: p.name,
      staffType: p.staff_type,
      minWeeklyHours: p.min_weekly_hours,
      skills: of(skills, p.id).map((r) => r.skill_id),
      availability: of(avail, p.id).map((r) => ({ weekday: r.weekday, start: r.start_time, end: r.end_time })),
      timeOff: of(timeOff, p.id).map((r) => ({ startDate: r.start_date, endDate: r.end_date, status: r.status })),
    })),
    stations: stations.results.map((s) => ({
      id: s.id, name: s.name, requiredSkillId: s.required_skill_id, isFrontDesk: !!s.is_front_desk,
    })),
    providerBlocks: blocks.results.map((b) => ({
      id: b.id, date: b.date, start: b.start_time, end: b.end_time, providerCount: b.provider_count,
    })),
    shifts: shifts.results.map((s) => ({
      id: s.id, staffId: s.staff_id, stationId: s.station_id, date: s.date,
      start: s.start_time, end: s.end_time, breakStart: s.break_start, breakEnd: s.break_end, status: s.status,
    })),
  };
}

// The grid's view of a week: the rules context plus warnings, coverage bars and hours.
export async function weekView(db, anyDate) {
  const clinic = await db.prepare('SELECT week_starts_on FROM clinics WHERE id = ?').bind(CLINIC).first();
  const start = startOfWeek(anyDate, clinic?.week_starts_on ?? 0);
  const ctx = await loadWeek(db, CLINIC, start);
  if (!ctx) return null;
  const inWeek = ctx.shifts.filter((s) => s.date >= start);
  const hours = {};
  for (const s of inWeek) hours[s.staffId] = (hours[s.staffId] ?? 0) + workedMinutes(s);
  return {
    weekStart: start,
    ...ctx,
    shifts: inWeek,
    warnings: checkSchedule(ctx),
    coverage: Object.fromEntries(ctx.dates.map((d) => [d, coverageBar(ctx, d)])),
    hours,
  };
}

async function body(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

async function saveShift(db, id, input) {
  const { value: v, errors } = validateShift(input);
  if (errors) return invalid(errors);
  const [person, station] = await Promise.all([
    db.prepare('SELECT id FROM staff WHERE id = ? AND clinic_id = ? AND active = 1').bind(v.staff_id, CLINIC).first(),
    db.prepare('SELECT id FROM stations WHERE id = ? AND clinic_id = ?').bind(v.station_id, CLINIC).first(),
  ]);
  if (!person) return invalid({ staff_id: 'Unknown person.' });
  if (!station) return invalid({ station_id: 'Unknown station.' });

  const fields = [v.staff_id, v.station_id, v.date, v.start_time, v.end_time, v.break_start, v.break_end];
  if (id) {
    const r = await db.prepare(`UPDATE shifts SET staff_id = ?, station_id = ?, date = ?, start_time = ?, end_time = ?,
      break_start = ?, break_end = ? WHERE id = ? AND clinic_id = ?`).bind(...fields, id, CLINIC).run();
    if (!r.meta.changes) return json({ error: 'Not found.' }, 404);
  } else {
    await db.prepare(`INSERT INTO shifts (clinic_id, staff_id, station_id, date, start_time, end_time, break_start, break_end)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).bind(CLINIC, ...fields).run();
  }
  return json(await weekView(db, v.date), id ? 200 : 201);
}

async function deleteShift(db, id) {
  const shift = await db.prepare('SELECT date FROM shifts WHERE id = ? AND clinic_id = ?').bind(id, CLINIC).first();
  if (!shift) return json({ error: 'Not found.' }, 404);
  await db.prepare('DELETE FROM shifts WHERE id = ?').bind(id).run();
  return json(await weekView(db, shift.date));
}

// Copy the previous week's shifts into an empty week, as drafts.
async function copyLastWeek(db, input) {
  if (!isDate(input.week)) return invalid({ week: 'Use YYYY-MM-DD.' });
  const target = (await weekView(db, input.week)).weekStart;
  const end = addDays(target, 6);
  const existing = await db.prepare('SELECT COUNT(*) AS n FROM shifts WHERE clinic_id = ? AND date BETWEEN ? AND ?')
    .bind(CLINIC, target, end).first();
  if (existing.n) return json({ error: 'This week already has shifts. Clear them before copying last week.' }, 409);
  const r = await db.prepare(`INSERT INTO shifts (clinic_id, staff_id, station_id, date, start_time, end_time, break_start, break_end)
    SELECT s.clinic_id, s.staff_id, s.station_id, date(s.date, '+7 days'), s.start_time, s.end_time, s.break_start, s.break_end
    FROM shifts s JOIN staff p ON p.id = s.staff_id
    WHERE s.clinic_id = ? AND s.date BETWEEN ? AND ? AND p.active = 1`)
    .bind(CLINIC, addDays(target, -7), addDays(target, -1)).run();
  if (!r.meta.changes) return json({ error: 'Last week has no shifts to copy.' }, 409);
  return json(await weekView(db, target));
}

// Replace one day's provider blocks: { date, blocks: [{ start_time, end_time, provider_count }] }.
async function saveBlocks(db, input) {
  if (!isDate(input.date)) return invalid({ date: 'Use YYYY-MM-DD.' });
  const blocks = Array.isArray(input.blocks) ? input.blocks : [];
  for (const b of blocks) {
    const n = Number(b.provider_count);
    if (!TIME.test(b.start_time ?? '') || !TIME.test(b.end_time ?? '') || b.start_time >= b.end_time
      || !Number.isInteger(n) || n < 0 || n > 50) {
      return invalid({ blocks: 'Each block needs a start before its end and a provider count from 0 to 50.' });
    }
  }
  await db.batch([
    db.prepare('DELETE FROM provider_blocks WHERE clinic_id = ? AND date = ?').bind(CLINIC, input.date),
    ...blocks.map((b) => db.prepare(
      'INSERT INTO provider_blocks (clinic_id, date, start_time, end_time, provider_count) VALUES (?, ?, ?, ?, ?)')
      .bind(CLINIC, input.date, b.start_time, b.end_time, Number(b.provider_count))),
  ]);
  return json(await weekView(db, input.date));
}

// Returns a Response for the schedule routes; null otherwise.
export async function handleSchedule(request, db, url) {
  const { pathname: path } = url;
  const method = request.method;

  if (path === '/api/week' && method === 'GET') {
    const date = url.searchParams.get('date');
    if (!isDate(date)) return json({ error: 'date=YYYY-MM-DD required' }, 400);
    const view = await weekView(db, date);
    return view ? json(view) : json({ error: 'clinic not found' }, 404);
  }
  if (path === '/api/week/copy' && method === 'POST') return copyLastWeek(db, await body(request));
  if (path === '/api/week/blocks' && method === 'PUT') return saveBlocks(db, await body(request));

  const m = path.match(/^\/api\/shifts(?:\/(\d+))?$/);
  if (!m) return null;
  const id = m[1] ? Number(m[1]) : null;
  if (!id && method === 'POST') return saveShift(db, null, await body(request));
  if (id && method === 'PUT') return saveShift(db, id, await body(request));
  if (id && method === 'DELETE') return deleteShift(db, id);
  return json({ error: 'Method not allowed.' }, 405);
}
