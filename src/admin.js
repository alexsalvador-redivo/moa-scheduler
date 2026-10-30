// Admin API: clinic settings, skills, stations and staff.
// MVP is one clinic (id 1). Manager-only access is enforced in milestone 7.
import { validateClinic, validateSkill, validateStation, validateStaff } from './validate.js';

const CLINIC = 1;

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
const invalid = (errors) => json({ error: 'Please fix the highlighted fields.', fields: errors }, 400);
const notFound = () => json({ error: 'Not found.' }, 404);

async function body(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

// ---------- clinic ----------

async function getClinic(db) {
  const c = await db.prepare('SELECT * FROM clinics WHERE id = ?').bind(CLINIC).first();
  return c && { ...c, open_hours: JSON.parse(c.open_hours) };
}

async function putClinic(db, input) {
  const { value: v, errors } = validateClinic(input);
  if (errors) return invalid(errors);
  await db.prepare('UPDATE clinics SET name = ?, open_hours = ?, coverage_ratio = ?, week_starts_on = ? WHERE id = ?')
    .bind(v.name, JSON.stringify(v.open_hours), v.coverage_ratio, v.week_starts_on, CLINIC).run();
  return json(await getClinic(db));
}

// ---------- skills ----------

const listSkills = async (db) => (await db.prepare('SELECT * FROM skills ORDER BY name').all()).results;

async function saveSkill(db, id, input) {
  const { value: v, errors } = validateSkill(input);
  if (errors) return invalid(errors);
  const clash = await db.prepare('SELECT id FROM skills WHERE name = ? COLLATE NOCASE AND id IS NOT ?').bind(v.name, id).first();
  if (clash) return invalid({ name: 'A skill with this name already exists.' });
  if (id) {
    const r = await db.prepare('UPDATE skills SET name = ? WHERE id = ?').bind(v.name, id).run();
    if (!r.meta.changes) return notFound();
  } else {
    await db.prepare('INSERT INTO skills (name) VALUES (?)').bind(v.name).run();
  }
  return json(await listSkills(db), id ? 200 : 201);
}

async function deleteSkill(db, id) {
  const used = await db.prepare('SELECT name FROM stations WHERE required_skill_id = ?').bind(id).all();
  if (used.results.length) {
    return json({ error: `Still required by: ${used.results.map((s) => s.name).join(', ')}. Change those stations first.` }, 409);
  }
  await db.batch([
    db.prepare('DELETE FROM staff_skills WHERE skill_id = ?').bind(id),
    db.prepare('DELETE FROM skills WHERE id = ?').bind(id),
  ]);
  return json(await listSkills(db));
}

// ---------- stations ----------

const listStations = async (db) =>
  (await db.prepare('SELECT * FROM stations WHERE clinic_id = ? ORDER BY id').bind(CLINIC).all()).results
    .map((s) => ({ ...s, is_front_desk: !!s.is_front_desk }));

async function saveStation(db, id, input) {
  const { value: v, errors } = validateStation(input);
  if (errors) return invalid(errors);
  if (v.required_skill_id && !(await db.prepare('SELECT id FROM skills WHERE id = ?').bind(v.required_skill_id).first())) {
    return invalid({ required_skill_id: 'Unknown skill.' });
  }
  if (id) {
    const r = await db.prepare('UPDATE stations SET name = ?, required_skill_id = ?, is_front_desk = ? WHERE id = ? AND clinic_id = ?')
      .bind(v.name, v.required_skill_id, v.is_front_desk, id, CLINIC).run();
    if (!r.meta.changes) return notFound();
  } else {
    await db.prepare('INSERT INTO stations (clinic_id, name, required_skill_id, is_front_desk) VALUES (?, ?, ?, ?)')
      .bind(CLINIC, v.name, v.required_skill_id, v.is_front_desk).run();
  }
  return json(await listStations(db), id ? 200 : 201);
}

async function deleteStation(db, id) {
  const used = await db.prepare('SELECT COUNT(*) AS n FROM shifts WHERE station_id = ?').bind(id).first();
  if (used.n) return json({ error: `This station has ${used.n} shift(s). Move them before deleting it.` }, 409);
  await db.prepare('DELETE FROM stations WHERE id = ? AND clinic_id = ?').bind(id, CLINIC).run();
  return json(await listStations(db));
}

// ---------- staff ----------

async function listStaff(db) {
  const [people, links] = await Promise.all([
    db.prepare('SELECT * FROM staff WHERE clinic_id = ? AND active = 1 ORDER BY name').bind(CLINIC).all(),
    db.prepare('SELECT staff_id, skill_id FROM staff_skills').all(),
  ]);
  return people.results.map((p) => ({
    ...p,
    skills: links.results.filter((l) => l.staff_id === p.id).map((l) => l.skill_id),
  }));
}

async function saveStaff(db, id, input) {
  const { value: v, errors } = validateStaff(input);
  if (errors) return invalid(errors);
  const clash = await db.prepare('SELECT id FROM staff WHERE email = ? AND id IS NOT ?').bind(v.email, id).first();
  if (clash) return invalid({ email: 'Someone already has this email.' });
  const known = (await listSkills(db)).map((s) => s.id);
  if (v.skills.some((s) => !known.includes(s))) return invalid({ skills: 'Unknown skill.' });

  let staffId = id;
  if (id) {
    const r = await db.prepare(
      'UPDATE staff SET name = ?, email = ?, role = ?, staff_type = ?, min_weekly_hours = ? WHERE id = ? AND clinic_id = ? AND active = 1')
      .bind(v.name, v.email, v.role, v.staff_type, v.min_weekly_hours, id, CLINIC).run();
    if (!r.meta.changes) return notFound();
  } else {
    const r = await db.prepare(
      'INSERT INTO staff (clinic_id, name, email, role, staff_type, min_weekly_hours) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(CLINIC, v.name, v.email, v.role, v.staff_type, v.min_weekly_hours).run();
    staffId = r.meta.last_row_id;
  }
  await db.batch([
    db.prepare('DELETE FROM staff_skills WHERE staff_id = ?').bind(staffId),
    ...v.skills.map((s) => db.prepare('INSERT INTO staff_skills (staff_id, skill_id) VALUES (?, ?)').bind(staffId, s)),
  ]);
  return json(await listStaff(db), id ? 200 : 201);
}

// Staff are deactivated, not deleted, so past shifts and hours keep their owner.
async function deactivateStaff(db, id) {
  await db.prepare('UPDATE staff SET active = 0 WHERE id = ? AND clinic_id = ?').bind(id, CLINIC).run();
  return json(await listStaff(db));
}

// ---------- routing ----------

const COLLECTIONS = {
  skills: { list: listSkills, save: saveSkill, remove: deleteSkill },
  stations: { list: listStations, save: saveStation, remove: deleteStation },
  staff: { list: listStaff, save: saveStaff, remove: deactivateStaff },
};

// Returns a Response for /api/clinic, /api/skills, /api/stations, /api/staff; null otherwise.
export async function handleAdmin(request, db, path) {
  const method = request.method;

  if (path === '/api/clinic') {
    if (method === 'GET') return json(await getClinic(db));
    if (method === 'PUT') return putClinic(db, await body(request));
    return json({ error: 'Method not allowed.' }, 405);
  }

  const m = path.match(/^\/api\/(skills|stations|staff)(?:\/(\d+))?$/);
  if (!m) return null;
  const c = COLLECTIONS[m[1]];
  const id = m[2] ? Number(m[2]) : null;

  if (!id && method === 'GET') return json(await c.list(db));
  if (!id && method === 'POST') return c.save(db, null, await body(request));
  if (id && method === 'PUT') return c.save(db, id, await body(request));
  if (id && method === 'DELETE') return c.remove(db, id);
  return json({ error: 'Method not allowed.' }, 405);
}
