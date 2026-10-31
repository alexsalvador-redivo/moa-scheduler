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
