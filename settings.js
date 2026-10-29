// Settings (superuser only): users and access, the lists used in drop-downs, and the date format.
import * as api from './api.js';
import { CONFIG } from './config.js';
import { state, can, ROLE_LABEL, ROLE_HINT, ROLE_ORDER, ACCESS_SUMMARY, MEMBER_STATUS_LABEL } from './state.js';
import { html, mount, on, openModal, fieldsHtml, readForm, toast, loadingHtml, emptyHtml, fmtDateShort, formatDate, DATE_FORMATS, getDateFormat, setDateFormat } from './ui.js';

const SECTIONS = [['set-users', 'Users and access'], ['set-lists', 'Lists'], ['set-dates', 'Date format']];
const LISTS = [['investment_kind', 'Kinds of investment', 'Offered when adding an investment.'], ['no_followup_reason', 'Reasons for no follow-up', 'Offered when someone chooses "No follow-up needed" or closes a task with nothing more to do.']];

export async function settingsView(main) {
  if (!can.configure) { mount(main, html`<header class="page-head"><h1>Settings</h1></header>${emptyHtml("You don't have access to settings", 'Only the superuser can change settings.')}`); return; }
  mount(main, html`<header class="page-head"><h1>Settings</h1></header>${loadingHtml()}`);
  const load = () => Promise.all([api.listMembers(), api.listInvitations()]);
  let [members, invites] = await load();
  let listItems = api.D.lists;
  let showRemoved = false;
  function draw() {
    mount(main, html`
      <header class="page-head"><h1>Settings</h1></header>
      <p class="jump"><span class="muted">Go to:</span> ${SECTIONS.map(([id, label]) => html`<button type="button" class="link" data-action="jump" data-to="${id}">${label}</button>`)}</p>
      <section class="settings-block" id="set-users">
        <div class="section-head"><h2>Users and access</h2><button class="btn btn-primary" data-action="invite">Invite user</button></div>
        <p class="muted">Who can sign in to ${state.org.name} and what they are allowed to do. Nobody is ever deleted: a suspended user can be reinstated, and a removed user is kept so the audit log stays complete and must be invited again to come back.</p>
        ${members.some((m) => m.status === 'removed') ? html`<p><label class="check small"><input type="checkbox" id="show-removed" ${showRemoved ? 'checked' : ''}> <span>Show removed users (${members.filter((m) => m.status === 'removed').length})</span></label></p>` : ''}
        <table class="grid"><thead><tr><th>Email</th><th>User type</th><th>Status</th><th></th></tr></thead><tbody>
          ${members.filter((m) => showRemoved || m.status !== 'removed').map((m) => { const me = m.user_id === state.user?.id; return html`<tr class="${m.status === 'active' ? '' : 'row-off'}">
            <td data-label="Email"><strong>${m.email || 'Unknown'}</strong>${me ? html` <span class="tag">You</span>` : ''}</td>
            <td data-label="User type">${ROLE_LABEL[m.role] || m.role}</td>
            <td data-label="Status">${m.status === 'active' ? 'Active' : html`<span class="${m.status === 'disabled' ? 'c-soon' : 'muted'}">${MEMBER_STATUS_LABEL[m.status] || m.status} ${fmtDateShort(m.updated_at)}</span>`}</td>
            <td class="act">${me ? html`<span class="muted">You cannot change your own access</span>`
              : m.status === 'active' ? html`<button class="btn btn-sm" data-action="member-type" data-id="${m.id}">Change type</button> <button class="btn btn-sm" data-action="member-suspend" data-id="${m.id}">Suspend</button> <button class="btn btn-sm" data-action="member-remove" data-id="${m.id}">Remove</button>`
                : m.status === 'disabled' ? html`<button class="btn btn-sm" data-action="member-reinstate" data-id="${m.id}">Reinstate</button> <button class="btn btn-sm" data-action="member-remove" data-id="${m.id}">Remove</button>`
                  : invites.some((i) => i.email === m.email.toLowerCase()) ? html`<span class="muted">Invited again</span>` : html`<button class="btn btn-sm" data-action="member-invite" data-id="${m.id}">Invite again</button>`}</td></tr>`; })}
          ${invites.map((i) => { const expired = new Date(i.expires_at) < new Date(); return html`<tr>
            <td data-label="Email">${i.email}</td>
            <td data-label="User type">${ROLE_LABEL[i.role] || i.role}</td>
            <td data-label="Status">${expired ? html`<span class="c-overdue">Invitation expired ${fmtDateShort(i.expires_at)}</span>` : html`Invited, link works until ${fmtDateShort(i.expires_at)}`}</td>
            <td class="act">${expired ? html`<button class="btn btn-sm" data-action="reinvite" data-id="${i.id}">Invite again</button>` : html`<button class="btn btn-sm" data-action="link" data-id="${i.id}">Show link</button>`}
              <button class="btn btn-sm" data-action="revoke" data-id="${i.id}">Revoke</button></td></tr>`; })}
        </tbody></table>
        <details class="access-summary"><summary>Who can do what</summary>
          <p class="muted">What each user type can do. These rules are fixed and are enforced by the database, not just by the screens.</p>
          <div class="scroll"><table class="grid keep compact access-table"><thead><tr><th>Area</th>${ROLE_ORDER.map((r) => html`<th>${ROLE_LABEL[r]}</th>`)}</tr></thead><tbody>
            ${ACCESS_SUMMARY.map(([area, levels]) => html`<tr><td>${area}</td>${levels.map((l) => html`<td><span class="lvl lvl-${l.toLowerCase()}">${l}</span></td>`)}</tr>`)}
          </tbody></table></div>
          <p class="hint">Full: see, add and change. View: see only. None: not shown at all.</p>
        </details>
      </section>
      <section class="settings-block" id="set-lists">
        <div class="section-head"><h2>Lists</h2></div>
        <p class="muted">The choices offered in drop-down boxes. Items are never deleted: archive one to stop it being offered. Anything already recorded keeps its wording.</p>
        ${LISTS.map(([key, title, hint]) => html`<h3>${title}</h3><p class="muted-small">${hint}</p>
          <table class="grid keep compact"><tbody>${listItems.filter((i) => i.list === key).map((i) => html`<tr class="${i.archived_at ? 'row-off' : ''}"><td>${i.name}${i.archived_at ? html` <span class="tag">Archived</span>` : ''}</td>
            <td class="act"><button class="btn btn-sm" data-action="li-rename" data-id="${i.id}">Rename</button> <button class="btn btn-sm" data-action="li-toggle" data-id="${i.id}">${i.archived_at ? 'Restore' : 'Archive'}</button></td></tr>`)}</tbody></table>
          <p><button class="btn btn-sm" data-action="li-add" data-list="${key}">Add to this list</button></p>`)}
      </section>
      <section class="settings-block" id="set-dates">
        <div class="section-head"><h2>Date format</h2></div>
        <p class="muted">How dates are shown on every screen and in downloaded reports, for everyone in ${state.org.name}. Boxes where you pick a date follow each person's own browser settings.</p>
        <form id="date-form" class="inline-form">
          <div class="field"><label for="date-format">Format</label><select id="date-format" name="date_format">${DATE_FORMATS.map(([k]) => html`<option value="${k}" ${k === getDateFormat() ? 'selected' : ''}>${formatDate(new Date(), k)} (${k})</option>`)}</select></div>
          <button class="btn btn-primary" type="submit">Save date format</button>
        </form>
      </section>
`);
    main.querySelector('#show-removed')?.addEventListener('change', (e) => { showRemoved = e.target.checked; draw(); });
    main.querySelector('#date-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = e.target.querySelector('button'); btn.disabled = true;
      try { const f = e.target.elements.date_format.value; await api.saveOrgSettings({ date_format: f }); setDateFormat(f); toast('Date format saved.'); draw(); }
      catch (ex) { toast(ex.message || 'Could not save.', 'error'); btn.disabled = false; }
    });
  }

  // ---- Users and invitations ----
  const ROLES = ROLE_ORDER;
  const roleHints = () => html`<dl class="role-hints">${ROLES.map((r) => html`<div><dt>${ROLE_LABEL[r]}</dt><dd>${ROLE_HINT[r]}</dd></div>`)}</dl>`;
  const memberBy = (el) => members.find((m) => m.id === el.dataset.id);
  // Change a person's user type. Their own access is never changed from here, so a superuser cannot lock themselves out.
  function memberTypeModal(m) {
    const fields = [{ name: 'role', label: 'User type', type: 'select', required: true, span: 2, options: ROLES.map((r) => [r, ROLE_LABEL[r]]) }];
    openModal({
      title: `Change user type: ${m.email}`, submitLabel: 'Save user type', body: html`${fieldsHtml(fields, { role: m.role })}${roleHints()}`,
      onSubmit: async (f) => {
        const v = readForm(f, fields);
        if (!ROLES.includes(v.role)) throw new Error('Choose a user type.');
        if (v.role !== m.role) { await api.updateMember(m.id, { role: v.role }); toast(`${m.email} is now ${ROLE_LABEL[v.role]}.`); }
        await reload();
      },
    });
  }
  // Suspend, reinstate or remove. Each asks first and says exactly what will happen.
  function memberStatusModal(m, status) {
    const text = {
      disabled: { title: `Suspend ${m.email}?`, button: 'Suspend user', done: 'suspended', body: 'They will not be able to open this organisation until you reinstate them. Their user type and everything they have done are kept.' },
      active: { title: `Reinstate ${m.email}?`, button: 'Reinstate user', done: 'reinstated', body: html`They will be able to sign in again as <strong>${ROLE_LABEL[m.role]}</strong>.` },
      removed: { title: `Remove ${m.email}?`, button: 'Remove user', done: 'removed', body: 'Use this when someone has left. They lose access straight away. Their record and everything they did stay in the audit log. If they come back, invite them again with the same email address.' },
    }[status];
    openModal({
      title: text.title, submitLabel: text.button, danger: status !== 'active', body: html`<p>${text.body}</p>`,
      onSubmit: async () => { await api.updateMember(m.id, { status }); toast(`${m.email} ${text.done}.`); await reload(); },
    });
  }
  const inviteLink = (i) => `${location.origin}${location.pathname}?invite=${i.token}`;
  // The app does not send email itself: the superuser copies the link, or opens their own mail app with it written out.
  function showInvite(i) {
    const link = inviteLink(i);
    const subject = `Your invitation to the ${state.org.name} ${CONFIG.appName} system`;
    const body = `Hello,\n\nYou have been invited to the ${state.org.name} ${CONFIG.appName} system as ${ROLE_LABEL[i.role]}.\n\nOpen this link and create your account with this email address (${i.email}):\n${link}\n\nThe link works until ${fmtDateShort(i.expires_at)}.`;
    const dlg = openModal({
      title: 'Invitation ready', hideFooter: true,
      body: html`<p>Send this link to <strong>${i.email}</strong>. They create an account with that email address and join as <strong>${ROLE_LABEL[i.role]}</strong>. The link works until ${fmtDateShort(i.expires_at)}.</p>
        <div class="field"><label for="invite-link">Invitation link</label><input type="text" id="invite-link" readonly value="${link}"></div>
        <p class="invite-actions"><button type="button" class="btn btn-primary" data-copy>Copy link</button>
          <a class="btn" href="mailto:${i.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}">Email it</a></p>
        <p class="hint">${CONFIG.appName} does not send the email itself. "Email it" opens your own mail app with the message written for you.</p>`,
    });
    const box = dlg.querySelector('#invite-link');
    box.addEventListener('focus', () => box.select());
    dlg.querySelector('[data-copy]').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(link); } catch { box.select(); document.execCommand?.('copy'); }
      toast('Link copied.');
    });
  }
  function inviteModal(preset = {}) {
    const fields = [
      { name: 'email', label: 'Email address', type: 'email', required: true, span: 2, autocomplete: 'off', hint: 'They must create their account with this exact address.' },
      { name: 'role', label: 'User type', type: 'select', required: true, span: 2, options: ROLES.map((r) => [r, ROLE_LABEL[r]]) },
    ];
    const dlg = openModal({
      title: 'Invite user', submitLabel: 'Create invitation',
      body: html`${fieldsHtml(fields, preset)}${roleHints()}`,
      onSubmit: async (f) => {
        const v = readForm(f, fields);
        const email = String(v.email || '').toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Enter a full email address.');
        if (!ROLES.includes(v.role)) throw new Error('Choose a user type.');
        const existing = members.find((m) => m.email.toLowerCase() === email);
        if (existing?.status === 'active') throw new Error('That person is already a user here.');
        if (existing?.status === 'disabled') throw new Error('That person is suspended. Reinstate them from the list instead.');
        const inv = await api.createInvitation({ email, role: v.role });
        dlg.addEventListener('close', () => showInvite(inv), { once: true });   // show the link once this dialog has closed
        await reload();
      },
    });
  }
  const reload = async () => { [members, invites] = await load(); await api.reload('lists'); listItems = api.D.lists; draw(); };
  draw();
  on(main, {
    jump: (el) => main.querySelector(`#${el.dataset.to}`)?.scrollIntoView?.({ behavior: 'smooth', block: 'start' }),
    invite: () => inviteModal(),
    'li-add': (el) => openModal({ title: 'Add to the list', submitLabel: 'Add', body: fieldsHtml([{ name: 'name', label: 'Name', required: true, span: 2 }]),
      onSubmit: async (f) => { const name = f.elements.name.value.trim(); if (!name) throw new Error('Enter a name.'); const max = Math.max(0, ...listItems.filter((i) => i.list === el.dataset.list).map((i) => i.sort_order)); await api.saveListItem({ list: el.dataset.list, name, sort_order: max + 10 }); toast('Added.'); await reload(); } }),
    'li-rename': (el) => { const i = listItems.find((x) => x.id === el.dataset.id); openModal({ title: 'Rename', submitLabel: 'Save', body: fieldsHtml([{ name: 'name', label: 'Name', required: true, span: 2 }], { name: i.name }),
      onSubmit: async (f) => { const name = f.elements.name.value.trim(); if (!name) throw new Error('Enter a name.'); await api.saveListItem({ name }, i.id); toast('Saved.'); await reload(); } }); },
    'li-toggle': async (el) => { const i = listItems.find((x) => x.id === el.dataset.id); try { await api.saveListItem({ archived_at: i.archived_at ? null : new Date().toISOString() }, i.id); await reload(); } catch (e) { toast(e.message, 'error'); } },
    'member-type': (el) => memberTypeModal(memberBy(el)),
    'member-suspend': (el) => memberStatusModal(memberBy(el), 'disabled'),
    'member-reinstate': (el) => memberStatusModal(memberBy(el), 'active'),
    'member-remove': (el) => memberStatusModal(memberBy(el), 'removed'),
    'member-invite': (el) => { const m = memberBy(el); inviteModal({ email: m.email, role: m.role }); },
    reinvite: (el) => { const i = invites.find((x) => x.id === el.dataset.id); inviteModal({ email: i.email, role: i.role }); },
    link: (el) => showInvite(invites.find((x) => x.id === el.dataset.id)),
    revoke: (el) => {
      const i = invites.find((x) => x.id === el.dataset.id);
      openModal({
        title: 'Revoke this invitation?', submitLabel: 'Revoke invitation', danger: true,
        body: html`<p>The link sent to <strong>${i.email}</strong> will stop working. You can invite them again later.</p>`,
        onSubmit: async () => { await api.revokeInvitation(i.id); toast('Invitation revoked.'); await reload(); },
      });
    },
  });
}
