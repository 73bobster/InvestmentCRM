// Help: a short, plain-language page.
import { html, mount } from './ui.js';
import { CONFIG } from './config.js';

export async function helpView(main) {
  mount(main, html`
    <header class="page-head"><h1>Help</h1></header>
    <p>${CONFIG.appName} keeps a record of Alchemy Drinks' relationships on both sides: <strong>brand owners</strong> (gold, where money comes in) and <strong>customers</strong> (teal, where money goes out). The two sides are kept apart and are not linked to each other.</p>
    <h2>The Log button</h2>
    <p>Use <strong>Log</strong> (the button at the top of the menu on a computer, or the round button above the tab bar on a phone) to record a note, call, email, meeting, visit or decision. Pick who it is about, write a short title and the details.</p>
    <h2>Every entry needs a next step</h2>
    <p>This is the heart of the system. Whenever you log something you must either set a <strong>revisit</strong> (tomorrow, 3 days, 1 week, 2 weeks, 1 month or a date, with what needs doing and who is doing it), or choose <strong>no follow-up needed</strong>, pick a reason and write a sentence explaining it. Recording the outcome of a task works the same way: choose an outcome (Resolved, Chased and awaiting reply, Escalated and so on), say what happened, then set the next step. Only an outcome that ends the work, such as Resolved, may finish with a reason why nothing more is needed. That keeps tasks being created, managed and finished. The outcomes and task categories are lists the superuser can edit in Settings.</p>
    <h2>Brand owners and customers</h2>
    <p>Each side is a tree. Brand owners: owner, then brand, then product. Customers: group, then sub-group (as many levels as you need, up to four in all), then pub or outlet. Open any record to see its overview, timeline of notes and meetings, contacts, tasks and investments. Figures are shown <em>at this level</em> and <em>including everything below</em>.</p>
    <h2>Investments</h2>
    <p>One type of record, with a <em>kind</em> (cash contribution, discount, free stock and so on). Each has payments, volume targets and reviews. Actual volumes are not held here: when a target is missed you record the shortfall and what was decided by hand. Reminders are created automatically for agreement ends (90, 60 and 30 days before), exclusivity ends (30 days), payments due and volume target reviews (14 days before the period ends).</p>
    <h2>Diary</h2>
    <p>Meetings and tasks in date order. Download the calendar file to put them in Outlook, Google Calendar or Apple Calendar. After a meeting, press <strong>Record outcome</strong>.</p>
    <h2>Gone quiet</h2>
    <p>An active brand owner or customer with no open task is flagged on the dashboard: nobody is due to revisit them.</p>
    <h2>Nothing is deleted</h2>
    <p>Records are archived instead, so they can be brought back. Every change is recorded in the audit log (admins and the superuser), and each record has a History tab.</p>
    <h2>User types</h2>
    <p><strong>Superuser</strong>: everything, including settings and inviting users. <strong>Admin</strong>: read and write, and the audit log. <strong>Review only</strong>: can see everything but cannot change anything.</p>`);
}
