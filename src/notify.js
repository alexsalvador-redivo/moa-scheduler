// "Your schedule is out" emails. The message is built by a pure function; sending
// goes through Resend's HTTP API (free tier: 3,000 emails a month) when
// RESEND_API_KEY and MAIL_FROM are set. Without them, nothing is sent and the
// caller is told so.
import { workedMinutes } from './rules.js';

const fmtDate = (d) => new Date(`${d}T12:00:00Z`)
  .toLocaleDateString('en-CA', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' });

function clock(t) {
  const [h, m] = t.split(':').map(Number);
  return `${h % 12 || 12}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h < 12 ? 'am' : 'pm'}`;
}

// shifts: this person's shifts for the week, each with a station name.
export function scheduleEmail({ person, clinicName, weekStart, shifts, appUrl, updated = false }) {
  const total = shifts.reduce((t, s) => t + workedMinutes(s), 0);
  const lines = shifts.length
    ? shifts.map((s) => `${fmtDate(s.date)}: ${clock(s.start)} – ${clock(s.end)}, ${s.station}`
      + (s.breakStart ? ` (meal break ${clock(s.breakStart)})` : ''))
    : ['No shifts for you this week.'];
  const subject = `${updated ? 'Updated schedule' : 'Your schedule'} for the week of ${fmtDate(weekStart)}`;
  const text = [
    `Hi ${person.name.split(' ')[0]},`,
    '',
    `${clinicName} has ${updated ? 'updated' : 'published'} the schedule for the week of ${fmtDate(weekStart)}.`,
    '',
    ...lines,
    '',
    `Total: ${Math.round((total / 60) * 100) / 100} hours`,
    '',
    `See your shifts any time: ${appUrl}/me.html`,
  ].join('\n');
  return { to: person.email, subject, text };
}

export function mailConfigured(env) {
  return Boolean(env.RESEND_API_KEY && env.MAIL_FROM);
}

// Send each message; never throws. Returns { sent, failed, skipped }.
export async function sendAll(env, messages, fetchImpl = fetch) {
  if (!mailConfigured(env)) return { sent: 0, failed: 0, skipped: messages.length };
  const results = await Promise.allSettled(messages.map(async (m) => {
    const res = await fetchImpl('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: env.MAIL_FROM, to: [m.to], subject: m.subject, text: m.text }),
    });
    if (!res.ok) throw new Error(`Resend ${res.status}`);
  }));
  const sent = results.filter((r) => r.status === 'fulfilled').length;
  return { sent, failed: results.length - sent, skipped: 0 };
}
