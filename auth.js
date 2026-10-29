// Signed-out screens: sign in, create account (only with an invitation), and joining with a code.
import * as api from './api.js';
import { html, mount, on, logoImg, wireLogos } from './ui.js';
import { applyBrand } from './shell.js';
import { CONFIG } from './config.js';
import { versionOf } from './versions.js';

const root = () => document.getElementById('app');

function frame(inner) {
  applyBrand(null);
  mount(root(), html`
    <div class="auth">
      <aside class="auth-side" aria-hidden="true">
        <div class="auth-banners"><span class="banner">Every brand owner</span><span class="banner">Every customer</span><span class="banner">Every follow-up</span></div>
        <p class="auth-line">${CONFIG.appName} for ${CONFIG.brand?.name || 'your business'}, in one place.</p>
      </aside>
      <main class="auth-main" id="main"><div class="auth-card"><div class="brand-stack">${logoImg(CONFIG.brand?.logoUrl, CONFIG.brand?.name || CONFIG.appName)}</div>${inner}<p class="auth-version">${versionOf('signin')}</p></div></main>
    </div>`);
  wireLogos(root());
}

function wireForm(handler) {
  const form = root().querySelector('form');
  const err = root().querySelector('.form-error');
  form.onsubmit = async (e) => {
    e.preventDefault();
    err.hidden = true;
    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    try { await handler(form); } catch (ex) { err.textContent = ex.message; err.hidden = false; btn.disabled = false; }
  };
  form.querySelector('input')?.focus();
}

// onSession(session) is called once the person is signed in.
export function showAuth({ mode = 'signin', invite = null, notice = '', onSession } = {}) {
  const signup = mode === 'signup';
  frame(html`
    <h1>${signup ? 'Create your account' : 'Sign in'}</h1>
    ${invite && signup ? html`<p class="notice">You've been invited to join. Create your account with the email address the invitation was sent to.</p>` : ''}
    ${signup && !invite ? html`<p class="notice">You need an invitation to join. Ask the superuser for an invitation link.</p>` : ''}
    ${notice ? html`<p class="notice">${notice}</p>` : ''}
    <form class="stack">
      ${signup ? html`<div class="field"><label for="name">Your name</label><input id="name" name="name" type="text" required autocomplete="name"></div>` : ''}
      <div class="field"><label for="email">Email</label><input id="email" name="email" type="email" required autocomplete="username" inputmode="email"></div>
      <div class="field"><label for="password">Password</label><input id="password" name="password" type="password" required minlength="8" autocomplete="${signup ? 'new-password' : 'current-password'}">${signup ? html`<p class="hint">At least 8 characters.</p>` : ''}</div>
      <p class="form-error" role="alert" hidden></p>
      <button class="btn btn-primary btn-block" type="submit">${signup ? 'Create account' : 'Sign in'}</button>
    </form>
    <p class="auth-alt">${signup
      ? html`Already have an account? <button class="link" data-action="signin">Sign in</button>`
      : html`New here? <button class="link" data-action="signup">Create an account</button>`}</p>`);
  on(root(), {
    signin: () => showAuth({ mode: 'signin', invite, onSession }),
    signup: () => showAuth({ mode: 'signup', invite, onSession }),
  });
  wireForm(async (form) => {
    const email = form.elements.email.value.trim().toLowerCase();
    const password = form.elements.password.value;
    if (signup) await api.auth.signUp(email, password, form.elements.name.value.trim());
    else await api.auth.signIn(email, password);
    const session = await api.auth.getSession();
    if (!session) throw new Error('Signed in, but the browser did not keep the session. Check that cookies are not blocked for this site, then try again.');
    await onSession(session);
  });
}

// Signed in, but not a member of any organisation yet.
export function showNoAccess({ email, onJoin, onSignOut, error = '' }) {
  frame(html`
    <h1>You're signed in, but not part of an organisation yet</h1>
    <p>You're signed in as <strong>${email}</strong>. Ask the superuser to invite this email address, then paste the invitation code (the long code at the end of the invitation link) here.</p>
    ${error ? html`<p class="form-error" role="alert">${error}</p>` : ''}
    <form class="stack">
      <div class="field"><label for="code">Invitation code</label><input id="code" name="code" type="text" required autocomplete="off" spellcheck="false" placeholder="Paste your invitation code"></div>
      <p class="form-error" role="alert" hidden></p>
      <button class="btn btn-primary btn-block" type="submit">Join organisation</button>
    </form>
    <p class="auth-alt"><button class="link" data-action="signout">Sign out</button></p>`);
  on(root(), { signout: () => onSignOut() });
  wireForm(async (form) => { await onJoin(form.elements.code.value.trim()); });
}
