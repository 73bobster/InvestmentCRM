// Diary: meetings and tasks in date order, with a calendar download (.ics) so they can go in Outlook, Google or Apple Calendar.
import * as api from './api.js';
import { D } from './api.js';
import { can } from './state.js';
import { openLog } from './logentry.js';
import { taskRow, wireTasks } from './tasks.js';
import { html, mount, on, icon, pill, emptyHtml, fmtDate, fmtTime, fmtDayTime, toISO, todayStr, addDaysISO, download, icsEsc, plural } from './ui.js';

const stamp = (d) => new Date(d).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const dayStamp = (iso) => iso.replace(/-/g, '');
function ics(items) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Alchemy Drinks//AD Investment CRM//EN', 'CALSCALE:GREGORIAN'];
  for (const it of items) {
    lines.push('BEGIN:VEVENT', `UID:${it.uid}@ad-investment-crm`, `DTSTAMP:${stamp(new Date())}`);
    if (it.start) lines.push(`DTSTART:${stamp(it.start)}`, `DTEND:${stamp(new Date(new Date(it.start).getTime() + 3600000))}`);
    else lines.push(`DTSTART;VALUE=DATE:${dayStamp(it.day)}`, `DTEND;VALUE=DATE:${dayStamp(addDaysISO(it.day, 1))}`);
    lines.push(`SUMMARY:${icsEsc(it.title)}`);
    if (it.where) lines.push(`LOCATION:${icsEsc(it.where)}`);
    if (it.detail) lines.push(`DESCRIPTION:${icsEsc(it.detail)}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}
const meetingItem = (e) => ({ uid: `m-${e.id}`, start: e.occurred_at, title: `${e.title} (${api.partyPath(e.party_id)})`, where: e.location, detail: [e.attendees && `With: ${e.attendees}`, e.body].filter(Boolean).join('\n') });
const taskItem = (t) => ({ uid: `t-${t.id}`, day: t.due_on, title: `Task: ${t.title}${t.party_id ? ` (${api.partyPath(t.party_id)})` : ''}`, detail: t.details });

export async function diaryView(main) {
  const draw = () => {
    const today = todayStr(); const horizon = addDaysISO(today, 60);
    const meetings = D.entries.filter((e) => e.kind === 'meeting' && e.meeting_status === 'scheduled' && !e.archived_at).sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
    // People's own tasks for the next 60 days; the system's reminders only for the next 14, so they do not bury the meetings.
    const tasks = D.tasks.filter((t) => t.status === 'open' && t.due_on <= (t.source === 'auto' ? addDaysISO(today, 14) : horizon));
    const days = new Map();
    const add = (day, item) => { if (!days.has(day)) days.set(day, []); days.get(day).push(item); };
    meetings.forEach((e) => add(toISO(new Date(e.occurred_at)), { type: 'm', e }));
    tasks.forEach((t) => add(t.due_on < today ? today : t.due_on, { type: 't', t }));
    const keys = [...days.keys()].sort();
    const missed = meetings.filter((e) => new Date(e.occurred_at) < new Date(Date.now() - 3600000));
    mount(main, html`
      <header class="page-head"><h1>Diary</h1><div class="head-actions">${can.write ? html`<button class="btn btn-primary" data-action="newmeeting">${icon('meeting')} Schedule a meeting</button>` : ''}<button class="btn" data-action="ics" ${keys.length ? '' : 'disabled'}>Download calendar file</button></div></header>
      <p class="muted">Scheduled meetings and open tasks for the next 60 days (automatic reminders for the next 14). The calendar file can be opened in Outlook, Google Calendar or Apple Calendar.</p>
      ${missed.length ? html`<p class="notice">${plural(missed.length, 'meeting')} ${missed.length === 1 ? 'has' : 'have'} happened without an outcome recorded. Use "Record outcome" below.</p>` : ''}
      ${keys.length ? html`<ul class="agenda">${keys.map((k) => html`<li class="agenda-day ${k === today ? 'today' : ''}">${k === today ? 'Today, ' : ''}${fmtDate(k)}</li>${days.get(k).map((it) => it.type === 'm'
        ? html`<li class="agenda-row"><span class="when">${fmtTime(it.e.occurred_at)}</span><div><strong>${it.e.title}</strong> <span class="tag tag-${D.partyById.get(it.e.party_id)?.side}">${D.partyById.get(it.e.party_id)?.side === 'brand' ? 'Brand owner' : 'Customer'}</span><br><span class="muted-small"><a href="#/${D.partyById.get(it.e.party_id)?.side === 'brand' ? 'brands' : 'customers'}/${it.e.party_id}">${api.partyPath(it.e.party_id)}</a>${it.e.location ? ` · ${it.e.location}` : ''}${it.e.attendees ? ` · ${it.e.attendees}` : ''}</span></div>${can.write ? html`<button class="btn btn-sm" data-action="outcome" data-id="${it.e.id}">Record outcome</button>` : html`<span></span>`}</li>`
        : html`<li class="agenda-row"><span class="when">Task</span><div><strong>${it.t.title}</strong><br><span class="muted-small">${it.t.party_id ? api.partyPath(it.t.party_id) : 'No party'} · ${api.personName(it.t.owner_id)}${it.t.due_on < today ? ' · overdue' : ''}</span></div><span></span></li>`)}`)}</ul>`
        : emptyHtml('Nothing in the diary', 'Schedule a meeting, or log a note with a revisit date.')}`);
    on(main, {
      newmeeting: () => openLog({ kind: 'meeting', occurred_at: new Date(Date.now() + 86400000).toISOString() }),
      outcome: (el) => { const e = D.entryById.get(el.dataset.id); openLog({ kind: 'note', title: `Outcome: ${e.title}`, related_entry_id: e.id, party_id: e.party_id, contact_id: e.contact_id, agreement_id: e.agreement_id, occurred_at: e.occurred_at }); },
      ics: () => download('ad-investment-crm-diary.ics', ics([...meetings.map(meetingItem), ...tasks.map(taskItem)]), 'text/calendar'),
    });
  };
  draw();
}
