// BC Employment Standards and coverage rules for MOA schedules.
// Pure functions: no I/O, no clock. Every rule WARNS; nothing blocks a save.
//
// Each warning is { ok: false, code, message, shiftIds }.
// Times are local wall-clock 'HH:MM' on a 'YYYY-MM-DD' date. A shift whose end
// is at or before its start runs past midnight into the next day.

const DAY = 1440;

// ---------- time helpers ----------

export function dayNumber(date) {
  const [y, m, d] = date.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86400000);
}

export function weekday(date) {
  return (dayNumber(date) + 4) % 7; // 1970-01-01 was a Thursday; 0 = Sunday
}

export function toMinutes(time) {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

function absolute(date, time) {
  return dayNumber(date) * DAY + toMinutes(time);
}

export function fmtTime(abs) {
  const m = ((abs % DAY) + DAY) % DAY;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

function fmtHours(minutes) {
  const h = minutes / 60;
  return `${Number.isInteger(h) ? h : h.toFixed(2).replace(/0$/, '')} h`;
}

// Absolute start/end of a shift and its break, in minutes.
export function span(shift) {
  const start = absolute(shift.date, shift.start);
  let end = absolute(shift.date, shift.end);
  if (end <= start) end += DAY;
  let breakStart = null;
  let breakEnd = null;
  if (shift.breakStart && shift.breakEnd) {
    breakStart = absolute(shift.date, shift.breakStart);
    if (breakStart < start) breakStart += DAY;
    breakEnd = breakStart + ((toMinutes(shift.breakEnd) - toMinutes(shift.breakStart) + DAY) % DAY);
  }
  return { start, end, breakStart, breakEnd };
}

// Minutes actually worked: shift length minus the planned break.
export function workedMinutes(shift) {
  const s = span(shift);
  const brk = s.breakStart === null ? 0 : s.breakEnd - s.breakStart;
  return s.end - s.start - brk;
}

// Intervals [from, to) when the person is on the floor (break removed).
function onFloor(shift) {
  const s = span(shift);
  if (s.breakStart === null) return [[s.start, s.end]];
  return [[s.start, s.breakStart], [s.breakEnd, s.end]].filter(([a, b]) => b > a);
}

function warn(code, message, shiftIds) {
  return { ok: false, code, message, shiftIds };
}

function groupBy(items, keyFn) {
  const map = new Map();
  for (const item of items) {
    const key = keyFn(item);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  }
  return map;
}

function staffName(ctx, staffId) {
  return ctx.staff?.find((p) => p.id === staffId)?.name ?? `Staff ${staffId}`;
}

// A person's shifts on one date form one work day (split shifts included).
function workDays(shifts) {
  const days = [];
  for (const [staffId, mine] of groupBy(shifts, (s) => s.staffId)) {
    for (const [date, segs] of groupBy(mine, (s) => s.date)) {
      const spans = segs.map(span);
      days.push({
        staffId,
        date,
        shifts: segs,
        start: Math.min(...spans.map((s) => s.start)),
        end: Math.max(...spans.map((s) => s.end)),
      });
    }
  }
  return days;
}

// ---------- rules ----------

// At least 8 consecutive hours off between one work day and the next.
export function rest8h(ctx) {
  const out = [];
  const byStaff = groupBy(workDays(ctx.shifts), (d) => d.staffId);
  for (const [staffId, days] of byStaff) {
    days.sort((a, b) => a.start - b.start);
    for (let i = 1; i < days.length; i++) {
      const gap = days[i].start - days[i - 1].end;
      if (gap < 8 * 60) {
        const prev = days[i - 1].shifts.at(-1);
        const next = days[i].shifts[0];
        out.push(warn('REST_8H',
          `${staffName(ctx, staffId)} has only ${fmtHours(Math.max(gap, 0))} off between ${days[i - 1].date} and ${days[i].date} (needs 8 h).`,
          [prev.id, next.id]));
      }
    }
  }
  return out;
}

// All segments of a split day finish within 12 hours of the first start.
export function split12h(ctx) {
  const out = [];
  for (const day of workDays(ctx.shifts)) {
    if (day.shifts.length < 2) continue;
    const length = day.end - day.start;
    if (length > 12 * 60) {
      out.push(warn('SPLIT_12H',
        `${staffName(ctx, day.staffId)}'s split shift on ${day.date} spans ${fmtHours(length)} (limit 12 h).`,
        day.shifts.map((s) => s.id)));
    }
  }
  return out;
}

// No shift shorter than 2 hours (BC minimum daily pay on reporting).
export function min2h(ctx) {
  return ctx.shifts
    .filter((s) => span(s).end - span(s).start < 120)
    .map((s) => warn('MIN_2H',
      `${staffName(ctx, s.staffId)}'s shift on ${s.date} is ${fmtHours(span(s).end - span(s).start)}; BC requires at least 2 h pay.`,
      [s.id]));
}

// A 30-minute meal break so no one works more than 5 hours in a row.
export function meal5h(ctx) {
  const out = [];
  for (const s of ctx.shifts) {
    const sp = span(s);
    if (sp.end - sp.start <= 5 * 60) continue;
    const name = staffName(ctx, s.staffId);
    if (sp.breakStart === null) {
      out.push(warn('MEAL_5H', `${name}'s ${fmtHours(sp.end - sp.start)} shift on ${s.date} has no meal break.`, [s.id]));
    } else if (sp.breakEnd - sp.breakStart < 30) {
      out.push(warn('MEAL_5H', `${name}'s meal break on ${s.date} is shorter than 30 min.`, [s.id]));
    } else if (sp.breakStart - sp.start > 5 * 60 || sp.end - sp.breakEnd > 5 * 60) {
      out.push(warn('MEAL_5H', `${name} works more than 5 h in a row on ${s.date}; move or add a meal break.`, [s.id]));
    }
  }
  return out;
}

// More than 8 hours worked in a day.
export function otDay(ctx) {
  const out = [];
  for (const day of workDays(ctx.shifts)) {
    const worked = day.shifts.reduce((sum, s) => sum + workedMinutes(s), 0);
    if (worked > 8 * 60) {
      out.push(warn('OT_DAY',
        `${staffName(ctx, day.staffId)} works ${fmtHours(worked)} on ${day.date}: ${fmtHours(worked - 480)} daily overtime.`,
        day.shifts.map((s) => s.id)));
    }
  }
  return out;
}

export function weekStart(date, weekStartsOn = 0) {
  const n = dayNumber(date);
  const back = (weekday(date) - weekStartsOn + 7) % 7;
  return new Date((n - back) * 86400000).toISOString().slice(0, 10);
}

// More than 40 hours worked in a week (Sun–Sat unless the clinic says otherwise).
export function otWeek(ctx) {
  const out = [];
  const startsOn = ctx.settings?.weekStartsOn ?? 0;
  const groups = groupBy(ctx.shifts, (s) => `${s.staffId}|${weekStart(s.date, startsOn)}`);
  for (const [key, mine] of groups) {
    const worked = mine.reduce((sum, s) => sum + workedMinutes(s), 0);
    if (worked > 40 * 60) {
      const [staffId, week] = key.split('|');
      out.push(warn('OT_WEEK',
        `${staffName(ctx, Number(staffId))} works ${fmtHours(worked)} in the week of ${week}: ${fmtHours(worked - 2400)} weekly overtime.`,
        mine.map((s) => s.id)));
    }
  }
  return out;
}

// Assigned person lacks the station's required skill.
export function skill(ctx) {
  const out = [];
  for (const s of ctx.shifts) {
    const station = ctx.stations?.find((st) => st.id === s.stationId);
    if (!station?.requiredSkillId) continue;
    const person = ctx.staff?.find((p) => p.id === s.staffId);
    if (!person?.skills?.includes(station.requiredSkillId)) {
      out.push(warn('SKILL',
        `${staffName(ctx, s.staffId)} is on ${station.name} on ${s.date} without the required skill.`,
        [s.id]));
    }
  }
  return out;
}

// Shift outside the person's availability, or on approved time off.
// Someone with no availability entered is treated as available any time.
export function avail(ctx) {
  const out = [];
  for (const s of ctx.shifts) {
    const person = ctx.staff?.find((p) => p.id === s.staffId);
    if (!person) continue;
    const name = person.name;
    const off = (person.timeOff ?? []).find(
      (t) => t.status === 'approved' && t.startDate <= s.date && s.date <= t.endDate);
    if (off) {
      out.push(warn('AVAIL', `${name} has approved time off on ${s.date}.`, [s.id]));
      continue;
    }
    const windows = person.availability ?? [];
    if (windows.length === 0) continue;
    const sp = span(s);
    const day = dayNumber(s.date) * DAY;
    const fits = windows.some((w) => w.weekday === weekday(s.date)
      && day + toMinutes(w.start) <= sp.start && sp.end <= day + toMinutes(w.end));
    if (!fits) {
      out.push(warn('AVAIL', `${name}'s shift on ${s.date} ${s.start}–${s.end} is outside their availability.`, [s.id]));
    }
  }
  return out;
}

// Headcount on the floor over [from, to): list of { from, to, count, shiftIds }.
function headcount(shifts, from, to) {
  const intervals = shifts.flatMap((s) => onFloor(s).map(([a, b]) => ({ a, b, id: s.id })))
    .filter((iv) => iv.b > from && iv.a < to);
  const points = new Set([from, to]);
  for (const iv of intervals) {
    if (iv.a > from) points.add(iv.a);
    if (iv.b < to) points.add(iv.b);
  }
  const sorted = [...points].sort((x, y) => x - y);
  const pieces = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const [a, b] = [sorted[i], sorted[i + 1]];
    const here = intervals.filter((iv) => iv.a <= a && iv.b >= b);
    const prev = pieces.at(-1);
    if (prev && prev.count === here.length) {
      prev.to = b;
      prev.shiftIds = [...new Set([...prev.shiftIds, ...here.map((iv) => iv.id)])];
    } else pieces.push({ from: a, to: b, count: here.length, shiftIds: here.map((iv) => iv.id) });
  }
  return pieces;
}

// Scheduled MOAs below providers × ratio at any point in a provider block.
export function coverage(ctx) {
  const out = [];
  const ratio = ctx.settings?.coverageRatio ?? 0.5;
  for (const block of ctx.providerBlocks ?? []) {
    const required = Math.ceil(block.providerCount * ratio);
    if (required === 0) continue;
    const from = absolute(block.date, block.start);
    const to = absolute(block.date, block.end);
    for (const piece of headcount(ctx.shifts, from, to)) {
      if (piece.count < required) {
        out.push(warn('COVERAGE',
          `${block.date} ${fmtTime(piece.from)}–${fmtTime(piece.to)}: ${piece.count} of ${required} MOAs scheduled for ${block.providerCount} providers (short by ${required - piece.count}).`,
          piece.shiftIds));
      }
    }
  }
  return out;
}

// Front desk has no one on it during open hours (lunch breaks included).
// Checks ctx.dates if given, otherwise every date that has a shift.
export function deskEmpty(ctx) {
  const out = [];
  const deskIds = new Set((ctx.stations ?? []).filter((st) => st.isFrontDesk).map((st) => st.id));
  if (deskIds.size === 0) return out;
  const dates = ctx.dates ?? [...new Set(ctx.shifts.map((s) => s.date))].sort();
  for (const date of dates) {
    const hours = ctx.settings?.openHours?.[weekday(date)];
    if (!hours) continue;
    const desk = ctx.shifts.filter((s) => deskIds.has(s.stationId));
    const from = absolute(date, hours[0]);
    const to = absolute(date, hours[1]);
    for (const piece of headcount(desk, from, to)) {
      if (piece.count === 0) {
        out.push(warn('DESK_EMPTY',
          `${date} ${fmtTime(piece.from)}–${fmtTime(piece.to)}: no one on the front desk.`,
          []));
      }
    }
  }
  return out;
}

export const RULES = {
  REST_8H: rest8h,
  SPLIT_12H: split12h,
  MIN_2H: min2h,
  MEAL_5H: meal5h,
  OT_DAY: otDay,
  OT_WEEK: otWeek,
  SKILL: skill,
  AVAIL: avail,
  COVERAGE: coverage,
  DESK_EMPTY: deskEmpty,
};

// Run every rule. ctx = { shifts, staff, stations, providerBlocks, settings, dates? }
export function checkSchedule(ctx) {
  return Object.values(RULES).flatMap((rule) => rule(ctx));
}
