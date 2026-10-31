// Scheduled-hours summary and CSV export for payroll. Pure functions.
import { workedMinutes } from './rules.js';

// Per person: total minutes, daily overtime (over 8 h in a day) and weekly
// overtime (over 40 h in the week, not counting hours already paid as daily OT),
// as BC Employment Standards count them.
export function hoursSummary(shifts) {
  const people = new Map();
  for (const s of shifts) {
    const p = people.get(s.staffId) ?? { staffId: s.staffId, totalMinutes: 0, days: new Map() };
    const m = workedMinutes(s);
    p.totalMinutes += m;
    p.days.set(s.date, (p.days.get(s.date) ?? 0) + m);
    people.set(s.staffId, p);
  }
  return [...people.values()].map(({ staffId, totalMinutes, days }) => {
    const dailyOtMinutes = [...days.values()].reduce((t, m) => t + Math.max(0, m - 480), 0);
    const weeklyOtMinutes = Math.max(0, totalMinutes - dailyOtMinutes - 2400);
    return {
      staffId,
      totalMinutes,
      dailyOtMinutes,
      weeklyOtMinutes,
      regularMinutes: totalMinutes - dailyOtMinutes - weeklyOtMinutes,
    };
  });
}

const hours = (min) => (min / 60).toFixed(2);

// Quote for CSV, and defuse spreadsheet formulas in typed-in text.
export function csvCell(value) {
  let v = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(v)) v = `'${v}`;
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

const row = (cells) => cells.map(csvCell).join(',');

// One row per shift, then a per-person summary. staff/stations are lookups by id.
export function scheduleCsv({ weekStart, shifts, staff, stations }) {
  const name = (id) => staff.find((p) => p.id === id)?.name ?? `Staff ${id}`;
  const email = (id) => staff.find((p) => p.id === id)?.email ?? '';
  const station = (id) => stations.find((s) => s.id === id)?.name ?? '';
  const sorted = [...shifts].sort((a, b) =>
    name(a.staffId).localeCompare(name(b.staffId)) || a.date.localeCompare(b.date) || a.start.localeCompare(b.start));

  const lines = [
    row([`Week starting ${weekStart}`]),
    row(['Staff', 'Email', 'Date', 'Station', 'Start', 'End', 'Break start', 'Break end', 'Minutes worked', 'Hours worked', 'Status']),
    ...sorted.map((s) => {
      const m = workedMinutes(s);
      return row([name(s.staffId), email(s.staffId), s.date, station(s.stationId), s.start, s.end,
        s.breakStart ?? '', s.breakEnd ?? '', m, hours(m), s.status ?? '']);
    }),
    '',
    row(['Staff', 'Email', 'Total hours', 'Regular hours', 'Daily overtime hours', 'Weekly overtime hours']),
    ...hoursSummary(shifts)
      .sort((a, b) => name(a.staffId).localeCompare(name(b.staffId)))
      .map((p) => row([name(p.staffId), email(p.staffId), hours(p.totalMinutes), hours(p.regularMinutes),
        hours(p.dailyOtMinutes), hours(p.weeklyOtMinutes)])),
  ];
  return `${lines.join('\r\n')}\r\n`;
}
