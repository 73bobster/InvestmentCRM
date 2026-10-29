// The signed-in frame: sidebar on desktop, tab bar on mobile (with a More menu), brand colours, section colours,
// the "Log" button, and the organisation switcher in both.
import { html, mount, on, icon, openModal, closeModal, logoImg, wireLogos, setDateFormat, todayStr } from './ui.js';
import { CONFIG } from './config.js';
import { state, can, ROLE_LABEL } from './state.js';
import * as api from './api.js';
import { screenLabel, versionOf } from './versions.js';

// Add a line here for each new screen, plus a route in main.js, an icon in ui.js, an entry in state.js (SCREENS) and in versions.js.
const NAV = [
  { id: 'dashboard', label: 'Dashboard', href: '#/dashboard' },
  { id: 'tasks', label: 'Tasks', href: '#/tasks' },
  { id: 'diary', label: 'Diary', href: '#/diary' },
  { id: 'brands', label: 'Brand owners', href: '#/brands', tone: 'brand' },
  { id: 'customers', label: 'Customers', href: '#/customers', tone: 'customer' },
  { id: 'investments', label: 'Investments', href: '#/investments' },
  { id: 'contacts', label: 'Contacts', href: '#/contacts' },
  { id: 'audit', label: 'Audit log', href: '#/audit', when: () => can.audit },
  { id: 'settings', label: 'Settings', href: '#/settings', when: () => can.configure },
];
// The bottom bar on a phone: Dashboard, Tasks, Brand owners, Customers. Everything else is under More.
const PHONE_TABS = ['dashboard', 'tasks', 'brands', 'customers'];
const visibleNav = () => NAV.filter((n) => !n.when || n.when());
const tabs = () => visibleNav().filter((n) => PHONE_TABS.includes(n.id));
export const firstScreenHref = () => '#/dashboard';
const HELP = { id: 'help', label: 'Help', href: '#/help' };
let current = '';

// ---- Brand ------------------------------------------------------------------
function luminance(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return null;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
// Colours come from organisations.brand.colours, e.g. {"primary": "#FF0066"}. Text on the brand colour is chosen for contrast.
export function applyBrand(org) {
  const root = document.documentElement;
  const primary = org?.brand?.colours?.primary;
  const lum = luminance(primary);
  if (lum === null) {
    root.style.removeProperty('--brand'); root.style.removeProperty('--brand-ink');
  } else {
    root.style.setProperty('--brand', primary);
    root.style.setProperty('--brand-ink', lum > 0.4 ? '#111111' : '#FFFFFF');
  }
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', primary || '#FF0066');
  document.title = org ? `${CONFIG.appName} – ${org.name}` : CONFIG.appName;
  setDateFormat(org?.settings?.date_format);   // the organisation's date format, used by every screen and download
}

// The colour of the banner and highlights follows the side being looked at: gold for brand owners, teal for customers, pink elsewhere.
export function setSection(side) {
  if (side === 'brand' || side === 'customer') document.body.dataset.section = side; else delete document.body.dataset.section;
}

// ---- Frame --------------------------------------------------------------------
const navLink = (n, cls) => html`<a class="${cls}${n.tone ? ` tone-${n.tone}` : ''}" href="${n.href}" data-nav="${n.id}">${icon(n.id)}<span>${n.label}</span>${n.id === 'tasks' ? html`<span class="badge" data-badge="tasks" hidden></span>` : ''}</a>`;

export function renderShell({ onSwitchOrg, onSignOut, onLog }) {
  const org = state.org;
  const logo = api.logoUrl(org.brand) || CONFIG.brand?.logoUrl;
  applyBrand(org);
  mount(document.getElementById('app'), html`
    <div class="shell">
      <aside class="side">
        <div class="side-brand"><div class="side-tag"><a class="brand-link brand-stack" href="#/dashboard" aria-label="${CONFIG.appName} for ${org.name}: go to the dashboard">${logoImg(logo, org.name, 'side-name')}</a><p class="side-app">${CONFIG.appName}</p>${can.write ? html`<button type="button" class="btn btn-primary side-logbtn" data-action="log">${icon('plus')} Log</button>` : ''}</div></div>
        <nav class="side-nav" aria-label="Main">${visibleNav().map((n) => navLink(n, 'side-link'))}</nav>
        <div class="side-foot">
          ${state.memberships.length > 1 ? html`<label class="side-switch"><span>Organisation</span><select id="org-switch">${state.memberships.map((m) => html`<option value="${m.organisation_id}" ${m.organisation_id === org.id ? 'selected' : ''}>${m.organisation.name}</option>`)}</select></label>` : ''}
          <a class="side-help" href="#/help" data-nav="help">${icon('help')}<span>Help</span></a>
          <p class="side-user"><span class="side-email">${state.user.email}</span><span class="side-role">${ROLE_LABEL[state.role]}</span></p>
          <button class="side-signout" type="button" data-action="signout">Sign out</button>
        </div>
      </aside>
      <div class="content"><header class="mobile-brand"><a class="brand-link brand-row" href="#/dashboard" aria-label="${CONFIG.appName} for ${org.name}: go to the dashboard">${logoImg(logo, org.name)}<span class="mobile-app">${CONFIG.appName}</span></a></header><main id="main" tabindex="-1"></main><footer class="screen-foot" id="screen-foot"></footer></div>
      ${can.write ? html`<button type="button" class="fab" data-action="log" aria-label="Log a note, call or meeting">${icon('plus')}<span>Log</span></button>` : ''}
      <nav class="tabbar" aria-label="Main">
        ${tabs().map((n) => navLink(n, 'tab-link'))}
        <button type="button" class="tab-link" data-action="more">${icon('more')}<span>More</span></button>
      </nav>
    </div>`);
  const root = document.getElementById('app');
  wireLogos(root);
  on(root, {
    signout: () => onSignOut(),
    more: () => openMenu(onSignOut, onSwitchOrg),
    log: () => onLog(),
  });
  root.querySelector('#org-switch')?.addEventListener('change', (e) => onSwitchOrg(e.target.value));
  refreshBadges();
}

function openMenu(onSignOut, onSwitchOrg) {
  const rest = [...visibleNav().filter((n) => !PHONE_TABS.includes(n.id)), HELP];
  // The sidebar is hidden on a phone, so the organisation switcher lives here too (only for people in more than one organisation).
  const orgs = state.memberships.length > 1
    ? html`<label class="side-switch menu-switch"><span>Organisation</span><select id="menu-org-switch">${state.memberships.map((m) => html`<option value="${m.organisation_id}" ${m.organisation_id === state.org.id ? 'selected' : ''}>${m.organisation.name}</option>`)}</select></label>`
    : '';
  const dlg = openModal({
    title: 'Menu',
    hideFooter: true,
    body: html`${orgs}<nav class="menu-list" aria-label="More">${rest.map((n) => html`<a class="menu-link" href="${n.href}" data-action="go">${icon(n.id)}<span>${n.label}</span></a>`)}</nav>
      <p class="side-user"><span>${state.user.email}</span><span class="side-role">${ROLE_LABEL[state.role]}</span></p>
      <p><button class="btn" type="button" data-action="signout">Sign out</button></p>`,
  });
  dlg.querySelector('#menu-org-switch')?.addEventListener('change', (e) => { const id = e.target.value; closeModal(); onSwitchOrg(id); });
  dlg.onclick = (e) => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    if (el.dataset.action === 'go') { closeModal(); return; }
    if (el.dataset.action === 'signout') { closeModal(); onSignOut(); }
  };
}

export function setBadge(id, n) {
  document.querySelectorAll(`[data-badge="${id}"]`).forEach((el) => {
    el.textContent = n > 99 ? '99+' : String(n);
    el.hidden = !n;
    el.setAttribute('aria-label', `${n} overdue`);
  });
}
// The badge on Tasks counts this person's open tasks that are overdue.
export function refreshBadges() {
  const today = todayStr();
  const n = (api.D.tasks || []).filter((t) => t.status === 'open' && t.owner_id === state.user?.id && t.due_on < today).length;
  setBadge('tasks', n);
}

export function setActive(section) {
  current = section;
  document.querySelectorAll('[data-nav]').forEach((a) => {
    if (a.dataset.nav === section) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  setSection(section === 'brands' ? 'brand' : section === 'customers' ? 'customer' : null);
  // The very bottom of every screen: that screen's own version.
  const foot = document.getElementById('screen-foot');
  if (foot) mount(foot, html`<span class="screen-version">${screenLabel(section)} ${versionOf(section)}</span>`);
}
