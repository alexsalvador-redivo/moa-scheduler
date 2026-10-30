// API Worker. Static files in public/ are served by Workers Static Assets;
// anything under /api/ lands here.
import { checkSchedule } from './rules.js';
import { handleAdmin } from './admin.js';
import { handleSchedule, loadWeek } from './schedule.js';

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

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

    const schedule = await handleSchedule(request, env.DB, url);
    if (schedule) return schedule;

    const admin = await handleAdmin(request, env.DB, url.pathname);
    if (admin) return admin;

    return json({ error: 'not found' }, 404);
  },
};
