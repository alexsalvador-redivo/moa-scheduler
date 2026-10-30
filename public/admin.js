// Clinic setup screen: clinic settings, staff, stations and skills.
import { $, esc, api, showErrors, blockPage } from '/api.js';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const state = { clinic: null, skills: [], stations: [], staff: [] };

const skillName = (id) => state.skills.find((s) => s.id === id)?.name ?? '';


// ---------- clinic settings ----------

function renderClinic() {
  const form = $('#clinic-form');
  const c = state.clinic;
  form.name.value = c.name;
  form.coverage_ratio.value = c.coverage_ratio;
  $('#clinic-week').innerHTML = DAYS.map((d, i) => `<option value="${i}">${d}</option>`).join('');
  form.week_starts_on.value = c.week_starts_on;
  $('#clinic-hours').innerHTML = DAYS.map((d, i) => {
    const [open, close] = c.open_hours[i] ?? ['', ''];
    return `<span>${d.slice(0, 3)}</span>
      <input type="time" name="open-${i}" value="${open}" aria-label="${d} opens">
      <input type="time" name="close-${i}" value="${close}" aria-label="${d} closes">`;
  }).join('');
  $('#clinic-hours').dataset.field = 'open_hours';
}

$('#clinic-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const open_hours = {};
  DAYS.forEach((_, i) => {
    const open = form[`open-${i}`].value, close = form[`close-${i}`].value;
    if (open || close) open_hours[i] = [open, close];
  });
  try {
    state.clinic = await api('clinic', {
      method: 'PUT',
      body: { name: form.name.value, coverage_ratio: form.coverage_ratio.value, week_starts_on: Number(form.week_starts_on.value), open_hours },
    });
    showErrors(form, null);
    const saved = $('.saved', form);
    saved.hidden = false;
    setTimeout(() => { saved.hidden = true; }, 2000);
  } catch (err) {
    showErrors(form, err);
  }
});

// ---------- lists ----------

const editBtns = (kind, id, label = 'Delete') =>
  `<td class="actions"><button data-edit="${kind}" data-id="${id}">Edit</button>
   <button class="danger" data-delete="${kind}" data-id="${id}">${label}</button></td>`;

function renderLists() {
  $('#staff tbody').innerHTML = state.staff.map((p) => `<tr>
    <td>${esc(p.name)}${p.role === 'manager' ? ' <span class="tag">manager</span>' : ''}<br><span class="muted">${esc(p.email)}</span></td>
    <td class="hide-sm">${esc(p.staff_type)}${p.min_weekly_hours ? `<br><span class="muted">min ${p.min_weekly_hours} h/wk</span>` : ''}</td>
    <td>${p.skills.map((s) => `<span class="tag">${esc(skillName(s))}</span>`).join('') || '<span class="muted">None</span>'}</td>
    ${editBtns('staff', p.id, 'Remove')}</tr>`).join('');

  $('#stations tbody').innerHTML = state.stations.map((s) => `<tr>
    <td>${esc(s.name)}${s.is_front_desk ? ' <span class="tag">front desk</span>' : ''}</td>
    <td>${s.required_skill_id ? esc(skillName(s.required_skill_id)) : '<span class="muted">Anyone</span>'}</td>
    ${editBtns('stations', s.id)}</tr>`).join('');

  $('#skills tbody').innerHTML = state.skills.map((k) => `<tr>
    <td>${esc(k.name)}</td>
    <td class="hide-sm">${state.staff.filter((p) => p.skills.includes(k.id)).length}</td>
    ${editBtns('skills', k.id)}</tr>`).join('');
}

// ---------- editor dialog ----------

const FORMS = {
  staff: {
    title: (r) => (r ? `Edit ${r.name}` : 'Add person'),
    fields: (r = {}) => `
      <label for="f-name">Name</label><input id="f-name" name="name" value="${esc(r.name)}">
      <label for="f-email">Email (used to sign in)</label><input id="f-email" name="email" type="email" value="${esc(r.email)}">
      <label for="f-type">Employment</label>
      <select id="f-type" name="staff_type">${['FT', 'PT', 'casual'].map((t) =>
        `<option ${r.staff_type === t ? 'selected' : ''}>${t}</option>`).join('')}</select>
      <label for="f-min">Minimum weekly hours</label>
      <input id="f-min" name="min_weekly_hours" type="number" min="0" max="60" step="0.5" value="${r.min_weekly_hours ?? 0}">
      <label for="f-role">Role</label>
      <select id="f-role" name="role">
        <option value="staff" ${r.role !== 'manager' ? 'selected' : ''}>Staff</option>
        <option value="manager" ${r.role === 'manager' ? 'selected' : ''}>Manager</option>
      </select>
      <label>Skills</label>
      <div class="checks" data-field="skills">${state.skills.map((k) => `<label class="check">
        <input type="checkbox" name="skill" value="${k.id}" ${r.skills?.includes(k.id) ? 'checked' : ''}>${esc(k.name)}</label>`).join('')}</div>`,
    read: (f) => ({
      name: f.name.value, email: f.email.value, staff_type: f.staff_type.value, role: f.role.value,
      min_weekly_hours: f.min_weekly_hours.value,
      skills: [...f.querySelectorAll('[name=skill]:checked')].map((c) => Number(c.value)),
    }),
  },
  stations: {
    title: (r) => (r ? `Edit ${r.name}` : 'Add station'),
    fields: (r = {}) => `
      <label for="f-name">Station name</label><input id="f-name" name="name" value="${esc(r.name)}">
      <label for="f-skill">Required skill</label>
      <select id="f-skill" name="required_skill_id"><option value="">Anyone</option>${state.skills.map((k) =>
        `<option value="${k.id}" ${r.required_skill_id === k.id ? 'selected' : ''}>${esc(k.name)}</option>`).join('')}</select>
      <label class="check"><input type="checkbox" name="is_front_desk" ${r.is_front_desk ? 'checked' : ''}>
        Front desk (flag any time no one is on it)</label>`,
    read: (f) => ({ name: f.name.value, required_skill_id: f.required_skill_id.value || null, is_front_desk: f.is_front_desk.checked }),
  },
  skills: {
    title: (r) => (r ? `Edit ${r.name}` : 'Add skill'),
    fields: (r = {}) => `<label for="f-name">Skill name</label><input id="f-name" name="name" value="${esc(r.name)}">`,
    read: (f) => ({ name: f.name.value }),
  },
};

const dialog = $('#editor');
const editorForm = $('form', dialog);
let editing = null;

function openEditor(kind, id) {
  const record = id ? state[kind].find((r) => r.id === id) : null;
  editing = { kind, id };
  $('#editor-title').textContent = FORMS[kind].title(record);
  $('#editor-fields').innerHTML = FORMS[kind].fields(record ?? undefined);
  showErrors(editorForm, null);
  dialog.showModal();
  $('#f-name')?.focus();
}

editorForm.addEventListener('submit', async (e) => {
  if (e.submitter?.value !== 'save') return;
  e.preventDefault();
  const { kind, id } = editing;
  try {
    state[kind] = await api(id ? `${kind}/${id}` : kind, { method: id ? 'PUT' : 'POST', body: FORMS[kind].read(editorForm) });
    dialog.close();
    renderLists();
  } catch (err) {
    showErrors(editorForm, err);
  }
});

document.addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-add], button[data-edit], button[data-delete]');
  if (!btn) return;
  const id = Number(btn.dataset.id) || null;
  if (btn.dataset.add) return openEditor(btn.dataset.add, null);
  if (btn.dataset.edit) return openEditor(btn.dataset.edit, id);

  const kind = btn.dataset.delete;
  const name = state[kind].find((r) => r.id === id)?.name;
  const question = kind === 'staff'
    ? `Remove ${name}? Their past shifts are kept.`
    : `Delete ${name}?`;
  if (!confirm(question)) return;
  try {
    state[kind] = await api(`${kind}/${id}`, { method: 'DELETE' });
    if (kind === 'skills') state.staff = await api('staff'); // their skill lists changed too
    renderLists();
  } catch (err) {
    alert(err.message);
  }
});

// ---------- load ----------

try {
  const [clinic, skills, stations, staff] = await Promise.all(['clinic', 'skills', 'stations', 'staff'].map((p) => api(p)));
  Object.assign(state, { clinic, skills, stations, staff });
  renderClinic();
  renderLists();
} catch (err) {
  if (!blockPage(err)) throw err;
}
