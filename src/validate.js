// Input checks for the admin API. Each validator returns { value, errors }:
// value is the cleaned record ready for D1, errors maps field → message.

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function text(input, field, errors, { required = true, max = 100 } = {}) {
  const v = typeof input[field] === 'string' ? input[field].trim() : '';
  if (required && !v) errors[field] = 'Required.';
  else if (v.length > max) errors[field] = `At most ${max} characters.`;
  return v;
}

function oneOf(input, field, options, errors, fallback) {
  const v = input[field] ?? fallback;
  if (!options.includes(v)) errors[field] = `Must be one of ${options.join(', ')}.`;
  return v;
}

function number(input, field, errors, { min = -Infinity, max = Infinity, fallback = 0, integer = false } = {}) {
  const raw = input[field] ?? fallback;
  const v = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw;
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max || (integer && !Number.isInteger(v))) {
    errors[field] = `Must be ${integer ? 'a whole number' : 'a number'} from ${min} to ${max}.`;
  }
  return v;
}

function idOrNull(input, field, errors) {
  const v = input[field];
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) errors[field] = 'Invalid id.';
  return n;
}

const done = (value, errors) => ({ value, errors: Object.keys(errors).length ? errors : null });

export function validateSkill(input) {
  const errors = {};
  return done({ name: text(input, 'name', errors, { max: 50 }) }, errors);
}

export function validateStation(input) {
  const errors = {};
  return done({
    name: text(input, 'name', errors, { max: 50 }),
    required_skill_id: idOrNull(input, 'required_skill_id', errors),
    is_front_desk: input.is_front_desk ? 1 : 0,
  }, errors);
}

export function validateStaff(input) {
  const errors = {};
  const email = text(input, 'email', errors, { max: 200 }).toLowerCase();
  if (email && !errors.email && !EMAIL.test(email)) errors.email = 'Not a valid email address.';
  const skills = Array.isArray(input.skills) ? input.skills.map(Number) : [];
  if (skills.some((id) => !Number.isInteger(id) || id <= 0)) errors.skills = 'Invalid skill id.';
  return done({
    name: text(input, 'name', errors),
    email,
    role: oneOf(input, 'role', ['manager', 'staff'], errors, 'staff'),
    staff_type: oneOf(input, 'staff_type', ['FT', 'PT', 'casual'], errors, 'FT'),
    min_weekly_hours: number(input, 'min_weekly_hours', errors, { min: 0, max: 60 }),
    skills: [...new Set(skills)],
  }, errors);
}

// open_hours: { "1": ["08:00", "20:00"], ... } keyed by weekday, 0 = Sunday.
export function validateClinic(input) {
  const errors = {};
  const hours = {};
  const raw = input.open_hours && typeof input.open_hours === 'object' ? input.open_hours : {};
  for (const [day, range] of Object.entries(raw)) {
    if (!/^[0-6]$/.test(day) || !Array.isArray(range) || range.length !== 2
      || !TIME.test(range[0]) || !TIME.test(range[1]) || range[0] >= range[1]) {
      errors.open_hours = 'Each open day needs a start before its end (HH:MM).';
      continue;
    }
    hours[day] = range;
  }
  return done({
    name: text(input, 'name', errors),
    open_hours: hours,
    coverage_ratio: number(input, 'coverage_ratio', errors, { min: 0.1, max: 5, fallback: 0.5 }),
    week_starts_on: number(input, 'week_starts_on', errors, { min: 0, max: 6, integer: true }),
  }, errors);
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function time(input, field, errors, required = true) {
  const v = typeof input[field] === 'string' ? input[field].trim() : '';
  if (!v) {
    if (required) errors[field] = 'Required.';
    return null;
  }
  if (!TIME.test(v)) errors[field] = 'Use HH:MM.';
  return v;
}

export function isDate(v) {
  return typeof v === 'string' && DATE.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`))
    && new Date(`${v}T00:00:00Z`).toISOString().startsWith(v);
}

// A shift may run past midnight (end at or before start). The break, if any,
// must sit inside the shift.
export function validateShift(input) {
  const errors = {};
  const v = {
    staff_id: idOrNull(input, 'staff_id', errors),
    station_id: idOrNull(input, 'station_id', errors),
    date: input.date,
    start_time: time(input, 'start_time', errors),
    end_time: time(input, 'end_time', errors),
    break_start: time(input, 'break_start', errors, false),
    break_end: time(input, 'break_end', errors, false),
  };
  if (!v.staff_id) errors.staff_id ??= 'Required.';
  if (!v.station_id) errors.station_id ??= 'Required.';
  if (!isDate(v.date)) errors.date = 'Use YYYY-MM-DD.';
  if (v.start_time && v.start_time === v.end_time) errors.end_time = 'End must differ from start.';
  if (!!v.break_start !== !!v.break_end) errors.break_end = 'Give both break start and end, or neither.';
  if (!errors.start_time && !errors.end_time && !errors.break_start && !errors.break_end && v.break_start) {
    // Minutes after shift start, wrapping past midnight.
    const after = (t) => (toMin(t) - toMin(v.start_time) + 1440) % 1440;
    const length = after(v.end_time) || 1440;
    if (after(v.break_start) >= length || after(v.break_end) > length || after(v.break_end) <= after(v.break_start)) {
      errors.break_start = 'The break must fall inside the shift.';
    }
  }
  return done(v, errors);
}

function toMin(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

// Recurring weekly availability: [{ weekday, start_time, end_time }], replaced as a whole.
export function validateAvailability(input) {
  const errors = {};
  const windows = Array.isArray(input.windows) ? input.windows : [];
  const value = [];
  for (const w of windows) {
    const weekday = Number(w?.weekday);
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6
      || !TIME.test(w.start_time ?? '') || !TIME.test(w.end_time ?? '') || w.start_time >= w.end_time) {
      errors.windows = 'Each available day needs a start time before its end time.';
      continue;
    }
    value.push({ weekday, start_time: w.start_time, end_time: w.end_time });
  }
  if (windows.length > 21) errors.windows = 'Too many time windows.';
  return done(value, errors);
}

export function validateTimeOff(input, today) {
  const errors = {};
  const v = {
    start_date: input.start_date,
    end_date: input.end_date || input.start_date,
    reason: text(input, 'reason', errors, { required: false, max: 200 }),
  };
  if (!isDate(v.start_date)) errors.start_date = 'Pick a date.';
  else if (today && v.start_date < today) errors.start_date = 'Pick today or a later date.';
  if (!isDate(v.end_date)) errors.end_date = 'Pick a date.';
  else if (!errors.start_date && v.end_date < v.start_date) errors.end_date = 'The last day must be on or after the first.';
  return done(v, errors);
}
