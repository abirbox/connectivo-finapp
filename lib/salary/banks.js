import { Buffer } from 'node:buffer';
import { decodePng } from './png.js';
import { jpegInfo } from './pdf.js';
// Bank list (domain loads the bank's own site icon). Bundled logos are served from /salary-assets/banklogos/.
export const BANKS = [['BRAC Bank PLC', 'bracbank.com'], ['The City Bank PLC', 'thecitybank.com'], ['Dutch-Bangla Bank PLC (DBBL)', 'dutchbanglabank.com'], ['Eastern Bank PLC (EBL)', 'ebl.com.bd'], ['Mutual Trust Bank PLC (MTB)', 'mutualtrustbank.com'], ['Prime Bank PLC', 'primebank.com.bd'], ['Pubali Bank PLC', 'pubalibangla.com'], ['Islami Bank PLC (IBBL)', 'islamibankbd.com'], ['One Bank PLC', 'onebank.com.bd'], ['Midland Bank PLC', 'midlandbankbd.com'], ['Standard Chartered Bank (SCB)', 'sc.com']];
export const DOMAIN_RE = /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/;
let host = null; // { asset(path) -> Buffer|null, kv }
export function setHost(h) { host = h; }
export function allowed(d, customBanks) { return BANKS.some(b => b[1] === d) || (customBanks || []).some(b => b.domain === d); }
/** PNG buffer for a domain: bundled file, else KV cache, else fetched once from Google's icon service. */
export async function logoPng(domain) {
  if (!DOMAIN_RE.test(domain || '')) return null;
  const bundled = await host.asset('/salary-assets/banklogos/' + domain + '.png'); if (bundled) return bundled;
  const key = 'sal:logo:' + domain;
  const c = await host.kv.get(key, { type: 'arrayBuffer' }); if (c) return Buffer.from(c);
  try {
    const r = await fetch('https://www.google.com/s2/favicons?domain=' + encodeURIComponent(domain) + '&sz=128', { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null; const b = Buffer.from(await r.arrayBuffer()); decodePng(b); await host.kv.put(key, b); return b;
  } catch (e) { return null; }
}
/** Decoded logo object for the PDF writer, for a bank name (built-in or custom). */
export async function logoFor(name, customBanks) {
  if (!name) return null;
  const c = (customBanks || []).find(b => b.name === name);
  try {
    if (c && c.logo) { const m = /^data:image\/jpe?g;base64,(.+)$/.exec(c.logo); if (m) { const b = Buffer.from(m[1], 'base64'); jpegInfo(b); return { jpeg: b }; } }
    const dom = c ? c.domain : (BANKS.find(b => b[0] === name) || [])[1];
    if (!dom) return null; const png = await logoPng(dom); return png ? decodePng(png) : null;
  } catch (e) { return null; }
}
