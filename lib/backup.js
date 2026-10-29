// Backup & restore for every portal. The browser drives it in small steps (list keys, read a few
// values, write a few values) so each request stays well inside the free-plan limits
// (50 subrequests and 10 ms CPU per request). Only CEO / developer accounts may use it.
'use strict';
import { getSessionFromRequest, json } from './auth.js';

const SCOPES = {
  finops:   ['data:', 'file:', 'filemeta:'],
  salary:   ['sal:'],
  invoice:  ['inv:'],
  projects: ['pdata:', 'pfile:', 'pfilemeta:', 'prj:'],
};
SCOPES.all = [].concat(SCOPES.finops, SCOPES.salary, SCOPES.invoice, SCOPES.projects);
const SKIP = (k) => k.indexOf(':backup:') !== -1;           // daily safety snapshots are not part of an export
const BIG = 400 * 1024, BATCH_BYTES = 1200 * 1024;

function allowed(scope, key) {
  const pre = SCOPES[scope];
  return !!pre && typeof key === 'string' && key.length < 600 && pre.some((p) => key.startsWith(p)) && !SKIP(key);
}

export async function handleBackup(request, env) {
  const s = await getSessionFromRequest(request, env);
  if (!s) return json(401, { error: 'Not signed in.' });
  if (s.role !== 'ceo' && s.role !== 'developer') return json(403, { error: 'Only CEO or developer accounts can download or upload data.' });
  const url = new URL(request.url), p = url.pathname.replace(/^\/api\/backup/, ''), m = request.method;
  if (m === 'POST' && request.headers.get('X-Portal') !== '1') return json(400, { error: 'Bad request.' });

  // raw single value (big files) ------------------------------------------------------------
  if (p === '/raw') {
    const scope = url.searchParams.get('scope'), key = url.searchParams.get('key');
    if (!allowed(scope, key)) return json(400, { error: 'Key not allowed.' });
    if (m === 'GET') {
      const v = await env.DB.get(key);
      if (v == null) return json(404, { error: 'Missing.' });
      return new Response(v, { status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
    }
    if (m === 'POST') { await env.DB.put(key, await request.text()); return json(200, { ok: true }); }
  }
  if (m !== 'POST') return json(405, { error: 'Method not allowed.' });
  let b;
  try { b = await request.json(); } catch (e) { return json(400, { error: 'Invalid request.' }); }
  const scope = b.scope;
  if (!SCOPES[scope]) return json(400, { error: 'Unknown scope.' });

  if (p === '/keys') {                                      // list one page of keys
    const pi = Math.max(0, Number(b.pi) || 0);
    if (pi >= SCOPES[scope].length) return json(200, { ok: true, keys: [], done: true });
    const r = await env.DB.list({ prefix: SCOPES[scope][pi], cursor: b.cursor || undefined, limit: 1000 });
    const keys = r.keys.map((k) => k.name).filter((k) => !SKIP(k));
    const more = !r.list_complete;
    return json(200, { ok: true, keys, pi: more ? pi : pi + 1, cursor: more ? r.cursor : null, done: !more && pi + 1 >= SCOPES[scope].length });
  }
  if (p === '/get') {                                       // read several small values (big ones are flagged)
    const out = {}, big = [], left = []; let bytes = 0;
    const keys = (b.keys || []).slice(0, 40);
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      if (!allowed(scope, k)) continue;
      if (bytes > BATCH_BYTES) { left.push(k); continue; }
      const v = await env.DB.get(k);
      if (v == null) continue;
      if (v.length > BIG) { big.push(k); continue; }
      out[k] = v; bytes += v.length;
    }
    return json(200, { ok: true, items: out, big, left });
  }
  if (p === '/put') {
    const items = (b.items || []).slice(0, 40); let n = 0;
    for (const it of items) { if (!allowed(scope, it[0]) || typeof it[1] !== 'string') continue; await env.DB.put(it[0], it[1]); n++; }
    return json(200, { ok: true, n });
  }
  if (p === '/delete') {
    const keys = (b.keys || []).slice(0, 40); let n = 0;
    for (const k of keys) { if (!allowed(scope, k)) continue; await env.DB.delete(k); n++; }
    return json(200, { ok: true, n });
  }
  return json(404, { error: 'Not found.' });
}
