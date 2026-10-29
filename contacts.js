// Contacts: the people at brand owners and customers. Key contacts are flagged.
import * as api from './api.js';
import { D } from './api.js';
import { can } from './state.js';
import { partyOptions, afterChange } from './logentry.js';
import { html, raw, mount, on, openModal, field, readForm, toast, emptyHtml, plural } from './ui.js';

const sideLink = (id) => `#/${D.partyById.get(id)?.side === 'brand' ? 'brands' : 'customers'}/${id}`;

export function openContactForm(contact = null, preset = {}) {
  const c = contact || preset;
  const specs = [{ name: 'name' }, { name: 'job_title' }, { name: 'email' }, { name: 'phone' }, { name: 'mobile' }, { name: 'is_key', type: 'checkbox' }, { name: 'notes' }];
  openModal({
    title: contact ? 'Change contact' : 'Add a contact', submitLabel: 'Save contact', wide: true,
    body: html`<div class="form-grid">
      <div class="field span-2"><label for="f-party_id">Works for <span class="req" aria-hidden="true">*</span></label><select id="f-party_id" name="party_id" required ${contact ? raw('disabled') : ''}><option value="">Choose</option>${partyOptions(c.party_id)}</select></div>
      ${field({ name: 'name', label: 'Name', required: true, value: c.name })}
      ${field({ name: 'job_title', label: 'Job title', value: c.job_title })}
      ${field({ name: 'email', label: 'Email', type: 'email', value: c.email })}
      ${field({ name: 'phone', label: 'Phone', type: 'tel', value: c.phone })}
      ${field({ name: 'mobile', label: 'Mobile', type: 'tel', value: c.mobile })}
      ${field({ name: 'is_key', label: 'Key contact', type: 'checkbox', value: c.is_key })}
      ${field({ name: 'notes', label: 'Notes', type: 'textarea', rows: 3, span: 2, value: c.notes })}
    </div>`,
    onSubmit: async (form) => {
      const v = readForm(form, specs);
      if (!v.name) throw new Error('Enter a name.');
      if (contact) await api.saveContact(v, contact.id);
      else { const party = form.elements.party_id.value; if (!party) throw new Error('Choose who they work for.'); await api.saveContact({ ...v, party_id: party }); }
      toast('Contact saved.');
      setTimeout(() => afterChange('contacts'), 0);
    },
  });
}
export function archiveContact(contact) {
  openModal({
    title: `Archive ${contact.name}?`, submitLabel: 'Archive', danger: true,
    body: html`<p>${contact.name} will no longer be offered when logging notes. Their past notes and meetings stay as they are.</p>`,
    onSubmit: async () => { await api.saveContact({ archived_at: new Date().toISOString() }, contact.id); toast('Archived.'); setTimeout(() => afterChange('contacts'), 0); },
  });
}
export function contactsTable(rows, { showParty = false } = {}) {
  return html`<table class="grid"><thead><tr><th>Name</th>${showParty ? html`<th>Works for</th>` : ''}<th>Job title</th><th>Email</th><th>Phone</th><th></th></tr></thead><tbody>
    ${rows.map((c) => html`<tr>
      <td data-label="Name"><strong>${c.name}</strong> ${c.is_key ? html`<span class="tag">Key</span>` : ''}${c.notes ? html`<div class="sub">${c.notes}</div>` : ''}</td>
      ${showParty ? html`<td data-label="Works for"><a href="${sideLink(c.party_id)}">${api.partyPath(c.party_id)}</a></td>` : ''}
      <td data-label="Job title">${c.job_title || ''}</td>
      <td data-label="Email">${c.email ? html`<a href="mailto:${c.email}">${c.email}</a>` : ''}</td>
      <td data-label="Phone">${c.phone ? html`<a href="tel:${c.phone}">${c.phone}</a>` : ''}${c.mobile ? html`<div class="sub"><a href="tel:${c.mobile}">${c.mobile}</a> mobile</div>` : ''}</td>
      <td class="act">${can.write ? html`<button class="btn btn-sm" data-action="c-edit" data-id="${c.id}">Change</button> <button class="btn btn-sm" data-action="c-archive" data-id="${c.id}">Archive</button>` : ''}</td></tr>`)}
  </tbody></table>`;
}
export const contactHandlers = { 'c-edit': (el) => openContactForm(D.contactById.get(el.dataset.id)), 'c-archive': (el) => archiveContact(D.contactById.get(el.dataset.id)) };

export async function contactsView(main) {
  const ui = { q: '', side: '', key: false };
  const draw = () => {
    const q = ui.q.toLowerCase();
    const rows = D.contacts.filter((c) => !c.archived_at && (!ui.side || D.partyById.get(c.party_id)?.side === ui.side) && (!ui.key || c.is_key)
      && (!q || [c.name, c.job_title, c.email, api.partyPath(c.party_id)].join(' ').toLowerCase().includes(q)))
      .sort((a, b) => api.partyPath(a.party_id).localeCompare(api.partyPath(b.party_id)) || a.name.localeCompare(b.name));
    mount(main, html`
      <header class="page-head"><h1>Contacts</h1>${can.write ? html`<div class="head-actions"><button class="btn btn-primary" data-action="c-add">Add a contact</button></div>` : ''}</header>
      <form class="filters" id="c-filters" onsubmit="return false">
        <div class="field"><label for="c-q">Search</label><input id="c-q" type="search" value="${ui.q}" placeholder="Name, company, email"></div>
        <div class="field"><label for="c-side">Side</label><select id="c-side"><option value="">Both</option><option value="brand" ${ui.side === 'brand' ? 'selected' : ''}>Brand owners</option><option value="customer" ${ui.side === 'customer' ? 'selected' : ''}>Customers</option></select></div>
        <div class="field"><label class="check"><input type="checkbox" id="c-key" ${ui.key ? 'checked' : ''}> <span>Key contacts only</span></label></div>
      </form>
      <p class="muted-small">${plural(rows.length, 'contact')}</p>
      ${rows.length ? contactsTable(rows, { showParty: true }) : emptyHtml('No contacts found', 'Add the people you deal with, or clear the filters.')}`);
    const f = main.querySelector('#c-filters');
    const q$ = f.querySelector('#c-q');
    q$.oninput = () => { ui.q = q$.value; const pos = q$.selectionStart; draw(); const n = main.querySelector('#c-q'); n.focus(); n.setSelectionRange(pos, pos); };
    f.querySelector('#c-side').onchange = (e) => { ui.side = e.target.value; draw(); };
    f.querySelector('#c-key').onchange = (e) => { ui.key = e.target.checked; draw(); };
    on(main, { 'c-add': () => openContactForm(), ...contactHandlers });
  };
  draw();
}
