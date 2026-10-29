import { Buffer } from 'node:buffer';
// Email delivery through an HTTPS API (no SMTP, no extra packages). Providers: Brevo, Resend.
function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function htmlBody(text) {
  return '<div style="font-family:&quot;Century Gothic&quot;,Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#14233b;white-space:pre-wrap">' + esc(text) + '</div>';
}
async function post(url, headers, body) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 30000);
  try {
    const r = await fetch(url, { method: 'POST', headers: Object.assign({ 'content-type': 'application/json', accept: 'application/json' }, headers), body: JSON.stringify(body), signal: ctl.signal });
    const txt = await r.text(); let j = {}; try { j = JSON.parse(txt); } catch (e) { /* not json */ }
    if (!r.ok) throw new Error((j.message || j.error || j.name || txt || ('HTTP ' + r.status)).toString().slice(0, 300) + ' (HTTP ' + r.status + ')');
    return j;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('The email service did not answer in time. Try again.');
    throw e;
  } finally { clearTimeout(t); }
}
/** msg: {fromName, fromEmail, replyTo, to, toName, subject, text, attachment:{name, buffer}} */
async function send(provider, apiKey, msg) {
  if (!apiKey) throw new Error('No email API key is saved yet (Settings > Email).');
  if (!msg.fromEmail) throw new Error('Sender email is not set (Settings > Email).');
  const atts = msg.attachments || (msg.attachment ? [msg.attachment] : []);
  if (provider === 'resend') {
    const base = 'https://api.resend.com';
    const body = { from: msg.fromName ? `${msg.fromName} <${msg.fromEmail}>` : msg.fromEmail, to: msg.toList && msg.toList.length ? msg.toList : [msg.to], subject: msg.subject, text: msg.text, html: msg.html || htmlBody(msg.text) };
    if (msg.cc && msg.cc.length) body.cc = msg.cc;
    if (msg.replyTo) body.reply_to = msg.replyTo;
    if (atts.length) body.attachments = atts.map(a => ({ filename: a.name, content: a.buffer.toString('base64') }));
    const j = await post(base + '/emails', { authorization: 'Bearer ' + apiKey }, body);
    return j.id || 'ok';
  }
  const base = 'https://api.brevo.com';
  const body = { sender: { name: msg.fromName || msg.fromEmail, email: msg.fromEmail }, to: (msg.toList && msg.toList.length ? msg.toList : [msg.to]).map((e, i) => ({ email: e, name: i === 0 ? (msg.toName || e) : e })), subject: msg.subject, textContent: msg.text, htmlContent: msg.html || htmlBody(msg.text) };
  if (msg.cc && msg.cc.length) body.cc = msg.cc.map(e => ({ email: e }));
  if (msg.replyTo) body.replyTo = { email: msg.replyTo };
  if (atts.length) body.attachment = atts.map(a => ({ name: a.name, content: a.buffer.toString('base64') }));
  const j = await post(base + '/v3/smtp/email', { 'api-key': apiKey }, body);
  return j.messageId || 'ok';
}
export { send };
