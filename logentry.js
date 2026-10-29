// The Log dialog (note, call, email, meeting, visit, decision) and the task dialogs.
// Everything that is logged must end with a next step: a "revisit" task, or a reason (and a comment) why none is needed.
import * as api from './api.js';
import { D } from './api.js';
import { state, SIDE, NODE_LABEL, ENTRY_KIND } from './state.js';
import { dispatch } from './router.js';
import { refreshBadges } from './shell.js';
import { html, raw, openModal, closeModal, toast, field, readForm, icon, todayStr, addDaysISO, parseISO, toISO, toLocalInput, fromLocalInput, fmtDateShort } from './ui.js';

// ---- Small shared pieces ---------------------------------------------------------------------------------------------------
// Every party in the organisation as <option>s, grouped by side, with the path shown so two "Heineken" never look alike.
export function partyOptions(selected, { side } = {}) {
  const live = D.parties.filter((p) => !p.archived_at && (!side || p.side === side));
  const sorted = [...live].sort((a, b) => api.partyPath(a.id).localeCompare(api.partyPath(b.id)));
  const group = (s) => sorted.filter((p) => p.side === s).map((p) => html`<option value="${p.id}" ${p.id === selected ? raw('selected') : ''}>${api.partyPath(p.id)} (${NODE_LABEL[p.node_type]})</option>`);
  if (side) return group(side);
  return ['brand', 'customer'].map((s) => { const o = group(s); return o.length ? html`<optgroup label="${SIDE[s].plural}">${o}</optgroup>` : ''; });
}
export const peopleOptions = (selected) => D.people.filter((p) => p.status === 'active').map((p) => html`<option value="${p.id}" ${p.id === selected ? raw('selected') : ''}>${p.name}</option>`);
// People, contacts and investments that belong to a party or to anything above it.
const lineage = (partyId) => [...api.ancestors(partyId).map((p) => p.id), partyId];
export const contactsFor = (partyId) => lineage(partyId).flatMap((id) => D.contactsOf.get(id) || []).filter((c) => !c.archived_at);
export const agreementsFor = (partyId) => lineage(partyId).flatMap((id) => D.agreementsOf.get(id) || []).filter((a) => !a.archived_at && a.status !== 'cancelled');
const opts = (rows, selected, label) => rows.map((r) => html`<option value="${r.id}" ${r.id === selected ? raw('selected') : ''}>${label(r)}</option>`);

// After a change: re-read what changed, update the badge, redraw the screen the person is on.
export async function afterChange(...names) {
  await api.reload(...names);
  refreshBadges();
  dispatch();
}

// ---- The follow-up block ---------------------------------------------------------------------------------------------------
const CHIPS = [['Tomorrow', 1], ['In 3 days', 3], ['In 1 week', 7], ['In 2 weeks', 14], ['In 1 month', 'month']];
const chipDate = (v) => {
  if (v !== 'month') return addDaysISO(todayStr(), v);
  const d = parseISO(todayStr()); d.setMonth(d.getMonth() + 1); return toISO(d);
};
const REQUIRED = { task: ['fu_title', 'fu_due', 'fu_owner'], none: ['fu_reason', 'fu_comment'] };

// opts: { heading, taskLabel, noneLabel, owner } - the same block serves "log an entry" and "close a task".
export function followupHtml({ heading = 'What happens next?', intro = 'Every entry needs a next step, or a reason why there is none.', taskLabel = 'Revisit: create a follow-up task', noneLabel = 'No follow-up needed', owner = state.user?.id, titleLabel = 'What needs doing?' } = {}) {
  return html`<section class="followup" data-followup>
    <h3>${heading}</h3><p class="hint">${intro}</p>
    <div class="opt"><label><input type="radio" name="fu_mode" value="task" checked> <span>${taskLabel}</span></label>
      <div class="sub-form" data-for="task">
        <div class="field"><span class="label">Revisit</span><div class="chips" role="group" aria-label="Revisit when">${CHIPS.map(([l, v]) => html`<button type="button" class="chip" data-chip="${v}" aria-pressed="false">${l}</button>`)}<button type="button" class="chip" data-chip="pick" aria-pressed="false">Pick a date</button></div></div>
        ${field({ name: 'fu_due', label: 'Revisit on', type: 'date', min: todayStr() })}
        ${field({ name: 'fu_title', label: titleLabel, placeholder: 'e.g. Send the revised proposal' })}
        <div class="field"><label for="f-fu_owner">Who is doing it?</label><select id="f-fu_owner" name="fu_owner">${peopleOptions(owner)}</select></div>
      </div></div>
    <div class="opt"><label><input type="radio" name="fu_mode" value="none"> <span>${noneLabel}</span></label>
      <div class="sub-form" data-for="none" hidden>
        <div class="field"><label for="f-fu_reason">Why?</label><select id="f-fu_reason" name="fu_reason"><option value="">Choose a reason</option>${D.listNames('no_followup_reason').map((n) => html`<option>${n}</option>`)}</select></div>
        ${field({ name: 'fu_comment', label: 'Explain in a sentence', type: 'textarea', rows: 2, hint: 'Required, so anyone reading later knows why it was left.' })}
      </div></div>
  </section>`;
}
// Shows the right half of the block, makes only that half required, and wires the date chips.
export function syncFollowup(scope) {
  const form = scope.querySelector('[data-followup]'); if (!form) return;
  const mode = form.querySelector('input[name="fu_mode"]:checked').value;
  form.querySelectorAll('[data-for]').forEach((s) => { s.hidden = s.dataset.for !== mode; });
  for (const [m, names] of Object.entries(REQUIRED)) for (const n of names) {
    const el = form.querySelector(`[name="${n}"]`); if (el) { el.required = m === mode; if (n === 'fu_comment') el.minLength = m === mode ? 5 : 0; }
  }
}
export function wireFollowup(dlg, extra = {}) {
  dlg.onclick = (e) => {
    const chip = e.target.closest('[data-chip]');
    if (chip) {
      const due = dlg.querySelector('[name="fu_due"]');
      if (chip.dataset.chip === 'pick') { try { due.showPicker?.(); } catch { /* not allowed */ } due.focus(); } else due.value = chipDate(chip.dataset.chip === 'month' ? 'month' : Number(chip.dataset.chip));
      markChips(dlg);
      return;
    }
    for (const [sel, fn] of Object.entries(extra)) { const el = e.target.closest(sel); if (el) { fn(el, e); return; } }
  };
  dlg.onchange = (e) => {
    if (e.target.name === 'fu_mode') syncFollowup(dlg);
    if (e.target.name === 'fu_due') markChips(dlg);
    extra.change?.(e);
  };
  syncFollowup(dlg);
}
function markChips(dlg) {
  const v = dlg.querySelector('[name="fu_due"]')?.value;
  dlg.querySelectorAll('[data-chip]').forEach((c) => {
    const on = c.dataset.chip !== 'pick' ? chipDate(c.dataset.chip === 'month' ? 'month' : Number(c.dataset.chip)) === v : !!v && !CHIPS.some(([, x]) => chipDate(x) === v);
    c.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
}
// Reads the block. Returns what the database functions expect.
export function readFollowup(form) {
  const mode = form.elements.fu_mode.value;
  if (mode === 'task') {
    const title = form.elements.fu_title.value.trim(); const due = form.elements.fu_due.value;
    if (!due) throw new Error('Choose when to revisit this.');
    if (!title) throw new Error('Say what the follow-up is.');
    return { mode: 'task', title, due_on: due, owner_id: form.elements.fu_owner.value };
  }
  const reason = form.elements.fu_reason.value; const comment = form.elements.fu_comment.value.trim();
  if (!reason) throw new Error('Choose why no follow-up is needed.');
  if (comment.length < 5) throw new Error('Explain in a sentence why no follow-up is needed.');
  return { mode: 'none', reason, comment };
}

// ---- Log an entry ------------------------------------------------------------------------------------------------------------
// preset: { party_id, kind, title, occurred_at, contact_id, agreement_id, related_entry_id }
export function openLog(preset = {}) {
  let kind = preset.kind || 'note';
  const partyId = preset.party_id || '';
  const dlg = openModal({
    title: preset.related_entry_id ? 'Record the outcome of a meeting' : 'Log a note, call or meeting', submitLabel: 'Save', wide: true,
    body: html`
      <div class="form-grid">
        <div class="field span-2"><label for="f-party_id">Who is it about? <span class="req" aria-hidden="true">*</span></label>
          <select id="f-party_id" name="party_id" required ${preset.related_entry_id ? raw('disabled') : ''}><option value="">Choose a brand owner or customer</option>${partyOptions(partyId)}</select></div>
        <div class="field span-2"><span class="label">What is it?</span>
          <div class="chips" role="group" aria-label="Kind of entry">${Object.entries(ENTRY_KIND).map(([k, l]) => html`<button type="button" class="chip kind-chip" data-kind="${k}" aria-pressed="${k === kind}">${icon(k)} ${l}</button>`)}</div></div>
        ${field({ name: 'title', label: 'Short title', required: true, span: 2, placeholder: 'e.g. Annual review with Sarah', value: preset.title })}
        ${field({ name: 'body', label: 'Details', type: 'textarea', rows: 4, span: 2 })}
        <div class="field"><label for="f-occurred_at" id="when-label">When</label><input type="datetime-local" id="f-occurred_at" name="occurred_at" value="${toLocalInput(preset.occurred_at)}"><p class="hint" id="when-hint" hidden>A future time puts it in the Diary as a scheduled meeting.</p></div>
        <div class="field" data-only="meeting visit"><label for="f-location">Where</label><input type="text" id="f-location" name="location"></div>
        <div class="field span-2" data-only="meeting visit call"><label for="f-attendees">Who was there</label><input type="text" id="f-attendees" name="attendees" placeholder="Names, separated by commas"></div>
        <div class="field"><label for="f-contact_id">Contact</label><select id="f-contact_id" name="contact_id"></select></div>
        <div class="field"><label for="f-agreement_id">Investment</label><select id="f-agreement_id" name="agreement_id"></select></div>
        <div class="field span-2" data-only="note call email meeting visit"><label class="check"><input type="checkbox" name="is_decision"> <span>This includes a decision</span></label></div>
      </div>
      ${followupHtml({})}`,
    onSubmit: async (form) => {
      const v = readForm(form, [{ name: 'party_id' }, { name: 'title' }, { name: 'body' }, { name: 'location' }, { name: 'attendees' }, { name: 'contact_id' }, { name: 'agreement_id' }]);
      const party = preset.related_entry_id ? D.entryById.get(preset.related_entry_id).party_id : v.party_id;
      if (!party) throw new Error('Choose who this is about.');
      const followup = readFollowup(form);
      const when = fromLocalInput(form.elements.occurred_at.value);
      await api.logEntry({
        party_id: party, kind, title: v.title, body: v.body, occurred_at: when, location: v.location, attendees: v.attendees,
        contact_id: v.contact_id, agreement_id: v.agreement_id, is_decision: kind === 'decision' || form.elements.is_decision.checked,
        meeting_status: kind === 'meeting' ? (new Date(when) > new Date() ? 'scheduled' : 'held') : null, related_entry_id: preset.related_entry_id || null, followup,
      });
      toast(followup.mode === 'task' ? `Saved. Revisit on ${fmtDateShort(followup.due_on)}.` : 'Saved.');
      setTimeout(() => afterChange('entries', 'tasks'), 0);
    },
  });
  const fill = () => {
    const pid = dlg.querySelector('[name="party_id"]').value || (preset.related_entry_id ? D.entryById.get(preset.related_entry_id).party_id : '');
    const cs = pid ? contactsFor(pid) : []; const as = pid ? agreementsFor(pid) : [];
    const curC = dlg.querySelector('[name="contact_id"]').value || preset.contact_id; const curA = dlg.querySelector('[name="agreement_id"]').value || preset.agreement_id;
    dlg.querySelector('[name="contact_id"]').innerHTML = html`<option value="">None</option>${opts(cs, curC, (c) => `${c.name}${c.job_title ? `, ${c.job_title}` : ''}`)}`.s;
    dlg.querySelector('[name="agreement_id"]').innerHTML = html`<option value="">None</option>${opts(as, curA, (a) => a.title)}`.s;
  };
  const showKind = () => {
    dlg.querySelectorAll('.kind-chip').forEach((c) => c.setAttribute('aria-pressed', c.dataset.kind === kind ? 'true' : 'false'));
    dlg.querySelectorAll('[data-only]').forEach((el) => { el.hidden = !el.dataset.only.split(' ').includes(kind); });
    dlg.querySelector('#when-label').textContent = kind === 'meeting' ? 'Meeting date and time' : 'When it happened';
    dlg.querySelector('#when-hint').hidden = kind !== 'meeting';
  };
  wireFollowup(dlg, {
    '.kind-chip': (el) => { kind = el.dataset.kind; showKind(); },
    change: (e) => { if (e.target.name === 'party_id') fill(); },
  });
  fill(); showKind();
  dlg.querySelector('[name="party_id"]').focus();
  return dlg;
}

// ---- Tasks -------------------------------------------------------------------------------------------------------------------
// Record the outcome of a task: choose an outcome, say what happened, then set the next step.
// Only outcomes marked "ends the work" in Settings (such as Resolved) may finish with "nothing more needed".
export function openCompleteTask(task) {
  const outcomes = D.lists.filter((l) => l.list === 'task_outcome' && !l.archived_at);
  const dlg = openModal({
    title: 'Record outcome', submitLabel: 'Save outcome', wide: true,
    body: html`<p><strong>${task.title}</strong>${task.party_id ? html`<br><span class="muted">${api.partyPath(task.party_id)}</span>` : ''}</p>
      <div class="form-grid">
        <div class="field span-2"><label for="f-outcome_code">Outcome <span class="req" aria-hidden="true">*</span></label>
          <select id="f-outcome_code" name="outcome_code" required><option value="">Choose the outcome</option>${outcomes.map((o) => html`<option value="${o.name}" data-ends="${o.ends_work ? 1 : 0}">${o.name}</option>`)}</select></div>
        ${field({ name: 'outcome', label: 'What happened?', type: 'textarea', rows: 3, required: true, span: 2 })}
      </div>
      ${followupHtml({ heading: 'And what is next?', intro: 'Every outcome sets the next step. Only an outcome that ends the work, such as Resolved, can say nothing more is needed.', taskLabel: 'Set the next step', noneLabel: 'Nothing more needed', owner: task.owner_id, titleLabel: 'Next step' })}`,
    onSubmit: async (form) => {
      const code = form.elements.outcome_code.value; const outcome = form.elements.outcome.value.trim();
      if (!code) throw new Error('Choose the outcome.');
      if (outcome.length < 3) throw new Error('Say what happened.');
      const fu = readFollowup(form);
      await api.completeTask({ id: task.id, outcome_code: code, outcome, mode: fu.mode === 'task' ? 'next_task' : 'none', next: fu.mode === 'task' ? { title: fu.title, due_on: fu.due_on, owner_id: fu.owner_id } : null, reason: fu.reason, comment: fu.comment });
      toast(fu.mode === 'task' ? `Outcome recorded. Next step due ${fmtDateShort(fu.due_on)}.` : 'Outcome recorded.');
      setTimeout(() => afterChange('tasks'), 0);
    },
  });
  const none = dlg.querySelector('input[name="fu_mode"][value="none"]');
  const gate = () => {
    const sel = dlg.querySelector('[name="outcome_code"]'); const ends = sel.selectedOptions[0]?.dataset.ends === '1';
    none.disabled = !ends;
    none.closest('label').title = ends ? '' : 'Only an outcome that ends the work (such as Resolved) can finish with nothing more needed.';
    if (!ends && none.checked) dlg.querySelector('input[name="fu_mode"][value="task"]').checked = true;
    syncFollowup(dlg);
  };
  wireFollowup(dlg, { change: (e) => { if (e.target.name === 'outcome_code') gate(); } });
  gate();
}

// Add a task, or change one that is open. Moving the date needs a reason, which is counted.
export function openTaskForm(task = null, preset = {}) {
  const t = task || { owner_id: state.user?.id, due_on: addDaysISO(todayStr(), 7), ...preset };
  const dlg = openModal({
    title: task ? 'Change task' : 'Add a task', submitLabel: 'Save task', wide: true,
    body: html`<div class="form-grid">
      ${field({ name: 'title', label: 'What needs doing?', required: true, span: 2, value: t.title })}
      ${field({ name: 'details', label: 'Details', type: 'textarea', rows: 3, span: 2, value: t.details })}
      <div class="field"><label for="f-due_on">Due <span class="req" aria-hidden="true">*</span></label><input type="date" id="f-due_on" name="due_on" required min="${todayStr()}" value="${t.due_on}"></div>
      <div class="field"><label for="f-owner_id">Who is it for?</label><select id="f-owner_id" name="owner_id">${peopleOptions(t.owner_id)}</select></div>
      <div class="field span-2" id="resched" hidden><label for="f-reschedule_reason">Why is the date moving? <span class="req" aria-hidden="true">*</span></label><input type="text" id="f-reschedule_reason" name="reschedule_reason" placeholder="e.g. Waiting for their answer">${task?.reschedule_count ? html`<p class="hint">Already moved ${task.reschedule_count} ${task.reschedule_count === 1 ? 'time' : 'times'}.</p>` : ''}</div>
      <div class="field"><label for="f-category">Category</label><select id="f-category" name="category"><option value="">None</option>${[...new Set([...D.listNames('task_category'), ...(t.category ? [t.category] : [])])].map((c) => html`<option ${c === t.category ? raw('selected') : ''}>${c}</option>`)}</select></div>
      <div class="field span-2"><label for="f-party_id">About</label><select id="f-party_id" name="party_id"><option value="">Nobody in particular</option>${partyOptions(t.party_id)}</select></div>
    </div>`,
    onSubmit: async (form) => {
      const v = readForm(form, [{ name: 'title' }, { name: 'details' }, { name: 'due_on' }, { name: 'owner_id' }, { name: 'party_id' }, { name: 'category' }, { name: 'reschedule_reason' }]);
      const moved = task && v.due_on !== task.due_on;
      if (moved && (v.reschedule_reason || '').length < 3) throw new Error('Say why the date is moving.');
      await api.saveTask({ id: task?.id, ...v, contact_id: task?.contact_id, agreement_id: task?.agreement_id });
      toast('Task saved.');
      setTimeout(() => afterChange('tasks'), 0);
    },
  });
  dlg.onchange = (e) => { if (task && e.target.name === 'due_on') dlg.querySelector('#resched').hidden = e.target.value === task.due_on; };
  if (task && task.party_id) dlg.querySelector('[name="party_id"]').disabled = true;
}

export function openCancelTask(task) {
  openModal({
    title: 'Cancel this task?', submitLabel: 'Cancel task', danger: true,
    body: html`<p><strong>${task.title}</strong></p>${field({ name: 'reason', label: 'Why is it being cancelled?', type: 'textarea', rows: 2, required: true, hint: 'Cancelled tasks are kept, with this reason.' })}`,
    onSubmit: async (form) => {
      const reason = form.elements.reason.value.trim();
      if (reason.length < 5) throw new Error('Explain why the task is being cancelled.');
      await api.cancelTask(task.id, reason);
      toast('Task cancelled.');
      setTimeout(() => afterChange('tasks'), 0);
    },
  });
}
export { closeModal };
