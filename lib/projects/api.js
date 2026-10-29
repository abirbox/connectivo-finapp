// Projects portal backend. The Projects portal is the same app as FinOps,
// but it reads and writes its OWN data (keys "pdata:*" / "pfile:*"), so
// nothing here can ever change the FinOps central books.
'use strict';
import { json } from '../auth.js';

const COLLECTIONS = new Set(['transactions', 'accounts', 'categories', 'businessUnits', 'auditLogs', 'roles', 'documents', 'counters']);
const MAX_BYTES = 4 * 1024 * 1024;

async function readCol(env, name) { return (await env.DB.get('pdata:' + name, { type: 'json' })) || {}; }
async function writeCol(env, name, obj) { await env.DB.put('pdata:' + name, JSON.stringify(obj)); }

function b64ToBytes(b64) {
  const bin = atob(b64), out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function handleProjects(request, env, user) {
  const url = new URL(request.url), p = url.pathname.replace(/^\/projects-api/, ''), m = request.method;
  // A suspended FinOps account cannot use the Projects portal either.
  try {
    const roles = (await env.DB.get('data:roles', { type: 'json' })) || {};
    if (user && roles[user.uid] && roles[user.uid].status === 'suspended') return json(403, { error: 'Your access has been suspended.' });
  } catch (e) { /* ignore */ }

  if (p === '/data' && m === 'POST') {
    let req;
    try { req = await request.json(); } catch (e) { return json(400, { error: 'Invalid request.' }); }
    const { op, collection, id, data } = req;
    if (!COLLECTIONS.has(collection)) return json(400, { error: 'Unknown collection.' });
    if (!['list', 'get', 'set', 'update', 'delete'].includes(op)) return json(400, { error: 'Unknown operation.' });
    if (op !== 'list' && !id) return json(400, { error: 'Missing document id.' });
    const store = await readCol(env, collection);
    if (op === 'list') return json(200, { ok: true, docs: Object.keys(store).map((k) => ({ id: k, ...store[k] })) });
    if (op === 'get') return json(200, { ok: true, doc: store[id] ? { id, ...store[id] } : null });
    if (op === 'set') { store[id] = data && typeof data === 'object' ? data : {}; await writeCol(env, collection, store); return json(200, { ok: true, id }); }
    if (op === 'update') {
      if (!store[id]) return json(400, { error: 'Document does not exist.' });
      store[id] = { ...store[id], ...(data && typeof data === 'object' ? data : {}) };
      await writeCol(env, collection, store); return json(200, { ok: true, id });
    }
    delete store[id]; await writeCol(env, collection, store); return json(200, { ok: true, id });
  }

  if (p === '/upload' && m === 'POST') {
    let b;
    try { b = await request.json(); } catch (e) { return json(400, { error: 'Invalid request.' }); }
    if (!b.dataBase64) return json(400, { error: 'No file data received.' });
    if (Math.floor(b.dataBase64.length * 0.75) > MAX_BYTES) return json(413, { error: 'Files over 4 MB are not supported. Please attach a smaller file.' });
    const id = crypto.randomUUID();
    await env.DB.put('pfile:' + id, b.dataBase64);
    await env.DB.put('pfilemeta:' + id, JSON.stringify({ filename: String(b.filename || 'file').slice(0, 200), contentType: b.contentType || 'application/octet-stream' }));
    return json(200, { ok: true, id });
  }

  if (p === '/file' && m === 'GET') {
    const id = url.searchParams.get('id');
    if (!id) return new Response('Missing id.', { status: 400 });
    const [data, meta] = await Promise.all([env.DB.get('pfile:' + id), env.DB.get('pfilemeta:' + id, { type: 'json' })]);
    if (data == null) return new Response('Not found.', { status: 404 });
    const name = String((meta && meta.filename) || 'file').replace(/[^\w.\- ]/g, '_');
    return new Response(b64ToBytes(data), { status: 200, headers: { 'Content-Type': (meta && meta.contentType) || 'application/octet-stream', 'Content-Disposition': 'inline; filename="' + name + '"', 'Cache-Control': 'private, max-age=3600' } });
  }
  // ---- one-time import of the first-version Projects portal data (read-only access to its old keys)
  if (p === '/legacy' && m === 'GET') {
    const old = await env.DB.get('prj:db', { type: 'json' });
    return json(200, { ok: true, db: old && old.db ? old.db : null });
  }
  if (p === '/legacy-file' && m === 'POST') {
    let b;
    try { b = await request.json(); } catch (e) { return json(400, { error: 'Invalid request.' }); }
    const id = String(b.id || '');
    if (!/^f[a-z0-9]+$/.test(id)) return json(400, { error: 'Bad file id.' });
    const f = await env.DB.get('prj:file:' + id, { type: 'json' });
    if (!f || !f.data) return json(404, { error: 'Old file not found.' });
    await env.DB.put('pfile:' + id, f.data);
    await env.DB.put('pfilemeta:' + id, JSON.stringify({ filename: f.name || 'file', contentType: f.type || 'application/octet-stream' }));
    return json(200, { ok: true, id, name: f.name || 'file', contentType: f.type || 'application/octet-stream', size: Math.floor(f.data.length * 0.75) });
  }
  return json(404, { error: 'Not found.' });
}
