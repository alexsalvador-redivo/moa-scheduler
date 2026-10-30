import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hoursSummary, scheduleCsv, csvCell } from '../src/payroll.js';
import { scheduleEmail, sendAll } from '../src/notify.js';

const lunch = { breakStart: '12:00', breakEnd: '12:30' };
const shift = (id, staffId, date, start, end, extra = {}) => ({ id, staffId, stationId: 1, date, start, end, ...extra });

// Spec test case 14 uses the shifts from cases 2, 7 and 8.
const case2 = [shift(1, 1, '2026-11-02', '12:00', '20:00', { breakStart: '16:00', breakEnd: '16:30' }),
  shift(2, 1, '2026-11-03', '08:00', '16:30', lunch)];
const case7 = [shift(3, 2, '2026-11-02', '08:00', '18:00', lunch)];
const case8 = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06']
  .map((d, i) => shift(10 + i, 3, d, '08:00', '16:30', lunch));

test('hoursSummary: cases 2, 7 and 8', () => {
  const byId = Object.fromEntries(hoursSummary([...case2, ...case7, ...case8]).map((p) => [p.staffId, p]));
  assert.deepEqual(byId[1], { staffId: 1, totalMinutes: 930, dailyOtMinutes: 0, weeklyOtMinutes: 0, regularMinutes: 930 });
  assert.deepEqual(byId[2], { staffId: 2, totalMinutes: 570, dailyOtMinutes: 90, weeklyOtMinutes: 0, regularMinutes: 480 });
  assert.deepEqual(byId[3], { staffId: 3, totalMinutes: 2400, dailyOtMinutes: 0, weeklyOtMinutes: 0, regularMinutes: 2400 });
});

test('hoursSummary: weekly overtime excludes hours already counted as daily overtime', () => {
  // Five 9.5 h days = 47.5 h: 7.5 h daily OT, leaving 40 h regular and no weekly OT.
  const long = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06']
    .map((d, i) => shift(i, 1, d, '08:00', '18:00', lunch));
  assert.deepEqual(hoursSummary(long)[0], { staffId: 1, totalMinutes: 2850, dailyOtMinutes: 450, weeklyOtMinutes: 0, regularMinutes: 2400 });
  // Add a 6 h Saturday: 6 h weekly OT.
  const plusSat = [...long, shift(9, 1, '2026-11-07', '09:00', '15:00', lunch)];
  assert.equal(hoursSummary(plusSat)[0].weeklyOtMinutes, 330);
});

test('scheduleCsv: test case 14, hours match the grid to the minute', () => {
  const csv = scheduleCsv({
    weekStart: '2026-11-01',
    shifts: [...case2, ...case7, ...case8],
    staff: [{ id: 1, name: 'Dee', email: 'dee@x.test' }, { id: 2, name: 'Ana', email: 'ana@x.test' },
      { id: 3, name: 'Priya', email: 'priya@x.test' }],
    stations: [{ id: 1, name: 'Front desk' }],
  });
  const lines = csv.trim().split('\r\n');
  assert.equal(lines[2], 'Ana,ana@x.test,2026-11-02,Front desk,08:00,18:00,12:00,12:30,570,9.50,');
  assert.ok(lines.includes('Dee,dee@x.test,15.50,15.50,0.00,0.00'));
  assert.ok(lines.includes('Ana,ana@x.test,9.50,8.00,1.50,0.00'));
  assert.ok(lines.includes('Priya,priya@x.test,40.00,40.00,0.00,0.00'));
});

test('csvCell quotes commas and defuses formulas', () => {
  assert.equal(csvCell('Lee, Morgan'), '"Lee, Morgan"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell('=HYPERLINK("x")'), `"'=HYPERLINK(""x"")"`);
  assert.equal(csvCell(null), '');
});

test('scheduleEmail lists shifts, total and the link', () => {
  const msg = scheduleEmail({
    person: { name: 'Dee Nguyen', email: 'dee@x.test' },
    clinicName: 'Maple Grove',
    weekStart: '2026-11-01',
    shifts: [{ ...case2[0], station: 'Front desk' }],
    appUrl: 'https://moa.example',
  });
  assert.equal(msg.to, 'dee@x.test');
  assert.equal(msg.subject, 'Your schedule for the week of Sun, Nov 1');
  assert.match(msg.text, /^Hi Dee,/);
  assert.match(msg.text, /Mon, Nov 2: 12 pm – 8 pm, Front desk \(meal break 4 pm\)/);
  assert.match(msg.text, /Total: 7\.5 hours/);
  assert.match(msg.text, /https:\/\/moa\.example\/me\.html/);
});

test('sendAll skips without config, counts failures with it', async () => {
  const msgs = [{ to: 'a@x', subject: 's', text: 't' }, { to: 'b@x', subject: 's', text: 't' }];
  assert.deepEqual(await sendAll({}, msgs), { sent: 0, failed: 0, skipped: 2 });
  const calls = [];
  const fake = async (url, init) => {
    calls.push(JSON.parse(init.body).to[0]);
    return { ok: !init.body.includes('b@x') };
  };
  const env = { RESEND_API_KEY: 'k', MAIL_FROM: 'Clinic <s@x>' };
  assert.deepEqual(await sendAll(env, msgs, fake), { sent: 1, failed: 1, skipped: 0 });
  assert.deepEqual(calls, ['a@x', 'b@x']);
});
