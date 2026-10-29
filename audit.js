// Audit log: every change, who made it and when. Visible to admins and the superuser. Read-only, and it cannot be edited or deleted.
import * as api from './api.js';
import { D } from './api.js';
import { can, ROLE_LABEL } from './state.js';
import { html, mount, loadingHtml, emptyHtml, fmtDateTime, fmtDateShort, todayStr, addDaysISO, fmtMoney } from './ui.js';

const ACTION = { INSERT: 'Added', UPDATE: 'Changed', DELETE: 'Deleted' };
const TABLE = {
  parties: 'record', contacts: 'contact', agreements: 'investment', agreement_payments: 'payment', agreement_targets: 'volume target', agreement_reviews: 'review',
  entries: 'note or meeting', tasks: 'task', list_items: 'list item', memberships: 'user access', invitations: 'invitation', organisations: 'organisation settings',
};
const HIDE = new Set(['id', 'organisation_id', 'created_at', 'created_by', 'updated_at', 'updated_by']);
const LABEL = (f) => f.replace(/_id$/, '').replace(/_/g, ' ');
// Show people, parties and investments by name rather than by code.
function show(field, v) {
  if (v === null || v === undefined || v === '') return 'empty';
  if (typeof v === 'object') return JSON.stringify(v);
  if (typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-/.test(v)) {
    if (['owner_id', 'user_id', 'completed_by'].includes(field)) return api.personName(v) || 'someone';
    if (['party_id', 'parent_id'].includes(field)) return D.partyById?.has(v) ? api.partyPath(v) : 'a record';
    if (field === 'agreement_id') return D.agreementById?.get(v)?.title || 'an investment';
    if (field === 'contact_id') return D.contactById?.get(v)?.name || 'a contact';
    if (field === 'entry_id' || field === 'related_entry_id') return D.entryById?.get(v)?.title || 'an entry';
    if (field === 'previous_task_id') return D.taskById?.get(v)?.title || 'a task';
    return 'linked record';
  }
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) return fmtDateTime(v);
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return fmtDateShort(v);
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  return String(v);
}
const nameOf = (r) => { const d = r.new_data || r.old_data || {}; return d.name || d.title || d.email || ''; };

export function auditTable(rows) {
  return html`<table class="grid"><thead><tr><th>When</th><th>Who</th><th>What</th><th>Detail</th></tr></thead><tbody>
    ${rows.map((r) => html`<tr>
      <td data-label="When">${fmtDateTime(r.occurred_at)}</td>
      <td data-label="Who">${r.actor_label || 'System'}</td>
      <td data-label="What">${ACTION[r.action] || r.action} ${TABLE[r.table_name] || r.table_name}${nameOf(r) ? html`: <strong>${nameOf(r)}</strong>` : ''}</td>
      <td data-label="Detail">${r.action === 'UPDATE'
        ? (r.changed_fields || []).filter((f) => !HIDE.has(f)).map((f) => html`<div class="sub"><strong>${LABEL(f)}</strong>: ${show(f, r.old_data?.[f])} → ${show(f, r.new_data?.[f])}</div>`)
        : ''}</td></tr>`)}
  </tbody></table>`;
}

export async function auditView(main) {
  if (!can.audit) { mount(main, html`<header class="page-head"><h1>Audit log</h1></header>${emptyHtml("You don't have access to the audit log", 'Ask an admin or the superuser.')}`); return; }
  mount(main, html`<header class="page-head"><h1>Audit log</h1></header>${loadingHtml()}`);
  const ui = { from: addDaysISO(todayStr(), -30), to: todayStr(), table: '' };
  const draw = async () => {
    const rows = await api.listAudit(ui);
    mount(main, html`
      <header class="page-head"><h1>Audit log</h1></header>
      <p class="muted">Every change made: who made it, when, and what changed. It cannot be edited or deleted. The most recent 200 changes in the period are shown.</p>
      <form class="filters" id="audit-form">
        <div class="field"><label for="a-from">From</label><input type="date" id="a-from" value="${ui.from}"></div>
        <div class="field"><label for="a-to">To</label><input type="date" id="a-to" value="${ui.to}"></div>
        <div class="field"><label for="a-table">Record type</label><select id="a-table"><option value="">All</option>${Object.entries(TABLE).map(([k, l]) => html`<option value="${k}" ${ui.table === k ? 'selected' : ''}>${l[0].toUpperCase() + l.slice(1)}</option>`)}</select></div>
      </form>
      ${rows.length ? auditTable(rows) : emptyHtml('No changes in this period', 'Try a wider date range.')}`);
    const f = main.querySelector('#audit-form');
    f.addEventListener('change', () => { ui.from = f.elements['a-from'].value || ui.from; ui.to = f.elements['a-to'].value || ui.to; ui.table = f.elements['a-table'].value; draw(); });
  };
  await draw();
}
