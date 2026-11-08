// Dashboard: what needs attention today, across both sides.
import * as api from './api.js';
import { D } from './api.js';
import { state, can, SIDE } from './state.js';
import { wireTasks } from './tasks.js';
import { html, mount, emptyHtml, fmtMoneyShort, fmtDateShort, fmtDayTime, relDays, todayStr, addDaysISO, daysBetween, plural, toISO } from './ui.js';

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
  // My own open tasks, not the system's "ends in" reminders: the deals panel already covers those.
  const mineAll = D.tasks.filter((t) => t.status === 'open' && t.owner_id === state.user.id).sort((a, b) => a.due_on.localeCompare(b.due_on));
  const mine = mineAll.filter((t) => t.source !== 'auto');
  const overdue = mine.filter((t) => t.due_on < today).length;
  const meetingsAll = D.entries.filter((e) => e.kind === 'meeting' && e.meeting_status === 'scheduled' && !e.archived_at).sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
  const meetings = meetingsAll.filter((e) => toISO(new Date(e.occurred_at)) >= today && toISO(new Date(e.occurred_at)) <= week);
  const unclosed = meetingsAll.filter((e) => toISO(new Date(e.occurred_at)) < today);
  const live = (a) => !a.archived_at && ['agreed', 'live'].includes(a.status);
  const need = [];
  for (const a of D.agreements.filter(live)) {
    const latest = (D.reviewsOf.get(a.id) || [])[0];
    const left = a.end_on ? daysBetween(today, a.end_on) : null;
    const why = [];
    if (latest && ['at_risk', 'missed'].includes(latest.status)) why.push({ text: latest.status === 'missed' ? 'Target missed' : 'Target at risk', bad: true });
    if (left !== null && left >= 0 && left <= 90) why.push({ text: `Ends ${fmtDateShort(a.end_on)} (${plural(left, 'day')})`, bad: left <= 30 });
    if (why.length) need.push({ a, why, sort: left !== null && left >= 0 ? left : 999 });
  }
  need.sort((x, y) => x.sort - y.sort);
  const quiet = goneQuiet().filter((p) => p.node_type !== 'site');
  const b = sideSum('brand'); const c = sideSum('customer');
  const link = (a) => `#/investments/${a.id}`;
  const money = (label, tone, s, still, owed, href) => html`<a class="money-line ${tone}" href="${href}"><span class="money-label">${label}</span><span class="money-fig"><strong>${fmtMoneyShort(s.per_year)}</strong> a year · ${plural(s.count, 'live deal')}</span><span class="money-fig">${fmtMoneyShort(s.planned)} ${still}</span>${s.overdue ? html`<span class="money-fig c-overdue">${fmtMoneyShort(s.overdue)} overdue ${owed}</span>` : ''}</a>`;
  mount(main, html`
    <header class="page-head"><h1>Dashboard</h1></header>
    <div class="money-strip">
      ${money('Money in', 'tone-brand', b, 'still to receive', 'to receive', '#/brands')}
      ${money('Money out', 'tone-customer', c, 'still to pay', 'to pay', '#/customers')}
    </div>
    <div class="dash-grid">
      <section class="dash-panel"><h2>My tasks ${overdue ? html`<span class="tag" style="background:var(--overdue-bg);color:var(--overdue)">${overdue} overdue</span>` : ''}</h2>
        ${mine.length ? html`<ul class="mini-tasks">${mine.slice(0, 5).map((t) => html`<li class="${t.due_on < today ? 'is-late' : ''}"><div><strong>${t.title}</strong><span class="muted-small">${t.party_id ? api.partyPath(t.party_id) : 'No record linked'}</span></div><span class="mini-due ${t.due_on < today ? 'c-overdue' : ''}">${relDays(t.due_on)}</span>${can.write ? html`<button class="btn btn-sm" data-action="done" data-id="${t.id}">Record outcome</button>` : ''}</li>`)}</ul>
          <p><a href="#/tasks">${mine.length > 5 ? `All ${mine.length} of my tasks` : 'Open Tasks'}</a>${mineAll.length > mine.length ? html` <span class="muted-small">· ${plural(mineAll.length - mine.length, 'automatic reminder')} on the Tasks screen</span>` : ''}</p>` : html`<p class="muted">Nothing open for you.</p><p><a href="#/tasks">Open Tasks</a></p>`}</section>
      <section class="dash-panel"><h2>Meetings this week</h2>
        ${meetings.length ? html`<ul class="attn">${meetings.map((e) => html`<li><strong>${e.title}</strong><br><span class="muted-small">${fmtDayTime(e.occurred_at)} · ${api.partyPath(e.party_id)}</span></li>`)}</ul>` : html`<p class="muted">No meetings booked in the next 7 days.</p>`}
        ${unclosed.length ? html`<p class="muted-small"><a href="#/diary">${plural(unclosed.length, 'earlier meeting')}</a> still marked as scheduled. Record what happened or cancel.</p>` : ''}</section>
    </div>
    <section class="dash-panel wide"><h2>Needs a decision</h2>
      ${need.length ? html`<ul class="attn">${need.slice(0, 6).map(({ a, why }) => html`<li><a href="${link(a)}"><span class="attn-name"><strong>${a.title}</strong><br><span class="muted-small">${api.partyPath(a.party_id)}</span></span><span class="attn-when">${why.map((w) => html`<span class="tag ${w.bad ? 'tag-bad' : ''}">${w.text}</span> `)}</span></a></li>`)}</ul>${need.length > 6 ? html`<p><a href="#/investments">${need.length - 6} more on Investments</a></p>` : ''}` : html`<p class="muted">No live deals are ending within 90 days or behind on their targets.</p>`}</section>
    ${quiet.length ? html`<section class="dash-panel wide"><h2>Gone quiet</h2><p class="muted-small">Active, but nobody has a follow-up due.</p>
      <p class="quiet-list">${quiet.slice(0, 3).map((p) => html`<a href="#/${p.side === 'brand' ? 'brands' : 'customers'}/${p.id}">${api.partyPath(p.id)}</a>`)}${quiet.length > 3 ? html` <span class="muted-small">and ${quiet.length - 3} more</span>` : ''}</p></section>` : ''}`);
  wireTasks(main);
}
