// Brand owners and customers. Both sides use the same screens; the side decides the words and the colour.
// Brand side: owner > brand > product. Customer side: group > sub-group(s) > pub or outlet. Figures are shown "at this level" and "including below".
import * as api from './api.js';
import { D } from './api.js';
import { state, can, SIDE, NODE_LABEL, CHILD_TYPES, ROOT_TYPES, PARTY_STATUS, ENTRY_KIND, AGREEMENT_STATUS } from './state.js';
import { openLog, openTaskForm, peopleOptions, contactsFor, agreementsFor, afterChange } from './logentry.js';
import { taskRow, wireTasks } from './tasks.js';
import { openContactForm, contactsTable, contactHandlers } from './contacts.js';
import { openAgreementForm, agreementsTable, amountText } from './investments.js';
import { auditTable } from './audit.js';
import { html, raw, mount, on, openModal, field, readForm, toast, pill, facts, icon, emptyHtml, fmtMoney, fmtMoneyShort, fmtInt, fmtDateShort, fmtDayTime, toLocalInput, fromLocalInput, relDays, todayStr, plural } from './ui.js';

const MAX_DEPTH = 4;
const money = (n) => { const x = Number(n || 0); return Number.isInteger(x) ? fmtMoneyShort(x) : fmtMoney(x); };
const path = (side) => SIDE[side].route;
const hrefOf = (p) => `#/${path(p.side)}/${p.id}`;

// Open tasks per party, counting everything underneath: { count, next, overdue }.
function taskSummary() {
  const m = new Map(); const today = todayStr();
  for (const t of D.tasks) {
    if (t.status !== 'open' || !t.party_id) continue;
    for (const id of [t.party_id, ...api.ancestors(t.party_id).map((p) => p.id)]) {
      const s = m.get(id) || { count: 0, human: 0, next: null, overdue: 0 };
      s.count++; if (t.source !== 'auto') s.human++; if (!s.next || t.due_on < s.next) s.next = t.due_on; if (t.due_on < today) s.overdue++;
      m.set(id, s);
    }
  }
  return m;
}
const total = (r, k) => Number(r?.[`own_${k}`] || 0) + Number(r?.[`below_${k}`] || 0);
const childrenOf = (id, archived) => (D.childrenOf.get(id) || []).filter((c) => archived || !c.archived_at);
const isQuiet = (p, tasks) => p.status === 'active' && !p.archived_at && !(tasks.get(p.id)?.human);

// ---- Add / change a record ------------------------------------------------------------------------------------------------
export function openPartyForm(party = null, { side, parent_id } = {}) {
  const sd = party?.side || side; const parent = party ? D.partyById.get(party.parent_id) : parent_id ? D.partyById.get(parent_id) : null;
  const types = party ? [party.node_type] : parent ? CHILD_TYPES[parent.node_type] : ROOT_TYPES[sd];
  const p = party || { status: 'active', owner_id: state.user.id, node_type: types[0] };
  const dlg = openModal({
    title: party ? `Change ${NODE_LABEL[party.node_type].toLowerCase()}` : parent ? `Add under ${parent.name}` : `Add a ${SIDE[sd].label.toLowerCase()}`, submitLabel: 'Save', wide: true,
    body: html`${parent ? html`<p class="muted">Inside <strong>${api.partyPath(parent.id)}</strong></p>` : ''}<div class="form-grid">
      ${field({ name: 'node_type', label: 'This is a', type: 'select', required: true, options: types.map((t) => [t, NODE_LABEL[t]]), value: p.node_type })}
      ${field({ name: 'name', label: 'Name', required: true, value: p.name })}
      ${field({ name: 'status', label: 'Status', type: 'select', required: true, options: Object.entries(PARTY_STATUS), value: p.status, hint: 'Active ones with no open task are flagged as "gone quiet".' })}
      <div class="field"><label for="f-owner_id">Looked after by</label><select id="f-owner_id" name="owner_id"><option value="">Not set</option>${peopleOptions(p.owner_id)}</select></div>
      ${field({ name: 'phone', label: 'Phone', type: 'tel', value: p.phone })}
      ${field({ name: 'email', label: 'Email', type: 'email', value: p.email })}
      ${field({ name: 'website', label: 'Website', value: p.website })}
      ${field({ name: 'address', label: 'Address', value: p.address })}
      ${field({ name: 'notes', label: 'Notes', type: 'textarea', rows: 3, span: 2, value: p.notes })}
    </div>`,
    onSubmit: async (form) => {
      const v = readForm(form, [{ name: 'node_type' }, { name: 'name' }, { name: 'status' }, { name: 'owner_id' }, { name: 'phone' }, { name: 'email' }, { name: 'website' }, { name: 'address' }, { name: 'notes' }]);
      if (!v.name) throw new Error('Enter a name.');
      let saved;
      if (party) { delete v.node_type; saved = await api.saveParty(v, party.id); }
      else saved = await api.saveParty({ ...v, side: sd, parent_id: parent?.id || null });
      toast('Saved.');
      setTimeout(async () => { await api.reload('parties'); if (!party) location.hash = `#/${path(sd)}/${saved.id}`; else afterChange('parties'); }, 0);
    },
  });
  return dlg;
}

// ---- The list (a tree) --------------------------------------------------------------------------------------------------------
export async function partiesView(main, side) {
  const S = SIDE[side]; const ui = { q: '', status: '', archived: false };
  const draw = () => {
    const tasks = taskSummary(); const q = ui.q.toLowerCase();
    const keep = new Set();
    const consider = (p) => !((!ui.archived && p.archived_at) || (ui.status && p.status !== ui.status));
    for (const p of D.parties) if (p.side === side && consider(p) && (!q || p.name.toLowerCase().includes(q))) { keep.add(p.id); if (q) api.ancestors(p.id).forEach((a) => keep.add(a.id)); }
    const rows = [];
    const walk = (p, depth) => { if (keep.has(p.id)) rows.push([p, depth]); childrenOf(p.id, true).sort((a, b) => a.name.localeCompare(b.name)).forEach((c) => walk(c, depth + 1)); };
    D.parties.filter((p) => p.side === side && !p.parent_id).sort((a, b) => a.name.localeCompare(b.name)).forEach((p) => walk(p, 0));
    mount(main, html`
      <header class="page-head"><h1>${S.plural}</h1>${can.write ? html`<div class="head-actions">${ROOT_TYPES[side].map((t, i) => html`<button class="btn ${i === 0 ? 'btn-primary' : ''}" data-action="add" data-type="${t}">Add ${t === 'site' ? 'a pub or outlet' : `a ${NODE_LABEL[t].toLowerCase()}`}</button>`)}</div>` : ''}</header>
      <p class="muted">${side === 'brand' ? 'Money comes in from brand owners: support for selling their brands.' : 'Money goes out to customers: investment in pubs and restaurant groups.'} Figures include everything underneath.</p>
      <form class="filters" id="p-filters" onsubmit="return false">
        <div class="field"><label for="p-q">Search</label><input id="p-q" type="search" value="${ui.q}"></div>
        <div class="field"><label for="p-status">Status</label><select id="p-status"><option value="">All</option>${Object.entries(PARTY_STATUS).map(([k, l]) => html`<option value="${k}" ${ui.status === k ? 'selected' : ''}>${l}</option>`)}</select></div>
        <div class="field"><label class="check"><input type="checkbox" id="p-arch" ${ui.archived ? 'checked' : ''}> <span>Show archived</span></label></div>
      </form>
      ${rows.length ? html`<table class="grid"><thead><tr><th>Name</th><th>Status</th><th>Investments</th><th>Per year</th><th>Next task</th></tr></thead><tbody>
        ${rows.map(([p, d]) => { const r = D.rollupOf.get(p.id); const t = tasks.get(p.id); return html`<tr class="${p.archived_at ? 'row-off' : ''}">
          <td data-label="Name"><div class="tree-name indent-${Math.min(d, 3)}"><a href="${hrefOf(p)}">${p.name}</a> <span class="tag tag-kind">${NODE_LABEL[p.node_type]}</span>${p.archived_at ? html` <span class="tag">Archived</span>` : ''}${isQuiet(p, tasks) ? html` <span class="tag" style="background:var(--soon-bg);color:var(--soon)">Gone quiet</span>` : ''}</div></td>
          <td data-label="Status">${pill(p.status, PARTY_STATUS[p.status])}</td>
          <td data-label="Investments">${fmtInt(total(r, 'count'))}</td><td data-label="Per year" class="money">${total(r, 'per_year') ? money(total(r, 'per_year')) : ''}</td>
          <td data-label="Next task">${t?.next ? html`<span class="${t.next < todayStr() ? 'c-overdue' : ''}">${fmtDateShort(t.next)}</span>` : html`<span class="muted">None</span>`}</td></tr>`; })}
      </tbody></table>` : emptyHtml(`No ${S.plural.toLowerCase()} found`, can.write ? 'Add the first one with the button above.' : 'Nothing matches those filters.')}`);
    const f = main.querySelector('#p-filters'); const qi = f.querySelector('#p-q');
    qi.oninput = () => { ui.q = qi.value; const pos = qi.selectionStart; draw(); const n = main.querySelector('#p-q'); n.focus(); n.setSelectionRange(pos, pos); };
    f.onchange = (e) => { if (e.target.id === 'p-q') return; ui.status = f.querySelector('#p-status').value; ui.archived = f.querySelector('#p-arch').checked; draw(); };
    on(main, { add: (el) => { const dlg = openPartyForm(null, { side }); const sel = dlg.querySelector('[name="node_type"]'); if (sel && el.dataset.type) sel.value = el.dataset.type; } });
  };
  draw();
}

// ---- Entry changes -------------------------------------------------------------------------------------------------------------
function openEntryEdit(e) {
  const dlg = openModal({
    title: `Change ${ENTRY_KIND[e.kind].toLowerCase()}`, submitLabel: 'Save', wide: true,
    body: html`<p class="muted">The follow-up cannot be removed here. To change it, use the task itself.</p><div class="form-grid">
      ${field({ name: 'title', label: 'Short title', required: true, span: 2, value: e.title })}
      ${field({ name: 'body', label: 'Details', type: 'textarea', rows: 4, span: 2, value: e.body })}
      <div class="field"><label for="f-occurred_at">When</label><input type="datetime-local" id="f-occurred_at" name="occurred_at" value="${toLocalInput(e.occurred_at)}"></div>
      ${e.kind === 'meeting' ? field({ name: 'meeting_status', label: 'Meeting is', type: 'select', required: true, options: [['scheduled', 'Scheduled'], ['held', 'Held'], ['cancelled', 'Cancelled']], value: e.meeting_status }) : ''}
      ${field({ name: 'location', label: 'Where', value: e.location })}${field({ name: 'attendees', label: 'Who was there', value: e.attendees })}
      <div class="field"><label for="f-contact_id">Contact</label><select id="f-contact_id" name="contact_id"><option value="">None</option>${contactsFor(e.party_id).map((c) => html`<option value="${c.id}" ${c.id === e.contact_id ? raw('selected') : ''}>${c.name}</option>`)}</select></div>
      <div class="field"><label for="f-agreement_id">Investment</label><select id="f-agreement_id" name="agreement_id"><option value="">None</option>${agreementsFor(e.party_id).map((a) => html`<option value="${a.id}" ${a.id === e.agreement_id ? raw('selected') : ''}>${a.title}</option>`)}</select></div>
      ${field({ name: 'is_decision', label: 'Includes a decision', type: 'checkbox', span: 2, value: e.is_decision })}
    </div>`,
    onSubmit: async (form) => {
      const v = readForm(form, [{ name: 'title' }, { name: 'body' }, { name: 'meeting_status' }, { name: 'location' }, { name: 'attendees' }, { name: 'contact_id' }, { name: 'agreement_id' }, { name: 'is_decision', type: 'checkbox' }]);
      if (!v.title) throw new Error('Give it a short title.');
      if (e.kind !== 'meeting') delete v.meeting_status;
      await api.updateEntry(e.id, { ...v, occurred_at: fromLocalInput(form.elements.occurred_at.value) });
      toast('Saved.'); setTimeout(() => afterChange('entries'), 0);
    },
  });
  return dlg;
}
function followupLine(e) {
  if (e.followup_mode === 'none') return html`<p class="tl-next"><strong>No follow-up:</strong> ${e.no_followup_reason}. ${e.no_followup_comment}</p>`;
  const t = D.tasks.filter((x) => x.entry_id === e.id && !x.previous_task_id)[0];
  if (!t) return '';
  const label = t.status === 'open' ? `due ${fmtDateShort(t.due_on)} (${relDays(t.due_on)})` : t.status === 'done' ? 'done' : 'cancelled';
  return html`<p class="tl-next"><strong>Next:</strong> ${t.title}, ${label}${t.owner_id ? ` · ${api.personName(t.owner_id)}` : ''}</p>`;
}

// ---- One record -----------------------------------------------------------------------------------------------------------------
export async function partyView(main, side, id, q = {}) {
  const S = SIDE[side];
  const party = D.partyById.get(id);
  if (!party || party.side !== side) { mount(main, html`<header class="page-head"><h1>${S.plural}</h1></header>${emptyHtml('Not found', 'That record does not exist or has been removed.', html`<p><a class="btn" href="#/${path(side)}">Back to ${S.plural.toLowerCase()}</a></p>`)}`); return; }
  const kids = childrenOf(id, false);
  const ui = { tab: q.tab || 'overview', below: kids.length > 0, kind: '', decisions: false };
  const history = [];
  const draw = async () => {
    const ids = ui.below ? [id, ...api.descendantIds(id)] : [id]; const idSet = new Set(ids);
    const tasksSum = taskSummary(); const today = todayStr(); const w = can.write && !party.archived_at;
    const r = D.rollupOf.get(id); const targets = D.targetRollupOf.get(id) || [];
    const myTasks = D.tasks.filter((t) => idSet.has(t.party_id));
    const openTasks = myTasks.filter((t) => t.status === 'open').sort((a, b) => a.due_on.localeCompare(b.due_on));
    const entries = D.entries.filter((e) => idSet.has(e.party_id) && !e.archived_at && (!ui.kind || e.kind === ui.kind) && (!ui.decisions || e.is_decision)).sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));
    const contacts = D.contacts.filter((c) => idSet.has(c.party_id) && !c.archived_at);
    const agreements = D.agreements.filter((a) => idSet.has(a.party_id) && !a.archived_at).sort((a, b) => a.title.localeCompare(b.title));
    const canAddKid = can.write && !party.archived_at && CHILD_TYPES[party.node_type].length && api.depthOf(id) < MAX_DEPTH;
    const tabs = [['overview', 'Overview'], ['timeline', 'Timeline'], ['contacts', 'Contacts'], ['tasks', 'Tasks'], ['investments', 'Investments'], ...(childrenOf(id, true).length ? [['below', 'Below']] : []), ...(can.audit ? [['history', 'History']] : [])];
    const belowToggle = kids.length ? html`<label class="check small"><input type="checkbox" data-toggle="below" ${ui.below ? 'checked' : ''}> <span>Include everything below</span></label>` : '';
    const rollRow = (label, key, fmt = money) => html`<tr><th scope="row">${label}</th><td>${fmt(r?.[`own_${key}`])}</td>${kids.length ? html`<td>${fmt(total(r, key))}</td>` : ''}</tr>`;

    let panel;
    if (ui.tab === 'overview') {
      panel = html`<div class="rollup">
        <section class="dash-panel"><h2>About</h2>${facts([['Type', NODE_LABEL[party.node_type]], ['Status', pill(party.status, PARTY_STATUS[party.status])], ['Looked after by', api.personName(party.owner_id)], ['Phone', party.phone], ['Email', party.email ? html`<a href="mailto:${party.email}">${party.email}</a>` : ''], ['Website', party.website], ['Address', party.address], ['Notes', party.notes]])}</section>
        <section class="dash-panel"><h2>${S.money}</h2>
          <table class="mini"><thead><tr><th></th><th>At this level</th>${kids.length ? html`<th>Including below</th>` : ''}</tr></thead><tbody>
            ${rollRow('Agreed or live', 'count', (v) => fmtInt(Number(v || 0)))}${rollRow('Per year', 'per_year')}${rollRow('One-off totals', 'total')}${rollRow(S.paid, 'done')}${rollRow(S.unpaid, 'planned')}${rollRow('Overdue', 'overdue')}
          </tbody></table>
          ${targets.length ? html`<h3>Volume targets in this period</h3><table class="mini"><tbody>${targets.map((t) => html`<tr><th scope="row">${t.unit}</th><td>${fmtInt(t.own_qty)}</td>${kids.length ? html`<td>${fmtInt(Number(t.own_qty) + Number(t.below_qty))}</td>` : ''}</tr>`)}</tbody></table>` : ''}
        </section>
        <section class="dash-panel"><h2>Next steps</h2>${openTasks.length ? html`<ul class="tasks">${openTasks.slice(0, 4).map((t) => taskRow(t, { showParty: ui.below }))}</ul>${openTasks.length > 4 ? html`<p><button class="link" data-tab="tasks">All ${openTasks.length} tasks</button></p>` : ''}` : html`<p class="muted">${isQuiet(party, tasksSum) ? 'Nothing is planned: this has gone quiet.' : 'Nothing open.'}</p>`}</section>
        <section class="dash-panel"><h2>Latest</h2>${entries.length ? html`<ul class="attn">${entries.slice(0, 3).map((e) => html`<li><strong>${e.title}</strong><br><span class="muted-small">${ENTRY_KIND[e.kind]} · ${fmtDayTime(e.occurred_at)}</span></li>`)}</ul><p><button class="link" data-tab="timeline">Open the timeline</button></p>` : html`<p class="muted">Nothing logged yet.</p>`}</section>
      </div>`;
    } else if (ui.tab === 'timeline') {
      panel = html`<form class="filters" onsubmit="return false"><div class="field"><label for="tl-kind">Show</label><select id="tl-kind" data-filter="kind"><option value="">Everything</option>${Object.entries(ENTRY_KIND).map(([k, l]) => html`<option value="${k}" ${ui.kind === k ? 'selected' : ''}>${l}s</option>`)}</select></div><div class="field"><label class="check"><input type="checkbox" data-filter="decisions" ${ui.decisions ? 'checked' : ''}> <span>Decisions only</span></label></div></form>
        ${entries.length ? html`<ul class="timeline">${entries.map((e) => { const up = e.kind === 'meeting' && e.meeting_status === 'scheduled'; return html`<li class="tl-item ${up ? 'upcoming' : ''}"><span class="tl-icon">${icon(e.kind)}</span>
          <div><p class="tl-title">${e.title} ${e.is_decision ? html`<span class="tag">Decision</span>` : ''}${up ? html` <span class="tag">Scheduled</span>` : e.meeting_status === 'cancelled' ? html` <span class="tag">Cancelled</span>` : ''}</p>
            <p class="tl-meta">${ENTRY_KIND[e.kind]} · ${fmtDayTime(e.occurred_at)} · ${api.personName(e.created_by) || 'someone'}${e.party_id !== id ? html` · <a href="${hrefOf(D.partyById.get(e.party_id))}">${api.partyPath(e.party_id)}</a>` : ''}${e.contact_id ? ` · with ${D.contactById.get(e.contact_id)?.name || ''}` : ''}${e.agreement_id ? html` · <a href="#/investments/${e.agreement_id}">${D.agreementById.get(e.agreement_id)?.title}</a>` : ''}</p>
            ${e.location || e.attendees ? html`<p class="tl-meta">${e.location}${e.location && e.attendees ? ' · ' : ''}${e.attendees ? `With ${e.attendees}` : ''}</p>` : ''}
            ${e.body ? html`<p class="tl-body prewrap">${e.body}</p>` : ''}${followupLine(e)}</div>
          <div class="tl-act">${w ? html`${up ? html`<button class="btn btn-sm btn-primary" data-action="outcome" data-id="${e.id}">Record outcome</button>` : ''}<button class="btn btn-sm" data-action="e-edit" data-id="${e.id}">Change</button>` : ''}</div></li>`; })}</ul>` : emptyHtml('Nothing logged yet', w ? 'Use the Log button to add a note, call or meeting.' : '')}`;
    } else if (ui.tab === 'contacts') {
      panel = html`${w ? html`<p class="inline-actions"><button class="btn btn-primary" data-action="c-add">Add a contact</button></p>` : ''}${contacts.length ? contactsTable(contacts, { showParty: ui.below && kids.length > 0 }) : emptyHtml('No contacts yet', 'Add the people you deal with here.')}`;
    } else if (ui.tab === 'tasks') {
      const closed = myTasks.filter((t) => t.status !== 'open').sort((a, b) => (b.completed_at || '').localeCompare(a.completed_at || ''));
      panel = html`${w ? html`<p class="inline-actions"><button class="btn btn-primary" data-action="addtask" data-party="${id}">Add a task</button></p>` : ''}
        ${openTasks.length ? html`<ul class="tasks">${openTasks.map((t) => taskRow(t, { showParty: ui.below && kids.length > 0 }))}</ul>` : emptyHtml('No open tasks', isQuiet(party, tasksSum) ? 'This has gone quiet. Log something or add a task so it is revisited.' : '')}
        ${closed.length ? html`<details><summary>Closed and cancelled (${closed.length})</summary><ul class="tasks">${closed.map((t) => taskRow(t, { showParty: ui.below && kids.length > 0 }))}</ul></details>` : ''}`;
    } else if (ui.tab === 'investments') {
      panel = html`${w ? html`<p class="inline-actions"><button class="btn btn-primary" data-action="a-add">Add an investment</button></p>` : ''}${agreements.length ? agreementsTable(agreements, { showParty: ui.below && kids.length > 0 }) : emptyHtml('No investments yet', side === 'brand' ? 'Add the support this brand owner provides.' : 'Add the investment made in this customer.')}`;
    } else if (ui.tab === 'below') {
      const all = childrenOf(id, true).sort((a, b) => a.name.localeCompare(b.name));
      panel = html`${canAddKid ? html`<p class="inline-actions">${CHILD_TYPES[party.node_type].map((t) => html`<button class="btn" data-action="add-child" data-type="${t}">Add a ${NODE_LABEL[t].toLowerCase()}</button>`)}</p>` : ''}
        <table class="grid"><thead><tr><th>Name</th><th>Status</th><th>Investments</th><th>Per year</th><th>Next task</th></tr></thead><tbody>${all.map((c) => { const cr = D.rollupOf.get(c.id); const t = tasksSum.get(c.id); return html`<tr class="${c.archived_at ? 'row-off' : ''}"><td data-label="Name"><a href="${hrefOf(c)}">${c.name}</a> <span class="tag tag-kind">${NODE_LABEL[c.node_type]}</span>${isQuiet(c, tasksSum) ? html` <span class="tag" style="background:var(--soon-bg);color:var(--soon)">Gone quiet</span>` : ''}</td><td data-label="Status">${pill(c.status, PARTY_STATUS[c.status])}</td><td data-label="Investments">${fmtInt(total(cr, 'count'))}</td><td data-label="Per year" class="money">${total(cr, 'per_year') ? money(total(cr, 'per_year')) : ''}</td><td data-label="Next task">${t?.next ? fmtDateShort(t.next) : html`<span class="muted">None</span>`}</td></tr>`; })}</tbody></table>`;
    } else {
      panel = history.length ? auditTable(history) : emptyHtml('No history', 'Changes to this record will appear here.');
    }

    const crumbs = api.ancestors(id);
    mount(main, html`
      <p class="crumbs"><a href="#/${path(side)}">${S.plural}</a>${crumbs.map((p) => html` › <a href="${hrefOf(p)}">${p.name}</a>`)}</p>
      <header class="page-head"><h1>${party.name}</h1>${w ? html`<div class="head-actions"><button class="btn btn-primary" data-action="log">${icon('plus')} Log</button><button class="btn" data-action="addtask" data-party="${id}">Add a task</button><button class="btn" data-action="p-edit">Change</button><button class="btn" data-action="p-arch">Archive</button></div>` : can.write && party.archived_at ? html`<div class="head-actions"><button class="btn" data-action="p-restore">Restore</button></div>` : ''}</header>
      <p><span class="tag tag-${side}">${S.label}: ${S.flow}</span> <span class="tag tag-kind">${NODE_LABEL[party.node_type]}</span> ${pill(party.status, PARTY_STATUS[party.status])} ${party.archived_at ? html`<span class="tag">Archived</span>` : ''} ${isQuiet(party, tasksSum) ? html`<span class="tag" style="background:var(--soon-bg);color:var(--soon)">Gone quiet</span>` : ''}</p>
      ${canAddKid ? html`<p class="inline-actions">${CHILD_TYPES[party.node_type].map((t) => html`<button class="btn btn-sm" data-action="add-child" data-type="${t}">Add a ${NODE_LABEL[t].toLowerCase()}</button>`)}</p>` : ''}
      <div class="tabs" role="tablist">${tabs.map(([k, l]) => html`<button class="tab" role="tab" data-tab="${k}" ${ui.tab === k ? raw('aria-current="page" aria-selected="true"') : raw('aria-selected="false"')}>${l}</button>`)}</div>
      ${['overview', 'history'].includes(ui.tab) ? '' : html`<p>${belowToggle}</p>`}
      ${panel}`);
    wireTasks(main, {
      log: () => openLog({ party_id: id }),
      'p-edit': () => openPartyForm(party),
      'p-arch': () => openModal({ title: `Archive ${party.name}?`, submitLabel: 'Archive', danger: true, body: html`<p>It is hidden from lists but kept, with everything logged against it, and can be restored. It cannot be archived while anything active sits underneath it.</p>`, onSubmit: async () => { await api.saveParty({ archived_at: new Date().toISOString() }, id); toast('Archived.'); setTimeout(() => afterChange('parties'), 0); } }),
      'p-restore': async () => { try { await api.saveParty({ archived_at: null }, id); toast('Restored.'); afterChange('parties'); } catch (e) { toast(e.message, 'error'); } },
      'add-child': (el) => { const dlg = openPartyForm(null, { side, parent_id: id }); const sel = dlg.querySelector('[name="node_type"]'); if (sel && el.dataset.type) sel.value = el.dataset.type; },
      'c-add': () => openContactForm(null, { party_id: id }),
      'a-add': () => openAgreementForm(null, { party_id: id }),
      outcome: (el) => { const e = D.entryById.get(el.dataset.id); openLog({ kind: 'note', title: `Outcome: ${e.title}`, related_entry_id: e.id, party_id: e.party_id, contact_id: e.contact_id, agreement_id: e.agreement_id, occurred_at: e.occurred_at }); },
      'e-edit': (el) => openEntryEdit(D.entryById.get(el.dataset.id)),
      ...contactHandlers,
    });
    const prev = main.onclick;
    main.onclick = async (e) => {
      const tab = e.target.closest('[data-tab]');
      if (tab) { ui.tab = tab.dataset.tab; if (ui.tab === 'history' && can.audit) history.splice(0, history.length, ...(await api.listAuditFor([id], 80))); draw(); return; }
      prev?.(e);
    };
    main.onchange = (e) => {
      const t = e.target;
      if (t.dataset.toggle === 'below') { ui.below = t.checked; draw(); }
      else if (t.dataset.filter === 'kind') { ui.kind = t.value; draw(); }
      else if (t.dataset.filter === 'decisions') { ui.decisions = t.checked; draw(); }
    };
  };
  if (ui.tab === 'history' && can.audit) history.push(...await api.listAuditFor([id], 80));
  await draw();
}
