// Tasks: what needs doing, by whom, by when. Every task ends by setting the next step or saying why there is none.
import * as api from './api.js';
import { D } from './api.js';
import { state, can } from './state.js';
import { openCompleteTask, openTaskForm, openCancelTask, peopleOptions } from './logentry.js';
import { html, mount, on, pill, emptyHtml, fmtDateShort, fmtDateTime, relDays, todayStr, daysBetween, plural } from './ui.js';

const SOURCE = { manual: 'Added by hand', follow_up: 'Follow-up', auto: 'Reminder' };

// One task row. Used here, on the dashboard and on each party's Tasks tab.
export function taskRow(t, { showParty = true, actions = true } = {}) {
  const overdue = t.status === 'open' && t.due_on < todayStr();
  const prev = t.previous_task_id ? D.taskById.get(t.previous_task_id) : null;
  const tone = t.status !== 'open' ? '' : overdue ? 'task-overdue' : daysBetween(todayStr(), t.due_on) <= 3 ? 'task-due_soon' : 'task-upcoming';
  return html`<li class="task ${tone} ${t.status !== 'open' ? 'task-done' : ''}" data-id="${t.id}">
    <div class="task-main">
      <p class="task-title"><strong>${t.title}</strong> ${t.source === 'auto' ? html`<span class="tag tag-kind">Reminder</span>` : ''}${t.reschedule_count ? html`<span class="tag">Moved ${t.reschedule_count}x</span>` : ''}</p>
      <p class="task-meta muted-small">${showParty && t.party_id ? html`<a href="#/${D.partyById.get(t.party_id)?.side === 'brand' ? 'brands' : 'customers'}/${t.party_id}">${api.partyPath(t.party_id)}</a> · ` : ''}${api.personName(t.owner_id) || 'Unassigned'}${t.details ? html` · ${t.details}` : ''}</p>
      ${t.status === 'done' ? html`<p class="task-meta muted-small">Closed ${fmtDateTime(t.completed_at)}: ${t.outcome}${t.closed_mode === 'none' ? html` (nothing more needed: ${t.no_followup_reason}, ${t.no_followup_comment})` : ''}</p>` : ''}
      ${t.status === 'cancelled' ? html`<p class="task-meta muted-small">Cancelled: ${t.outcome}</p>` : ''}
      ${prev ? html`<p class="task-chain">Follows on from: ${prev.title}</p>` : ''}
    </div>
    <div class="task-due"><span class="${overdue ? 'c-overdue' : ''}">${fmtDateShort(t.due_on)}</span><br><span class="muted-small">${t.status === 'open' ? relDays(t.due_on) : ''}</span></div>
    ${actions && t.status === 'open' && can.write ? html`<div class="task-act"><button class="btn btn-sm btn-primary" data-action="done" data-id="${t.id}">Close</button><button class="btn btn-sm" data-action="edit" data-id="${t.id}">Change</button><button class="btn btn-sm" data-action="cancel" data-id="${t.id}">Cancel</button></div>` : html`<div></div>`}
  </li>`;
}
export function wireTasks(root, extra = {}) {
  on(root, {
    ...extra,
    done: (el) => openCompleteTask(D.taskById.get(el.dataset.id)),
    edit: (el) => openTaskForm(D.taskById.get(el.dataset.id)),
    cancel: (el) => openCancelTask(D.taskById.get(el.dataset.id)),
    addtask: (el) => openTaskForm(null, el.dataset.party ? { party_id: el.dataset.party } : {}),
  });
}

export async function tasksView(main, q = {}) {
  const ui = { who: q.who || 'me', when: q.when || 'open', side: q.side || '' };
  const draw = () => {
    const today = todayStr();
    let rows = D.tasks.filter((t) => ui.when === 'closed' ? t.status !== 'open' : t.status === 'open');
    if (ui.who === 'me') rows = rows.filter((t) => t.owner_id === state.user.id); else if (ui.who !== 'all') rows = rows.filter((t) => t.owner_id === ui.who);
    if (ui.side) rows = rows.filter((t) => t.party_id && D.partyById.get(t.party_id)?.side === ui.side);
    rows = [...rows].sort((a, b) => ui.when === 'closed' ? (b.completed_at || '').localeCompare(a.completed_at || '') : a.due_on.localeCompare(b.due_on));
    const bucket = (t) => (t.due_on < today ? 'Overdue' : t.due_on === today ? 'Today' : daysBetween(today, t.due_on) <= 7 ? 'Next 7 days' : 'Later');
    const groups = ui.when === 'closed' ? [['Closed and cancelled', rows]] : ['Overdue', 'Today', 'Next 7 days', 'Later'].map((g) => [g, rows.filter((t) => bucket(t) === g)]).filter(([, r]) => r.length);
    mount(main, html`
      <header class="page-head"><h1>Tasks</h1>${can.write ? html`<div class="head-actions"><button class="btn btn-primary" data-action="addtask">Add a task</button></div>` : ''}</header>
      <form class="filters" id="t-filters">
        <div class="field"><label for="t-who">Whose</label><select id="t-who"><option value="me" ${ui.who === 'me' ? 'selected' : ''}>Mine</option><option value="all" ${ui.who === 'all' ? 'selected' : ''}>Everyone</option>${D.people.filter((p) => p.id !== state.user.id).map((p) => html`<option value="${p.id}" ${ui.who === p.id ? 'selected' : ''}>${p.name}</option>`)}</select></div>
        <div class="field"><label for="t-when">Show</label><select id="t-when"><option value="open" ${ui.when === 'open' ? 'selected' : ''}>Open tasks</option><option value="closed" ${ui.when === 'closed' ? 'selected' : ''}>Closed or cancelled</option></select></div>
        <div class="field"><label for="t-side">Side</label><select id="t-side"><option value="">Both</option><option value="brand" ${ui.side === 'brand' ? 'selected' : ''}>Brand owners</option><option value="customer" ${ui.side === 'customer' ? 'selected' : ''}>Customers</option></select></div>
      </form>
      ${groups.length ? groups.map(([g, r]) => html`<section class="settings-block"><h2 class="${g === 'Overdue' ? 'c-overdue' : ''}">${g} <span class="muted-small">${plural(r.length, 'task')}</span></h2><ul class="tasks">${r.map((t) => taskRow(t))}</ul></section>`)
        : emptyHtml(ui.when === 'closed' ? 'Nothing closed yet' : 'No open tasks', ui.who === 'me' ? 'You have nothing to do. Log a note or a meeting and it will ask you for the next step.' : 'Nothing matches those filters.')}`);
    const f = main.querySelector('#t-filters');
    f.onchange = () => { ui.who = f.querySelector('#t-who').value; ui.when = f.querySelector('#t-when').value; ui.side = f.querySelector('#t-side').value; draw(); };
    wireTasks(main);
  };
  draw();
}
