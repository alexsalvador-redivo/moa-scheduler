// Manager's weekly grid: one row per person, one column per day. Every save
// returns the refreshed week, with warnings, coverage bars and hours.
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const PRESETS = [
  { label: 'Day 8–4:30', start: '08:00', end: '16:30', breakStart: '12:00', breakEnd: '12:30' },
  { label: 'Evening 12–8', start: '12:00', end: '20:00', breakStart: '16:00', breakEnd: '16:30' },
  { label: 'Sat 9–3', start: '09:00', end: '15:00', breakStart: '12:00', breakEnd: '12:30' },
  { label: 'Short 9–1', start: '09:00', end: '13:00', breakStart: '', breakEnd: '' },
];
const RULE_LABELS = {
  REST_8H: 'Less than 8 h off between shifts',
  SPLIT_12H: 'Split shift over 12 h',
  MIN_2H: 'Shift under 2 h',
  MEAL_5H: 'Meal break',
  OT_DAY: 'Daily overtime',
  OT_WEEK: 'Weekly overtime',
  SKILL: 'Missing skill',
  AVAIL: 'Availability or time off',
  COVERAGE: 'Not enough MOAs',
  DESK_EMPTY: 'Front desk empty',
};

let week = null;
let highlighted = new Set();

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const minutes = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const hours = (min) => `${Math.round((min / 60) * 100) / 100} h`;
const short = (t) => t.replace(/^0/, '').replace(':00', '');
const fmtDay = (d, opts) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-CA', { timeZone: 'UTC', ...opts });
const weekdayOf = (d) => new Date(`${d}T12:00:00Z`).getUTCDay();
const addDays = (d, n) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

async function api(path, options = {}) {
  const res = await fetch(`/api/${path}`, {
    ...options,
    headers: { 'content-type': 'application/json' },
    body: options.body && JSON.stringify(options.body),
  });
  const data = await res.json().catch(() => ({ error: 'Unexpected server response.' }));
  if (!res.ok) throw Object.assign(new Error(data.error ?? 'Request failed.'), { fields: data.fields });
  return data;
}

function showErrors(form, err) {
  form.querySelectorAll('.field-error').forEach((e) => e.remove());
  const box = $('.form-error', form);
  box.hidden = !err;
  if (!err) return;
  box.textContent = err.message;
  for (const [field, message] of Object.entries(err.fields ?? {})) {
    const input = form.querySelector(`[name="${field}"]`) ?? form.querySelector(`[data-field="${field}"]`);
    input?.insertAdjacentHTML('afterend', `<p class="field-error">${esc(message)}</p>`);
  }
}

// ---------- rendering ----------

function coverageBarHtml(date) {
  const bar = week.coverage[date];
  if (!bar.length) return '<div class="cov closed">Closed</div>';
  const total = bar.reduce((t, p) => t + minutes(p.to) - minutes(p.from), 0);
  return `<div class="cov">${bar.map((p) => {
    const state = p.required === 0 ? 'idle' : p.count >= p.required ? 'ok' : 'short';
    const width = ((minutes(p.to) - minutes(p.from)) / total) * 100;
    const tip = `${p.from}–${p.to}: ${p.count} on the floor, ${p.required} needed`;
    return `<i class="${state}" style="width:${width}%" title="${tip}"></i>`;
  }).join('')}</div>`;
}

function providerSummary(date) {
  const blocks = week.providerBlocks.filter((b) => b.date === date);
  if (!blocks.length) return 'No providers';
  return blocks.map((b) => b.providerCount).join(' / ') + (blocks.length === 1 && blocks[0].providerCount === 1 ? ' provider' : ' providers');
}

function cellNote(person, date) {
  const off = person.timeOff.find((t) => t.startDate <= date && date <= t.endDate && t.status !== 'declined');
  if (off) return `<span class="note ${off.status}">${off.status === 'approved' ? 'Time off' : 'Off requested'}</span>`;
  if (person.availability.length) {
    const windows = person.availability.filter((a) => a.weekday === weekdayOf(date));
    return windows.length
      ? `<span class="note">Avail ${windows.map((w) => `${short(w.start)}–${short(w.end)}`).join(', ')}</span>`
      : '<span class="note unavailable">Unavailable</span>';
  }
  return '';
}

function render() {
  const { dates } = week;
  $('#week-label').textContent = `${fmtDay(dates[0], { month: 'short', day: 'numeric' })} – ${fmtDay(dates[6], { month: 'short', day: 'numeric', year: 'numeric' })}`;
  const status = $('#week-status');
  status.textContent = week.publishedAt ? 'Published' : 'Draft';
  status.className = `tag ${week.publishedAt ? 'published' : 'draft'}`;
  history.replaceState(null, '', `?week=${week.weekStart}`);

  const warned = new Map();
  for (const w of week.warnings) for (const id of w.shiftIds) warned.set(id, [...(warned.get(id) ?? []), w]);
  const stationName = (id) => week.stations.find((s) => s.id === id)?.name ?? '?';

  $('#grid thead').innerHTML = `<tr><th class="who">Staff</th>${dates.map((d) => {
    const dayWarnings = week.warnings.filter((w) => ['COVERAGE', 'DESK_EMPTY'].includes(w.code) && w.message.startsWith(d)).length;
    return `<th class="${d === new Date().toISOString().slice(0, 10) ? 'today' : ''}">
      <div class="day">${DAYS[weekdayOf(d)]} ${fmtDay(d, { day: 'numeric' })}${dayWarnings ? ` <span class="badge" title="Coverage warnings">${dayWarnings}</span>` : ''}</div>
      <button class="link" data-blocks="${d}">${providerSummary(d)}</button>
      ${coverageBarHtml(d)}</th>`;
  }).join('')}</tr>`;

  $('#grid tbody').innerHTML = week.staff.map((p) => {
    const worked = week.hours[p.id] ?? 0;
    const under = p.minWeeklyHours && worked < p.minWeeklyHours * 60;
    return `<tr><th class="who" scope="row">${esc(p.name)}
      <span class="muted">${esc(p.staffType)} · <span class="${under ? 'under' : ''}" title="${under ? `Below minimum of ${p.minWeeklyHours} h` : ''}">${hours(worked)}</span></span></th>
      ${dates.map((d) => `<td data-add="${p.id}|${d}">${cellNote(p, d)}${week.shifts.filter((s) => s.staffId === p.id && s.date === d).map((s) => {
        const ws = warned.get(s.id) ?? [];
        const cls = ['chip', ws.length ? 'warn' : '', highlighted.has(s.id) ? 'hl' : ''].join(' ');
        const tip = ws.map((w) => w.message).join('\n');
        return `<button class="${cls}" data-shift="${s.id}" title="${esc(tip)}">
          <b>${short(s.start)}–${short(s.end)}</b><span>${esc(stationName(s.stationId))}</span>
          ${s.breakStart ? `<span class="muted">Break ${short(s.breakStart)}</span>` : ''}</button>`;
      }).join('')}</td>`).join('')}</tr>`;
  }).join('');

  const list = $('#warnings ul');
  $('#warnings .count').textContent = week.warnings.length ? `(${week.warnings.length})` : '';
  list.innerHTML = week.warnings.length
    ? week.warnings.map((w, i) => `<li><button class="link warning" data-warning="${i}">
        <span class="tag code">${esc(RULE_LABELS[w.code] ?? w.code)}</span> ${esc(w.message)}</button></li>`).join('')
    : '<li class="ok-text">No warnings. This week is covered and BC-compliant.</li>';
}

async function load(date) {
  week = await api(`week?date=${date}`);
  highlighted = new Set();
  render();
}

// ---------- shift dialog ----------

const shiftDialog = $('#shift-dialog');
const shiftForm = $('form', shiftDialog);
let editingShift = null;

function updateSkillHint() {
  const station = week.stations.find((s) => s.id === Number(shiftForm.station_id.value));
  const person = week.staff.find((p) => p.id === Number(shiftForm.staff_id.value));
  const hint = $('#s-skill-hint');
  hint.hidden = !(station?.requiredSkillId && person && !person.skills.includes(station.requiredSkillId));
  if (!hint.hidden) hint.textContent = `${person.name} doesn't have the skill ${station.name} needs. You can still save; it will show as a warning.`;
}

function openShift({ shift = null, staffId, date }) {
  editingShift = shift;
  const s = shift ?? {};
  const day = shift?.date ?? date;
  shiftForm.dataset.date = day;
  $('#shift-title').textContent = shift ? 'Edit shift' : 'Add shift';
  $('#shift-day').textContent = fmtDay(day, { weekday: 'long', month: 'long', day: 'numeric' });
  shiftForm.staff_id.innerHTML = week.staff.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
  shiftForm.staff_id.value = s.staffId ?? staffId;
  shiftForm.station_id.innerHTML = week.stations.map((st) => `<option value="${st.id}">${esc(st.name)}</option>`).join('');
  if (s.stationId) shiftForm.station_id.value = s.stationId;
  const hoursToday = week.settings.openHours[weekdayOf(day)];
  const preset = PRESETS.find((p) => hoursToday && p.start >= hoursToday[0] && p.end <= hoursToday[1]) ?? PRESETS[0];
  shiftForm.start_time.value = s.start ?? preset.start;
  shiftForm.end_time.value = s.end ?? preset.end;
  shiftForm.break_start.value = shift ? (s.breakStart ?? '') : preset.breakStart;
  shiftForm.break_end.value = shift ? (s.breakEnd ?? '') : preset.breakEnd;
  $('#s-delete').hidden = !shift;
  showErrors(shiftForm, null);
  updateSkillHint();
  shiftDialog.showModal();
}

$('#s-presets').innerHTML = PRESETS.map((p, i) => `<button type="button" data-preset="${i}">${p.label}</button>`).join('');
$('#s-presets').addEventListener('click', (e) => {
  const p = PRESETS[e.target.dataset.preset];
  if (!p) return;
  shiftForm.start_time.value = p.start;
  shiftForm.end_time.value = p.end;
  shiftForm.break_start.value = p.breakStart;
  shiftForm.break_end.value = p.breakEnd;
});
shiftForm.staff_id.addEventListener('change', updateSkillHint);
shiftForm.station_id.addEventListener('change', updateSkillHint);

shiftForm.addEventListener('submit', async (e) => {
  if (e.submitter?.value !== 'save') return;
  e.preventDefault();
  const body = {
    staff_id: Number(shiftForm.staff_id.value),
    station_id: Number(shiftForm.station_id.value),
    date: shiftForm.dataset.date,
    start_time: shiftForm.start_time.value,
    end_time: shiftForm.end_time.value,
    break_start: shiftForm.break_start.value,
    break_end: shiftForm.break_end.value,
  };
  try {
    week = await api(editingShift ? `shifts/${editingShift.id}` : 'shifts', { method: editingShift ? 'PUT' : 'POST', body });
    shiftDialog.close();
    render();
  } catch (err) {
    showErrors(shiftForm, err);
  }
});

$('#s-delete').addEventListener('click', async () => {
  if (!confirm('Delete this shift?')) return;
  week = await api(`shifts/${editingShift.id}`, { method: 'DELETE' });
  shiftDialog.close();
  render();
});

// ---------- provider blocks dialog ----------

const blocksDialog = $('#blocks-dialog');
const blocksForm = $('form', blocksDialog);

const blockRow = (b = {}) => `<div class="block-row">
  <input type="time" name="b-start" value="${b.start ?? ''}" aria-label="Block start">
  <input type="time" name="b-end" value="${b.end ?? ''}" aria-label="Block end">
  <input type="number" name="b-count" min="0" max="50" value="${b.providerCount ?? 1}" aria-label="Providers">
  <button type="button" class="danger" data-remove-block aria-label="Remove block">✕</button></div>`;

function openBlocks(date) {
  blocksForm.dataset.date = date;
  $('#blocks-title').textContent = `Providers on ${fmtDay(date, { weekday: 'long', month: 'short', day: 'numeric' })}`;
  $('#blocks-ratio').textContent = week.settings.coverageRatio;
  const blocks = week.providerBlocks.filter((b) => b.date === date);
  const open = week.settings.openHours[weekdayOf(date)];
  $('#blocks-rows').innerHTML = blocks.length ? blocks.map(blockRow).join('')
    : blockRow({ start: open?.[0] ?? '08:00', end: open?.[1] ?? '16:30', providerCount: 1 });
  showErrors(blocksForm, null);
  blocksDialog.showModal();
}

$('#blocks-add').addEventListener('click', () => {
  const last = [...blocksForm.querySelectorAll('[name=b-end]')].at(-1)?.value;
  $('#blocks-rows').insertAdjacentHTML('beforeend', blockRow({ start: last ?? '', end: '' }));
});
$('#blocks-rows').addEventListener('click', (e) => {
  if (e.target.closest('[data-remove-block]')) e.target.closest('.block-row').remove();
});

blocksForm.addEventListener('submit', async (e) => {
  if (e.submitter?.value !== 'save') return;
  e.preventDefault();
  const blocks = [...blocksForm.querySelectorAll('.block-row')].map((row) => ({
    start_time: $('[name=b-start]', row).value,
    end_time: $('[name=b-end]', row).value,
    provider_count: Number($('[name=b-count]', row).value),
  }));
  try {
    week = await api('week/blocks', { method: 'PUT', body: { date: blocksForm.dataset.date, blocks } });
    blocksDialog.close();
    render();
  } catch (err) {
    showErrors(blocksForm, err);
  }
});

// ---------- page events ----------

$('#grid').addEventListener('click', (e) => {
  const chip = e.target.closest('[data-shift]');
  if (chip) return openShift({ shift: week.shifts.find((s) => s.id === Number(chip.dataset.shift)) });
  const blocks = e.target.closest('[data-blocks]');
  if (blocks) return openBlocks(blocks.dataset.blocks);
  const cell = e.target.closest('[data-add]');
  if (cell) {
    const [staffId, date] = cell.dataset.add.split('|');
    openShift({ staffId: Number(staffId), date });
  }
});

$('#warnings').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-warning]');
  if (!btn) return;
  const w = week.warnings[Number(btn.dataset.warning)];
  highlighted = new Set(w.shiftIds);
  render();
  $('.chip.hl')?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
});

$('#prev').addEventListener('click', () => load(addDays(week.weekStart, -7)));
$('#next').addEventListener('click', () => load(addDays(week.weekStart, 7)));
$('#copy').addEventListener('click', async () => {
  try {
    week = await api('week/copy', { method: 'POST', body: { week: week.weekStart } });
    render();
  } catch (err) {
    alert(err.message);
  }
});

const params = new URLSearchParams(location.search);
load(params.get('week') ?? new Date().toISOString().slice(0, 10));
