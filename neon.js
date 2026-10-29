// A small client for Neon Auth (sign in) and the Neon Data API (records). No libraries, no build step.
//
// Sign-in is cookie based: Neon Auth sets a session cookie, and we ask it for a short-lived token (15 minutes) that is sent with
// every data request. The database reads who you are from that token and applies the row-level security rules.
// Everything here talks only to the two addresses in config.js.
import { CONFIG } from './config.js';

const AUTH = CONFIG.authUrl.replace(/\/$/, '');
const API = CONFIG.apiUrl.replace(/\/$/, '');

export class NeonError extends Error {
  constructor(message, { code, status, details, hint } = {}) { super(message); this.code = code; this.status = status; this.details = details; this.hint = hint; }
}

// ---- Sign in ------------------------------------------------------------------------------------------------------
async function authFetch(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(AUTH + path, { method, credentials: 'include', headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  } catch (e) { throw new NeonError('Failed to fetch: could not reach the sign-in service.', { code: 'network' }); }
  const text = await res.text();
  let json = null; try { json = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
  if (!res.ok) throw new NeonError(json?.message || `Sign-in service error (${res.status})`, { code: json?.code || String(res.status), status: res.status });
  return json;
}

let token = null;          // { jwt, exp (seconds) }
let tokenRequest = null;   // one refresh at a time

function jwtExp(jwt) { try { return JSON.parse(atob(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).exp; } catch { return 0; } }

export async function getToken(force = false) {
  const now = Date.now() / 1000;
  if (!force && token && token.exp - 60 > now) return token.jwt;
  if (!tokenRequest) {
    tokenRequest = authFetch('/token').then((r) => {
      if (!r?.token) throw new NeonError('You are signed out.', { code: 'signed_out', status: 401 });
      token = { jwt: r.token, exp: jwtExp(r.token) };
      return token.jwt;
    }).finally(() => { tokenRequest = null; });
  }
  return tokenRequest;
}

export const auth = {
  async signUp({ email, password, name }) { const r = await authFetch('/sign-up/email', { method: 'POST', body: { email, password, name } }); token = null; return r; },
  async signIn({ email, password }) { const r = await authFetch('/sign-in/email', { method: 'POST', body: { email, password } }); token = null; return r; },
  async signOut() { try { await authFetch('/sign-out', { method: 'POST', body: {} }); } finally { token = null; } },
  // Returns { user, session } or null when nobody is signed in.
  async getSession() { const r = await authFetch('/get-session'); return r && r.user ? r : null; },
};

// ---- Data -----------------------------------------------------------------------------------------------------------
async function request(method, path, { body, prefer, single } = {}, retried = false) {
  const jwt = await getToken();
  const headers = { authorization: `Bearer ${jwt}` };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (prefer) headers.prefer = prefer;
  if (single) headers.accept = 'application/vnd.pgrst.object+json';
  let res;
  try { res = await fetch(API + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }); }
  catch (e) { throw new NeonError('Failed to fetch: could not reach the server.', { code: 'network' }); }
  const text = await res.text();
  let json = null; try { json = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
  if (res.status === 401 && !retried) { token = null; return request(method, path, { body, prefer, single }, true); }
  if (!res.ok) throw new NeonError(json?.message || `Request failed (${res.status})`, { code: json?.code || String(res.status), status: res.status, details: json?.details, hint: json?.hint });
  return json;
}

// PostgREST values in filters: commas, brackets and colons need quoting inside in.(...)
const q = (v) => encodeURIComponent(String(v));
const inList = (list) => `(${list.map((v) => (/[,()"\s]/.test(String(v)) ? `"${String(v).replace(/"/g, '\\"')}"` : String(v))).join(',')})`;

// A query you build up and then await, in the style  from('parties').select('*').eq('side', 'brand').order('name')
class Query {
  constructor(table) { this.table = table; this.method = 'GET'; this.params = []; this.cols = '*'; this.payload = undefined; this.returnRows = true; this.one = false; this.maybe = false; this.lim = null; this.off = null; }
  select(cols = '*') { this.cols = cols; this.returnRows = true; return this; }
  insert(rows) { this.method = 'POST'; this.payload = rows; this.returnRows = false; return this; }
  update(values) { this.method = 'PATCH'; this.payload = values; this.returnRows = false; return this; }
  eq(c, v) { this.params.push(`${c}=eq.${q(v)}`); return this; }
  neq(c, v) { this.params.push(`${c}=neq.${q(v)}`); return this; }
  gt(c, v) { this.params.push(`${c}=gt.${q(v)}`); return this; }
  gte(c, v) { this.params.push(`${c}=gte.${q(v)}`); return this; }
  lt(c, v) { this.params.push(`${c}=lt.${q(v)}`); return this; }
  lte(c, v) { this.params.push(`${c}=lte.${q(v)}`); return this; }
  is(c, v) { this.params.push(`${c}=is.${v === null ? 'null' : v}`); return this; }
  in(c, list) { this.params.push(`${c}=in.${encodeURIComponent(inList(list))}`); return this; }
  order(c, { ascending = true } = {}) { this.params.push(`order=${c}.${ascending ? 'asc' : 'desc'}`); return this; }
  limit(n) { this.lim = n; return this; }
  range(from, to) { this.off = from; this.lim = to - from + 1; return this; }
  single() { this.one = true; return this; }
  maybeSingle() { this.maybe = true; return this; }
  async run() {
    const parts = [...this.params];
    if (this.method === 'GET' || this.returnRows) parts.push(`select=${encodeURIComponent(this.cols)}`);
    if (this.lim !== null) parts.push(`limit=${this.lim}`);
    if (this.off) parts.push(`offset=${this.off}`);
    const prefer = this.method === 'GET' ? undefined : (this.returnRows ? 'return=representation' : 'return=minimal');
    const data = await request(this.method, `/${this.table}${parts.length ? `?${parts.join('&')}` : ''}`, { body: this.payload, prefer, single: this.one });
    if (this.maybe) return Array.isArray(data) ? (data[0] ?? null) : data;
    return data;
  }
  then(resolve, reject) {
    return this.run().then((data) => ({ data, error: null }), (error) => ({ data: null, error })).then(resolve, reject);
  }
}

export const from = (table) => new Query(table);
export async function rpc(name, args = {}) {
  try { return { data: await request('POST', `/rpc/${name}`, { body: args }), error: null }; }
  catch (error) { return { data: null, error }; }
}
