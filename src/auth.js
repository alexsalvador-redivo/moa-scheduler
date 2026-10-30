// Who is making the request. In production Cloudflare Access sits in front of
// the app; we verify its signed JWT (src/access.js) rather than trusting a plain
// header, so a request that bypasses Access gets nothing. For local development,
// DEV_LOGIN=true in .dev.vars lets the page pick a person with an x-dev-user header.
import { verifyAccessJwt } from './access.js';

export function accessConfigured(env) {
  return Boolean(env.ACCESS_TEAM_DOMAIN && env.ACCESS_AUD);
}

export async function requestEmail(request, env, fetchImpl = fetch) {
  if (accessConfigured(env)) {
    try {
      return await verifyAccessJwt(request.headers.get('cf-access-jwt-assertion'), {
        teamDomain: env.ACCESS_TEAM_DOMAIN, aud: env.ACCESS_AUD, fetchImpl,
      });
    } catch {
      return null; // couldn't fetch Access's keys: refuse rather than guess
    }
  }
  if (env.DEV_LOGIN === 'true') return request.headers.get('x-dev-user')?.toLowerCase() ?? null;
  return null;
}

export async function currentUser(request, env) {
  const email = await requestEmail(request, env);
  if (!email) return null;
  return env.DB.prepare('SELECT id, clinic_id, name, email, role, staff_type FROM staff WHERE email = ? AND active = 1')
    .bind(email).first();
}

// Today's date at the clinic, 'YYYY-MM-DD'.
export function clinicToday(now = new Date()) {
  return now.toLocaleDateString('en-CA', { timeZone: 'America/Vancouver' });
}
