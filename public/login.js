// Demo copy only: user ID + password sign-in, then back to the page they wanted.
import { $, api, showErrors } from '/api.js';

const form = $('#login-form');

// Only same-site paths, so the link can't bounce someone to another website.
function nextPage() {
  const next = new URLSearchParams(location.search).get('next') ?? '/';
  return /^\/(?!\/)/.test(next) && !next.startsWith('/login') ? next : '/';
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const button = $('button', form);
  button.disabled = true;
  try {
    await api('login', { method: 'POST', body: { userId: form.userId.value, password: form.password.value } });
    location.replace(nextPage());
  } catch (err) {
    showErrors(form, err.status === 404 ? new Error('This copy of the app signs in through Cloudflare Access.') : err);
    form.password.select();
  } finally {
    button.disabled = false;
  }
});
