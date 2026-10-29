// Connectivo FinOps — Worker entry point (Workers-with-static-assets model).
// Unlike Pages Functions, a plain Worker has no automatic file-based
// routing, so this one file dispatches every /api/* request itself and
// falls through to the static site (index.html etc.) for everything else.
import {
  makeSessionToken, cookieFor, clearCookie,
  getSessionFromRequest, json,
} from '../lib/auth.js';
import { readCollection, writeCollection, putFile, getFile } from '../lib/store.js';
import { handleSalary, payrollSummary } from '../lib/salary/api.js';
import { handleInvoice } from '../lib/invoice/api.js';
import { handleProjects } from '../lib/projects/api.js';
import { handleBackup } from '../lib/backup.js';
import { checkCredentials, getProfile, updateOwnProfile, listProfilesSafe, createStaffUser, updateStaffUser, deleteStaffUser } from '../lib/accounts.js';

const ALLOWED_COLLECTIONS = new Set([
  'transactions', 'accounts', 'categories', 'businessUnits',
  'auditLogs', 'roles', 'documents', 'counters',
]);
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024; // 4 MB

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const { pathname } = url;
    const method = request.method;

    try {
      // BUG FIX: these were `return handleXxx(...)` — returning the promise
      // directly WITHOUT awaiting it. That means if the async handler
      // threw, the rejection happened after this try block had already
      // "returned" and exited, so the catch below never ran — the error
      // went completely uncaught, which is exactly what surfaced as
      // Cloudflare's generic "Error 1101" instead of a real JSON response.
      if (pathname === '/api/auth/login' && method === 'POST') return await handleLogin(request, env);
      if (pathname === '/api/auth/logout' && method === 'POST') return await handleLogout();
      if (pathname === '/api/auth/session' && method === 'GET') return await handleSession(request, env);
      if (pathname === '/api/data' && method === 'POST') return await handleData(request, env);
      if (pathname === '/api/upload' && method === 'POST') return await handleUpload(request, env);
      if (pathname === '/api/file' && method === 'GET') return await handleFile(request, env);
      if (pathname === '/api/profile' && method === 'GET') return await handleProfileGet(request, env);
      if (pathname === '/api/profile' && method === 'POST') return await handleProfileUpdate(request, env);
      if (pathname === '/api/users' && method === 'POST') return await handleUsersAdmin(request, env);
      if (pathname === '/api/accounts' && method === 'GET') return await handleAccountsList(request, env);
      if (pathname === '/api/payroll/fetch' && method === 'POST') return await handlePayrollFetch(request, env);
      if (pathname.startsWith('/api/backup/')) return await handleBackup(request, env);
      if (pathname.startsWith('/salary-api/')) {
        const s = await getSessionFromRequest(request, env);
        if (!s) return json(401, { error: 'Not signed in.' });
        if (!['ceo', 'developer', 'admin'].includes(s.role)) return json(403, { error: 'Not authorized.' });
        return await handleSalary(request, env, { username: s.name, display: s.name });
      }
      if (pathname.startsWith('/invoice-api/')) {
        const s = await getSessionFromRequest(request, env);
        if (!s) return json(401, { error: 'Not signed in.' });
        if (!['ceo', 'developer', 'admin'].includes(s.role)) return json(403, { error: 'Not authorized.' });
        return await handleInvoice(request, env, { username: s.name, display: s.name });
      }
      if (pathname.startsWith('/projects-api/')) {
        const s = await getSessionFromRequest(request, env);
        if (!s) return json(401, { error: 'Not signed in.' });
        if (!['ceo', 'developer', 'admin'].includes(s.role)) return json(403, { error: 'Not authorized.' });
        return await handleProjects(request, env, { uid: s.uid, role: s.role, name: s.name });
      }
      if (pathname === '/projects' || pathname === '/projects/' || pathname === '/projects/index.html') {
        const s = await getSessionFromRequest(request, env);
        if (!s || !['ceo', 'developer', 'admin'].includes(s.role)) return Response.redirect(new URL('/', request.url).toString(), 302);
        const r = await env.ASSETS.fetch(new Request(new URL('/projects/index.html', request.url).toString()));
        const h = new Headers(r.headers); h.set('Cache-Control', 'no-store');
        return new Response(r.body, { status: r.status, headers: h });
      }
      if (pathname === '/invoice' || pathname === '/invoice/' || pathname === '/invoice/index.html') {
        const s = await getSessionFromRequest(request, env);
        if (!s || !['ceo', 'developer', 'admin'].includes(s.role)) return Response.redirect(new URL('/', request.url).toString(), 302);
        const r = await env.ASSETS.fetch(new Request(new URL('/invoice/index.html', request.url).toString()));
        const h = new Headers(r.headers); h.set('Cache-Control', 'no-store');
        return new Response(r.body, { status: r.status, headers: h });
      }
      if (pathname === '/salary' || pathname === '/salary/' || pathname === '/salary/index.html') {
        const s = await getSessionFromRequest(request, env);
        if (!s || !['ceo', 'developer', 'admin'].includes(s.role)) return Response.redirect(new URL('/', request.url).toString(), 302);
        const r = await env.ASSETS.fetch(new Request(new URL('/salary/index.html', request.url).toString()));
        const h = new Headers(r.headers); h.set('Cache-Control', 'no-store');
        return new Response(r.body, { status: r.status, headers: h });
      }
    } catch (e) {
      console.error('worker error:', e);
      return json(500, { error: 'Server error. Please try again.' });
    }

    // Not one of our API routes — serve the static site (index.html, etc.)
    return env.ASSETS.fetch(request);
  },
};

async function handleLogin(request, env) {
  let body;
  try { body = await request.json(); }
  catch (e) { return json(400, { error: 'Invalid request.' }); }

  const acct = await checkCredentials(body.username, body.password, env);
  if (!acct) return json(401, { error: 'Incorrect username or password.' });
  if (acct.role === 'staff') {
    const roles = await readCollection(env, 'roles');
    if (roles[acct.uid] && roles[acct.uid].status === 'suspended') return json(403, { error: 'Your access has been suspended. Please contact the CEO or Super Admin.' });
  }

  const token = await makeSessionToken(acct, env);
  const perms = acct.role === 'staff' ? (acct.perms || { pages: [], edit: false }) : null;
  return json(200, { ok: true, uid: acct.uid, name: acct.name, role: acct.role, perms }, { 'Set-Cookie': cookieFor(token) });
}

async function handleLogout() {
  return json(200, { ok: true }, { 'Set-Cookie': clearCookie() });
}

async function handleSession(request, env) {
  const session = await getSessionFromRequest(request, env);
  if (!session) return json(401, { ok: false, error: 'Not signed in.' });
  let perms = null;
  if (session.role === 'staff') {
    const p = await getProfile(env, session.uid);
    if (!p) return json(401, { ok: false, error: 'Account no longer exists.' });
    perms = p.perms || { pages: [], edit: false };
  }
  return json(200, { ok: true, uid: session.uid, name: session.name, role: session.role, perms });
}

async function handleData(request, env) {
  const session = await getSessionFromRequest(request, env);
  if (!session) return json(401, { error: 'Not signed in.' });

  let req;
  try { req = await request.json(); }
  catch (e) { return json(400, { error: 'Invalid request.' }); }

  const { op, collection, id, data } = req;
  if (!ALLOWED_COLLECTIONS.has(collection)) return json(400, { error: 'Unknown collection.' });
  if (!['list', 'get', 'set', 'update', 'delete'].includes(op)) return json(400, { error: 'Unknown operation.' });
  if (op !== 'list' && !id) return json(400, { error: 'Missing document id.' });

  if (collection === 'roles' && (op === 'set' || op === 'update') && id !== session.uid) {
    if (session.role !== 'ceo' && session.role !== 'developer' && session.role !== 'admin') return json(403, { error: 'Not authorized to change that account.' });
  }
  // Deleting a transaction outright is available to any signed-in account
  // (CEO, Admin, Developer) — this app deliberately has no void-only
  // restriction; editing and removing records directly is the intended
  // workflow.

  // Staff accounts (created by CEO/Super Admin): writes need the "can edit" permission;
  // sections they weren't given (Documents, Audit) come back empty.
  if (session.role === 'staff') {
    const p = await getProfile(env, session.uid);
    if (!p) return json(401, { error: 'Account no longer exists.' });
    const perms = p.perms || { pages: [], edit: false };
    const roleDocs = await readCollection(env, 'roles');
    if (roleDocs[session.uid] && roleDocs[session.uid].status === 'suspended') return json(403, { error: 'Your access has been suspended.' });
    if (op === 'set' || op === 'update' || op === 'delete') {
      const free = collection === 'auditLogs' || (collection === 'roles' && id === session.uid);
      if (!free && !perms.edit) return json(403, { error: 'Your account is view-only.' });
    } else {
      const need = { documents: '#/documents', auditLogs: '#/audit' }[collection];
      if (need && !perms.pages.includes(need)) return json(200, op === 'list' ? { ok: true, docs: [] } : { ok: true, doc: null });
    }
  }

  const store = await readCollection(env, collection);

  if (op === 'list') {
    const docs = Object.keys(store).map((k) => ({ id: k, ...store[k] }));
    return json(200, { ok: true, docs });
  }
  if (op === 'get') {
    const doc = store[id];
    return json(200, { ok: true, doc: doc ? { id, ...doc } : null });
  }
  if (op === 'set') {
    store[id] = data && typeof data === 'object' ? data : {};
    await writeCollection(env, collection, store);
    return json(200, { ok: true, id });
  }
  if (op === 'update') {
    if (!store[id]) return json(400, { error: 'Document does not exist.' });
    store[id] = { ...store[id], ...(data && typeof data === 'object' ? data : {}) };
    await writeCollection(env, collection, store);
    return json(200, { ok: true, id });
  }
  if (op === 'delete') {
    delete store[id];
    await writeCollection(env, collection, store);
    return json(200, { ok: true, id });
  }
}

async function handleUpload(request, env) {
  const session = await getSessionFromRequest(request, env);
  if (!session) return json(401, { error: 'Not signed in.' });
  if (session.role === 'staff') {
    const p = await getProfile(env, session.uid);
    if (!p || !(p.perms && p.perms.edit)) return json(403, { error: 'Your account is view-only.' });
  }

  let body;
  try { body = await request.json(); }
  catch (e) { return json(400, { error: 'Invalid request.' }); }

  const { filename, contentType, dataBase64 } = body;
  if (!dataBase64) return json(400, { error: 'No file data received.' });
  const approxBytes = Math.floor(dataBase64.length * 0.75);
  if (approxBytes > MAX_UPLOAD_BYTES) return json(413, { error: 'Files over 4 MB are not supported. Please attach a smaller file.' });

  const id = crypto.randomUUID();
  await putFile(env, id, dataBase64, {
    filename: (filename || 'file').slice(0, 200),
    contentType: contentType || 'application/octet-stream',
  });
  return json(200, { ok: true, id });
}

async function handleProfileGet(request, env) {
  const session = await getSessionFromRequest(request, env);
  if (!session) return json(401, { error: 'Not signed in.' });
  const profile = await getProfile(env, session.uid);
  if (!profile) return json(404, { error: 'Account not found.' });
  return json(200, { ok: true, uid: profile.uid, username: profile.username, name: profile.name, role: profile.role, avatarId: profile.avatarId || null, perms: profile.perms || null });
}

async function handleProfileUpdate(request, env) {
  const session = await getSessionFromRequest(request, env);
  if (!session) return json(401, { error: 'Not signed in.' });

  let body;
  try { body = await request.json(); }
  catch (e) { return json(400, { error: 'Invalid request.' }); }

  const result = await updateOwnProfile(env, session.uid, {
    currentPassword: body.currentPassword,
    newUsername: body.newUsername,
    newName: body.newName,
    newPassword: body.newPassword,
    newAvatarId: body.newAvatarId,
  });
  if (!result.ok) return json(400, { error: result.error });
  return json(200, {
    ok: true, uid: result.profile.uid, username: result.profile.username,
    name: result.profile.name, role: result.profile.role, avatarId: result.profile.avatarId || null,
  });
}

async function handleAccountsList(request, env) {
  const session = await getSessionFromRequest(request, env);
  if (!session) return json(401, { error: 'Not signed in.' });
  const profiles = await listProfilesSafe(env);
  return json(200, { ok: true, accounts: profiles });
}

function base64ToBytes(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
async function handleFile(request, env) {
  const session = await getSessionFromRequest(request, env);
  if (!session) return new Response('Not signed in.', { status: 401 });

  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  if (!id) return new Response('Missing id.', { status: 400 });

  const result = await getFile(env, id);
  if (!result) return new Response('Not found.', { status: 404 });
  const bytes = base64ToBytes(result.base64);
  const safeName = String(result.meta.filename || 'file').replace(/[^\w.\- ]/g, '_');
  return new Response(bytes, {
    status: 200,
    headers: {
      'Content-Type': result.meta.contentType || 'application/octet-stream',
      'Content-Disposition': `inline; filename="${safeName}"`,
      'Cache-Control': 'private, max-age=3600',
    },
  });
}

// Finalized payroll TOTALS for the Payroll Import page - read directly from the built-in Payroll/Attendance Portal.
async function handlePayrollFetch(request, env) {
  const session = await getSessionFromRequest(request, env);
  if (!session) return json(401, { error: 'Not signed in.' });
  if (!['ceo', 'developer', 'admin'].includes(session.role)) return json(403, { error: 'Not authorized.' });
  let body; try { body = await request.json(); } catch (e) { return json(400, { error: 'Invalid request.' }); }
  const month = String(body.month || '');
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return json(400, { error: 'Choose a month.' });
  return json(200, await payrollSummary(env, month));
}

// CEO / Super Admin / Developer: create, change and remove staff accounts and their access.
async function handleUsersAdmin(request, env) {
  const session = await getSessionFromRequest(request, env);
  if (!session) return json(401, { error: 'Not signed in.' });
  if (!['ceo', 'developer', 'admin'].includes(session.role)) return json(403, { error: 'Not authorized.' });
  let b; try { b = await request.json(); } catch (e) { return json(400, { error: 'Invalid request.' }); }
  let r;
  if (b.action === 'create') r = await createStaffUser(env, b);
  else if (b.action === 'update') r = await updateStaffUser(env, String(b.uid || ''), b);
  else if (b.action === 'delete') r = await deleteStaffUser(env, String(b.uid || ''));
  else return json(400, { error: 'Unknown action.' });
  if (!r.ok) return json(400, { error: r.error });
  if (b.action === 'delete') {
    const roles = await readCollection(env, 'roles');
    if (roles[b.uid]) { delete roles[b.uid]; await writeCollection(env, 'roles', roles); }
  }
  return json(200, r);
}
