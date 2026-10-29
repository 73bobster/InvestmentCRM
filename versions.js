// One version per screen, in the form v1.YYMMDDHHMM: the date and time (UK) the screen's own files were last changed.
// It is shown at the bottom of each screen so a person can say exactly which version they were looking at.
// Update the entry for a screen whenever you change it.
export const SCREENS = [
  ['dashboard', 'Dashboard', '1.2610291746'],
  ['tasks', 'Tasks', '1.2610291746'],
  ['diary', 'Diary', '1.2610291746'],
  ['brands', 'Brand owners', '1.2610291746'],
  ['customers', 'Customers', '1.2610291746'],
  ['investments', 'Investments', '1.2610291746'],
  ['contacts', 'Contacts', '1.2610291746'],
  ['audit', 'Audit log', '1.2610291746'],
  ['settings', 'Settings', '1.2610291746'],
  ['help', 'Help', '1.2610291746'],
  ['signin', 'Sign in', '1.2610291746'],
];
const BY_ID = new Map(SCREENS.map(([id, label, version]) => [id, { label, version }]));
export const screenLabel = (id) => BY_ID.get(id)?.label || '';
export const versionOf = (id) => (BY_ID.get(id) ? `v${BY_ID.get(id).version}` : '');
