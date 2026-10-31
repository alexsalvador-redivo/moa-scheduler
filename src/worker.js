// API Worker. Static files in public/ are served by Workers Static Assets;
// anything under /api/ lands here. Every API route needs a signed-in staff
// member; everything outside /api/me needs a manager.
import { checkSchedule } from './rules.js';
import { handleAdmin } from './admin.js';
import { handleSchedule, loadWeek } from './schedule.js';
import { handleMe } from './me.js';
import { handlePublish } from './publish.js';
import { currentUser, accessConfigured } from './auth.js';

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

// What a path needs: 'public', 'dev' (local picker only), 'staff' or 'manager'.
export function accessFor(path) {
  if (path === '/api/health') return 'public';
  if (path === '/api/dev/users') return 'dev';
  if (path === '/api/me' || path.startsWith('/api/me/')) return 'staff';
  return 'manager';
}

async function route(request, env, url, user) {
  const path = url.pathname;
  if (accessFor(path) === 'staff') return handleMe(request, env.DB, user, path);

  // GET /api/check?week=2026-11-01 → shifts for the week and every rule warning.
  if (path === '/api/check' && request.method === 'GET') {
    const week = url.searchParams.get('week');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(week ?? '')) return json({ error: 'week=YYYY-MM-DD required' }, 400);
    const ctx = await loadWeek(env.DB, 1, week);
    if (!ctx) return json({ error: 'clinic not found' }, 404);
    return json({ week, shifts: ctx.shifts, warnings: checkSchedule(ctx) });
  }

  return (await handlePublish(request, env, url))
    ?? (await handleSchedule(request, env.DB, url))
    ?? (await handleAdmin(request, env.DB, path))
    ?? json({ error: 'not found' }, 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const need = accessFor(url.pathname);
    const devLogin = env.DEV_LOGIN === 'true' && !accessConfigured(env);

    if (need === 'public') return json({ ok: true });
    if (need === 'dev') {
      if (!devLogin) return json({ error: 'not found' }, 404);
      const people = await env.DB.prepare('SELECT name, email, role FROM staff WHERE active = 1 ORDER BY name').all();
      return json(people.results);
    }

    const user = await currentUser(request, env);
    if (!user) return json({ error: 'You are not signed in as a member of this clinic.', devLogin }, 401);
    if (need === 'manager' && user.role !== 'manager') {
      return json({ error: 'Only managers can do this. Open My shifts instead.', role: user.role }, 403);
    }
    return route(request, env, url, user);
  },
};
