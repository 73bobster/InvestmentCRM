// UI toolkit: escaped-by-default templating, dates, forms, modals, toasts.

// ---- Templating ---------------------------------------------------------
// html`...` escapes every interpolated value unless it is itself html`...` or raw(...).
// Use raw() only for markup you wrote yourself, never for data from the database or the user.
const ENT = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ENT[c]);
class Safe { constructor(s) { this.s = s; } toString() { return this.s; } }
export const raw = (s) => new Safe(String(s ?? ''));
const part = (v) => (v instanceof Safe ? v.s : Array.isArray(v) ? v.map(part).join('') : v === null || v === undefined || v === false ? '' : esc(v));
export const html = (strings, ...vals) => {
  let out = strings[0];
  for (let i = 0; i < vals.length; i++) out += part(vals[i]) + strings[i + 1];
  return new Safe(out);
};
export const mount = (el, safe) => { el.innerHTML = safe instanceof Safe ? safe.s : esc(safe); keepDatesWhole(el); };

// A date written with hyphens (04-Oct-26) would otherwise be split across two lines at a hyphen. After each render,
// date text is wrapped in a span that stays on one line. Only visible text is touched: never attributes, form
// fields, drop-down options or charts.
const HYPHEN_DATE = /\b(?:\d{2}-[A-Z][a-z]{2}(?:-\d{2})?|\d{4}-\d{2}-\d{2})\b/g;
function keepDatesWhole(root) {
  if (!dateFormat.includes('-') || typeof document === 'undefined' || typeof NodeFilter === 'undefined' || !document.createTreeWalker) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const found = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const p = n.parentElement;
    if (!p || p.closest('textarea, select, script, style, svg, .nw')) continue;
    HYPHEN_DATE.lastIndex = 0;
    if (HYPHEN_DATE.test(n.nodeValue)) found.push(n);
  }
  for (const n of found) {
    // The whole piece of text goes into one span, so that where a cell lays its contents out side by side
    // (the stacked tables on a phone) the text still counts as a single item, as it did before.
    const text = n.nodeValue; const whole = document.createElement('span'); let last = 0;
    for (const m of text.matchAll(HYPHEN_DATE)) {
      whole.append(text.slice(last, m.index));
      const span = document.createElement('span'); span.className = 'nw'; span.textContent = m[0]; whole.append(span);
      last = m.index + m[0].length;
    }
    whole.append(text.slice(last));
    n.replaceWith(whole);
  }
}
export const isSafe = (v) => v instanceof Safe;

// Click delegation: <button data-action="save"> calls handlers.save(el, event).
export function on(root, handlers) {
  root.onclick = (e) => {
    const el = e.target.closest('[data-action]');
    if (!el || !root.contains(el)) return;
    const fn = handlers[el.dataset.action];
    if (fn) { e.preventDefault(); fn(el, e); }
  };
}

// ---- Dates and numbers --------------------------------------------------
const pad = (n) => String(n).padStart(2, '0');
export const toISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const todayStr = () => toISO(new Date());
export const parseISO = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
export const addDaysISO = (s, n) => { const d = parseISO(s); d.setDate(d.getDate() + n); return toISO(d); };
// Every date on screen, in reports and in downloads goes through formatDate, so one setting changes them all.
// The format is chosen per organisation in Settings (organisations.settings.date_format). The first is the default.
export const DATE_FORMATS = [['dd-Mmm-yy', '04-Oct-26'], ['dd Mmm yyyy', '4 Oct 2026'], ['dd/mm/yyyy', '04/10/2026'], ['dd/mm/yy', '04/10/26'], ['mm/dd/yyyy', '10/04/2026'], ['yyyy-mm-dd', '2026-10-04']];
export const DEFAULT_DATE_FORMAT = 'dd-Mmm-yy';
let dateFormat = DEFAULT_DATE_FORMAT;
export const setDateFormat = (f) => { dateFormat = DATE_FORMATS.some(([k]) => k === f) ? f : DEFAULT_DATE_FORMAT; };
export const getDateFormat = () => dateFormat;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
// year = false leaves the year off, for chart axes and other tight spaces.
export function formatDate(d, format = dateFormat, year = true) {
  const dd = pad(d.getDate()); const mm = pad(d.getMonth() + 1); const mon = MONTHS[d.getMonth()]; const yyyy = String(d.getFullYear()); const yy = yyyy.slice(2);
  switch (format) {
    case 'dd Mmm yyyy': return `${d.getDate()} ${mon}${year ? ` ${yyyy}` : ''}`;
    case 'dd/mm/yyyy': return `${dd}/${mm}${year ? `/${yyyy}` : ''}`;
    case 'dd/mm/yy': return `${dd}/${mm}${year ? `/${yy}` : ''}`;
    case 'mm/dd/yyyy': return `${mm}/${dd}${year ? `/${yyyy}` : ''}`;
    case 'yyyy-mm-dd': return year ? `${yyyy}-${mm}-${dd}` : `${mm}-${dd}`;
    default: return `${dd}-${mon}${year ? `-${yy}` : ''}`;
  }
}
const asDate = (s) => parseISO(String(s).slice(0, 10));
export const fmtDateShort = (s) => (s ? formatDate(asDate(s)) : '');                                       // 04-Oct-26
export const fmtDate = (s) => { if (!s) return ''; const d = asDate(s); return `${DAYS[d.getDay()]} ${formatDate(d)}`; };   // Sun 04-Oct-26
export const fmtDayMonth = (s, weekday = false) => { if (!s) return ''; const d = asDate(s); return `${weekday ? `${DAYS[d.getDay()]} ` : ''}${formatDate(d, dateFormat, false)}`; };   // 04-Oct
export const fmtMonth = (s, long = false) => { if (!s) return ''; const d = asDate(s); return long ? `${MONTHS_LONG[d.getMonth()]} ${d.getFullYear()}` : `${MONTHS[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`; };
export const fmtDateTime = (s) => { if (!s) return ''; const d = new Date(s); return `${formatDate(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
export const fmtInt = (n) => (n === null || n === undefined ? '' : new Intl.NumberFormat('en-GB').format(n));
export const fmtMoney = (n, cur = 'GBP') => (n === null || n === undefined ? '' : new Intl.NumberFormat('en-GB', { style: 'currency', currency: cur }).format(n));
export const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
export function dueText(days) {
  if (days === null || days === undefined) return 'No date set';
  if (days < 0) return `${plural(-days, 'day')} overdue`;
  if (days === 0) return 'Due today';
  return `Due in ${plural(days, 'day')}`;
}

// ---- Small components ---------------------------------------------------
const ICONS = {
  dashboard: '<rect x="3" y="3" width="7" height="9"/><rect x="14" y="3" width="7" height="5"/><rect x="14" y="12" width="7" height="9"/><rect x="3" y="16" width="7" height="5"/>',
  tasks: '<path d="M9 6h11M9 12h11M9 18h11M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2"/>',
  diary: '<rect x="3" y="5" width="18" height="16" rx="1"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  brands: '<path d="M4 20V9l8-5 8 5v11M9 20v-6h6v6"/>',
  customers: '<path d="M5 20V8h14v12M3 20h18M9 12h2M13 12h2M9 16h2M13 16h2M9 4h6v4H9z"/>',
  investments: '<path d="M3 20h18M6 20v-6M11 20V9M16 20v-9M21 20V5"/>',
  accruals: '<path d="M4 4h16v16H4zM4 9h16M9 9v11M14 14h3M14 17h3"/>',
  contacts: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 3-5.5 6.5-5.5s6.5 1.9 6.5 5.5M16 4.8a3.5 3.5 0 0 1 0 6.4M18 14.8c2 .6 3.5 2.1 3.5 5.2"/>',
  audit: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  settings: '<path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.6 9.4a2.5 2.5 0 1 1 3.6 2.3c-.8.5-1.2 1-1.2 1.9M12 17v.5"/>',
  more: '<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  note: '<path d="M6 3h9l4 4v14H6zM14 3v5h5M9 13h7M9 17h7"/>',
  call: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A15 15 0 0 1 3 6a2 2 0 0 1 2-2z"/>',
  email: '<rect x="3" y="5" width="18" height="14" rx="1"/><path d="M3 7l9 6 9-6"/>',
  meeting: '<circle cx="8" cy="8" r="3"/><circle cx="16.5" cy="9" r="2.5"/><path d="M2.5 20c0-3.3 2.5-5 5.5-5s5.5 1.7 5.5 5M14.5 15.3c3-.4 6 1 6 4.7"/>',
  visit: '<path d="M12 21s-7-6-7-11a7 7 0 0 1 14 0c0 5-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>',
  decision: '<path d="M5 12l5 5 9-10"/>',
};
export const icon = (name) => raw(`<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${ICONS[name] || ''}</svg>`);

// The organisation's logo, falling back to its name as text if the picture cannot load. This app shows the organisation's (Alchemy Drinks') logo only.
export const logoImg = (url, name, extraClass = '') => (url
  ? html`<img class="logo" src="${url}" alt="${name}" data-name="${name}" data-class="${extraClass}" referrerpolicy="no-referrer">`
  : html`<span class="logo-text ${extraClass}">${name}</span>`);
export function wireLogos(root) {
  root.querySelectorAll('img.logo').forEach((img) => {
    img.addEventListener('error', () => {
      const s = document.createElement('span');
      s.className = `logo-text ${img.dataset.class || ''}`.trim();
      s.textContent = img.dataset.name || '';
      img.replaceWith(s);
    }, { once: true });
  });
}

export const facts = (pairs) => html`<dl class="facts">${pairs.filter(([, v]) => v !== null && v !== undefined && v !== '').map(([k, v]) => html`<div><dt>${k}</dt><dd>${v}</dd></div>`)}</dl>`;

// A coloured status label. The colour comes from the class pill-<status> in app.css (overdue, soon, ok, quiet, info, ...).
export const pill = (status, label = status) => html`<span class="pill pill-${status}">${label}</span>`;
export const loadingHtml = (text = 'Loading') => html`<p class="loading" role="status">${text}</p>`;
export const emptyHtml = (title, text = '', actionHtml = '') => html`<div class="empty"><h2>${title}</h2>${text ? html`<p>${text}</p>` : ''}${actionHtml}</div>`;
export const errorHtml = (msg) => html`<div class="empty empty-error" role="alert"><h2>That didn't load</h2><p>${msg}</p><p><button class="btn" type="button" data-action="reload">Try again</button></p></div>`;

// ---- Toasts -------------------------------------------------------------
export function toast(msg, kind = 'ok') {
  const box = document.getElementById('toasts');
  if (!box) return;
  const t = document.createElement('div');
  t.className = `toast toast-${kind}`;
  t.textContent = msg;
  box.append(t);
  setTimeout(() => t.remove(), kind === 'error' ? 7000 : 3500);
}

// ---- Forms --------------------------------------------------------------
const optPair = (o) => (Array.isArray(o) ? o : [o.value ?? o, o.label ?? o]);

export function field(f, values = {}) {
  const has = values[f.name] !== undefined && values[f.name] !== null;
  const cur = has ? values[f.name] : f.value ?? '';
  const id = `f-${f.name}`;
  const req = f.required ? raw(' required') : '';
  const attrs = html`id="${id}" name="${f.name}"${req}`;
  if (f.type === 'checkbox') {
    return html`<div class="field ${f.span === 2 ? 'span-2' : ''}"><label class="check"><input type="checkbox" id="${id}" name="${f.name}" ${cur ? raw('checked') : ''}> <span>${f.label}</span></label>${f.hint ? html`<p class="hint">${f.hint}</p>` : ''}</div>`;
  }
  let control;
  if (f.type === 'textarea') {
    control = html`<textarea ${attrs} rows="${f.rows || 3}">${cur}</textarea>`;
  } else if (f.type === 'select') {
    const opts = (f.options || []).map(optPair).map(([v, l]) => html`<option value="${v}" ${String(v) === String(cur) ? raw('selected') : ''}>${l}</option>`);
    const blank = f.required && cur ? [] : [html`<option value="">${f.blank || (f.required ? 'Choose' : 'Not set')}</option>`];
    control = html`<select ${attrs}>${blank}${opts}</select>`;
  } else {
    const extra = ['min', 'max', 'step', 'placeholder', 'autocomplete', 'inputmode', 'maxlength', 'list']
      .filter((k) => f[k] !== undefined)
      .map((k) => html` ${k}="${f[k]}"`);
    control = html`<input type="${f.type || 'text'}" ${attrs} value="${cur}"${extra}>`;
  }
  return html`<div class="field ${f.span === 2 ? 'span-2' : ''}"><label for="${id}">${f.label}${f.required ? html`<span class="req" aria-hidden="true"> *</span>` : ''}</label>${control}${f.hint ? html`<p class="hint">${f.hint}</p>` : ''}</div>`;
}

export const datalist = (id, options) => html`<datalist id="${id}">${options.map(([v, l]) => html`<option value="${v}">${l}</option>`)}</datalist>`;

export const fieldsHtml = (specs, values = {}) => html`<div class="form-grid">${specs.map((f) => field(f, values))}</div>`;

// Reads a form into a plain object: blanks become null, numbers become numbers, checkboxes become booleans.
export function readForm(form, specs) {
  const out = {};
  for (const f of specs) {
    const el = form.elements[f.name];
    if (!el) continue;
    if (f.type === 'checkbox') { out[f.name] = !!el.checked; continue; }
    let v = String(el.value ?? '').trim();
    if (v === '') { out[f.name] = null; continue; }
    if (f.type === 'number') v = Number(v);
    out[f.name] = v;
  }
  return out;
}

// ---- Modal --------------------------------------------------------------
let lastFocus = null;
export function closeModal() {
  const dlg = document.getElementById('dialog');
  if (dlg?.open) dlg.close();
}

// openModal({ title, body, onSubmit, submitLabel, hideFooter, wide, danger })
// onSubmit(form) may throw: the message is shown inside the dialog and it stays open.
export function openModal({ title, body, onSubmit, submitLabel = 'Save', cancelLabel = 'Cancel', hideFooter = false, wide = false, danger = false }) {
  const dlg = document.getElementById('dialog');
  lastFocus = document.activeElement;
  dlg.onclick = null;
  dlg.className = `modal${wide ? ' modal-wide' : ''}`;
  mount(dlg, html`<form class="modal-form" method="dialog">
    <header class="modal-head"><h2 id="dlg-title">${title}</h2><button type="button" class="icon-btn" data-close aria-label="Close">${icon('close')}</button></header>
    <div class="modal-body">${body}<p class="form-error" role="alert" hidden></p></div>
    ${hideFooter ? '' : html`<footer class="modal-foot"><button type="button" class="btn" data-close>${cancelLabel}</button><button type="submit" class="btn ${danger ? 'btn-danger' : 'btn-primary'}">${submitLabel}</button></footer>`}
  </form>`);
  const form = dlg.querySelector('form');
  const errBox = dlg.querySelector('.form-error');
  dlg.querySelectorAll('[data-close]').forEach((b) => { b.onclick = () => closeModal(); });
  dlg.onclose = () => { mount(dlg, ''); try { lastFocus?.focus?.(); } catch { /* element gone */ } };
  if (onSubmit) {
    form.onsubmit = async (e) => {
      e.preventDefault();
      errBox.hidden = true;
      const btn = form.querySelector('button[type="submit"]');
      if (btn) btn.disabled = true;
      try {
        await onSubmit(form);
        closeModal();
      } catch (err) {
        errBox.textContent = err.message || 'Something went wrong.';
        errBox.hidden = false;
        if (btn) btn.disabled = false;
      }
    };
  } else {
    form.onsubmit = (e) => e.preventDefault();
  }
  if (!dlg.open) dlg.showModal();
  return dlg;
}

// ---- Extra helpers for this app -----------------------------------------------------------------------------
export const todayISO = todayStr;
export const daysBetween = (fromISO, toISO) => Math.round((parseISO(toISO.slice(0, 10)) - parseISO(fromISO.slice(0, 10))) / 86400000);
export const fmtTime = (s) => { const d = new Date(s); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
export const fmtDayTime = (s) => `${fmtDate(toISO(new Date(s)))} ${fmtTime(s)}`;
// value for <input type="datetime-local"> from an ISO timestamp, and back
export const toLocalInput = (s) => { const d = s ? new Date(s) : new Date(); return `${toISO(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
export const fromLocalInput = (v) => (v ? new Date(v).toISOString() : null);
export const fmtMoneyShort = (n) => (n === null || n === undefined ? '' : new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 }).format(n));
// How far away a date is, in words: "3 days overdue", "Today", "In 5 days".
export function relDays(iso) {
  if (!iso) return '';
  const n = daysBetween(todayStr(), iso);
  if (n < 0) return `${plural(-n, 'day')} overdue`;
  if (n === 0) return 'Today';
  if (n === 1) return 'Tomorrow';
  return `In ${plural(n, 'day')}`;
}
export const nl = (text) => html`<span class="prewrap">${text || ''}</span>`;
// Escapes text for an iCalendar file.
export const icsEsc = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
export function download(filename, text, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a'); a.href = url; a.download = filename; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
