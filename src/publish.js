// Manager actions on a finished week: approve time off, publish with an email
// notice, export scheduled hours as CSV.
import { weekView, addDays } from './schedule.js';
import { isDate } from './validate.js';
import { scheduleCsv } from './payroll.js';
import { scheduleEmail, sendAll, mailConfigured } from './notify.js';

const CLINIC = 1;

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

async function body(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

// ---------- time off ----------

// Requests with the person's name and how many of their shifts fall on those days.
async function listTimeOff(db, status) {
  const rows = await db.prepare(`SELECT t.id, t.staff_id, p.name, t.start_date, t.end_date, t.reason, t.status,
      (SELECT COUNT(*) FROM shifts s WHERE s.staff_id = t.staff_id AND s.date BETWEEN t.start_date AND t.end_date) AS shift_count
    FROM time_off t JOIN staff p ON p.id = t.staff_id
    WHERE p.clinic_id = ? AND (? = 'all' OR t.status = ?)
    ORDER BY t.status = 'pending' DESC, t.start_date`).bind(CLINIC, status, status).all();
  return rows.results;
}

async function decideTimeOff(db, id, input) {
  if (!['approved', 'declined', 'pending'].includes(input.status)) {
    return json({ error: 'Status must be approved, declined or pending.' }, 400);
  }
  const r = await db.prepare(`UPDATE time_off SET status = ? WHERE id = ?
    AND staff_id IN (SELECT id FROM staff WHERE clinic_id = ?)`).bind(input.status, id, CLINIC).run();
  if (!r.meta.changes) return json({ error: 'Not found.' }, 404);
  return json(await listTimeOff(db, 'pending'));
}

// ---------- publish ----------

// Publishes every shift in the week. The first publish emails everyone with a
// shift; a later one emails only people whose shifts changed since.
async function publishWeek(db, env, input, origin) {
  if (!isDate(input.week)) return json({ error: 'week=YYYY-MM-DD required' }, 400);
  const before = await weekView(db, input.week);
  const start = before.weekStart, end = addDays(start, 6);
  const drafts = before.shifts.filter((s) => s.status === 'draft');
  if (before.publishedAt && drafts.length === 0) return json({ error: 'Nothing new to publish this week.' }, 409);
  if (!before.shifts.length) return json({ error: 'This week has no shifts yet.' }, 409);

  const now = new Date().toISOString();
  await db.batch([
    db.prepare("UPDATE shifts SET status = 'published' WHERE clinic_id = ? AND date BETWEEN ? AND ?").bind(CLINIC, start, end),
    db.prepare(`INSERT INTO schedule_weeks (clinic_id, week_start, published_at) VALUES (?, ?, ?)
      ON CONFLICT (clinic_id, week_start) DO UPDATE SET published_at = excluded.published_at`).bind(CLINIC, start, now),
  ]);

  const updated = Boolean(before.publishedAt);
  const notify = new Set((updated ? drafts : before.shifts).map((s) => s.staffId));
  const [people, clinic] = await Promise.all([
    db.prepare('SELECT id, name, email FROM staff WHERE clinic_id = ? AND active = 1').bind(CLINIC).all(),
    db.prepare('SELECT name FROM clinics WHERE id = ?').bind(CLINIC).first(),
  ]);
  const stationName = (id) => before.stations.find((s) => s.id === id)?.name ?? '';
  const messages = people.results.filter((p) => notify.has(p.id)).map((person) => scheduleEmail({
    person,
    clinicName: clinic.name,
    weekStart: start,
    updated,
    appUrl: env.APP_URL || origin,
    shifts: before.shifts.filter((s) => s.staffId === person.id).map((s) => ({ ...s, station: stationName(s.stationId) })),
  }));
  const emails = await sendAll(env, messages);

  return json({ week: await weekView(db, start), emails: { ...emails, configured: mailConfigured(env) } });
}

// ---------- export ----------

async function exportCsv(db, date) {
  if (!isDate(date)) return json({ error: 'date=YYYY-MM-DD required' }, 400);
  const view = await weekView(db, date);
  const staff = await db.prepare('SELECT id, name, email FROM staff WHERE clinic_id = ?').bind(CLINIC).all();
  const csv = scheduleCsv({ weekStart: view.weekStart, shifts: view.shifts, staff: staff.results, stations: view.stations });
  return new Response(csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="moa-hours-${view.weekStart}.csv"`,
    },
  });
}

// Returns a Response for these routes; null otherwise.
export async function handlePublish(request, env, url) {
  const { pathname: path } = url;
  const method = request.method;
  const db = env.DB;

  if (path === '/api/time-off' && method === 'GET') {
    const status = url.searchParams.get('status') ?? 'pending';
    if (!['pending', 'approved', 'declined', 'all'].includes(status)) return json({ error: 'Unknown status.' }, 400);
    return json(await listTimeOff(db, status));
  }
  const m = path.match(/^\/api\/time-off\/(\d+)$/);
  if (m && method === 'PUT') return decideTimeOff(db, Number(m[1]), await body(request));

  if (path === '/api/week/publish' && method === 'POST') return publishWeek(db, env, await body(request), url.origin);
  if (path === '/api/week/export.csv' && method === 'GET') return exportCsv(db, url.searchParams.get('date'));
  return null;
}
