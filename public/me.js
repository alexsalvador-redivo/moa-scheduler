// Staff phone view: published shifts, recurring availability and time-off requests.
import { $, esc, api, showErrors, devUser, devPicker } from '/api.js';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
let me = null;

const addDays = (d, n) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const weekdayOf = (d) => new Date(`${d}T12:00:00Z`).getUTCDay();
const fmtDate = (d, opts) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-CA', { timeZone: 'UTC', ...opts });
const hours = (min) => `${Math.round((min / 60) * 100) / 100} h`;

// '13:30' → '1:30 pm'
function clock(t) {
  const [h, m] = t.split(':').map(Number);
  return `${h % 12 || 12}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h < 12 ? 'am' : 'pm'}`;
}

// ---------- shifts ----------

function renderShifts() {
  const list = $('#shift-list');
  const notice = me.beingUpdated
    ? '<p class="hint">Your manager is updating the schedule. Check back soon for changes.</p>' : '';
  if (!me.shifts.length) {
    list.innerHTML = `${notice}<div class="empty"><p><b>No shifts published yet.</b></p>
      <p class="muted">You'll get an email when your manager publishes the schedule.</p></div>`;
    return;
  }
  // Group by Sunday-start week.
  const weeks = new Map();
  for (const s of me.shifts) {
    const start = addDays(s.date, -weekdayOf(s.date));
    if (!weeks.has(start)) weeks.set(start, []);
    weeks.get(start).push(s);
  }
  list.innerHTML = notice + [...weeks].map(([start, shifts]) => {
    const total = shifts.reduce((t, s) => t + s.minutes, 0);
    return `<h2 class="week-head">Week of ${fmtDate(start, { month: 'short', day: 'numeric' })}<span class="muted">${hours(total)}</span></h2>
      <ul class="plain shifts">${shifts.map((s) => {
        const past = s.date < me.today;
        const cls = s.date === me.today ? 'today' : past ? 'past' : '';
        return `<li class="shift-card ${cls}">
          <div class="when"><b>${fmtDate(s.date, { weekday: 'short' })}</b><span>${fmtDate(s.date, { month: 'short', day: 'numeric' })}</span></div>
          <div class="what"><b>${clock(s.start_time)} – ${clock(s.end_time)}</b>
            <span>${esc(s.station)}${s.date === me.today ? ' · <span class="tag published">Today</span>' : ''}</span>
            ${s.break_start ? `<span class="muted">Meal break ${clock(s.break_start)} – ${clock(s.break_end)}</span>` : ''}</div>
          <div class="hrs muted">${hours(s.minutes)}</div></li>`;
      }).join('')}</ul>`;
  }).join('');
}

// ---------- availability ----------

function renderAvailability() {
  $('#avail-days').innerHTML = DAYS.map((d, i) => {
    const w = me.availability.find((a) => a.weekday === i);
    return `<div class="avail-row ${w ? '' : 'off'}" data-day="${i}">
      <label class="check"><input type="checkbox" name="on" ${w ? 'checked' : ''}>${d}</label>
      <input type="time" name="start" value="${w?.start_time ?? '08:00'}" aria-label="${d} from" ${w ? '' : 'disabled'}>
      <input type="time" name="end" value="${w?.end_time ?? '16:30'}" aria-label="${d} until" ${w ? '' : 'disabled'}></div>`;
  }).join('');
}

$('#avail-days').addEventListener('change', (e) => {
  if (e.target.name !== 'on') return;
  const row = e.target.closest('.avail-row');
  row.classList.toggle('off', !e.target.checked);
  row.querySelectorAll('input[type=time]').forEach((i) => { i.disabled = !e.target.checked; });
});

$('#avail-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const windows = [...form.querySelectorAll('.avail-row')]
    .filter((row) => $('[name=on]', row).checked)
    .map((row) => ({ weekday: Number(row.dataset.day), start_time: $('[name=start]', row).value, end_time: $('[name=end]', row).value }));
  try {
    me = await api('me/availability', { method: 'PUT', body: { windows } });
    showErrors(form, null);
    renderAvailability();
    const saved = $('.saved', form);
    saved.hidden = false;
    setTimeout(() => { saved.hidden = true; }, 2000);
  } catch (err) {
    showErrors(form, err);
  }
});

// ---------- time off ----------

const STATUS = { pending: 'Waiting for approval', approved: 'Approved', declined: 'Declined' };

function renderTimeOff() {
  const form = $('#off-form');
  form.start_date.min = me.today;
  form.end_date.min = form.start_date.value || me.today;
  $('#off-list').innerHTML = me.timeOff.length ? me.timeOff.map((t) => {
    const range = t.start_date === t.end_date
      ? fmtDate(t.start_date, { weekday: 'short', month: 'short', day: 'numeric' })
      : `${fmtDate(t.start_date, { month: 'short', day: 'numeric' })} – ${fmtDate(t.end_date, { month: 'short', day: 'numeric' })}`;
    return `<li class="off-item"><div><b>${range}</b>${t.reason ? `<span class="muted">${esc(t.reason)}</span>` : ''}</div>
      <div><span class="tag status-${t.status}">${STATUS[t.status]}</span>
      ${t.status === 'pending' ? `<button class="link" data-withdraw="${t.id}">Withdraw</button>` : ''}</div></li>`;
  }).join('') : '<li class="muted">No requests.</li>';
}

$('#off-form').start_date.addEventListener('change', (e) => {
  const end = $('#off-form').end_date;
  end.min = e.target.value;
  if (!end.value || end.value < e.target.value) end.value = e.target.value;
});

$('#off-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  try {
    me = await api('me/time-off', {
      method: 'POST',
      body: { start_date: form.start_date.value, end_date: form.end_date.value, reason: form.reason.value },
    });
    form.reset();
    showErrors(form, null);
    renderTimeOff();
  } catch (err) {
    showErrors(form, err);
  }
});

$('#off-list').addEventListener('click', async (e) => {
  const id = e.target.dataset.withdraw;
  if (!id || !confirm('Withdraw this request?')) return;
  try {
    me = await api(`me/time-off/${id}`, { method: 'DELETE' });
    renderTimeOff();
  } catch (err) {
    alert(err.message);
  }
});

// ---------- tabs and start-up ----------

$('.tabs').addEventListener('click', (e) => {
  const tab = e.target.closest('[data-tab]');
  if (!tab) return;
  document.querySelectorAll('[data-tab]').forEach((t) => t.setAttribute('aria-selected', String(t === tab)));
  document.querySelectorAll('[data-panel]').forEach((p) => { p.hidden = p.dataset.panel !== tab.dataset.tab; });
});

async function showDevPicker() {
  await devPicker($('#dev-user'), start);
  $('#dev-login').hidden = false;
}

async function start() {
  try {
    me = await api('me');
  } catch (err) {
    $('#app').hidden = true;
    if (err.status === 401 && err.devLogin) return showDevPicker();
    $('#signed-out').hidden = false;
    return;
  }
  renderShifts();
  renderAvailability();
  renderTimeOff();
  $('#signed-out').hidden = true;
  $('#who').textContent = me.person.name;
  $('#app').hidden = false;
  if (devUser()) await showDevPicker();
}

start();
