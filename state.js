// Who is signed in, which organisation they are working in, and what their role allows.
// The database enforces all of this; these helpers only decide what to show.

export const state = { user: null, memberships: [], membership: null, org: null, role: null };

// Three user types. Keys are stored in the database (memberships.role); labels can be changed freely.
export const ROLE_LABEL = { superuser: 'Superuser', admin: 'Admin', reviewer: 'Review only' };
export const ROLE_HINT = {
  superuser: 'Everything, including settings, lists and inviting users.',
  admin: 'Read and write: add and change everything and see the audit log. No settings.',
  reviewer: 'Review only: can see everything but cannot change anything.',
};
export const ROLE_ORDER = ['superuser', 'admin', 'reviewer'];

// What each user type can do, for the "Who can do what" table in Settings. Order: superuser, admin, reviewer.
export const ACCESS_SUMMARY = [
  ['Brand owners, customers, contacts', ['Full', 'Full', 'View']],
  ['Meetings, notes, decisions and tasks', ['Full', 'Full', 'View']],
  ['Investments, deal components, payments and volume targets', ['Full', 'Full', 'View']],
  ['Accruals (forecast and actuals) and the Finance report', ['Full', 'Full', 'View']],
  ['Audit log', ['View', 'View', 'None']],
  ['Settings, lists and users', ['Full', 'None', 'None']],
];

export const SCREENS = {
  dashboard: 'Dashboard', tasks: 'Tasks', diary: 'Diary', brands: 'Brand owners', customers: 'Customers',
  investments: 'Investments', accruals: 'Accruals', contacts: 'Contacts', audit: 'Audit log', settings: 'Settings', help: 'Help',
};
export const screenName = (id) => SCREENS[id] || 'This screen';

// ---- Which screens are in the menu, in what order, and for whom ----------------------------------------------------------------
// The superuser can switch any screen on or off for each user type and set the menu order (Settings, Screens). Two limits: the
// superuser always keeps Settings, and the Audit log and Settings are never available to a user type that cannot use them.
// Switching a screen off only hides it: nothing is deleted, the data is not made private (the database rules decide that) and every change is audited.
// organisations.settings.hidden_screens_by_type holds { user type: [screen ids that are off] }; organisations.settings.screen_order holds { id: 0 to 99 }.
export const SCREEN_INFO = {
  dashboard: ['Dashboard', 'The opening screen.'],
  tasks: ['Tasks', 'What is due, due soon or overdue.'],
  diary: ['Diary', 'Meetings and reminders in date order.'],
  brands: ['Brand owners', 'Brand owners, their brands and products, contacts and history.'],
  customers: ['Customers', 'Groups, sub-groups and pubs, contacts and history.'],
  investments: ['Investments', 'Deals, their components, payments and volume targets.'],
  accruals: ['Accruals', 'Forecast and actual accruals, and the Finance download.'],
  contacts: ['Contacts', 'Key contacts across brand owners and customers.'],
  audit: ['Audit log', 'The screen only: every change is still recorded while it is hidden.'],
  settings: ['Settings', 'Superuser only.'],
};
// The standard order number of each menu screen (0 to 99, lowest first).
export const MENU_STANDARD = [['dashboard', 5], ['tasks', 10], ['diary', 15], ['brands', 20], ['customers', 25], ['investments', 30], ['accruals', 35], ['contacts', 40], ['audit', 45], ['settings', 50]];
export const SWITCHABLE = MENU_STANDARD.map(([id]) => id);
// Every menu screen in the order it is shown: { id, label, hint, std, seq }. Anything missing or not valid falls back to the standard.
export function menuLayout(settings = state.org?.settings) {
  const saved = settings?.screen_order && typeof settings.screen_order === 'object' ? settings.screen_order : {};
  return MENU_STANDARD.map(([id, std], i) => {
    const [label, hint] = SCREEN_INFO[id];
    const seq = Number.isInteger(saved[id]) && saved[id] >= 0 && saved[id] <= 99 ? saved[id] : std;
    return { id, label, hint, std, seq, i };
  }).sort((a, b) => a.seq - b.seq || a.i - b.i);
}
// A screen a user type can never use, whatever the setting: Settings is the superuser's, and the Audit log is for superusers and admins.
export const screenLocked = (id, role) => (id === 'settings' && role !== 'superuser') || (id === 'audit' && !['superuser', 'admin'].includes(role));
// The screens switched off for one user type (the signed-in person's own by default). The superuser's Settings can never be off.
export function hiddenScreens(role = state.role, settings = state.org?.settings) {
  const by = settings?.hidden_screens_by_type;
  const list = by && typeof by === 'object' && !Array.isArray(by) ? by[role] : null;
  return Array.isArray(list) ? list.filter((id) => SWITCHABLE.includes(id) && !(id === 'settings' && role === 'superuser')) : [];
}
export const screenOn = (id, role = state.role, settings = state.org?.settings) => id === 'help' || !hiddenScreens(role, settings).includes(id);
export const MEMBER_STATUS_LABEL = { active: 'Active', disabled: 'Suspended', removed: 'Removed' };

export const can = {
  get write() { return ['superuser', 'admin'].includes(state.role); },
  get audit() { return ['superuser', 'admin'].includes(state.role); },
  get configure() { return state.role === 'superuser'; },
};

export function setMembership(m) {
  state.membership = m;
  state.org = m.organisation;
  state.role = m.role;
  try { localStorage.setItem('app:org', m.organisation_id); } catch { /* storage unavailable */ }
}

export function clearState() {
  state.user = null; state.memberships = []; state.membership = null; state.org = null; state.role = null;
}

// ---- Words used for the two sides ---------------------------------------------------------------------------------------
// brand = a brand owner (money comes IN to Alchemy). customer = a pub or restaurant group (money goes OUT from Alchemy).
export const SIDE = {
  brand: { label: 'Brand owner', plural: 'Brand owners', money: 'Brand support', flow: 'money in', coverTab: 'Brands and products', coverHelp: 'Which brands and products each deal covers.', paid: 'Received', unpaid: 'To receive', route: 'brands', section: 'brand' },
  customer: { label: 'Customer', plural: 'Customers', money: 'Customer investment', flow: 'money out', coverTab: 'Sub-groups and pubs', coverHelp: 'Which sub-groups and pubs each deal covers.', paid: 'Paid', unpaid: 'To pay', route: 'customers', section: 'customer' },
};
export const NODE_LABEL = { brand_owner: 'Brand owner', brand: 'Brand', product: 'Product', group: 'Group', sub_group: 'Sub-group', site: 'Pub or outlet' };
// What can be added underneath each type (the database checks this too).
export const CHILD_TYPES = { brand_owner: ['brand', 'product'], brand: ['product'], product: [], group: ['sub_group', 'site'], sub_group: ['sub_group', 'site'], site: [] };
export const ROOT_TYPES = { brand: ['brand_owner'], customer: ['group', 'site'] };
export const PARTY_STATUS = { prospect: 'Prospect', active: 'Active', dormant: 'Dormant', ended: 'Ended' };
export const AGREEMENT_STATUS = { proposed: 'Proposed', agreed: 'Agreed', live: 'Live', ended: 'Ended', cancelled: 'Cancelled' };
export const ENTRY_KIND = { note: 'Note', call: 'Call', email: 'Email', meeting: 'Meeting', visit: 'Visit', decision: 'Decision' };
export const REVIEW_STATUS = { on_track: 'On track', at_risk: 'At risk', missed: 'Missed', met: 'Met' };
export const SHORTFALL_OUTCOME = { pending: 'To be decided', waived: 'Waived', clawed_back: 'Clawed back', carried_forward: 'Carried forward' };

// How often a component is paid out (payments are created for each date and each makes a reminder) and how often it is accrued.
export const PAYOUT_FREQ = { none: 'Payments added by hand', one_off: 'One payment', monthly: 'Monthly', quarterly: 'Quarterly', half_yearly: 'Half-yearly', annual: 'Annually' };
export const ACCRUAL_FREQ = { monthly: 'Monthly', quarterly: 'Quarterly', annual: 'Annually' };
