// Data layer: every call to Neon goes through here.
// Every query is scoped to the current organisation. Row-level security is the real guard;
// the filter is there so a person who belongs to several organisations only sees the one they chose.
import * as neon from './neon.js';
import { state } from './state.js';
import { formatDate } from './ui.js';

const org = () => state.org.id;
const from = neon.from;

// ---- Errors -------------------------------------------------------------
// Messages raised by the database carry dates as "21 Sep 2026". Show them in the organisation's own date format.
const DB_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ownDates = (msg) => msg.replace(/\b(\d{2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{4})\b/g, (m, d, mon, y) => formatDate(new Date(Number(y), DB_MONTHS.indexOf(mon), Number(d))));
export function friendly(err) {
  const msg = ownDates(err?.message || String(err));
  if (/row-level security|permission denied/i.test(msg) && !/You do not have permission/i.test(msg)) return "You don't have permission to do that.";
  if (/at least one active superuser/i.test(msg)) return 'There must always be at least one active superuser. Make someone else a superuser first.';
  if (err?.code === '23505') {
    if (/parties_name_unique/i.test(msg)) return 'There is already a record with that name in that place.';
    if (/list_items_unique/i.test(msg)) return 'That is already in the list.';
    if (/tasks_auto_key/i.test(msg)) return 'That reminder already exists.';
    return 'That already exists.';
  }
  if (err?.code === '23503') return 'That is linked to a record that no longer exists. Refresh and try again.';
  if (err?.code === '23514') return /new row for relation/i.test(msg) ? 'One of the values is not allowed. Check the dates and numbers.' : msg;
  if (/Failed to fetch|NetworkError|network|could not reach/i.test(msg)) return 'Could not reach the server. Check your connection and try again.';
  return msg;
}
const fail = (error) => { const e = new Error(friendly(error)); e.code = error.code; e.raw = error; throw e; };
const ok = ({ data, error }) => { if (error) fail(error); return data; };
// Long lists are read a page at a time. build() must return a fresh query with a stable order.
async function all(build) {
  const out = [];
  for (let at = 0; ; at += 1000) {
    const rows = ok(await build().range(at, at + 999));
    out.push(...rows);
    if (rows.length < 1000) return out;
  }
}

// ---- Authentication -----------------------------------------------------
function authFail(error) {
  const msg = error?.message || '';
  let text = msg;
  if (/invalid (email or )?password|invalid login|incorrect/i.test(msg) || error?.code === 'INVALID_EMAIL_OR_PASSWORD') text = 'Email or password is incorrect.';
  else if (/already exists|already registered/i.test(msg) || /USER_ALREADY_EXISTS/.test(error?.code || '')) text = 'An account with that email already exists. Sign in instead.';
  else if (/password.*(short|least)|PASSWORD_TOO_SHORT/i.test(msg + (error?.code || ''))) text = 'Choose a longer password (at least 8 characters).';
  else if (/too many|rate limit|429/i.test(msg + (error?.code || ''))) text = 'Too many attempts. Wait a few minutes and try again.';
  else if (/Failed to fetch|could not reach/i.test(msg)) text = 'Could not reach the sign-in service. Check your connection and try again.';
  const e = new Error(text); e.raw = error; throw e;
}
export const auth = {
  async getSession() { try { return await neon.auth.getSession(); } catch (e) { authFail(e); } },
  async signIn(email, password) { try { return await neon.auth.signIn({ email, password }); } catch (e) { authFail(e); } },
  async signUp(email, password, name) { try { return await neon.auth.signUp({ email, password, name }); } catch (e) { authFail(e); } },
  async signOut() { try { await neon.auth.signOut(); } catch (e) { authFail(e); } },
};

// ---- Organisation context -----------------------------------------------
export async function loadMemberships(userId) {
  const rows = ok(await from('memberships').select('*, organisation:organisations(*)').eq('user_id', userId).eq('status', 'active'));
  return rows.filter((m) => m.organisation);
}
// Straight after sign-up the database can take a moment to see the new account, so "Not signed in" is retried a few times.
export async function acceptInvitation(token) {
  for (let attempt = 0; ; attempt++) {
    const { data, error } = await neon.rpc('accept_invitation', { p_token: token });
    if (!error) return data;
    if (attempt < 4 && /Not signed in/i.test(error.message || '')) { await new Promise((r) => setTimeout(r, 700 * (attempt + 1))); continue; }
    fail(error);
  }
}
export const logoUrl = (brand) => brand?.logo_url || null;

// ---- Users, invitations and organisation settings (superuser; the database refuses anyone else) ----
export async function listMembers() {
  const members = ok(await from('memberships').select('*').eq('organisation_id', org()).order('created_at'));
  const ids = members.map((m) => m.user_id);
  const profiles = ids.length ? ok(await from('profiles').select('id, email, display_name').in('id', ids)) : [];
  const byId = new Map(profiles.map((p) => [p.id, p]));
  return members.map((m) => ({ ...m, email: byId.get(m.user_id)?.email || '', display_name: byId.get(m.user_id)?.display_name || '' }));
}
export const updateMember = async (id, patch) => ok(await from('memberships').update(patch).eq('id', id).eq('organisation_id', org()).select().single());
export const listInvitations = async () =>
  ok(await from('invitations').select('*').eq('organisation_id', org()).is('accepted_at', null).is('revoked_at', null).order('created_at', { ascending: false }));
export async function createInvitation({ email, role }) {
  const address = String(email).trim().toLowerCase();
  ok(await from('invitations').update({ revoked_at: new Date().toISOString() }).eq('organisation_id', org()).eq('email', address).is('accepted_at', null).is('revoked_at', null));
  return ok(await from('invitations').insert({ organisation_id: org(), email: address, role }).select().single());
}
export const revokeInvitation = async (id) => ok(await from('invitations').update({ revoked_at: new Date().toISOString() }).eq('id', id).eq('organisation_id', org()).select().single());
export async function saveOrgSettings(patch) {
  const cur = ok(await from('organisations').select('settings').eq('id', org()).single());
  const row = ok(await from('organisations').update({ settings: { ...(cur.settings || {}), ...patch } }).eq('id', org()).select().single());
  state.org.settings = row.settings;
  return row;
}

// ---- Audit log (superuser and admin; the database refuses anyone else) ----
export async function listAudit({ from: fromDate, to, table, limit = 200 } = {}) {
  let q = from('audit_log').select('*').eq('organisation_id', org()).order('occurred_at', { ascending: false }).order('id', { ascending: false }).limit(limit);
  if (fromDate) q = q.gte('occurred_at', `${fromDate}T00:00:00`);
  if (to) q = q.lte('occurred_at', `${to}T23:59:59.999`);
  if (table) q = q.eq('table_name', table);
  return ok(await q);
}
export const listAuditFor = async (ids, limit = 100) => ok(await from('audit_log').select('*').eq('organisation_id', org()).in('record_id', ids).order('occurred_at', { ascending: false }).order('id', { ascending: false }).limit(limit));

// ---- The data this app works with ------------------------------------------------------------------------------------
// Everything for the organisation is read once (a handful of requests at the same time) and kept here, indexed, so every
// screen can show names, paths and roll-ups without asking again. After a change, reload() re-reads only what changed.
export const D = {
  loaded: false, parties: [], contacts: [], agreements: [], payments: [], targets: [], reviews: [], entries: [], tasks: [], lists: [], people: [],
  rollups: [], targetRollups: [],
};
const LOADERS = {
  parties: () => all(() => from('parties').select('*').eq('organisation_id', org()).order('name').order('id')),
  contacts: () => all(() => from('contacts').select('*').eq('organisation_id', org()).order('name').order('id')),
  agreements: () => all(() => from('agreements').select('*').eq('organisation_id', org()).order('title').order('id')),
  payments: () => all(() => from('agreement_payments').select('*').eq('organisation_id', org()).order('due_on').order('id')),
  targets: () => all(() => from('agreement_targets').select('*').eq('organisation_id', org()).order('period_start').order('id')),
  reviews: () => all(() => from('agreement_reviews').select('*').eq('organisation_id', org()).order('reviewed_on', { ascending: false }).order('id')),
  entries: () => all(() => from('entries').select('*').eq('organisation_id', org()).order('occurred_at', { ascending: false }).order('id')),
  tasks: () => all(() => from('tasks').select('*').eq('organisation_id', org()).order('due_on').order('id')),
  lists: () => all(() => from('list_items').select('*').eq('organisation_id', org()).order('sort_order').order('name').order('id')),
  people: async () => {
    const ms = all(() => from('memberships').select('user_id, role, status').eq('organisation_id', org()).order('created_at').order('id'));
    const ps = all(() => from('profiles').select('id, email, display_name').order('id'));
    const [m, p] = await Promise.all([ms, ps]);
    const byId = new Map(p.map((x) => [x.id, x]));
    return m.map((x) => ({ id: x.user_id, role: x.role, status: x.status, name: byId.get(x.user_id)?.display_name || byId.get(x.user_id)?.email || 'Someone', email: byId.get(x.user_id)?.email || '' }));
  },
  rollups: () => all(() => from('party_rollup').select('*').eq('organisation_id', org()).order('party_id')),
  targetRollups: () => all(() => from('party_target_rollup').select('*').eq('organisation_id', org()).order('party_id').order('unit')),
};
const REFRESH_AFTER = { // what else to re-read when one of these changes (figures and reminders are worked out by the database)
  parties: ['parties', 'rollups', 'targetRollups'],
  agreements: ['agreements', 'rollups', 'targetRollups', 'tasks'],
  payments: ['payments', 'rollups', 'tasks'],
  targets: ['targets', 'targetRollups', 'tasks'],
};
export async function loadAll() {
  const names = Object.keys(LOADERS);
  const rows = await Promise.all(names.map((n) => LOADERS[n]()));
  names.forEach((n, i) => { D[n] = rows[i]; });
  D.loaded = true;
  index();
}
export async function reload(...names) {
  const want = [...new Set(names.flatMap((n) => REFRESH_AFTER[n] || [n]))];
  const rows = await Promise.all(want.map((n) => LOADERS[n]()));
  want.forEach((n, i) => { D[n] = rows[i]; });
  index();
}
export const resetData = () => { D.loaded = false; };

const group = (rows, key) => { const m = new Map(); for (const r of rows) { const k = r[key]; if (!m.has(k)) m.set(k, []); m.get(k).push(r); } return m; };
function index() {
  D.partyById = new Map(D.parties.map((p) => [p.id, p]));
  D.childrenOf = group(D.parties.filter((p) => p.parent_id), 'parent_id');
  D.contactsOf = group(D.contacts, 'party_id');
  D.contactById = new Map(D.contacts.map((c) => [c.id, c]));
  D.agreementsOf = group(D.agreements, 'party_id');
  D.agreementById = new Map(D.agreements.map((a) => [a.id, a]));
  D.paymentsOf = group(D.payments, 'agreement_id');
  D.targetsOf = group(D.targets, 'agreement_id');
  D.reviewsOf = group(D.reviews, 'agreement_id');
  D.entriesOf = group(D.entries, 'party_id');
  D.entryById = new Map(D.entries.map((e) => [e.id, e]));
  D.tasksOf = group(D.tasks, 'party_id');
  D.taskById = new Map(D.tasks.map((t) => [t.id, t]));
  D.rollupOf = new Map(D.rollups.map((r) => [r.party_id, r]));
  D.targetRollupOf = group(D.targetRollups, 'party_id');
  D.personById = new Map(D.people.map((p) => [p.id, p]));
  D.listNames = (list) => D.lists.filter((l) => l.list === list && !l.archived_at).map((l) => l.name);
}
export const personName = (id) => D.personById?.get(id)?.name || '';
// The ancestors of a record, outermost first (not including the record itself).
export function ancestors(id) {
  const out = []; let cur = D.partyById.get(id)?.parent_id;
  while (cur) { const p = D.partyById.get(cur); if (!p) break; out.unshift(p); cur = p.parent_id; }
  return out;
}
export const partyPath = (id, sep = ' › ') => [...ancestors(id), D.partyById.get(id)].filter(Boolean).map((p) => p.name).join(sep);
export function descendantIds(id) {
  const out = []; const walk = (x) => { for (const c of D.childrenOf.get(x) || []) { out.push(c.id); walk(c.id); } }; walk(id); return out;
}
export const depthOf = (id) => ancestors(id).length + 1;

// ---- Writing ------------------------------------------------------------------------------------------------------------
// Nothing is ever deleted: a record is archived by setting archived_at.
const saver = (table) => async (values, id) => {
  if (id) return ok(await from(table).update(values).eq('id', id).eq('organisation_id', org()).select().single());
  return ok(await from(table).insert({ ...values, organisation_id: org() }).select().single());
};
export const saveParty = saver('parties');
export const saveContact = saver('contacts');
export const saveAgreement = saver('agreements');
export const savePayment = saver('agreement_payments');
export const saveTarget = saver('agreement_targets');
export const saveReview = saver('agreement_reviews');
export const saveListItem = saver('list_items');
export const updateEntry = async (id, values) => ok(await from('entries').update(values).eq('id', id).eq('organisation_id', org()).select().single());

// Entries and tasks are written through database functions that enforce the follow-up rules.
export const logEntry = async (p) => ok(await neon.rpc('entry_log', { p: { ...p, organisation_id: org() } }));
export const saveTask = async (p) => ok(await neon.rpc('task_save', { p: { ...p, organisation_id: org() } }));
export const completeTask = async (p) => ok(await neon.rpc('task_complete', { p: { ...p, organisation_id: org() } }));
export const cancelTask = async (id, reason) => ok(await neon.rpc('task_cancel', { p_org: org(), p_id: id, p_reason: reason }));
