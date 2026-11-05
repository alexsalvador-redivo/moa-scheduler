// Shared by every page: API calls, form errors, and what to show when the
// person isn't signed in or isn't allowed (with a person picker in local dev).
const DEV_KEY = 'moa-dev-user';
let devChoice = null; // used when browser storage is blocked

export const $ = (sel, root = document) => root.querySelector(sel);
export const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function devUser() {
  try {
    return localStorage.getItem(DEV_KEY) ?? devChoice;
  } catch {
    return devChoice;
  }
}

function setDevUser(email) {
  devChoice = email;
  try {
    localStorage.setItem(DEV_KEY, email);
  } catch { /* storage blocked: devChoice lasts until reload */ }
}

// Demo mode: which staff member a manager is previewing "My shifts" as (this tab only).
const VIEW_KEY = 'moa-view-as';
let viewChoice = null;

export function viewAs() {
  try {
    return sessionStorage.getItem(VIEW_KEY) ?? viewChoice;
  } catch {
    return viewChoice;
  }
}

export function setViewAs(id) {
  viewChoice = id || null;
  try {
    if (id) sessionStorage.setItem(VIEW_KEY, id);
    else sessionStorage.removeItem(VIEW_KEY);
  } catch { /* storage blocked: viewChoice lasts until reload */ }
}

function authHeaders() {
  const headers = {};
  if (devUser()) headers['x-dev-user'] = devUser();
  if (viewAs()) headers['x-view-as'] = viewAs();
  return headers;
}

export async function api(path, options = {}) {
  const headers = { 'content-type': 'application/json', ...authHeaders() };
  const res = await fetch(`/api/${path}`, { ...options, headers, body: options.body && JSON.stringify(options.body) });
  const data = await res.json().catch(() => ({ error: 'Unexpected server response.' }));
  if (!res.ok) throw Object.assign(new Error(data.error ?? 'Request failed.'), { status: res.status, ...data });
  return data;
}

// Downloads a file from the API (so the dev sign-in header goes with it).
export async function download(path) {
  const res = await fetch(`/api/${path}`, { headers: authHeaders() });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Download failed.');
  const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? 'download';
  const url = URL.createObjectURL(await res.blob());
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function showErrors(form, err) {
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

// Fills `select` with staff for local dev sign-in; picking someone calls onPick.
export async function devPicker(select, onPick) {
  const people = await api('dev/users');
  select.innerHTML = `<option value="">Choose a person…</option>${people.map((p) =>
    `<option value="${esc(p.email)}" ${p.email === devUser() ? 'selected' : ''}>${esc(p.name)}${p.role === 'manager' ? ' (manager)' : ''}</option>`).join('')}`;
  select.onchange = () => {
    setDevUser(select.value);
    onPick();
  };
}

// For manager pages: replace the page with a sign-in or permission message.
// Returns true when it handled the error.
export function blockPage(err) {
  if (err.status !== 401 && err.status !== 403) return false;
  loaded();
  // Staff who open a manager page go straight to their own page.
  if (err.status === 403 && !devUser()) {
    location.replace('/me.html');
    return true;
  }
  const main = $('main');
  const title = err.status === 403 ? 'This page is for managers' : "You're not signed in";
  const body = err.status === 403
    ? 'You can see your own shifts, availability and time off on <a href="/me.html">My shifts</a>.'
    : "Your email isn't on this clinic's staff list. Ask your manager to add you.";
  main.innerHTML = `<section class="blocked"><h2>${title}</h2><p>${body}</p>
    ${err.devLogin || devUser() ? `<label for="dev-user">Local development: pick who you are</label><select id="dev-user"></select>` : ''}</section>`;
  if (err.devLogin || devUser()) devPicker($('#dev-user'), () => location.reload()).catch(() => {});
  return true;
}

// ---------- in-page messages (instead of the browser's alert/confirm boxes) ----------

let askDialog = null;

// Asks a yes/no question in the app's own style. Resolves true when confirmed.
export function ask(question, { yes = 'OK', danger = false } = {}) {
  if (!askDialog) {
    askDialog = document.createElement('dialog');
    askDialog.className = 'ask';
    askDialog.innerHTML = `<form method="dialog"><p class="ask-text"></p>
      <menu><button value="no">Cancel</button><button value="yes" class="primary"></button></menu></form>`;
    document.body.append(askDialog);
  }
  $('.ask-text', askDialog).textContent = question;
  const ok = $('button[value=yes]', askDialog);
  ok.textContent = yes;
  ok.className = danger ? 'primary danger-fill' : 'primary';
  askDialog.returnValue = '';
  askDialog.showModal();
  ok.focus();
  return new Promise((resolve) => {
    askDialog.addEventListener('close', () => resolve(askDialog.returnValue === 'yes'), { once: true });
  });
}

// Shows a short message at the bottom of the screen. kind: 'error' or 'ok'.
export function toast(message, kind = 'error') {
  let box = $('#toast');
  if (!box) {
    box = Object.assign(document.createElement('div'), { id: 'toast', role: 'status' });
    box.setAttribute('aria-live', 'polite');
    document.body.append(box);
    box.addEventListener('click', () => { box.hidden = true; });
  }
  box.textContent = message;
  box.className = kind;
  box.hidden = false;
  clearTimeout(box.timer);
  box.timer = setTimeout(() => { box.hidden = true; }, kind === 'error' ? 8000 : 4000);
}

// Hides the "Loading…" message once a page has its data.
export function loaded() {
  document.body.classList.remove('is-loading');
}
