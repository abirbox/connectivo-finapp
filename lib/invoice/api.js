// Connectivo Invoice Portal - API, running inside the FinOps Worker (same login, same KV).
// Stored under the "inv:" prefix. Completely separate from the ledger: no financial calculations here.
import { Buffer } from 'node:buffer';
import * as mail from '../salary/mail.js';

const MAX_JSON = 6 * 1024 * 1024;
const baseHeaders = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin' };
function send(code, body) {
  const h = Object.assign({}, baseHeaders, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  return new Response(JSON.stringify(body), { status: code, headers: h });
}
const fail = (code, msg, extra) => send(code, Object.assign({ error: msg }, extra || {}));
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
async function readJson(request, limit) {
  const len = +request.headers.get('content-length') || 0; if (len > (limit || MAX_JSON)) throw Object.assign(new Error('Data is too large.'), { status: 413 });
  const txt = await request.text(); if (txt.length > (limit || MAX_JSON)) throw Object.assign(new Error('Data is too large.'), { status: 413 });
  try { return JSON.parse(txt || '{}'); } catch (e) { throw Object.assign(new Error('Bad request data.'), { status: 400 }); }
}

function sniff(b) {
  if (b.length > 4 && b.subarray(0, 4).toString('latin1') === '%PDF') return 'application/pdf';
  if (b[0] === 0xff && b[1] === 0xd8) return 'image/jpeg';
  if (b[0] === 0x89 && b.subarray(1, 4).toString('latin1') === 'PNG') return 'image/png';
  if (b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  if (b.subarray(0, 3).toString('latin1') === 'GIF') return 'image/gif';
  return '';
}
async function loadState(env) {
  const raw = await env.DB.get('inv:db', { type: 'json' });
  return raw || { rev: 1, db: { s: {}, clients: [], inv: [], items: [], log: [] }, fresh: true };
}
async function saveState(env, st) {
  const day = new Date().toISOString().slice(0, 10);
  if (st.lastBackup !== day) { st.lastBackup = day; try { await env.DB.put('inv:backup:' + day, JSON.stringify({ rev: st.rev, db: st.db }), { expirationTtl: 60 * 86400 }); } catch (e) { /* backup is best effort */ } }
  delete st.fresh;
  await env.DB.put('inv:db', JSON.stringify(st));
}
// Email provider, sender and API key are shared with the Payroll/Attendance Portal (Settings > Email there).
async function mailConfig(env) {
  const sal = (await env.DB.get('sal:db', { type: 'json' })) || { db: { s: {} } };
  const s = (sal.db && sal.db.s) || {}, sec = (await env.DB.get('sal:secrets', { type: 'json' })) || {};
  const provider = s.mailProvider === 'resend' ? 'resend' : 'brevo';
  const key = sec[provider === 'resend' ? 'resendKey' : 'brevoKey'] || '';
  return { provider, key, fromName: s.mailFromName || s.company || 'Connectivo', fromEmail: s.mailFromEmail || '', ok: !!(key && s.mailFromEmail) };
}
function htmlEmail(b, company) {
  const m = b.summary || {};
  const row = (k, v, strong) => `<tr><td style="padding:9px 0;color:#62728c;font-size:13px;border-bottom:1px solid #e6eef8">${esc(k)}</td><td style="padding:9px 0;text-align:right;font-size:${strong ? 15 : 13}px;font-weight:${strong ? 800 : 600};color:${strong ? '#1b6fb5' : '#14233b'};border-bottom:1px solid #e6eef8">${esc(v)}</td></tr>`;
  const body = esc(b.text || '').replace(/\r?\n/g, '<br>');
  return `<!doctype html><html><body style="margin:0;background:#eef3fa;padding:24px 12px;font-family:Arial,Helvetica,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #dbe6f4">
<tr><td style="background:linear-gradient(90deg,#0b2a57,#1b6fb5);padding:22px 28px;color:#ffffff"><div style="font-size:11px;letter-spacing:2px;opacity:.8">${esc(company)}</div><div style="font-size:24px;font-weight:800;letter-spacing:1px;margin-top:4px">INVOICE</div></td></tr>
<tr><td style="padding:26px 28px;color:#14233b;font-size:14px;line-height:1.65">${body}</td></tr>
<tr><td style="padding:0 28px 24px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f8fd;border:1px solid #dbe6f4;border-radius:10px;padding:6px 18px">
${row('Invoice No', m.no || '')}${row('Invoice date', m.date || '')}${row('Due date', m.dueDate || '')}${row('Amount due', m.amount || '', true)}</table>
<p style="margin:16px 0 0;font-size:12.5px;color:#62728c">The invoice is attached to this email as a PDF.</p></td></tr>
<tr><td style="background:#f4f8fd;padding:14px 28px;font-size:11.5px;color:#62728c;border-top:1px solid #e1e9f4">${esc(company)} &middot; ${esc(m.contact || '')}</td></tr></table></body></html>`;
}

export async function handleInvoice(request, env, user) {
  const url = new URL(request.url), p = url.pathname.replace(/^\/invoice-api/, '/api'), m = request.method;
  if (m !== 'GET' && m !== 'HEAD' && request.headers.get('x-portal') !== '1') return fail(403, 'Blocked (missing header).');
  try {
    const who = user.username;
    if (p === '/api/db' && m === 'GET') {
      const st = await loadState(env), mc = await mailConfig(env);
      return send(200, { rev: st.rev, db: st.db, fresh: !!st.fresh, user: { name: who }, mail: { ok: mc.ok, provider: mc.provider, from: mc.fromEmail, hasKey: !!mc.key } });
    }
    if (p === '/api/db' && m === 'PUT') {
      const b = await readJson(request, 12 * 1024 * 1024);
      if (!b.db || typeof b.db !== 'object' || !Array.isArray(b.db.inv) || !Array.isArray(b.db.clients) || !b.db.s) return fail(400, 'Invalid data.');
      const st = await loadState(env);
      if (!st.fresh && b.rev !== st.rev) return fail(409, 'conflict', { rev: st.rev });
      st.db = b.db; st.rev = (st.rev || 1) + 1; await saveState(env, st);
      return send(200, { rev: st.rev });
    }
    if (p === '/api/backup' && m === 'GET') {
      const st = await loadState(env);
      return new Response(JSON.stringify({ exported: new Date().toISOString(), db: st.db }), { status: 200, headers: Object.assign({}, baseHeaders, { 'Content-Type': 'application/json', 'Content-Disposition': 'attachment; filename="connectivo-invoices-backup-' + new Date().toISOString().slice(0, 10) + '.json"', 'Cache-Control': 'no-store' }) });
    }
    if (p === '/api/send' && m === 'POST') {
      const b = await readJson(request, 8 * 1024 * 1024);
      const to = String(b.to || '').split(/[;,\s]+/).map(x => x.trim()).filter(Boolean), cc = String(b.cc || '').split(/[;,\s]+/).map(x => x.trim()).filter(Boolean);
      const okMail = x => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x);
      if (!to.length) return fail(400, 'Enter the client\'s email address.');
      const badE = to.concat(cc).find(x => !okMail(x)); if (badE) return fail(400, '"' + badE + '" is not a valid email address.');
      if (to.length > 5 || cc.length > 5) return fail(400, 'Please use at most 5 recipients per field.');
      if (typeof b.pdf !== 'string' || b.pdf.length < 100) return fail(400, 'The PDF was not received. Please refresh the page and try again.');
      const buf = Buffer.from(b.pdf, 'base64'); if (buf.length < 100 || buf.subarray(0, 5).toString('latin1') !== '%PDF-') return fail(400, 'That is not a valid PDF.');
      const st = await loadState(env), inv = (st.db.inv || []).find(x => x.id === b.id); if (!inv) return fail(404, 'Invoice not found. Save it first.');
      const mc = await mailConfig(env);
      if (!mc.key) return fail(400, 'No email service key is saved yet. Add it in the Payroll/Attendance Portal under Settings > Email delivery.');
      if (!mc.fromEmail) return fail(400, 'The sender email is not set. Add it in the Payroll/Attendance Portal under Settings > Email delivery.');
      const company = (st.db.s && st.db.s.company) || 'Connectivo', replyTo = (st.db.s && st.db.s.replyTo) || '';
      const subject = String(b.subject || ('Invoice ' + (inv.no || '') + ' from ' + company)).slice(0, 300), text = String(b.text || '').slice(0, 8000);
      const fname = String(b.name || ('Invoice_' + (inv.no || 'draft') + '.pdf')).replace(/[^A-Za-z0-9._-]+/g, '_');
      inv.sent = inv.sent || [];
      try {
        const id = await mail.send(mc.provider, mc.key, { fromName: mc.fromName, fromEmail: mc.fromEmail, replyTo, to: to[0], toName: to[0], toList: to, cc, subject, text, html: htmlEmail({ text, summary: b.summary }, company), attachment: { name: fname, buffer: buf } });
        inv.sent.push({ at: new Date().toISOString(), to: to.join(', '), cc: cc.join(', '), by: who, ok: true, subject, ref: String(id || '') });
        st.db.log = st.db.log || []; st.db.log.unshift(new Date().toLocaleString('en-GB') + ' - ' + who + ': emailed invoice ' + inv.no + ' to ' + to.join(', ')); st.db.log = st.db.log.slice(0, 500);
        st.rev++; await saveState(env, st);
        return send(200, { ok: true, rev: st.rev, db: st.db });
      } catch (err) {
        inv.sent.push({ at: new Date().toISOString(), to: to.join(', '), cc: cc.join(', '), by: who, ok: false, err: String(err.message).slice(0, 300), subject });
        st.rev++; await saveState(env, st);
        return fail(502, err.message, { rev: st.rev });
      }
    }
    /* ---- payment proof files (images / PDF), stored in their own KV keys so the main data stays small */
    if (p === '/api/files' && m === 'POST') {
      const b = await readJson(request, 9 * 1024 * 1024);
      if (typeof b.data !== 'string' || b.data.length < 20) return fail(400, 'The file was not received.');
      const buf = Buffer.from(b.data, 'base64'); if (buf.length > 6 * 1024 * 1024) return fail(413, 'The file is too large (max 6 MB).');
      const kind = sniff(buf); if (!kind) return fail(400, 'Only JPG, PNG, WEBP, GIF or PDF files are allowed.');
      const id = 'f' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      const name = String(b.name || 'proof').replace(/[^A-Za-z0-9._ -]+/g, '_').slice(0, 80);
      await env.DB.put('inv:file:' + id, JSON.stringify({ name, type: kind, data: b.data, by: who, at: new Date().toISOString() }));
      return send(200, { id, name, type: kind, size: buf.length });
    }
    const fm = /^\/api\/files\/(f[a-z0-9]+)$/.exec(p);
    if (fm && m === 'GET') {
      const f = await env.DB.get('inv:file:' + fm[1], { type: 'json' }); if (!f) return fail(404, 'File not found.');
      const buf = Buffer.from(f.data, 'base64');
      return new Response(buf, { status: 200, headers: Object.assign({}, baseHeaders, { 'Content-Type': f.type, 'Content-Disposition': (url.searchParams.get('dl') ? 'attachment' : 'inline') + '; filename="' + String(f.name).replace(/"/g, '') + '"', 'Cache-Control': 'private, max-age=3600', 'Content-Security-Policy': "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox" }) });
    }
    if (fm && m === 'DELETE') { await env.DB.delete('inv:file:' + fm[1]); return send(200, { ok: true }); }
    return fail(404, 'Not found.');
  } catch (e) {
    console.error('invoice api error:', e);
    return fail(e.status || 500, e.status ? e.message : 'Server error. Please try again.');
  }
}
