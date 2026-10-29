// Connectivo Salary / Attendance Portal - API, running inside the FinOps Worker (same login, same KV).
// Everything is stored in the FinOps KV namespace under the "sal:" prefix.
import { Buffer } from 'node:buffer';
import { monthLabel, money } from './pdf.js';
import * as mail from './mail.js';
import * as banks from './banks.js';

const DOC_EXT = new Set(['pdf', 'png', 'jpg', 'jpeg', 'doc', 'docx', 'xls', 'xlsx', 'txt', 'csv']);
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.pdf': 'application/pdf', '.txt': 'text/plain; charset=utf-8', '.csv': 'text/csv' };
const MAX_JSON = 24 * 1024 * 1024, MAX_FILE = 24 * 1024 * 1024;
const DEFAULT_DB = () => ({ s: {}, emps: [], att: [], slips: {}, log: [], nid: 1, aid: 1, docs: [], did: 1 });

async function loadState(env) {
  const raw = await env.DB.get('sal:db', { type: 'json' });
  const st = raw || { rev: 1, db: DEFAULT_DB() };
  st.db.docs = st.db.docs || []; st.db.did = st.db.did || 1; st.audit = st.audit || [];
  return st;
}
async function saveState(env, st) {
  const day = new Date().toISOString().slice(0, 10);
  if (st.lastBackup !== day) { st.lastBackup = day; try { await env.DB.put('sal:backup:' + day, JSON.stringify({ rev: st.rev, db: st.db }), { expirationTtl: 60 * 86400 }); } catch (e) {} }
  await env.DB.put('sal:db', JSON.stringify(st));
}
function note(st, who, action, detail) { st.audit.push([new Date().toISOString(), who, action, String(detail || '').slice(0, 200)]); if (st.audit.length > 200) st.audit.splice(0, st.audit.length - 200); }
async function getSecrets(env) { return (await env.DB.get('sal:secrets', { type: 'json' })) || {}; }

const baseHeaders = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin' };
function send(code, body, headers) {
  const h = Object.assign({}, baseHeaders, headers || {});
  if (body && typeof body === 'object' && !(body instanceof Uint8Array)) { body = JSON.stringify(body); h['Content-Type'] = 'application/json; charset=utf-8'; h['Cache-Control'] = 'no-store'; }
  return new Response(body, { status: code, headers: h });
}
const fail = (code, msg, extra) => send(code, Object.assign({ error: msg }, extra || {}));
async function readBuf(request, limit) {
  const len = +request.headers.get('content-length') || 0; if (len > limit) throw Object.assign(new Error('File or data is too large.'), { status: 413 });
  const b = Buffer.from(await request.arrayBuffer()); if (b.length > limit) throw Object.assign(new Error('File or data is too large.'), { status: 413 }); return b;
}
async function readJson(request, limit) { const b = await readBuf(request, limit || MAX_JSON); try { return JSON.parse(b.toString('utf8') || '{}'); } catch (e) { throw Object.assign(new Error('Bad request data.'), { status: 400 }); } }

function emailSettings(d) { const s = d.s || {}; return { provider: s.mailProvider === 'resend' ? 'resend' : 'brevo', fromName: s.mailFromName || s.company || 'Connectivo', fromEmail: s.mailFromEmail || '', replyTo: s.mailReplyTo || '' }; }
function fillTpl(t, v) { let o = t || ''; Object.keys(v).forEach(k => { o = o.split('{' + k + '}').join(v[k]); }); return o; }
function slipFor(d, eid, month) {
  const s = d.slips[eid + '|' + month], e = d.emps.find(x => x.id === +eid);
  if (!s || !e) throw Object.assign(new Error('Payslip not found. Save it first.'), { status: 404 });
  return { s, e };
}
// PDFs are built in the browser (Cloudflare's free plan allows only ~10 ms of CPU per request), the Worker only stores / emails them.
function pdfFrom(b) {
  if (!b || typeof b.pdf !== 'string' || b.pdf.length < 100) throw Object.assign(new Error('The PDF was not received. Please refresh the page and try again.'), { status: 400 });
  const buf = Buffer.from(b.pdf, 'base64'); if (buf.length < 100 || buf.subarray(0, 5).toString('latin1') !== '%PDF-') throw Object.assign(new Error('That is not a valid PDF.'), { status: 400 });
  return buf;
}
const attName = (e, month) => 'Attendance_Report_' + e.name.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '') + '_' + month + '.pdf';
const pdfName = (e, month) => 'Payslip_' + e.name.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '') + '_' + month + '.pdf';
const rnd = n => { const a = new Uint8Array(n); crypto.getRandomValues(a); return Array.from(a, x => x.toString(16).padStart(2, '0')).join(''); };
async function fileDoc(env, d, who, eid, month, buf, name) {
  const stored = 'payslip_' + eid + '_' + month + '_' + rnd(4) + '.pdf';
  await env.DB.put('sal:file:' + stored, buf);
  const doc = { id: d.did++, eid: +eid, type: 'Payslip', kind: 'payslip', month, title: 'Payslip ' + monthLabel(month), orig: name, stored, at: new Date().toLocaleString('en-GB'), by: who };
  d.docs.push(doc); return doc;
}
async function dropDoc(env, d, id) {
  const i = d.docs.findIndex(x => x.id === id); if (i < 0) return;
  try { await env.DB.delete('sal:file:' + d.docs[i].stored); } catch (e) {}
  d.docs.splice(i, 1);
}

export async function payrollSummary(env, month) {
  const st = await loadState(env), d = st.db, r2 = v => Math.round((+v || 0) * 100) / 100, depts = {}, T = { employees: 0, earnings: 0, deductions: 0, pardoned: 0, overtime: 0, net: 0 };
  const emps = new Map((d.emps || []).map(e => [e.id, e])); const fin = new Set();
  Object.keys(d.slips || {}).forEach(k => {
    const s = d.slips[k]; if (!s || s.month !== month || s.status !== 'Finalized') return; const e = emps.get(s.eid); fin.add(s.eid);
    const name = (e && e.dept) || 'Unassigned', x = depts[name] || (depts[name] = { name, employees: 0, earnings: 0, deductions: 0, pardoned: 0, overtime: 0, net: 0 });
    const ot = (s.earn || []).filter(l => l.l === 'Over Time').reduce((a, l) => a + (+l.a || 0), 0);
    [x, T].forEach(o => { o.employees++; o.earnings += +s.te || 0; o.deductions += +s.td || 0; o.pardoned += +s.tp || 0; o.overtime += ot; o.net += +s.net || 0; });
  });
  const pending = (d.emps || []).filter(e => e.status !== 'Inactive' && !fin.has(e.id)).length;
  const fix = o => { Object.keys(o).forEach(k => { if (typeof o[k] === 'number' && k !== 'employees') o[k] = r2(o[k]); }); return o; };
  return { ok: true, month, currency: 'BDT', company: (d.s || {}).company || 'Connectivo', generatedAt: new Date().toISOString(), totals: fix(T), departments: Object.values(depts).map(fix), notFinalizedEmployees: pending };
}

async function loadAssets(env, request) {
  const origin = new URL(request.url).origin;
  const get = async path => { try { const r = await env.ASSETS.fetch(new Request(origin + path)); if (!r.ok) return null; if ((r.headers.get('content-type') || '').includes('text/html')) return null; return Buffer.from(await r.arrayBuffer()); } catch (e) { return null; } };
  banks.setHost({ asset: get, kv: env.DB });
  return get;
}
/** user = { username, display } from the FinOps session. */
export async function handleSalary(request, env, user) {
  const url = new URL(request.url), p = url.pathname.replace(/^\/salary-api/, '/api'), m = request.method;
  if (m !== 'GET' && m !== 'HEAD' && request.headers.get('x-portal') !== '1') return fail(403, 'Blocked (missing header).');
  try {
    await loadAssets(env, request); const who = user.username;
    if (p === '/api/session' && m === 'GET') {
      const st = await loadState(env);
      return send(200, { setup: false, embedded: true, user: { id: 1, username: user.username, display: user.display, role: 'admin', active: true }, company: (st.db.s || {}).company || 'Connectivo' });
    }
    if (p === '/api/logout' && m === 'POST') return send(200, { ok: true });
    if (p === '/api/db' && m === 'GET') { const st = await loadState(env); return send(200, { rev: st.rev, db: st.db }); }
    if (p === '/api/db' && m === 'PUT') {
      const b = await readJson(request);
      if (!b.db || typeof b.db !== 'object' || !b.db.s || !Array.isArray(b.db.emps) || !Array.isArray(b.db.att) || typeof b.db.slips !== 'object') return fail(400, 'Invalid data.');
      const st = await loadState(env);
      if (b.rev !== st.rev) return fail(409, 'conflict', { rev: st.rev });
      st.db = Object.assign({}, b.db, { docs: st.db.docs, did: st.db.did }); st.rev++; await saveState(env, st);
      return send(200, { rev: st.rev });
    }
    if (p === '/api/backup' && m === 'GET') {
      const st = await loadState(env);
      return send(200, JSON.stringify({ exported: new Date().toISOString(), db: st.db }), { 'Content-Type': 'application/json', 'Content-Disposition': 'attachment; filename="connectivo-salary-backup-' + new Date().toISOString().slice(0, 10) + '.json"', 'Cache-Control': 'no-store' });
    }
    if (p === '/api/restore' && m === 'POST') {
      const b = await readJson(request); const nd = b.db || b;
      if (!nd || !nd.s || !Array.isArray(nd.emps) || !Array.isArray(nd.att)) return fail(400, 'That is not a valid backup file.');
      const st = await loadState(env); nd.docs = st.db.docs; nd.did = st.db.did; st.db = Object.assign(DEFAULT_DB(), nd); st.rev++; note(st, who, 'restore', ''); await saveState(env, st); return send(200, { ok: true });
    }
    if (p === '/api/docs' && m === 'POST') {
      const eid = +url.searchParams.get('eid'), name = String(url.searchParams.get('name') || 'file').replace(/[\\/]/g, '_').slice(0, 120);
      const ext = (name.split('.').pop() || '').toLowerCase();
      const st = await loadState(env), d = st.db;
      if (!d.emps.some(e => e.id === eid)) return fail(404, 'Employee not found.');
      if (!DOC_EXT.has(ext)) return fail(400, 'File type .' + ext + ' is not allowed.');
      const buf = await readBuf(request, MAX_FILE); if (!buf.length) return fail(400, 'The file is empty.');
      const stored = 'e' + eid + '_' + rnd(5) + '_' + name.replace(/[^A-Za-z0-9._-]+/g, '_');
      await env.DB.put('sal:file:' + stored, buf);
      const doc = { id: d.did++, eid, type: String(url.searchParams.get('type') || 'Other').slice(0, 60), title: String(url.searchParams.get('title') || '').slice(0, 120), orig: name, stored, at: new Date().toLocaleString('en-GB'), by: who };
      d.docs.push(doc); st.rev++; note(st, who, 'doc_upload', eid + ' ' + name); await saveState(env, st);
      return send(200, { ok: true, doc, rev: st.rev });
    }
    let mm = /^\/api\/docs\/(\d+)$/.exec(p);
    if (mm && m === 'GET') {
      const st = await loadState(env), d = st.db.docs.find(x => x.id === +mm[1]); if (!d) return fail(404, 'Not found.');
      const data = await env.DB.get('sal:file:' + d.stored, { type: 'arrayBuffer' }); if (!data) return fail(404, 'File is missing on the server.');
      const ext = ('.' + (d.orig.split('.').pop() || '')).toLowerCase();
      return send(200, new Uint8Array(data), { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Content-Disposition': (url.searchParams.get('dl') === '1' ? 'attachment' : 'inline') + '; filename="' + d.orig.replace(/"/g, '') + '"', 'Cache-Control': 'no-store' });
    }
    if (mm && m === 'DELETE') {
      const id = +mm[1], st = await loadState(env), d0 = st.db.docs.find(x => x.id === id); if (!d0) return fail(404, 'Not found.');
      await dropDoc(env, st.db, id); for (const k in st.db.slips) if (st.db.slips[k].docId === id) delete st.db.slips[k].docId;
      st.rev++; note(st, who, 'doc_delete', d0.orig); await saveState(env, st); return send(200, { ok: true, rev: st.rev });
    }
    if (p === '/api/banklogo' && m === 'GET') {
      const dom = String(url.searchParams.get('d') || '').toLowerCase(), st = await loadState(env);
      if (!banks.allowed(dom, st.db.s.customBanks)) return fail(404, 'Unknown bank.');
      const png = await banks.logoPng(dom); if (!png) return fail(404, 'Logo not available.');
      return send(200, new Uint8Array(png), { 'Content-Type': 'image/png', 'Cache-Control': 'private, max-age=604800' });
    }
    if (p === '/api/payslips/file' && m === 'POST') {
      const b = await readJson(request, 3e6), st = await loadState(env), d = st.db;
      const { e } = slipFor(d, b.eid, b.month), buf = pdfFrom(b), s = d.slips[b.eid + '|' + b.month];
      if (s.docId) await dropDoc(env, d, s.docId);
      s.docId = (await fileDoc(env, d, who, b.eid, b.month, buf, pdfName(e, b.month))).id;
      st.rev++; note(st, who, 'payslip_filed', e.name + ' ' + b.month); await saveState(env, st); return send(200, { ok: true, rev: st.rev });
    }
    if (p === '/api/payslips/unfile' && m === 'POST') {
      const b = await readJson(request, 1e5), st = await loadState(env), s = st.db.slips[b.eid + '|' + b.month];
      if (s && s.docId) { await dropDoc(env, st.db, s.docId); delete s.docId; } if (s) { delete s.sent; delete s.sendStatus; delete s.sendError; }
      st.rev++; note(st, who, 'payslip_reopened', b.eid + ' ' + b.month); await saveState(env, st); return send(200, { ok: true, rev: st.rev });
    }
    if (p === '/api/payslips/send' && m === 'POST') {
      const b = await readJson(request, 7e6), st = await loadState(env), d0 = st.db, { s, e } = slipFor(d0, b.eid, b.month);
      if (s.status !== 'Finalized') return fail(400, 'Finalize the payslip before sending.');
      if (!(e.email || '').trim()) return fail(400, e.name + ' has no email address. Add it in the employee profile.');
      if (s.sent && !b.force) return fail(409, 'already_sent', { sent: s.sent });
      const es = emailSettings(d0), sec = await getSecrets(env), key = sec[es.provider === 'resend' ? 'resendKey' : 'brevoKey'];
      const vals = { name: e.name, month: monthLabel(b.month), company: d0.s.company || 'Connectivo', net_pay: money(s.net), designation: e.desig || '' };
      const coverIsAuto = txt => { const tp = d0.s.cover || ''; if (!tp) return false; const re = new RegExp('^' + tp.split(/\{[a-z_]+\}/i).map(x => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[^\\n]*?') + '$'); return re.test(String(txt).replace(/\r/g, '')); };
      const text = typeof b.cover === 'string' && b.cover.trim() ? b.cover : (s.cover && !coverIsAuto(s.cover) ? s.cover : fillTpl(d0.s.cover, vals));
      try {
        const id = await mail.send(es.provider, key, { fromName: es.fromName, fromEmail: es.fromEmail, replyTo: es.replyTo, to: e.email.trim(), toName: e.name, subject: fillTpl(d0.s.subject || 'Payslip for {month} - {company}', vals), text, attachments: [{ name: pdfName(e, b.month), buffer: pdfFrom(b) }].concat(b.att ? [{ name: attName(e, b.month), buffer: pdfFrom({ pdf: b.att }) }] : []) });
        if (b.att) { d0.attsent = d0.attsent || {}; d0.attsent[b.eid + '|' + b.month] = new Date().toLocaleString('en-GB'); }
        s.cover = text; s.sent = new Date().toLocaleString('en-GB'); s.sendStatus = 'Sent'; s.sendError = '';
        st.rev++; note(st, who, 'payslip_sent', e.name + ' ' + b.month + ' -> ' + e.email + ' (' + id + ')'); await saveState(env, st);
        return send(200, { ok: true, rev: st.rev, to: e.email });
      } catch (err) {
        s.sendStatus = 'Failed'; s.sendError = String(err.message).slice(0, 300); s.cover = text; st.rev++; await saveState(env, st);
        return fail(502, err.message);
      }
    }
    if (p === '/api/attreport/send' && m === 'POST') {
      const b = await readJson(request, 4e6), st = await loadState(env), d0 = st.db, e = d0.emps.find(x => x.id === +b.eid);
      if (!e) return fail(404, 'Employee not found.');
      if (!(e.email || '').trim()) return fail(400, e.name + ' has no email address. Add it in the employee profile.');
      const es = emailSettings(d0), sec = await getSecrets(env), key = sec[es.provider === 'resend' ? 'resendKey' : 'brevoKey'];
      const vals = { name: e.name, month: monthLabel(b.month), company: d0.s.company || 'Connectivo', designation: e.desig || '' };
      const text = 'Dear ' + e.name + ',\n\nPlease find attached your Monthly Attendance Report for ' + vals.month + ' (overtime, late, leave/absent and work from home).\n\nRegards,\n' + vals.company;
      const buf = pdfFrom({ pdf: b.pdf });
      try {
        const id = await mail.send(es.provider, key, { fromName: es.fromName, fromEmail: es.fromEmail, replyTo: es.replyTo, to: e.email.trim(), toName: e.name, subject: 'Monthly Attendance Report for ' + vals.month + ' - ' + vals.company, text, attachments: [{ name: attName(e, b.month), buffer: buf }] });
        d0.attsent = d0.attsent || {}; d0.attsent[e.id + '|' + b.month] = new Date().toLocaleString('en-GB');
        st.rev++; note(st, who, 'attreport_sent', e.name + ' ' + b.month + ' -> ' + e.email + ' (' + id + ')'); await saveState(env, st);
        return send(200, { ok: true, rev: st.rev, to: e.email });
      } catch (err) { return fail(502, err.message); }
    }
    if (p === '/api/email/status' && m === 'GET') { const sec = await getSecrets(env); return send(200, { brevo: !!sec.brevoKey, resend: !!sec.resendKey }); }
    if (p === '/api/email/key' && m === 'POST') {
      const b = await readJson(request, 1e5), k = b.provider === 'resend' ? 'resendKey' : 'brevoKey', sec = await getSecrets(env);
      sec[k] = String(b.key || '').trim(); await env.DB.put('sal:secrets', JSON.stringify(sec)); return send(200, { ok: true, brevo: !!sec.brevoKey, resend: !!sec.resendKey });
    }
    if (p === '/api/email/test' && m === 'POST') {
      const b = await readJson(request, 1e5), st = await loadState(env), es = emailSettings(st.db), sec = await getSecrets(env);
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(b.to || '')) return fail(400, 'Enter a valid email address.');
      try { await mail.send(es.provider, sec[es.provider === 'resend' ? 'resendKey' : 'brevoKey'], { fromName: es.fromName, fromEmail: es.fromEmail, replyTo: es.replyTo, to: b.to, subject: 'Test email from the Connectivo Payroll/Attendance Portal', text: 'This is a test email. Your email delivery settings work.' }); return send(200, { ok: true }); }
      catch (err) { return fail(502, err.message); }
    }
    if (p === '/api/users' && m === 'GET') return send(200, { users: [{ id: 1, username: user.username, display: user.display, role: 'admin', active: true }] });
    if (p === '/api/users' || /^\/api\/users\/\d+\/toggle$/.test(p) || p === '/api/account/password') return fail(403, 'Accounts and passwords are managed in Connectivo FinOps.');
    return fail(404, 'Not found.');
  } catch (err) {
    const code = err.status || 500; if (code === 500) console.error('salary error', err);
    return fail(code, code === 500 ? 'Server error. Please try again.' : err.message);
  }
}
