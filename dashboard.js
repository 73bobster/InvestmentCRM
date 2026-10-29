// Dashboard: what needs attention today, across both sides.
import * as api from './api.js';
import { D } from './api.js';
import { state, SIDE } from './state.js';
import { taskRow, wireTasks } from './tasks.js';
import { html, mount, emptyHtml, fmtMoneyShort, fmtDateShort, fmtDayTime, todayStr, addDaysISO, daysBetween, plural, toISO } from './ui.js';

// Active relationships with no open task of a person's own making (the system's reminders do not count): nobody is due to revisit them.
export function goneQuiet() {
  const open = new Set(D.tasks.filter((t) => t.status === 'open' && t.source !== 'auto').flatMap((t) => [t.party_id, ...api.ancestors(t.party_id || '').map((p) => p.id)]));
  return D.parties.filter((p) => !p.archived_at && p.status === 'active' && ['brand_owner', 'group', 'site'].includes(p.node_type) && !open.has(p.id));
}
const sideSum = (side) => {
  const roots = D.parties.filter((p) => p.side === side && !p.parent_id && !p.archived_at);
  const r = roots.map((p) => D.rollupOf.get(p.id)).filter(Boolean);
  const n = (k) => r.reduce((s, x) => s + Number(x[k] || 0), 0);
  return { count: n('own_count') + n('below_count'), per_year: n('own_per_year') + n('below_per_year'), total: n('own_total') + n('below_total'), done: n('own_done') + n('below_done'), planned: n('own_planned') + n('below_planned'), overdue: n('own_overdue') + n('below_overdue') };
};

export async function dashboardView(main) {
  const today = todayStr(); const week = addDaysISO(today, 7);
  const mine = D.tasks.filter((t) => t.status === 'open' && t.owner_id === state.user.id).sort((a, b) => a.due_on.localeCompare(b.due_on));
  const overdueAll = D.tasks.filter((t) => t.status === 'open' && t.due_on < today);
  const meetings = D.entries.filter((e) => e.kind === 'meeting' && e.meeting_status === 'scheduled' && !e.archived_at && toISO(new Date(e.occurred_at)) <= week).sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
  const quiet = goneQuiet();
  const ending = D.agreements.filter((a) => !a.archived_at && ['agreed', 'live'].includes(a.status) && a.end_on && daysBetween(today, a.end_on) >= 0 && daysBetween(today, a.end_on) <= 90).sort((a, b) => a.end_on.localeCompare(b.end_on));
  const atRisk = D.agreements.filter((a) => !a.archived_at && ['agreed', 'live'].includes(a.status) && (D.reviewsOf.get(a.id) || [])[0] && ['at_risk', 'missed'].includes(D.reviewsOf.get(a.id)[0].status));
  const b = sideSum('brand'); const c = sideSum('customer');
  const link = (a) => `#/investments/${a.id}`;
  mount(main, html`
    <header class="page-head"><h1>Dashboard</h1></header>
    <div class="rollup">
      <section class="dash-panel tone-brand"><h2>Brand owners <span class="tag tag-brand">Money in</span></h2>
        <div class="figures"><div class="figure"><p class="figure-label">Live and agreed</p><p class="figure-value">${b.count}</p></div><div class="figure"><p class="figure-label">Per year</p><p class="figure-value money">${fmtMoneyShort(b.per_year)}</p></div><div class="figure"><p class="figure-label">Still to receive</p><p class="figure-value money">${fmtMoneyShort(b.planned)}</p></div></div>
        ${b.overdue ? html`<p class="c-overdue">${fmtMoneyShort(b.overdue)} overdue to receive</p>` : ''}<p><a href="#/brands">Open brand owners</a></p></section>
      <section class="dash-panel tone-customer"><h2>Customers <span class="tag tag-customer">Money out</span></h2>
        <div class="figures"><div class="figure"><p class="figure-label">Live and agreed</p><p class="figure-value">${c.count}</p></div><div class="figure"><p class="figure-label">Per year</p><p class="figure-value money">${fmtMoneyShort(c.per_year)}</p></div><div class="figure"><p class="figure-label">Still to pay</p><p class="figure-value money">${fmtMoneyShort(c.planned)}</p></div></div>
        ${c.overdue ? html`<p class="c-overdue">${fmtMoneyShort(c.overdue)} overdue to pay</p>` : ''}<p><a href="#/customers">Open customers</a></p></section>
    </div>
    <div class="dash-grid">
      <section class="dash-panel"><h2>My tasks ${overdueAll.length ? html`<span class="tag" style="background:var(--overdue-bg);color:var(--overdue)">${overdueAll.length} overdue in the team</span>` : ''}</h2>
        ${mine.length ? html`<ul class="tasks">${mine.slice(0, 6).map((t) => taskRow(t))}</ul>${mine.length > 6 ? html`<p><a href="#/tasks">All ${mine.length} of my tasks</a></p>` : ''}` : html`<p class="muted">Nothing open for you.</p>`}</section>
      <section class="dash-panel"><h2>Meetings in the next 7 days</h2>
        ${meetings.length ? html`<ul class="attn">${meetings.map((e) => html`<li><strong>${e.title}</strong><br><span class="muted-small">${fmtDayTime(e.occurred_at)} · ${api.partyPath(e.party_id)}</span></li>`)}</ul>` : html`<p class="muted">No meetings booked. <a href="#/diary">Open the diary</a></p>`}</section>
      <section class="dash-panel"><h2>Agreements ending within 90 days</h2>
        ${ending.length ? html`<ul class="attn">${ending.map((a) => html`<li><a href="${link(a)}"><strong>${a.title}</strong></a><br><span class="muted-small">${api.partyPath(a.party_id)} · ends ${fmtDateShort(a.end_on)} (${plural(daysBetween(today, a.end_on), 'day')})</span></li>`)}</ul>` : html`<p class="muted">None ending soon.</p>`}</section>
      <section class="dash-panel"><h2>Volume targets at risk</h2>
        ${atRisk.length ? html`<ul class="attn">${atRisk.map((a) => html`<li><a href="${link(a)}"><strong>${a.title}</strong></a><br><span class="muted-small">${api.partyPath(a.party_id)} · latest review: ${D.reviewsOf.get(a.id)[0].status === 'missed' ? 'missed' : 'at risk'}</span></li>`)}</ul>` : html`<p class="muted">Nothing flagged at risk.</p>`}</section>
      <section class="dash-panel"><h2>Gone quiet</h2><p class="muted-small">Active, but with no open task: nobody is due to revisit them.</p>
        ${quiet.length ? html`<ul class="attn">${quiet.slice(0, 8).map((p) => html`<li><a href="#/${p.side === 'brand' ? 'brands' : 'customers'}/${p.id}"><strong>${api.partyPath(p.id)}</strong></a></li>`)}</ul>${quiet.length > 8 ? html`<p class="muted-small">and ${quiet.length - 8} more</p>` : ''}` : html`<p class="muted">Everyone has something planned.</p>`}</section>
    </div>`);
  wireTasks(main);
}
