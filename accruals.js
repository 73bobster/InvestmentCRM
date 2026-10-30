// Accruals: for every component of every deal, a forecast per period (worked out from the amount and how often it is accrued),
// with the actual entered alongside it. Brand owners are money in (income); customers are money out (cost).
// The same lines, filtered, are the report for Finance (Download for Finance).
import * as api from './api.js';
import { D } from './api.js';
import { can, SIDE, ACCRUAL_FREQ, AGREEMENT_STATUS } from './state.js';
import { afterChange } from './logentry.js';
import { html, mount, on, openModal, field, readForm, toast, emptyHtml, fmtMoney, fmtDateShort, fmtMonth, todayStr, download } from './ui.js';

const money = (n) => fmtMoney(Number(n || 0));
const monthOf = (iso) => iso.slice(0, 7);
const lastDay = (ym) => { const [y, m] = ym.split('-').map(Number); return `${ym}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`; };
const periodLabel = (x) => (x.period_end.slice(0, 7) === x.period_start.slice(0, 7) ? fmtMonth(x.period_start, true) : `${fmtMonth(x.period_start)} to ${fmtMonth(x.period_end)}`);
const diff = (x) => (x.actual_amount === null || x.actual_amount === undefined ? null : Number(x.actual_amount) - Number(x.forecast_amount));

// The lines for the filters chosen, each joined to its deal, component and who it is with.
export function accrualLines({ side = '', from, to, deal = '' }) {
  const out = [];
  for (const x of D.accruals) {
    if (x.archived_at) continue;
    const a = D.agreementById.get(x.agreement_id); const c = D.componentById.get(x.component_id); if (!a || !c || a.archived_at || c.archived_at) continue;
    if (!['agreed', 'live', 'ended'].includes(a.status)) continue;
    const party = D.partyById.get(a.party_id); if (!party || (side && party.side !== side)) continue;
    if (deal && a.id !== deal) continue;
    if (from && x.period_start < `${from}-01`) continue;
    if (to && x.period_start > lastDay(to)) continue;
    out.push({ x, a, c, party });
  }
  return out.sort((p, q) => p.x.period_start.localeCompare(q.x.period_start) || api.partyPath(p.a.party_id).localeCompare(api.partyPath(q.a.party_id)) || p.a.title.localeCompare(q.a.title) || p.c.kind.localeCompare(q.c.kind));
}

function openActualForm(line) {
  const { x, a, c } = line;
  openModal({
    title: 'Enter the actual', submitLabel: 'Save',
    body: html`<p class="muted">${a.title} · ${c.kind} · ${periodLabel(x)}<br>Forecast ${money(x.forecast_amount)}</p><div class="form-grid">
      ${field({ name: 'actual_amount', label: 'Actual (£)', type: 'number', step: '0.01', min: 0, value: x.actual_amount ?? x.forecast_amount, hint: 'Leave blank to clear the actual and go back to the forecast.' })}
      ${field({ name: 'actual_on', label: 'Confirmed on', type: 'date', value: x.actual_on || todayStr() })}
      ${field({ name: 'note', label: 'Note', type: 'textarea', rows: 2, span: 2, value: x.note, placeholder: 'e.g. Invoice 1043, volumes lower than planned' })}
    </div>`,
    onSubmit: async (form) => {
      const v = readForm(form, [{ name: 'actual_amount', type: 'number' }, { name: 'actual_on' }, { name: 'note' }]);
      if (v.actual_amount === null) { v.actual_on = null; } else if (!v.actual_on) v.actual_on = todayStr();
      await api.saveAccrual(v, x.id);
      toast('Saved.'); setTimeout(() => afterChange('accruals'), 0);
    },
  });
}

export async function accrualsView(main, q = {}) {
  const year = new Date().getFullYear();
  const ui = { side: q.side || '', from: q.from || `${year}-01`, to: q.to || `${year}-12`, deal: q.deal || '', needed: false };
  const draw = () => {
    const all = accrualLines(ui);
    const lines = ui.needed ? all.filter((l) => l.x.actual_amount === null && l.x.period_end < todayStr()) : all;
    const tot = (side, key) => all.filter((l) => l.party.side === side).reduce((s, l) => s + (key === 'forecast' ? Number(l.x.forecast_amount) : key === 'actual' ? Number(l.x.actual_amount || 0) : l.x.actual_amount === null ? Number(l.x.forecast_amount) : 0), 0);
    const needed = all.filter((l) => l.x.actual_amount === null && l.x.period_end < todayStr()).length;
    const months = [...new Set(all.map((l) => monthOf(l.x.period_start)))].sort();
    const mrow = (m) => { const f = (side, k) => all.filter((l) => monthOf(l.x.period_start) === m && l.party.side === side).reduce((s, l) => s + (k === 'f' ? Number(l.x.forecast_amount) : Number(l.x.actual_amount ?? 0)), 0); return { m, inF: f('brand', 'f'), inA: f('brand', 'a'), outF: f('customer', 'f'), outA: f('customer', 'a') }; };
    const deals = D.agreements.filter((a) => !a.archived_at && ['agreed', 'live', 'ended'].includes(a.status)).sort((a, b) => api.partyPath(a.party_id).localeCompare(api.partyPath(b.party_id)) || a.title.localeCompare(b.title));
    mount(main, html`
      <header class="page-head"><h1>Accruals</h1><div class="head-actions">${can.write ? html`<button class="btn" data-action="refresh">Extend schedules</button>` : ''}<button class="btn btn-primary" data-action="finance" ${all.length ? '' : 'disabled'}>Download for Finance</button></div></header>
      <p class="muted">A forecast for each period is worked out from the amount and how often each component is accrued. Enter the actual beside it when it is known. Brand owners are money in (income); customers are money out (cost).</p>
      <div class="figures">
        <div class="figure"><p class="figure-label">Money in: forecast</p><p class="figure-value money">${money(tot('brand', 'forecast'))}</p></div>
        <div class="figure"><p class="figure-label">Money in: actual entered</p><p class="figure-value money">${money(tot('brand', 'actual'))}</p></div>
        <div class="figure"><p class="figure-label">Money out: forecast</p><p class="figure-value money">${money(tot('customer', 'forecast'))}</p></div>
        <div class="figure"><p class="figure-label">Money out: actual entered</p><p class="figure-value money">${money(tot('customer', 'actual'))}</p></div>
      </div>
      <p class="muted-small">Figures cover the periods and filters below. ${needed ? html`<strong class="c-soon">${needed} ${needed === 1 ? 'period has' : 'periods have'} ended with no actual entered.</strong>` : 'Every period that has ended has an actual.'}</p>
      <form class="filters" id="ac-filters" onsubmit="return false">
        <div class="field"><label for="ac-side">Side</label><select id="ac-side"><option value="">Both</option><option value="brand" ${ui.side === 'brand' ? 'selected' : ''}>Brand owners (in)</option><option value="customer" ${ui.side === 'customer' ? 'selected' : ''}>Customers (out)</option></select></div>
        <div class="field"><label for="ac-from">From</label><input type="month" id="ac-from" value="${ui.from}"></div>
        <div class="field"><label for="ac-to">To</label><input type="month" id="ac-to" value="${ui.to}"></div>
        <div class="field"><label for="ac-deal">Deal</label><select id="ac-deal"><option value="">All deals</option>${deals.map((a) => html`<option value="${a.id}" ${ui.deal === a.id ? 'selected' : ''}>${api.partyPath(a.party_id)}: ${a.title}</option>`)}</select></div>
        <div class="field"><label class="check"><input type="checkbox" id="ac-needed" ${ui.needed ? 'checked' : ''}> <span>Actual still needed</span></label></div>
      </form>
      ${months.length ? html`<section class="settings-block"><h2>By month</h2><div class="scroll"><table class="grid keep compact"><thead><tr><th>Month</th><th>In: forecast</th><th>In: actual</th><th>Out: forecast</th><th>Out: actual</th></tr></thead><tbody>
        ${months.map((m) => { const r = mrow(m); return html`<tr><td data-label="Month">${fmtMonth(`${m}-01`, true)}</td><td data-label="In: forecast" class="money">${r.inF ? money(r.inF) : ''}</td><td data-label="In: actual" class="money">${r.inA ? money(r.inA) : ''}</td><td data-label="Out: forecast" class="money">${r.outF ? money(r.outF) : ''}</td><td data-label="Out: actual" class="money">${r.outA ? money(r.outA) : ''}</td></tr>`; })}
      </tbody></table></div></section>` : ''}
      ${lines.length ? html`<section class="settings-block"><h2>Lines</h2><div class="scroll"><table class="grid"><thead><tr><th>Period</th><th>With</th><th>Deal and component</th><th>Forecast</th><th>Actual</th><th>Difference</th><th></th></tr></thead><tbody>
        ${lines.map((l) => { const d = diff(l.x); const late = l.x.actual_amount === null && l.x.period_end < todayStr(); return html`<tr>
          <td data-label="Period">${periodLabel(l.x)}</td>
          <td data-label="With"><span class="tag tag-${l.party.side}">${l.party.side === 'brand' ? 'In' : 'Out'}</span> <a href="#/${SIDE[l.party.side].route}/${l.party.id}">${api.partyPath(l.party.id)}</a></td>
          <td data-label="Deal and component"><a href="#/investments/${l.a.id}">${l.a.title}</a><div class="sub">${l.c.kind}${l.c.description ? ` (${l.c.description})` : ''} · ${ACCRUAL_FREQ[l.c.accrual_frequency].toLowerCase()}${l.a.status === 'ended' ? ' · deal ended' : ''}</div></td>
          <td data-label="Forecast" class="money">${money(l.x.forecast_amount)}</td>
          <td data-label="Actual" class="money">${l.x.actual_amount === null ? (late ? html`<span class="c-soon">Needed</span>` : html`<span class="muted">Not yet</span>`) : money(l.x.actual_amount)}${l.x.note ? html`<div class="sub">${l.x.note}</div>` : ''}</td>
          <td data-label="Difference" class="money">${d === null ? '' : html`<span class="${d < 0 ? 'c-overdue' : ''}">${d > 0 ? '+' : ''}${money(d)}</span>`}</td>
          <td class="act">${can.write ? html`<button class="btn btn-sm ${l.x.actual_amount === null ? 'btn-primary' : ''}" data-action="actual" data-id="${l.x.id}">${l.x.actual_amount === null ? 'Enter actual' : 'Change'}</button>` : ''}</td></tr>`; })}
      </tbody></table></div></section>` : emptyHtml('No accruals for these filters', 'Accruals appear once a deal is agreed or live, has a start date, and its components have an amount. Widen the dates or change the filters.')}`);
    const f = main.querySelector('#ac-filters');
    f.onchange = () => { ui.side = f.querySelector('#ac-side').value; ui.from = f.querySelector('#ac-from').value; ui.to = f.querySelector('#ac-to').value; ui.deal = f.querySelector('#ac-deal').value; ui.needed = f.querySelector('#ac-needed').checked; draw(); };
    on(main, {
      actual: (el) => { const l = all.find((z) => z.x.id === el.dataset.id); if (l) openActualForm(l); },
      refresh: async () => { try { const n = await api.refreshSchedules(); toast(`Schedules checked for ${n} components.`); afterChange('components'); } catch (e) { toast(e.message, 'error'); } },
      finance: () => {
        const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
        const head = ['Period start', 'Period end', 'Direction', 'Counterparty', 'Deal', 'Deal status', 'Component', 'Description', 'Accrual frequency', 'Forecast (GBP)', 'Actual (GBP)', 'Difference (GBP)', 'Actual confirmed on', 'Basis', 'Note'];
        const rows = all.map((l) => { const d = diff(l.x); return [l.x.period_start, l.x.period_end, l.party.side === 'brand' ? 'Income (money in)' : 'Cost (money out)', api.partyPath(l.party.id), l.a.title, AGREEMENT_STATUS[l.a.status], l.c.kind, l.c.description, ACCRUAL_FREQ[l.c.accrual_frequency], Number(l.x.forecast_amount).toFixed(2), l.x.actual_amount === null ? '' : Number(l.x.actual_amount).toFixed(2), d === null ? '' : d.toFixed(2), l.x.actual_on, l.x.actual_amount === null ? 'Forecast' : 'Actual', l.x.note].map(esc).join(','); });
        const sumRows = ['brand', 'customer'].map((s) => [`Total ${s === 'brand' ? 'income' : 'cost'}`, '', '', '', '', '', '', '', '', tot(s, 'forecast').toFixed(2), tot(s, 'actual').toFixed(2), '', '', '', ''].map(esc).join(','));
        download(`accruals-${ui.from}-to-${ui.to}.csv`, [head.map(esc).join(','), ...rows, ...sumRows].join('\r\n'), 'text/csv');
      },
    });
  };
  draw();
}
