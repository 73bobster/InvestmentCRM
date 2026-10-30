// Boot: work out who is signed in and which organisation they are in, read that organisation's data, then run the app.
import * as api from './api.js';
import { state, setMembership, clearState } from './state.js';
import { route, onRoute, start as startRouter, dispatch } from './router.js';
import { renderShell, setActive, firstScreenHref, refreshBadges } from './shell.js';
import { showAuth, showNoAccess } from './auth.js';
import { html, mount, toast, errorHtml, loadingHtml } from './ui.js';
import { openLog } from './logentry.js';
import { dashboardView } from './dashboard.js';
import { tasksView } from './tasks.js';
import { diaryView } from './diary.js';
import { partiesView, partyView } from './parties.js';
import { investmentsView, investmentView } from './investments.js';
import { accrualsView } from './accruals.js';
import { contactsView } from './contacts.js';
import { settingsView } from './settings.js';
import { auditView } from './audit.js';
import { helpView } from './help.js';

const INVITE_KEY = 'app:invite';
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } },
  del: (k) => { try { localStorage.removeItem(k); } catch { /* storage unavailable */ } },
};

// An invitation link looks like https://your-app/?invite=CODE. Keep the code until the person has signed in.
function captureInvite() {
  const params = new URLSearchParams(location.search);
  const code = params.get('invite');
  if (!code) return;
  store.set(INVITE_KEY, code);
  params.delete('invite');
  const qs = params.toString();
  history.replaceState(null, '', location.pathname + (qs ? `?${qs}` : '') + location.hash);
}

// ---- Routes ---------------------------------------------------------------------
route('/dashboard', 'dashboard', (m) => dashboardView(m));
route('/tasks', 'tasks', (m, p, q) => tasksView(m, q));
route('/diary', 'diary', (m) => diaryView(m));
route('/brands', 'brands', (m) => partiesView(m, 'brand'));
route('/brands/:id', 'brands', (m, p, q) => partyView(m, 'brand', p.id, q));
route('/customers', 'customers', (m) => partiesView(m, 'customer'));
route('/customers/:id', 'customers', (m, p, q) => partyView(m, 'customer', p.id, q));
route('/investments', 'investments', (m, p, q) => investmentsView(m, q));
route('/investments/:id', 'investments', (m, p) => investmentView(m, p.id));
route('/accruals', 'accruals', (m, p, q) => accrualsView(m, q));
route('/contacts', 'contacts', (m) => contactsView(m));
route('/audit', 'audit', (m) => auditView(m));
route('/settings', 'settings', (m) => settingsView(m));
route('/help', 'help', (m) => helpView(m));
onRoute(setActive);

// ---- Session flow -----------------------------------------------------------------
let entering = false;

function showFatal(err) {
  console.error(err);
  mount(document.getElementById('app'), html`<main id="main" class="auth-main">${errorHtml(err.message || 'Something went wrong.')}</main>`);
}
const signInScreen = (extra = {}) => showAuth({ mode: store.get(INVITE_KEY) ? 'signup' : 'signin', invite: store.get(INVITE_KEY), onSession: enter, ...extra });

async function signOut() {
  try { await api.auth.signOut(); } catch (e) { console.error(e); }
  clearState(); api.resetData();
  signInScreen({ mode: 'signin' });
}

async function openOrg(m) {
  setMembership(m);
  api.resetData();
  mount(document.getElementById('app'), html`<main id="main" class="auth-main">${loadingHtml('Loading your records')}</main>`);
  await api.loadAll();
  renderShell({ onSwitchOrg: switchOrg, onSignOut: signOut, onLog: () => openLog() });
  location.hash = firstScreenHref();
  startRouter();
  refreshBadges();
}
async function switchOrg(orgId) {
  const m = state.memberships.find((x) => x.organisation_id === orgId);
  if (!m) return;
  try { await openOrg(m); } catch (err) { showFatal(err); }
}

async function join(code) {
  await api.acceptInvitation(code);
  await enter({ user: state.user });
}

async function enter(session) {
  if (entering) return;
  entering = true;
  try {
    state.user = session.user;
    let notice = '';
    const invite = store.get(INVITE_KEY);
    if (invite) {
      try { await api.acceptInvitation(invite); } catch (e) { notice = e.message; }
      store.del(INVITE_KEY);
    }
    state.memberships = await api.loadMemberships(session.user.id);
    if (!state.memberships.length) {
      showNoAccess({ email: session.user.email, error: notice, onJoin: join, onSignOut: signOut });
      return;
    }
    await openOrg(state.memberships.find((m) => m.organisation_id === store.get('app:org')) || state.memberships[0]);
    if (notice) toast(notice, 'error');
  } catch (err) {
    showFatal(err);
  } finally {
    entering = false;
  }
}

export async function boot() {
  document.addEventListener('click', (e) => { if (e.target.closest?.('[data-action="reload"]')) location.reload(); });
  captureInvite();
  try {
    const session = await api.auth.getSession();
    if (session) await enter(session); else signInScreen();
  } catch (err) {
    showFatal(err);
  }
}
// Used by screens after a change: draw the current screen again from the data already refreshed.
export const refreshScreen = () => dispatch();

if (typeof window !== 'undefined' && !window.__APP_TEST__) boot();
