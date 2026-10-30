// Staff API: the signed-in person's published shifts, availability and time off.
import { currentUser, clinicToday } from './auth.js';
import { workedMinutes } from './rules.js';
import { validateAvailability, validateTimeOff } from './validate.js';
import { addDays } from './schedule.js';

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
const invalid = (errors) => json({ error: 'Please fix the highlighted fields.', fields: errors }, 400);

async function body(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

// Published shifts from the start of this week to five weeks out.
async function myView(db, me) {
  const today = clinicToday();
  const [shifts, availability, timeOff] = await Promise.all([
    db.prepare(`SELECT s.id, s.date, s.start_time, s.end_time, s.break_start, s.break_end, st.name AS station
      FROM shifts s JOIN stations st ON st.id = s.station_id
      WHERE s.staff_id = ? AND s.status = 'published' AND s.date BETWEEN ? AND ?
      ORDER BY s.date, s.start_time`).bind(me.id, addDays(today, -6), addDays(today, 35)).all(),
    db.prepare('SELECT weekday, start_time, end_time FROM availability WHERE staff_id = ? ORDER BY weekday, start_time')
      .bind(me.id).all(),
    db.prepare(`SELECT id, start_date, end_date, reason, status FROM time_off
      WHERE staff_id = ? AND end_date >= ? ORDER BY start_date`).bind(me.id, addDays(today, -30)).all(),
  ]);
  return {
    today,
    person: { id: me.id, name: me.name, email: me.email, role: me.role, staffType: me.staff_type },
    shifts: shifts.results.map((s) => ({
      ...s,
      minutes: workedMinutes({ date: s.date, start: s.start_time, end: s.end_time, breakStart: s.break_start, breakEnd: s.break_end }),
    })),
    availability: availability.results,
    timeOff: timeOff.results,
  };
}

async function saveAvailability(db, me, input) {
  const { value, errors } = validateAvailability(input);
  if (errors) return invalid(errors);
  await db.batch([
    db.prepare('DELETE FROM availability WHERE staff_id = ?').bind(me.id),
    ...value.map((w) => db.prepare('INSERT INTO availability (staff_id, weekday, start_time, end_time) VALUES (?, ?, ?, ?)')
      .bind(me.id, w.weekday, w.start_time, w.end_time)),
  ]);
  return json(await myView(db, me));
}

async function requestTimeOff(db, me, input) {
  const { value: v, errors } = validateTimeOff(input, clinicToday());
  if (errors) return invalid(errors);
  const overlap = await db.prepare(`SELECT id FROM time_off WHERE staff_id = ? AND status != 'declined'
    AND start_date <= ? AND end_date >= ?`).bind(me.id, v.end_date, v.start_date).first();
  if (overlap) return invalid({ start_date: 'You already have a request covering some of these days.' });
  await db.prepare('INSERT INTO time_off (staff_id, start_date, end_date, reason, status) VALUES (?, ?, ?, ?, ?)')
    .bind(me.id, v.start_date, v.end_date, v.reason || null, 'pending').run();
  return json(await myView(db, me), 201);
}

// Staff can withdraw their own request while it is still pending.
async function withdrawTimeOff(db, me, id) {
  const r = await db.prepare("DELETE FROM time_off WHERE id = ? AND staff_id = ? AND status = 'pending'").bind(id, me.id).run();
  if (!r.meta.changes) return json({ error: 'Only pending requests can be withdrawn.' }, 409);
  return json(await myView(db, me));
}

// Returns a Response for /api/me routes; null otherwise.
export async function handleMe(request, env, path) {
  if (path === '/api/dev/users' && env.DEV_LOGIN === 'true') {
    const people = await env.DB.prepare('SELECT name, email, role FROM staff WHERE active = 1 ORDER BY name').all();
    return json(people.results);
  }
  if (!path.startsWith('/api/me')) return null;

  const me = await currentUser(request, env);
  if (!me) return json({ error: 'Not signed in as a staff member.', devLogin: env.DEV_LOGIN === 'true' }, 401);
  const db = env.DB;
  const method = request.method;

  if (path === '/api/me' && method === 'GET') return json(await myView(db, me));
  if (path === '/api/me/availability' && method === 'PUT') return saveAvailability(db, me, await body(request));
  if (path === '/api/me/time-off' && method === 'POST') return requestTimeOff(db, me, await body(request));
  const m = path.match(/^\/api\/me\/time-off\/(\d+)$/);
  if (m && method === 'DELETE') return withdrawTimeOff(db, me, Number(m[1]));
  return json({ error: 'Not found.' }, 404);
}
