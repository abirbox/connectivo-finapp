// Connectivo - standalone Node.js server.
// Runs the whole portal (FinOps, Payroll/Attendance, Invoice, Projects) on your own server or domain,
// without Cloudflare. It loads the very same code as the Cloudflare Worker (src/worker.js) and only
// adds two small things the Worker normally gets from Cloudflare:
//   * DB      - a key/value store, saved as plain files in the "data" folder
//   * ASSETS  - the static website files from the "public" folder
//
// Start:  node server.mjs        (needs Node.js 18 or newer, no npm install required)
// Open :  http://localhost:3000
//
// Settings (all optional) are read from environment variables:
//   PORT             port to listen on (default 3000)
//   HOST             address to listen on (default 0.0.0.0)
//   DATA_DIR         where the data is stored (default ./data)  <- back this folder up
//   SESSION_SECRET   long random text used to sign logins (created automatically in DATA_DIR if missing)
//   SSL_KEY, SSL_CERT  paths to a TLS key/certificate if you want Node itself to serve https
//   AUTH_<USER>_HASH   optional starting-password hashes (AUTH_SHANTO_HASH, AUTH_SHOMVOB_HASH, AUTH_SHOIKOT_HASH, AUTH_ABIR_HASH)
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import worker from './src/worker.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT) || 3050;
const HOST = process.env.HOST || '0.0.0.0';
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data'));
const KV_DIR = path.join(DATA_DIR, 'kv');
fs.mkdirSync(KV_DIR, { recursive: true });

// ---------------------------------------------------------------- key/value store (one file per key)
const enc = (k) => Buffer.from(k, 'utf8').toString('base64url');
const dec = (f) => Buffer.from(f, 'base64url').toString('utf8');
const fileOf = (k) => path.join(KV_DIR, enc(k));
function toBuffer(v) {
  if (typeof v === 'string') return Buffer.from(v, 'utf8');
  if (v instanceof ArrayBuffer) return Buffer.from(v);
  if (ArrayBuffer.isView(v)) return Buffer.from(v.buffer, v.byteOffset, v.byteLength);
  return Buffer.from(String(v), 'utf8');
}
const DB = {
  async get(key, opt) {
    let buf;
    try { buf = await fs.promises.readFile(fileOf(key)); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
    const type = typeof opt === 'string' ? opt : (opt && opt.type) || 'text';
    if (type === 'json') return JSON.parse(buf.toString('utf8'));
    if (type === 'arrayBuffer') return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    return buf.toString('utf8');
  },
  async put(key, value) {
    const f = fileOf(key), tmp = f + '.' + process.pid + '.tmp';
    await fs.promises.writeFile(tmp, toBuffer(value));
    await fs.promises.rename(tmp, f); // atomic: a crash can never leave a half-written file
  },
  async delete(key) { try { await fs.promises.unlink(fileOf(key)); } catch (e) { if (e.code !== 'ENOENT') throw e; } },
  async list(o = {}) {
    const prefix = o.prefix || '', limit = Math.min(Number(o.limit) || 1000, 1000), after = o.cursor ? dec(o.cursor) : null;
    let names = (await fs.promises.readdir(KV_DIR)).filter((f) => !f.endsWith('.tmp')).map(dec).filter((k) => k.startsWith(prefix)).sort();
    if (after != null) names = names.filter((k) => k > after);
    const page = names.slice(0, limit), complete = names.length <= limit;
    return { keys: page.map((name) => ({ name })), list_complete: complete, cursor: complete ? undefined : enc(page[page.length - 1]) };
  },
};

// ---------------------------------------------------------------- session secret
let SESSION_SECRET = process.env.SESSION_SECRET;
if (!SESSION_SECRET) {
  const f = path.join(DATA_DIR, 'session-secret.txt');
  try { SESSION_SECRET = fs.readFileSync(f, 'utf8').trim(); } catch (e) { /* first start */ }
  if (!SESSION_SECRET || SESSION_SECRET.length < 32) { SESSION_SECRET = crypto.randomBytes(48).toString('hex'); fs.writeFileSync(f, SESSION_SECRET, { mode: 0o600 }); }
}

// ---------------------------------------------------------------- static files ("ASSETS")
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.ico': 'image/x-icon', '.pdf': 'application/pdf', '.txt': 'text/plain; charset=utf-8',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.wasm': 'application/wasm', '.map': 'application/json', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.csv': 'text/csv; charset=utf-8',
};
const ASSETS = {
  async fetch(req) {
    const u = new URL(req.url);
    let p;
    try { p = decodeURIComponent(u.pathname); } catch (e) { return new Response('Bad request', { status: 400 }); }
    if (p.includes('\0')) return new Response('Bad request', { status: 400 });
    let file = path.join(PUBLIC, p);
    if (file !== PUBLIC && !file.startsWith(PUBLIC + path.sep)) return new Response('Not found', { status: 404 });
    let st = await fs.promises.stat(file).catch(() => null);
    if (st && st.isDirectory()) {
      if (!p.endsWith('/')) return new Response(null, { status: 307, headers: { Location: u.pathname + '/' + u.search } });
      file = path.join(file, 'index.html'); st = await fs.promises.stat(file).catch(() => null);
    }
    if (!st || !st.isFile()) return new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    const ext = path.extname(file).toLowerCase();
    const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Content-Length': String(st.size) };
    headers['Cache-Control'] = ext === '.html' ? 'no-cache' : 'public, max-age=3600';
    if (req.method === 'HEAD') return new Response(null, { status: 200, headers });
    return new Response(await fs.promises.readFile(file), { status: 200, headers });
  },
};

const env = Object.assign({}, process.env, { DB, ASSETS, SESSION_SECRET });
const ctx = { waitUntil(p) { Promise.resolve(p).catch((e) => console.error('background task failed:', e)); }, passThroughOnException() {} };

// ---------------------------------------------------------------- HTTP glue
const MAX_BODY = 120 * 1024 * 1024; // restores of big backups can be large
let queue = Promise.resolve();      // changes are handled one at a time, so two people saving at once can never mix up data
async function readBody(req) {
  const chunks = []; let n = 0;
  for await (const c of req) { n += c.length; if (n > MAX_BODY) throw Object.assign(new Error('Too large'), { status: 413 }); chunks.push(c); }
  return Buffer.concat(chunks);
}
async function handle(req, res, secure) {
  const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() || (secure ? 'https' : 'http');
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost';
  const method = req.method || 'GET';
  const body = ['GET', 'HEAD'].includes(method) ? undefined : await readBody(req);
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) { if (Array.isArray(v)) v.forEach((x) => headers.append(k, x)); else if (v != null) headers.set(k, v); }
  headers.delete('content-length'); headers.delete('transfer-encoding');
  const request = new Request(`${proto}://${host}${req.url}`, { method, headers, body });
  const out = await worker.fetch(request, env, ctx);
  res.statusCode = out.status;
  out.headers.forEach((v, k) => { if (k !== 'set-cookie') res.setHeader(k, v); });
  const cookies = typeof out.headers.getSetCookie === 'function' ? out.headers.getSetCookie() : (out.headers.get('set-cookie') ? [out.headers.get('set-cookie')] : []);
  if (cookies.length) {
    // The login cookie is marked "Secure" (https only). When someone tests over plain http (not localhost), drop that flag so login still works.
    const plain = proto !== 'https' && !/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);
    res.setHeader('Set-Cookie', plain ? cookies.map((c) => c.replace(/;\s*Secure/i, '')) : cookies);
  }
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (method === 'HEAD') return res.end();
  res.end(Buffer.from(await out.arrayBuffer()));
}
function listener(secure) {
  return (req, res) => {
    const run = () => handle(req, res, secure).catch((e) => {
      console.error('request failed:', req.method, req.url, e);
      if (!res.headersSent) { res.statusCode = e.status || 500; res.setHeader('Content-Type', 'application/json'); }
      res.end(JSON.stringify({ error: e.status === 413 ? 'That file is too large.' : 'Server error. Please try again.' }));
    });
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return void run();
    queue = queue.then(run, run);
  };
}

const useTls = process.env.SSL_KEY && process.env.SSL_CERT;
const server = useTls
  ? https.createServer({ key: fs.readFileSync(process.env.SSL_KEY), cert: fs.readFileSync(process.env.SSL_CERT) }, listener(true))
  : http.createServer(listener(false));
server.requestTimeout = 5 * 60 * 1000;
server.listen(PORT, HOST, () => {
  console.log(`Connectivo portal is running on ${useTls ? 'https' : 'http'}://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  console.log(`Data is stored in: ${DATA_DIR}  (back this folder up)`);
});
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { console.log('Stopping...'); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 3000).unref(); });
