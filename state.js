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
