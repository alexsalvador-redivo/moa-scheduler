// Who is making the request. In production Cloudflare Access sits in front of
// the app and adds the signed-in email as a header (milestone 7 verifies its JWT).
// For local development, DEV_LOGIN=true in .dev.vars lets the page pick a person
// with an x-dev-user header instead.

export function requestEmail(request, env) {
  const email = request.headers.get('cf-access-authenticated-user-email');
  if (email) return email.toLowerCase();
  if (env.DEV_LOGIN === 'true') return request.headers.get('x-dev-user')?.toLowerCase() ?? null;
  return null;
}

export async function currentUser(request, env) {
  const email = requestEmail(request, env);
  if (!email) return null;
  return env.DB.prepare('SELECT id, clinic_id, name, email, role, staff_type FROM staff WHERE email = ? AND active = 1')
    .bind(email).first();
}

// Today's date at the clinic, 'YYYY-MM-DD'.
export function clinicToday(now = new Date()) {
  return now.toLocaleDateString('en-CA', { timeZone: 'America/Vancouver' });
}
