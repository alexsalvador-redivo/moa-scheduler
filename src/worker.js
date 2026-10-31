// API Worker. Static files in public/ are served by Workers Static Assets;
// anything under /api/ lands here.
import { checkSchedule } from './rules.js';
import { handleAdmin } from './admin.js';

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

const addDays = (date, n) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

// Load everything the rules engine needs for one clinic week.
export async function loadWeek(db, clinicId, weekStart) {
  const weekEnd = addDays(weekStart, 6);
  const [clinic, staff, skills, avail, timeOff, stations, blocks, shifts] = await Promise.all([
    db.prepare('SELECT * FROM clinics WHERE id = ?').bind(clinicId).first(),
    db.prepare('SELECT id, name, staff_type FROM staff WHERE clinic_id = ? AND active = 1').bind(clinicId).all(),
    db.prepare('SELECT staff_id, skill_id FROM staff_skills').all(),
    db.prepare('SELECT staff_id, weekday, start_time, end_time FROM availability').all(),
    db.prepare('SELECT staff_id, start_date, end_date, status FROM time_off WHERE end_date >= ? AND start_date <= ?')
      .bind(weekStart, weekEnd).all(),
    db.prepare('SELECT * FROM stations WHERE clinic_id = ?').bind(clinicId).all(),
    db.prepare('SELECT * FROM provider_blocks WHERE clinic_id = ? AND date BETWEEN ? AND ?')
      .bind(clinicId, weekStart, weekEnd).all(),
    // Include the day before so REST_8H sees a late shift on the previous Saturday.
    db.prepare('SELECT * FROM shifts WHERE clinic_id = ? AND date BETWEEN ? AND ?')
      .bind(clinicId, addDays(weekStart, -1), weekEnd).all(),
  ]);
  if (!clinic) return null;

  const of = (rows, id) => rows.results.filter((r) => r.staff_id === id);
  return {
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
      skills: of(skills, p.id).map((r) => r.skill_id),
      availability: of(avail, p.id).map((r) => ({ weekday: r.weekday, start: r.start_time, end: r.end_time })),
      timeOff: of(timeOff, p.id).map((r) => ({ startDate: r.start_date, endDate: r.end_date, status: r.status })),
    })),
    stations: stations.results.map((s) => ({
      id: s.id, name: s.name, requiredSkillId: s.required_skill_id, isFrontDesk: !!s.is_front_desk,
    })),
    providerBlocks: blocks.results.map((b) => ({
      date: b.date, start: b.start_time, end: b.end_time, providerCount: b.provider_count,
    })),
    shifts: shifts.results.map((s) => ({
      id: s.id, staffId: s.staff_id, stationId: s.station_id, date: s.date,
      start: s.start_time, end: s.end_time, breakStart: s.break_start, breakEnd: s.break_end, status: s.status,
    })),
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/health') {
      const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM staff').first();
      return json({ ok: true, staff: row.n });
    }

    // GET /api/check?week=2026-11-01 → shifts for the week and every rule warning.
    if (url.pathname === '/api/check' && request.method === 'GET') {
      const week = url.searchParams.get('week');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(week ?? '')) return json({ error: 'week=YYYY-MM-DD required' }, 400);
      const ctx = await loadWeek(env.DB, 1, week);
      if (!ctx) return json({ error: 'clinic not found' }, 404);
      return json({ week, shifts: ctx.shifts, warnings: checkSchedule(ctx) });
    }

    const admin = await handleAdmin(request, env.DB, url.pathname);
    if (admin) return admin;

    return json({ error: 'not found' }, 404);
  },
};
