// Investments: one type, with a kind. Brand side = money in (support from the brand owner); customer side = money out (investment in a pub or group).
// Each has payments, volume targets (no actual volumes held here) and reviews, where a shortfall is recorded by hand.
import * as api from './api.js';
import { D } from './api.js';
import { state, can, SIDE, NODE_LABEL, AGREEMENT_STATUS, REVIEW_STATUS, SHORTFALL_OUTCOME, PAYOUT_FREQ, ACCRUAL_FREQ } from './state.js';
import { partyOptions, peopleOptions, afterChange, openLog, contactsFor } from './logentry.js';
import { html, raw, mount, on, openModal, field, readForm, toast, pill, facts, emptyHtml, fmtMoney, fmtMoneyShort, fmtInt, fmtDateShort, fmtDateTime, fmtDayTime, todayStr, download, plural, daysBetween, parseISO } from './ui.js';
import { auditTable } from './audit.js';
import { setSection } from './shell.js';

const sideOf = (a) => D.partyById.get(a.party_id)?.side;
const route = (side) => (side === 'brand' ? 'brands' : 'customers');
const moneyOf = (n) => { const x = Number(n || 0); return Number.isInteger(x) ? fmtMoneyShort(x) : fmtMoney(x); };
export const liveComponents = (a) => (D.componentsOf.get(a.id) || []).filter((c) => !c.archived_at);
// The money in a deal is the sum of its components.
export const amountText = (a) => {
  const cs = liveComponents(a); if (!cs.length) return 'No components yet';
  const sum = (b) => cs.filter((c) => c.amount_basis === b).reduce((t, c) => t + Number(c.amount || 0), 0);
  const parts = []; if (sum('per_year')) parts.push(`${moneyOf(sum('per_year'))} a year`); if (sum('total')) parts.push(`${moneyOf(sum('total'))} in total`);
  return parts.length ? parts.join(' + ') : 'Amount not set';
};
// How long a deal runs: the typed-in length, or worked out from the start and end dates.
export function lengthText(a) {
  if (!a.start_on || !a.end_on) return a.start_on ? 'Open ended' : 'Not set';
  const s = parseISO(a.start_on); const e = parseISO(a.end_on); e.setDate(e.getDate() + 1);
  const m = (e.getFullYear() - s.getFullYear()) * 12 + e.getMonth() - s.getMonth();
  if (e.getDate() === s.getDate() && m > 0) return m % 12 === 0 ? plural(m / 12, 'year') : plural(m, 'month');
  return plural(daysBetween(a.start_on, a.end_on) + 1, 'day');
}
const period = (a) => (a.start_on || a.end_on ? `${a.start_on ? fmtDateShort(a.start_on) : '?'} to ${a.end_on ? fmtDateShort(a.end_on) : 'open ended'}` : 'No dates set');
const money = (n) => { const x = Number(n || 0); return Number.isInteger(x) ? fmtMoneyShort(x) : fmtMoney(x); };
const archive = (table) => (id) => table({ archived_at: new Date().toISOString() }, id);

// ---- Forms ---------------------------------------------------------------------------------------------------------------------
export function openAgreementForm(agreement = null, preset = {}) {
  const a = agreement || { status: 'proposed', length_mode: 'dates', owner_id: state.user.id, ...preset };
  const years = a.term_months && a.term_months % 12 === 0;
  const dlg = openModal({
    title: agreement ? 'Change deal' : 'Add a deal', submitLabel: 'Save deal', wide: true,
    body: html`<p class="muted">A deal holds one or more components (listing fee, retro / rebate, marketing support, customer investment, new business ...). ${agreement ? '' : 'Add the components on the next screen.'}</p><div class="form-grid">
      <div class="field span-2"><label for="f-party_id">With <span class="req" aria-hidden="true">*</span></label><select id="f-party_id" name="party_id" required ${agreement ? raw('disabled') : ''}><option value="">Choose a brand owner or customer</option>${partyOptions(a.party_id)}</select></div>
      ${field({ name: 'title', label: 'Title', required: true, span: 2, value: a.title, placeholder: 'e.g. Carling 2026 to 2028 agreement' })}
      ${field({ name: 'status', label: 'Status', type: 'select', required: true, options: Object.entries(AGREEMENT_STATUS), value: a.status, hint: 'Payments, accruals and reminders count once a deal is agreed or live.' })}
      ${field({ name: 'agreed_on', label: 'Date of agreement', type: 'date', value: a.agreed_on })}
      ${field({ name: 'start_on', label: 'Starts', type: 'date', value: a.start_on })}
      ${field({ name: 'length_mode', label: 'Length of deal', type: 'select', required: true, options: [['dates', 'Set by start and end dates'], ['term', 'A number of months or years from the start']], value: a.length_mode })}
      <div class="field" id="len-dates" ${a.length_mode === 'term' ? raw('hidden') : ''}><label for="f-end_on">Ends</label><input type="date" id="f-end_on" name="end_on" value="${a.length_mode === 'term' ? '' : a.end_on || ''}"><p class="hint">Reminders are created 90, 60 and 30 days before the renewal date, or the end date if there is none.</p></div>
      <div class="field" id="len-term" ${a.length_mode === 'term' ? '' : raw('hidden')}><label for="f-term_value">How long</label><div class="inline-form"><input type="number" min="1" step="1" id="f-term_value" name="term_value" value="${a.term_months ? (years ? a.term_months / 12 : a.term_months) : ''}"> <select id="f-term_unit" name="term_unit"><option value="months" ${years ? '' : raw('selected')}>months</option><option value="years" ${years ? raw('selected') : ''}>years</option></select></div><p class="hint" id="len-calc">${a.length_mode === 'term' && a.end_on ? `Ends ${fmtDateShort(a.end_on)}` : 'The end date is worked out from the start date.'}</p></div>
      ${field({ name: 'renewal_on', label: 'Renewal date', type: 'date', value: a.renewal_on, hint: 'Optional. If blank, the end date is used.' })}
      <div class="field"><label for="f-owner_id">Looked after by</label><select id="f-owner_id" name="owner_id"><option value="">Not set</option>${peopleOptions(a.owner_id)}</select></div>
      ${field({ name: 'end_action', label: 'What happens at the end', value: a.end_action, placeholder: 'e.g. Renew, review, claw back unspent', span: 2 })}
      ${field({ name: 'has_exclusivity', label: 'Includes exclusivity', type: 'checkbox', span: 2, value: a.has_exclusivity })}
      <div class="span-2 form-grid" id="excl" ${a.has_exclusivity ? '' : raw('hidden')}>
        ${field({ name: 'exclusivity_detail', label: 'What is exclusive', value: a.exclusivity_detail, placeholder: 'e.g. Only Carling lager on the bar' })}
        ${field({ name: 'exclusivity_ends_on', label: 'Exclusivity ends', type: 'date', value: a.exclusivity_ends_on })}
      </div>
      ${field({ name: 'notes', label: 'Notes', type: 'textarea', rows: 3, span: 2, value: a.notes })}
    </div>`,
    onSubmit: async (form) => {
      const v = readForm(form, [{ name: 'title' }, { name: 'status' }, { name: 'agreed_on' }, { name: 'start_on' }, { name: 'length_mode' }, { name: 'end_on' }, { name: 'term_value', type: 'number' }, { name: 'term_unit' }, { name: 'renewal_on' }, { name: 'owner_id' }, { name: 'end_action' }, { name: 'has_exclusivity', type: 'checkbox' }, { name: 'exclusivity_detail' }, { name: 'exclusivity_ends_on' }, { name: 'notes' }]);
      if (v.length_mode === 'term') {
        if (!v.start_on) throw new Error('Enter the start date: the length runs from it.');
        if (!v.term_value || v.term_value < 1) throw new Error('Say how many months or years the deal runs.');
        v.term_months = Math.round(v.term_value) * (v.term_unit === 'years' ? 12 : 1); v.end_on = null;
      } else { v.term_months = null; if (v.start_on && v.end_on && v.end_on < v.start_on) throw new Error('The end date is before the start date.'); }
      delete v.term_value; delete v.term_unit;
      if (v.renewal_on && v.agreed_on && v.renewal_on < v.agreed_on) throw new Error('The renewal date is before the date of agreement.');
      if (!v.has_exclusivity) { v.exclusivity_detail = null; v.exclusivity_ends_on = null; }
      let id = agreement?.id;
      if (agreement) await api.saveAgreement(v, id);
      else { const party = form.elements.party_id.value; if (!party) throw new Error('Choose who the deal is with.'); id = (await api.saveAgreement({ ...v, party_id: party })).id; }
      toast('Deal saved.');
      setTimeout(async () => {
        if (agreement) { await afterChange('agreements'); return; }
        await api.reload('agreements'); location.hash = `#/investments/${id}`;
        setTimeout(() => { const created = D.agreementById.get(id); if (created) openComponentForm(created); }, 500);
      }, 0);
      return id;
    },
  });
  const calc = () => {
    const mode = dlg.querySelector('[name="length_mode"]').value; dlg.querySelector('#len-dates').hidden = mode === 'term'; dlg.querySelector('#len-term').hidden = mode !== 'term';
    const start = dlg.querySelector('[name="start_on"]').value; const n = Number(dlg.querySelector('[name="term_value"]').value); const unit = dlg.querySelector('[name="term_unit"]').value;
    const out = dlg.querySelector('#len-calc'); if (!out) return;
    if (mode === 'term' && start && n > 0) { const d = parseISO(start); d.setMonth(d.getMonth() + Math.round(n) * (unit === 'years' ? 12 : 1)); d.setDate(d.getDate() - 1); out.textContent = `Ends ${fmtDateShort(d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'))}`; }
    else out.textContent = 'The end date is worked out from the start date.';
  };
  dlg.onchange = (e) => { if (e.target.name === 'has_exclusivity') dlg.querySelector('#excl').hidden = !e.target.checked; calc(); };
  dlg.oninput = calc;
}

// ---- Components: the parts of a deal ------------------------------------------------------------------------------------------
export function openComponentForm(agreement, component = null) {
  const kinds = D.listNames('investment_kind'); if (component?.kind && !kinds.includes(component.kind)) kinds.push(component.kind);
  const c = component || { amount_basis: 'per_year', payout_frequency: 'quarterly', accrual_frequency: 'monthly' };
  const made = component ? (D.paymentsOf.get(agreement.id) || []).filter((p) => p.component_id === component.id && p.status === 'done' && !p.archived_at).length : 0;
  const dlg = openModal({
    title: component ? 'Change component' : 'Add a component', submitLabel: 'Save component', wide: true,
    body: html`<p class="muted">One part of the deal, for example a listing fee, a retro (an amount paid for hitting volume targets, the same as a rebate), marketing support, customer investment or new business.</p>${made ? html`<p class="notice">${plural(made, 'payment')} already marked ${SIDE[sideOf(agreement)].paid.toLowerCase()} will be kept as they are. If you change the amount or frequency, only the payments still to come are re-planned, so check the total.</p>` : ''}<div class="form-grid">
      ${field({ name: 'kind', label: 'Kind', type: 'select', required: true, options: kinds, value: c.kind })}
      ${field({ name: 'description', label: 'Description', value: c.description, placeholder: 'e.g. Retro on 500 kegs a quarter' })}
      ${field({ name: 'amount', label: 'Amount (£)', type: 'number', step: '0.01', min: 0, value: c.amount })}
      ${field({ name: 'amount_basis', label: 'Amount is', type: 'select', required: true, options: [['per_year', 'Per year'], ['total', 'In total, over the deal']], value: c.amount_basis })}
      ${field({ name: 'payout_frequency', label: 'How often it is paid out', type: 'select', required: true, options: Object.entries(PAYOUT_FREQ), value: c.payout_frequency, hint: 'A payment, with its own reminder task, is created for every date. Needs a start date and an agreed or live deal.' })}
      ${field({ name: 'first_payout_on', label: 'First payment due', type: 'date', value: c.first_payout_on, hint: 'Blank: the start date of the deal.' })}
      ${field({ name: 'accrual_frequency', label: 'How often it is accrued', type: 'select', required: true, options: Object.entries(ACCRUAL_FREQ), value: c.accrual_frequency, hint: 'Sets the periods on the Accruals screen.' })}
      ${field({ name: 'notes', label: 'Notes', type: 'textarea', rows: 2, span: 2, value: c.notes })}
    </div>`,
    onSubmit: async (form) => {
      const v = readForm(form, [{ name: 'kind' }, { name: 'description' }, { name: 'amount', type: 'number' }, { name: 'amount_basis' }, { name: 'payout_frequency' }, { name: 'first_payout_on' }, { name: 'accrual_frequency' }, { name: 'notes' }]);
      if (v.payout_frequency !== 'none' && !(v.amount > 0)) throw new Error('Enter the amount, or choose "Payments added by hand".');
      if (v.payout_frequency !== 'none' && !agreement.start_on) throw new Error('The deal needs a start date before payments can be planned.');
      await api.saveComponent(component ? v : { ...v, agreement_id: agreement.id }, component?.id);
      toast('Component saved.'); setTimeout(() => afterChange('components'), 0);
    },
  });
  return dlg;
}

// ---- Coverage: which brands / products or sub-groups / pubs a deal covers ------------------------------------------------------------
export function openCoverageForm(agreement) {
  const below = api.descendantIds(agreement.party_id).map((id) => D.partyById.get(id)).filter((p) => p && !p.archived_at);
  const chosen = new Set((D.scopesOf.get(agreement.id) || []).filter((x) => !x.archived_at).map((x) => x.party_id));
  const order = []; const walk = (id, depth) => { for (const c of (D.childrenOf.get(id) || []).filter((x) => !x.archived_at).sort((x, y) => x.name.localeCompare(y.name))) { order.push([c, depth]); walk(c.id, depth + 1); } }; walk(agreement.party_id, 0);
  const root = D.partyById.get(agreement.party_id);
  openModal({
    title: 'What the deal covers', submitLabel: 'Save', wide: true,
    body: below.length ? html`<p class="muted">Tick what ${agreement.title} covers. Ticking a ${sideOf(agreement) === 'brand' ? 'brand' : 'sub-group'} covers everything under it. Tick nothing to cover everything under ${root.name}.</p>
      <ul class="check-tree">${order.map(([p, d]) => html`<li style="margin-left:${d * 1.5}rem"><label class="check"><input type="checkbox" name="scope" value="${p.id}" ${chosen.has(p.id) ? raw('checked') : ''}> <span>${p.name} <span class="tag tag-kind">${NODE_LABEL[p.node_type]}</span></span></label></li>`)}</ul>`
      : html`<p>There is nothing underneath ${root.name} yet. Add ${sideOf(agreement) === 'brand' ? 'brands and products' : 'sub-groups and pubs'} to it first, then tick what this deal covers.</p>`,
    onSubmit: async (form) => {
      if (!below.length) return;
      const now = new Set([...form.querySelectorAll('input[name="scope"]:checked')].map((el) => el.value));
      const existing = (D.scopesOf.get(agreement.id) || []).filter((x) => !x.archived_at);
      for (const row of existing) if (!now.has(row.party_id)) await api.saveScope({ archived_at: new Date().toISOString() }, row.id);
      for (const id of now) if (!existing.some((x) => x.party_id === id)) await api.saveScope({ agreement_id: agreement.id, party_id: id });
      toast('Saved.'); setTimeout(() => afterChange('scopes'), 0);
    },
  });
}
// The records a deal covers: what is ticked, or everything underneath when nothing is.
export const coverOf = (a) => {
  const rows = (D.scopesOf.get(a.id) || []).filter((x) => !x.archived_at).map((x) => D.partyById.get(x.party_id)).filter(Boolean);
  return rows;
};
export const covers = (a, partyId) => {
  const ticked = coverOf(a); if (!ticked.length) return 'all';
  const line = new Set([partyId, ...api.ancestors(partyId).map((p) => p.id)]);
  return ticked.some((t) => line.has(t.id)) ? 'yes' : '';
};

// ---- What the investment was used for ----------------------------------------------------------------------------------------------------
export function openUseForm(agreement, use = null) {
  const kinds = D.listNames('investment_use'); if (use?.used_for && !kinds.includes(use.used_for)) kinds.push(use.used_for);
  const u = use || { used_on: todayStr() };
  openModal({
    title: use ? 'Change what it was used for' : 'What has the investment been used for?', submitLabel: 'Save',
    body: html`<div class="form-grid">
      ${field({ name: 'used_for', label: 'Used for', type: 'select', required: true, options: kinds, value: u.used_for })}
      ${field({ name: 'used_on', label: 'Date', type: 'date', required: true, value: u.used_on })}
      <div class="field"><label for="f-component_id">Which part of the deal</label><select id="f-component_id" name="component_id"><option value="">The deal as a whole</option>${liveComponents(agreement).map((c) => html`<option value="${c.id}" ${c.id === u.component_id ? raw('selected') : ''}>${c.kind}${c.description ? ` (${c.description})` : ''}</option>`)}</select></div>
      ${field({ name: 'amount', label: 'Amount (£)', type: 'number', step: '0.01', min: 0, value: u.amount })}
      ${field({ name: 'note', label: 'Detail', type: 'textarea', rows: 2, span: 2, value: u.note, placeholder: 'e.g. Branding on three delivery vans' })}
    </div>`,
    onSubmit: async (form) => {
      const v = readForm(form, [{ name: 'used_for' }, { name: 'used_on' }, { name: 'component_id' }, { name: 'amount', type: 'number' }, { name: 'note' }]);
      await api.saveUse(use ? v : { ...v, agreement_id: agreement.id }, use?.id);
      toast('Saved.'); setTimeout(() => afterChange('uses'), 0);
    },
  });
}
export function openPaymentForm(agreement, payment = null) {
  const side = sideOf(agreement); const p = payment || { status: 'planned', due_on: agreement.start_on || todayStr() };
  const dlg = openModal({
    title: payment ? 'Change payment' : 'Add a payment', submitLabel: 'Save payment',
    body: html`<div class="form-grid">
      ${field({ name: 'due_on', label: 'Due', type: 'date', required: true, value: p.due_on })}
      ${field({ name: 'amount', label: 'Amount (£)', type: 'number', step: '0.01', min: 0, required: true, value: p.amount })}
      ${field({ name: 'status', label: 'Status', type: 'select', required: true, options: [['planned', SIDE[side].unpaid], ['done', SIDE[side].paid]], value: p.status })}
      ${field({ name: 'done_on', label: `${SIDE[side].paid} on`, type: 'date', value: p.done_on })}
      ${field({ name: 'reference', label: 'Reference', value: p.reference, span: 2 })}
      ${field({ name: 'note', label: 'Note', type: 'textarea', rows: 2, span: 2, value: p.note })}
    </div>`,
    onSubmit: async (form) => {
      const v = readForm(form, [{ name: 'due_on' }, { name: 'amount', type: 'number' }, { name: 'status' }, { name: 'done_on' }, { name: 'reference' }, { name: 'note' }]);
      if (v.amount === null) throw new Error('Enter the amount.');
      if (v.status === 'done' && !v.done_on) v.done_on = todayStr();
      if (v.status === 'planned') v.done_on = null;
      await api.savePayment(payment ? v : { ...v, agreement_id: agreement.id }, payment?.id);
      toast('Payment saved.'); setTimeout(() => afterChange('payments'), 0);
    },
  });
  return dlg;
}
export function openMarkPaid(agreement, payment) {
  const side = sideOf(agreement);
  openModal({
    title: `Mark as ${SIDE[side].paid.toLowerCase()}`, submitLabel: 'Save',
    body: html`<p>${money(payment.amount)} due ${fmtDateShort(payment.due_on)}</p><div class="form-grid">${field({ name: 'done_on', label: `${SIDE[side].paid} on`, type: 'date', required: true, value: todayStr() })}${field({ name: 'reference', label: 'Reference', value: payment.reference })}</div>`,
    onSubmit: async (form) => { await api.savePayment({ status: 'done', done_on: form.elements.done_on.value, reference: form.elements.reference.value.trim() || null }, payment.id); toast('Saved.'); setTimeout(() => afterChange('payments'), 0); },
  });
}
export function openTargetForm(agreement, target = null) {
  const t = target || { scope: 'all_sales', unit: 'kegs', period_start: agreement.start_on, period_end: agreement.end_on };
  const dlg = openModal({
    title: target ? 'Change volume target' : 'Add a volume target', submitLabel: 'Save target',
    body: html`<div class="form-grid">
      ${field({ name: 'scope', label: 'Target is for', type: 'select', required: true, options: [['all_sales', 'All sales'], ['product', 'A particular product']], value: t.scope })}
      <div class="field" id="prod" ${t.scope === 'product' ? '' : raw('hidden')}><label for="f-product">Product</label><input type="text" id="f-product" name="product" value="${t.product || ''}" placeholder="e.g. Carling 50L keg"></div>
      ${field({ name: 'quantity', label: 'Quantity', type: 'number', step: '0.01', min: 0, required: true, value: t.quantity })}
      ${field({ name: 'unit', label: 'Unit', required: true, list: 'units', value: t.unit, hint: 'Totals only add up like with like (kegs with kegs).' })}
      <datalist id="units">${['kegs', 'cases', 'litres', 'hectolitres', 'bottles', 'units'].map((u) => html`<option value="${u}">`)}</datalist>
      ${field({ name: 'period_start', label: 'Period starts', type: 'date', required: true, value: t.period_start })}
      ${field({ name: 'period_end', label: 'Period ends', type: 'date', required: true, value: t.period_end, hint: 'A reminder to review is created 14 days before.' })}
      ${field({ name: 'note', label: 'Note', type: 'textarea', rows: 2, span: 2, value: t.note })}
    </div>`,
    onSubmit: async (form) => {
      const v = readForm(form, [{ name: 'scope' }, { name: 'product' }, { name: 'quantity', type: 'number' }, { name: 'unit' }, { name: 'period_start' }, { name: 'period_end' }, { name: 'note' }]);
      if (!v.quantity || v.quantity <= 0) throw new Error('Enter a quantity above zero.');
      if (v.scope === 'product' && !v.product) throw new Error('Say which product.');
      if (v.scope === 'all_sales') v.product = null;
      if (v.period_end < v.period_start) throw new Error('The period ends before it starts.');
      await api.saveTarget(target ? v : { ...v, agreement_id: agreement.id }, target?.id);
      toast('Target saved.'); setTimeout(() => afterChange('targets'), 0);
    },
  });
  dlg.onchange = (e) => { if (e.target.name === 'scope') dlg.querySelector('#prod').hidden = e.target.value !== 'product'; };
}
export function openReviewForm(agreement, review = null) {
  const r = review || { status: 'on_track', reviewed_on: todayStr() };
  const dlg = openModal({
    title: review ? 'Change review' : 'Record a review', submitLabel: 'Save review',
    body: html`<p class="muted">How is this going against its targets? Record your judgement; actual volumes are not held in this system.</p><div class="form-grid">
      ${field({ name: 'reviewed_on', label: 'Reviewed on', type: 'date', required: true, value: r.reviewed_on })}
      ${field({ name: 'status', label: 'Verdict', type: 'select', required: true, options: Object.entries(REVIEW_STATUS), value: r.status })}
      ${field({ name: 'note', label: 'What did you find?', type: 'textarea', rows: 3, span: 2, value: r.note })}
      ${field({ name: 'shortfall_amount', label: 'Shortfall (£), if any', type: 'number', step: '0.01', min: 0, value: r.shortfall_amount })}
      ${field({ name: 'shortfall_outcome', label: 'What was decided', type: 'select', options: Object.entries(SHORTFALL_OUTCOME), blank: 'Not applicable', value: r.shortfall_outcome })}
    </div>`,
    onSubmit: async (form) => {
      const v = readForm(form, [{ name: 'reviewed_on' }, { name: 'status' }, { name: 'note' }, { name: 'shortfall_amount', type: 'number' }, { name: 'shortfall_outcome' }]);
      if (v.shortfall_amount && !v.shortfall_outcome) v.shortfall_outcome = 'pending';
      if (!v.shortfall_amount) { v.shortfall_amount = null; v.shortfall_outcome = null; }
      await api.saveReview(review ? v : { ...v, agreement_id: agreement.id }, review?.id);
      toast('Review saved.'); setTimeout(() => afterChange('reviews'), 0);
    },
  });
  return dlg;
}
const confirmArchive = (what, fn, then) => openModal({ title: `Archive this ${what}?`, submitLabel: 'Archive', danger: true, body: html`<p>It is hidden from lists and totals but kept, with its history, and can be restored.</p>`, onSubmit: async () => { await fn(); toast('Archived.'); setTimeout(then, 0); } });

// ---- Tables -----------------------------------------------------------------------------------------------------------------------
export function agreementsTable(rows, { showParty = true } = {}) {
  return html`<table class="grid"><thead><tr><th>Deal</th>${showParty ? html`<th>With</th>` : ''}<th>Components</th><th>Status</th><th>Amount</th><th>Dates</th><th>Exclusivity</th></tr></thead><tbody>
    ${rows.map((a) => html`<tr class="${a.archived_at ? 'row-off' : ''}">
      <td data-label="Investment"><a href="#/investments/${a.id}"><strong>${a.title}</strong></a>${a.archived_at ? html` <span class="tag">Archived</span>` : ''}</td>
      ${showParty ? html`<td data-label="With"><span class="tag tag-${sideOf(a)}">${SIDE[sideOf(a)]?.label}</span> <a href="#/${route(sideOf(a))}/${a.party_id}">${api.partyPath(a.party_id)}</a></td>` : ''}
      <td data-label="Components">${liveComponents(a).map((c) => c.kind).join(', ') || html`<span class="muted">None yet</span>`}</td><td data-label="Status">${pill(a.status, AGREEMENT_STATUS[a.status])}</td>
      <td data-label="Amount" class="money">${amountText(a)}</td><td data-label="Dates">${period(a)}</td>
      <td data-label="Exclusivity">${a.has_exclusivity ? html`Yes${a.exclusivity_ends_on ? html`, to ${fmtDateShort(a.exclusivity_ends_on)}` : ''}` : 'No'}</td></tr>`)}
  </tbody></table>`;
}

// ---- List ------------------------------------------------------------------------------------------------------------------------
export async function investmentsView(main, q = {}) {
  const ui = { side: q.side || '', status: q.status || '', kind: '', q: '', archived: false };
  const draw = () => {
    const t = ui.q.toLowerCase();
    const rows = D.agreements.filter((a) => (ui.archived || !a.archived_at) && (!ui.side || sideOf(a) === ui.side) && (!ui.status || a.status === ui.status) && (!ui.kind || liveComponents(a).some((c) => c.kind === ui.kind))
      && (!t || [a.title, a.kind, api.partyPath(a.party_id), ...liveComponents(a).map((c) => c.description || '')].join(' ').toLowerCase().includes(t)))
      .sort((a, b) => api.partyPath(a.party_id).localeCompare(api.partyPath(b.party_id)) || a.title.localeCompare(b.title));
    const counted = rows.filter((a) => ['agreed', 'live'].includes(a.status) && !a.archived_at);
    const sum = (side, basis) => counted.filter((a) => sideOf(a) === side).reduce((s, a) => s + liveComponents(a).filter((c) => c.amount_basis === basis).reduce((t, c) => t + Number(c.amount || 0), 0), 0);
    mount(main, html`
      <header class="page-head"><h1>Investments</h1><div class="head-actions">${can.write ? html`<button class="btn btn-primary" data-action="a-add">Add a deal</button>` : ''}<button class="btn" data-action="csv" ${rows.length ? '' : 'disabled'}>Download as CSV</button></div></header>
      <div class="figures">
        <div class="figure"><p class="figure-label">Money in, per year</p><p class="figure-value money">${money(sum('brand', 'per_year'))}</p></div>
        <div class="figure"><p class="figure-label">Money out, per year</p><p class="figure-value money">${money(sum('customer', 'per_year'))}</p></div>
        <div class="figure"><p class="figure-label">Money in, one-off totals</p><p class="figure-value money">${money(sum('brand', 'total'))}</p></div>
        <div class="figure"><p class="figure-label">Money out, one-off totals</p><p class="figure-value money">${money(sum('customer', 'total'))}</p></div>
      </div>
      <p class="muted-small">Figures count agreed and live investments in the list below.</p>
      <form class="filters" id="i-filters" onsubmit="return false">
        <div class="field"><label for="i-q">Search</label><input id="i-q" type="search" value="${ui.q}"></div>
        <div class="field"><label for="i-side">Side</label><select id="i-side"><option value="">Both</option><option value="brand" ${ui.side === 'brand' ? 'selected' : ''}>Brand owners (in)</option><option value="customer" ${ui.side === 'customer' ? 'selected' : ''}>Customers (out)</option></select></div>
        <div class="field"><label for="i-status">Status</label><select id="i-status"><option value="">All</option>${Object.entries(AGREEMENT_STATUS).map(([k, l]) => html`<option value="${k}" ${ui.status === k ? 'selected' : ''}>${l}</option>`)}</select></div>
        <div class="field"><label for="i-kind">Component kind</label><select id="i-kind"><option value="">All</option>${D.listNames('investment_kind').map((k) => html`<option ${ui.kind === k ? 'selected' : ''}>${k}</option>`)}</select></div>
        <div class="field"><label class="check"><input type="checkbox" id="i-arch" ${ui.archived ? 'checked' : ''}> <span>Show archived</span></label></div>
      </form>
      ${rows.length ? agreementsTable(rows) : emptyHtml('No deals found', 'Add one, or change the filters.')}`);
    const f = main.querySelector('#i-filters'); const qi = f.querySelector('#i-q');
    qi.oninput = () => { ui.q = qi.value; const pos = qi.selectionStart; draw(); const n = main.querySelector('#i-q'); n.focus(); n.setSelectionRange(pos, pos); };
    f.onchange = (e) => { if (e.target.id === 'i-q') return; ui.side = f.querySelector('#i-side').value; ui.status = f.querySelector('#i-status').value; ui.kind = f.querySelector('#i-kind').value; ui.archived = f.querySelector('#i-arch').checked; draw(); };
    on(main, {
      'a-add': () => openAgreementForm(),
      csv: () => {
        const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
        const head = ['Side', 'With', 'Deal', 'Status', 'Date of agreement', 'Starts', 'Ends', 'Length', 'Renewal date', 'Component', 'Description', 'Amount', 'Basis', 'Payout', 'Accrued', 'Covers', 'Exclusivity', 'Received or paid (whole deal)', 'Still planned (whole deal)'];
        const lines = rows.flatMap((a) => { const r = (D.paymentsOf.get(a.id) || []).filter((p) => !p.archived_at); const sum = (st) => r.filter((p) => p.status === st).reduce((x, p) => x + Number(p.amount), 0);
          const cov = coverOf(a).map((p) => p.name).join('; ') || 'Everything'; const cs = liveComponents(a);
          return (cs.length ? cs : [null]).map((c) => [SIDE[sideOf(a)]?.label, api.partyPath(a.party_id), a.title, AGREEMENT_STATUS[a.status], a.agreed_on, a.start_on, a.end_on, lengthText(a), a.renewal_on, c?.kind, c?.description, c?.amount, c ? (c.amount_basis === 'per_year' ? 'per year' : 'total') : '', c ? PAYOUT_FREQ[c.payout_frequency] : '', c ? ACCRUAL_FREQ[c.accrual_frequency] : '', cov, a.has_exclusivity ? a.exclusivity_detail || 'Yes' : 'No', sum('done'), sum('planned')].map(esc).join(',')); });
        download('investments.csv', [head.map(esc).join(','), ...lines].join('\r\n'), 'text/csv');
      },
    });
  };
  draw();
}

// ---- Detail --------------------------------------------------------------------------------------------------------------------
export async function investmentView(main, id) {
  const a = D.agreementById.get(id);
  if (!a) { mount(main, html`<header class="page-head"><h1>Investment</h1></header>${emptyHtml('Not found', 'That deal does not exist or has been removed.', html`<p><a class="btn" href="#/investments">Back to investments</a></p>`)}`); return; }
  const side = sideOf(a); const S = SIDE[side]; setSection(side);
  const payments = (D.paymentsOf.get(id) || []).filter((p) => !p.archived_at).sort((x, y) => x.due_on.localeCompare(y.due_on)); const targets = (D.targetsOf.get(id) || []).filter((t) => !t.archived_at); const reviews = (D.reviewsOf.get(id) || []).filter((r) => !r.archived_at);
  const entries = D.entries.filter((e) => e.agreement_id === id && !e.archived_at); const tasks = D.tasks.filter((t) => t.agreement_id === id);
  const components = liveComponents(a); const uses = (D.usesOf.get(id) || []).filter((u) => !u.archived_at); const cover = coverOf(a); const hasBelow = api.descendantIds(a.party_id).length > 0;
  const done = payments.filter((p) => p.status === 'done').reduce((s, p) => s + Number(p.amount), 0); const planned = payments.filter((p) => p.status === 'planned').reduce((s, p) => s + Number(p.amount), 0);
  const today = todayStr();
  const history = can.audit ? await api.listAuditFor([id, ...components.map((c) => c.id), ...uses.map((u) => u.id), ...payments.map((p) => p.id), ...targets.map((t) => t.id), ...reviews.map((r) => r.id)], 60) : [];
  const w = can.write;
  mount(main, html`
    <p class="crumbs"><a href="#/investments">Investments</a> › <a href="#/${route(side)}/${a.party_id}">${api.partyPath(a.party_id)}</a></p>
    <header class="page-head"><h1>${a.title}</h1>${w ? html`<div class="head-actions"><button class="btn" data-action="log">Log a note</button><button class="btn" data-action="a-edit">Change deal</button><button class="btn" data-action="a-arch">${a.archived_at ? 'Restore' : 'Archive'}</button></div>` : ''}</header>
    <p><span class="tag tag-${side}">${S.label}: ${S.flow}</span> ${pill(a.status, AGREEMENT_STATUS[a.status])} ${a.archived_at ? html`<span class="tag">Archived</span>` : ''}</p>
    <div class="rollup">
      <section class="dash-panel"><h2>Terms</h2>${facts([['With', html`<a href="#/${route(side)}/${a.party_id}">${api.partyPath(a.party_id)}</a>`], ['Date of agreement', a.agreed_on ? fmtDateShort(a.agreed_on) : ''], ['Amount', amountText(a)], ['Dates', period(a)], ['Length of deal', lengthText(a)], ['Renewal date', a.renewal_on ? fmtDateShort(a.renewal_on) : ''], ['Looked after by', api.personName(a.owner_id)], ['At the end', a.end_action], ['Exclusivity', a.has_exclusivity ? `${a.exclusivity_detail || 'Yes'}${a.exclusivity_ends_on ? `, until ${fmtDateShort(a.exclusivity_ends_on)}` : ''}` : 'None'], ['Notes', a.notes]])}</section>
      <section class="dash-panel"><h2>Money</h2>${facts([[S.paid, money(done)], [S.unpaid, money(planned)], ['Overdue', money(payments.filter((p) => p.status === 'planned' && p.due_on < today).reduce((s, p) => s + Number(p.amount), 0))]])}</section>
    </div>

    <section class="settings-block"><div class="section-head"><h2>Components</h2>${w ? html`<button class="btn btn-sm" data-action="c-add">Add a component</button>` : ''}</div>
      ${components.length ? html`<table class="grid"><thead><tr><th>Kind</th><th>Amount</th><th>Paid out</th><th>Accrued</th><th></th></tr></thead><tbody>${components.map((c) => html`<tr>
        <td data-label="Kind"><strong>${c.kind}</strong>${c.description ? html`<div class="sub">${c.description}</div>` : ''}${c.notes ? html`<div class="sub">${c.notes}</div>` : ''}</td>
        <td data-label="Amount" class="money">${c.amount === null ? 'Not set' : `${money(c.amount)} ${c.amount_basis === 'per_year' ? 'a year' : 'in total'}`}</td>
        <td data-label="Paid out">${PAYOUT_FREQ[c.payout_frequency]}${c.first_payout_on ? html`<div class="sub">from ${fmtDateShort(c.first_payout_on)}</div>` : ''}</td><td data-label="Accrued">${ACCRUAL_FREQ[c.accrual_frequency]}</td>
        <td class="act">${w ? html`<button class="btn btn-sm" data-action="c-edit" data-id="${c.id}">Change</button> <button class="btn btn-sm" data-action="c-arch" data-id="${c.id}">Archive</button>` : ''}</td></tr>`)}</tbody></table>
        <p class="muted-small">Payments for each component are planned from how often it is paid out, and each one creates its own reminder. Accrual periods are on the <a href="#/accruals?deal=${id}">Accruals screen</a>.</p>` : html`<p class="muted">No components yet. Add the listing fee, retro / rebate, marketing support and so on.</p>`}</section>

    <section class="settings-block"><div class="section-head"><h2>What the deal covers</h2>${w && hasBelow ? html`<button class="btn btn-sm" data-action="cover">Change</button>` : ''}</div>
      ${cover.length ? html`<ul class="attn">${cover.map((p) => html`<li><a href="#/${route(side)}/${p.id}">${api.partyPath(p.id)}</a> <span class="tag tag-kind">${NODE_LABEL[p.node_type]}</span></li>`)}</ul>` : html`<p class="muted">${hasBelow ? `Everything under ${api.partyPath(a.party_id)}.` : `Nothing sits under ${api.partyPath(a.party_id)} yet.`}</p>`}</section>

    <section class="settings-block"><div class="section-head"><h2>What the investment was used for</h2>${w ? html`<button class="btn btn-sm" data-action="u-add">Add</button>` : ''}</div>
      ${uses.length ? html`<table class="grid"><thead><tr><th>Date</th><th>Used for</th><th>Part of deal</th><th>Amount</th><th></th></tr></thead><tbody>${uses.map((u) => html`<tr>
        <td data-label="Date">${fmtDateShort(u.used_on)}</td><td data-label="Used for"><strong>${u.used_for}</strong>${u.note ? html`<div class="sub">${u.note}</div>` : ''}</td>
        <td data-label="Part of deal">${u.component_id ? D.componentById.get(u.component_id)?.kind || '' : 'Whole deal'}</td><td data-label="Amount" class="money">${u.amount ? money(u.amount) : ''}</td>
        <td class="act">${w ? html`<button class="btn btn-sm" data-action="u-edit" data-id="${u.id}">Change</button> <button class="btn btn-sm" data-action="u-arch" data-id="${u.id}">Archive</button>` : ''}</td></tr>`)}</tbody></table>` : html`<p class="muted">Nothing recorded yet. Note here what the money was spent on, for example branding on vans.</p>`}</section>

    <section class="settings-block"><div class="section-head"><h2>Payments</h2>${w ? html`<button class="btn btn-sm" data-action="p-add">Add a payment</button>` : ''}</div>
      ${payments.length ? html`<table class="grid"><thead><tr><th>Due</th><th>Amount</th><th>Status</th><th>Reference</th><th></th></tr></thead><tbody>${payments.map((p) => html`<tr>
        <td data-label="Due">${fmtDateShort(p.due_on)}${p.status === 'planned' && p.due_on < today ? html` <span class="c-overdue">overdue</span>` : ''}</td><td data-label="Amount" class="money">${money(p.amount)}</td>
        <td data-label="Status">${p.status === 'done' ? html`${pill('done', S.paid)} ${fmtDateShort(p.done_on)}` : pill('planned', S.unpaid)}</td><td data-label="Reference">${p.reference || ''}${p.component_id ? html`<div class="sub">${D.componentById.get(p.component_id)?.kind || ''}</div>` : p.note ? html`<div class="sub">${p.note}</div>` : ''}</td>
        <td class="act">${w ? html`${p.status === 'planned' ? html`<button class="btn btn-sm btn-primary" data-action="p-done" data-id="${p.id}">Mark ${S.paid.toLowerCase()}</button> ` : ''}<button class="btn btn-sm" data-action="p-edit" data-id="${p.id}">Change</button> <button class="btn btn-sm" data-action="p-arch" data-id="${p.id}">Archive</button>` : ''}</td></tr>`)}</tbody></table>` : html`<p class="muted">No payments planned. Set how often each component is paid out, or add payments by hand, so reminders are created for each due date.</p>`}</section>

    <section class="settings-block"><div class="section-head"><h2>Volume targets</h2>${w ? html`<button class="btn btn-sm" data-action="t-add">Add a target</button>` : ''}</div>
      ${targets.length ? html`<table class="grid"><thead><tr><th>For</th><th>Target</th><th>Period</th><th></th></tr></thead><tbody>${targets.map((t) => html`<tr>
        <td data-label="For">${t.scope === 'product' ? t.product : 'All sales'}${t.note ? html`<div class="sub">${t.note}</div>` : ''}</td><td data-label="Target">${fmtInt(t.quantity)} ${t.unit}</td>
        <td data-label="Period">${fmtDateShort(t.period_start)} to ${fmtDateShort(t.period_end)}${t.period_end >= today && daysBetween(today, t.period_end) <= 14 ? html` <span class="c-soon">ends soon</span>` : ''}</td>
        <td class="act">${w ? html`<button class="btn btn-sm" data-action="t-edit" data-id="${t.id}">Change</button> <button class="btn btn-sm" data-action="t-arch" data-id="${t.id}">Archive</button>` : ''}</td></tr>`)}</tbody></table>` : html`<p class="muted">No targets set.</p>`}</section>

    <section class="settings-block"><div class="section-head"><h2>Reviews and shortfalls</h2>${w ? html`<button class="btn btn-sm" data-action="r-add">Record a review</button>` : ''}</div>
      <p class="muted-small">Actual volumes are not held here. A review is your judgement of how it is going, and any shortfall is recorded by hand.</p>
      ${reviews.length ? html`<table class="grid"><thead><tr><th>Reviewed</th><th>Verdict</th><th>Shortfall</th><th>Note</th><th></th></tr></thead><tbody>${reviews.map((r) => html`<tr>
        <td data-label="Reviewed">${fmtDateShort(r.reviewed_on)}</td><td data-label="Verdict">${pill(r.status, REVIEW_STATUS[r.status])}</td>
        <td data-label="Shortfall">${r.shortfall_amount ? html`<span class="money">${money(r.shortfall_amount)}</span> ${SHORTFALL_OUTCOME[r.shortfall_outcome] || ''}` : ''}</td><td data-label="Note">${r.note || ''}</td>
        <td class="act">${w ? html`<button class="btn btn-sm" data-action="r-edit" data-id="${r.id}">Change</button> <button class="btn btn-sm" data-action="r-arch" data-id="${r.id}">Archive</button>` : ''}</td></tr>`)}</tbody></table>` : html`<p class="muted">No reviews yet.</p>`}</section>

    <section class="settings-block"><h2>Open tasks</h2>${tasks.filter((t) => t.status === 'open').length ? html`<ul class="attn">${tasks.filter((t) => t.status === 'open').map((t) => html`<li><strong>${t.title}</strong> <span class="muted-small">due ${fmtDateShort(t.due_on)} · ${api.personName(t.owner_id)}</span></li>`)}</ul>` : html`<p class="muted">None.</p>`}</section>
    <section class="settings-block"><h2>Notes and meetings about this deal</h2>${entries.length ? html`<ul class="attn">${entries.slice(0, 10).map((e) => html`<li><strong>${e.title}</strong> <span class="muted-small">${fmtDayTime(e.occurred_at)}</span>${e.body ? html`<div class="sub">${e.body}</div>` : ''}</li>`)}</ul>` : html`<p class="muted">None logged against this deal.</p>`}</section>
    ${can.audit ? html`<section class="settings-block"><h2>History</h2>${history.length ? auditTable(history) : html`<p class="muted">No changes recorded.</p>`}</section>` : ''}`);
  const by = (list, el) => list.find((x) => x.id === el.dataset.id);
  const again = () => { setTimeout(() => afterChange('agreements'), 0); };
  on(main, {
    log: () => openLog({ party_id: a.party_id, agreement_id: id }),
    'c-add': () => openComponentForm(a), 'c-edit': (el) => openComponentForm(a, by(components, el)),
    'c-arch': (el) => confirmArchive('component', () => api.saveComponent({ archived_at: new Date().toISOString() }, el.dataset.id), () => afterChange('components')),
    cover: () => openCoverageForm(a),
    'u-add': () => openUseForm(a), 'u-edit': (el) => openUseForm(a, by(uses, el)),
    'u-arch': (el) => confirmArchive('record', () => api.saveUse({ archived_at: new Date().toISOString() }, el.dataset.id), () => afterChange('uses')),
    'a-edit': () => openAgreementForm(a),
    'a-arch': () => (a.archived_at ? api.saveAgreement({ archived_at: null }, id).then(() => { toast('Restored.'); again(); }) : confirmArchive('deal', () => api.saveAgreement({ archived_at: new Date().toISOString() }, id), again)),
    'p-add': () => openPaymentForm(a), 'p-edit': (el) => openPaymentForm(a, by(payments, el)), 'p-done': (el) => openMarkPaid(a, by(payments, el)),
    'p-arch': (el) => confirmArchive('payment', () => api.savePayment({ archived_at: new Date().toISOString() }, el.dataset.id), () => afterChange('payments')),
    't-add': () => openTargetForm(a), 't-edit': (el) => openTargetForm(a, by(targets, el)),
    't-arch': (el) => confirmArchive('target', () => api.saveTarget({ archived_at: new Date().toISOString() }, el.dataset.id), () => afterChange('targets')),
    'r-add': () => openReviewForm(a), 'r-edit': (el) => openReviewForm(a, by(reviews, el)),
    'r-arch': (el) => confirmArchive('review', () => api.saveReview({ archived_at: new Date().toISOString() }, el.dataset.id), () => afterChange('reviews')),
  });
}
