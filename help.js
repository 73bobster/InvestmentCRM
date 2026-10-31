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
    <p>Each side is a tree. Brand owners: owner, then brand, then product. Customers: group, then sub-group (as many levels as you need, up to four in all), then pub or outlet. Open any record to see its overview, interactions (notes, calls, emails, meetings, visits and decisions), contacts, tasks and investments. Figures are shown <em>at this level</em> and <em>including everything below</em>.</p>
    <h2>Deals and their components</h2>
    <p>A <strong>deal</strong> is an agreement with a brand owner (money in) or a customer (money out). It holds one or more <strong>components</strong>: listing fee, retro / rebate (an amount paid for hitting volume targets), marketing support, customer investment, new business and so on. Each component has its own amount, how often it is paid out and how often it is accrued.</p>
    <p>A deal records its date of agreement, its start and its <strong>length</strong>: either type in a number of months or years from the start, or enter the start and end dates and the length is worked out. Set a renewal date if it differs from the end; reminders follow it.</p>
    <p>Set how often a component is <strong>paid out</strong> and the payments are planned for you, each with its own reminder task, once the deal is agreed or live. Payments already marked paid or received are never changed. Use <strong>What the investment was used for</strong> to note, for example, branding on vans.</p>
    <h2>What a deal covers</h2>
    <p>Open a deal and choose <strong>What the deal covers</strong> to tick the brands and products (or sub-groups and pubs) it applies to. Tick nothing to cover everything underneath. On a brand owner or customer, the <strong>Brands and products</strong> or <strong>Sub-groups and pubs</strong> tab shows a checklist of what each deal covers.</p>
    <p>Actual volumes are not held here: when a target is missed you record the shortfall and what was decided by hand.</p>
    <h2>Accruals</h2>
    <p>The <strong>Accruals</strong> screen shows a forecast for each period of each component, worked out from its amount and how often it is accrued. Enter the <strong>actual</strong> beside the forecast when it is known; the difference is shown. <strong>Download for Finance</strong> gives a spreadsheet of the lines you are looking at, with totals for income (brand owners) and cost (customers).</p>
    <h2>Diary</h2>
    <p>Meetings and tasks in date order. Download the calendar file to put them in Outlook, Google Calendar or Apple Calendar. After a meeting, press <strong>Record outcome</strong>.</p>
    <h2>Gone quiet</h2>
    <p>An active brand owner or customer with no open task is flagged on the dashboard: nobody is due to revisit them.</p>
    <h2>Nothing is deleted</h2>
    <p>Records are archived instead, so they can be brought back. Every change is recorded in the audit log (admins and the superuser), and each record has a History tab.</p>
    <h2>User types</h2>
    <p><strong>Superuser</strong>: everything, including settings and inviting users. <strong>Admin</strong>: read and write, and the audit log. <strong>Review only</strong>: can see everything but cannot change anything.</p>`);
}
