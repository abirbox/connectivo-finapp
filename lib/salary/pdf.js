'use strict';
// Minimal dependency-free PDF writer (embedded Century Gothic look-alike + JPEG images) and the payslip renderer.
import zlib from 'node:zlib';
import { Buffer } from 'node:buffer';
import W from './fontmetrics.js';
import FD from './fontdata.js';

const CP1252 = { 0x20AC: 0x80, 0x201A: 0x82, 0x0192: 0x83, 0x201E: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02C6: 0x88, 0x2030: 0x89, 0x0160: 0x8A, 0x2039: 0x8B, 0x0152: 0x8C, 0x017D: 0x8E, 0x2018: 0x91, 0x2019: 0x92, 0x201C: 0x93, 0x201D: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x02DC: 0x98, 0x2122: 0x99, 0x0161: 0x9A, 0x203A: 0x9B, 0x0153: 0x9C, 0x017E: 0x9E, 0x0178: 0x9F };
function toBytes(str) {
  const out = [];
  for (const ch of String(str == null ? '' : str)) {
    const c = ch.codePointAt(0);
    if (c >= 32 && c < 127) out.push(c);
    else if (c >= 160 && c <= 255) out.push(c);
    else if (CP1252[c]) out.push(CP1252[c]);
    else if (c === 9 || c === 10) out.push(32);
    else out.push(63); // '?'
  }
  return out;
}
function textWidth(str, font, size, spacing) {
  const b = toBytes(str); let w = 0;
  for (const c of b) w += W[font][c] || 0;
  return w * size / 1000 + (spacing || 0) * Math.max(0, b.length - 1);
}
function rgb(hex) {
  const h = hex.replace('#', '');
  return [0, 2, 4].map(i => (parseInt(h.substr(i, 2), 16) / 255).toFixed(3)).join(' ');
}
function num(n) { return (Math.round(n * 100) / 100).toString(); }

function jpegInfo(buf) {
  if (buf[0] !== 0xFF || buf[1] !== 0xD8) throw new Error('not a JPEG');
  let i = 2;
  while (i < buf.length) {
    if (buf[i] !== 0xFF) { i++; continue; }
    const m = buf[i + 1];
    if (m === 0xD8 || (m >= 0xD0 && m <= 0xD7) || m === 0x01 || m === 0xFF) { i += (m === 0xFF ? 1 : 2); continue; }
    const len = buf.readUInt16BE(i + 2);
    if (m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC) {
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7), comps: buf[i + 9] };
    }
    i += 2 + len;
  }
  throw new Error('bad JPEG');
}

class PDF {
  constructor(w, h) { this.w = w; this.h = h; this.ops = []; this.images = []; this.shadings = []; this.gstates = []; }
  y(v) { return this.h - v; }
  newPage() { (this.done = this.done || []).push(this.ops); this.ops = []; }
  image(buf, x, y, w, h) { // buf: JPEG Buffer, or a decoded {w,h,rgb,alpha} / {jpeg} object
    if (buf && buf.jpeg) buf = buf.jpeg;
    const raw = !Buffer.isBuffer(buf);
    const info = raw ? { width: buf.w, height: buf.h, comps: 3 } : jpegInfo(buf);
    let idx = this.images.findIndex(im => im.buf === buf);
    if (idx < 0) { this.images.push({ buf, info, raw }); idx = this.images.length - 1; }
    this.ops.push(`q ${num(w)} 0 0 ${num(h)} ${num(x)} ${num(this.y(y + h))} cm /Im${idx} Do Q`);
  }
  _rrPath(x, y, w, h, r) {
    const Y = this.y(y + h); r = Math.min(r || 0, w / 2, h / 2);
    if (!r) return `${num(x)} ${num(Y)} ${num(w)} ${num(h)} re`;
    const k = 0.5523 * r;
    return [`${num(x + r)} ${num(Y)} m`, `${num(x + w - r)} ${num(Y)} l`, `${num(x + w - r + k)} ${num(Y)} ${num(x + w)} ${num(Y + r - k)} ${num(x + w)} ${num(Y + r)} c`,
      `${num(x + w)} ${num(Y + h - r)} l`, `${num(x + w)} ${num(Y + h - r + k)} ${num(x + w - r + k)} ${num(Y + h)} ${num(x + w - r)} ${num(Y + h)} c`,
      `${num(x + r)} ${num(Y + h)} l`, `${num(x + r - k)} ${num(Y + h)} ${num(x)} ${num(Y + h - r + k)} ${num(x)} ${num(Y + h - r)} c`,
      `${num(x)} ${num(Y + r)} l`, `${num(x)} ${num(Y + r - k)} ${num(x + r - k)} ${num(Y)} ${num(x + r)} ${num(Y)} c h`].join(' ');
  }
  rect(x, y, w, h, o) {
    o = o || {}; let s = 'q ';
    if (o.fill) s += `${rgb(o.fill)} rg `;
    if (o.stroke) s += `${rgb(o.stroke)} RG ${num(o.lw || 0.7)} w `;
    s += this._rrPath(x, y, w, h, o.r) + ' ' + (o.fill && o.stroke ? 'B' : o.fill ? 'f' : 'S') + ' Q';
    this.ops.push(s);
  }
  line(x1, y1, x2, y2, color, lw, dash) {
    this.ops.push(`q ${rgb(color || '#000000')} RG ${num(lw || 0.7)} w ${dash ? '[' + dash + '] 0 d ' : ''}${num(x1)} ${num(this.y(y1))} m ${num(x2)} ${num(this.y(y2))} l S Q`);
  }
  text(str, x, y, o) { // y = baseline measured from the top of the page
    o = o || {}; const font = o.font || 'F1', size = o.size || 10, sp = o.spacing || 0;
    const w = textWidth(str, font, size, sp);
    if (o.align === 'right') x -= w; else if (o.align === 'center') x -= w / 2;
    const hex = toBytes(str).map(b => b.toString(16).padStart(2, '0')).join('');
    this.ops.push(`BT /${font} ${num(size)} Tf ${rgb(o.color || '#000000')} rg ${num(sp)} Tc ${num(x)} ${num(this.y(y))} Td <${hex}> Tj ET`);
    return w;
  }
  gradRect(x, y, w, h, c1, c2, o) { // horizontal (or vertical if o.vertical) two-colour gradient, optional rounded corners
    o = o || {};
    const c = hex => rgb(hex);
    const key = JSON.stringify([x, y, w, h, c1, c2, !!o.vertical]);
    let idx = this.shadings.findIndex(s => s.key === key);
    if (idx < 0) { this.shadings.push({ key, coords: o.vertical ? `0 ${num(this.y(y))} 0 ${num(this.y(y + h))}` : `${num(x)} 0 ${num(x + w)} 0`, c0: c(c1), c1: c(c2) }); idx = this.shadings.length - 1; }
    this.ops.push(`q ${this._rrPath(x, y, w, h, o.r)} W n /Sh${idx} sh Q`);
  }
  stamp(str, cx, cy, deg, size, color, alpha, o) { // rotated, semi-transparent stamp text with a border box, centred on (cx, cy)
    o = o || {}; const sp = o.spacing || 4, w = textWidth(str, 'F2', size, sp);
    let gi = this.gstates.indexOf(alpha); if (gi < 0) { this.gstates.push(alpha); gi = this.gstates.length - 1; }
    const t = deg * Math.PI / 180, c = Math.cos(t).toFixed(4), s = Math.sin(t).toFixed(4);
    const hex = toBytes(str).map(b => b.toString(16).padStart(2, '0')).join('');
    const bw = w + size * 0.9, bh = size * 1.25;
    this.ops.push(`q /GS${gi} gs ${c} ${s} ${-s} ${c} ${num(cx)} ${num(this.y(cy))} cm ${rgb(color)} RG ${rgb(color)} rg ${num(size / 11)} w ${num(-bw / 2)} ${num(-bh * 0.5)} ${num(bw)} ${num(bh)} re S BT /F2 ${num(size)} Tf ${num(sp)} Tc 1 0 0 1 ${num(-w / 2)} ${num(-size * 0.34)} Tm <${hex}> Tj ET Q`);
  }
  build(meta) {
    const objs = []; const add = (s) => { objs.push(Buffer.isBuffer(s) ? s : Buffer.from(s, 'latin1')); return objs.length; };
    // 1 catalog, 2 pages, 3 page, 4 content, 5-7 fonts, 8 info, then images
    let nid = 9; this.images.forEach(im => { im.id = nid++; if (im.raw && im.buf.alpha) im.sid = nid++; });
    const xobj = this.images.map((im, i) => `/Im${i} ${im.id} 0 R`).join(' ');
    add('<< /Type /Catalog /Pages 2 0 R >>');
    const allPages = (this.done || []).concat([this.ops]);
    const extra = []; let eid = nid; for (let i = 1; i < allPages.length; i++) { extra.push(eid); eid += 2; }
    const FONTBASE = eid;
    add(`<< /Type /Pages /Kids [3 0 R ${extra.map(i => i + ' 0 R').join(' ')}] /Count ${allPages.length} >>`);
    const pageObj = (cid) => `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(this.w)} ${num(this.h)}] /Contents ${cid} 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R /F3 7 0 R >> /XObject << ${xobj} >> ${this.shadings.length ? '/Shading << ' + this.shadings.map((sh, i) => `/Sh${i} << /ShadingType 2 /ColorSpace /DeviceRGB /Coords [${sh.coords}] /Function << /FunctionType 2 /Domain [0 1] /C0 [${sh.c0}] /C1 [${sh.c1}] /N 1 >> /Extend [true true] >>`).join(' ') + ' >>' : ''} ${this.gstates.length ? '/ExtGState << ' + this.gstates.map((a, i) => `/GS${i} << /ca ${a} /CA ${a} >>`).join(' ') + ' >>' : ''} >> >>`;
    const contentObj = (ops) => { const c = zlib.deflateSync(Buffer.from(ops.join('\n'), 'latin1')); return Buffer.concat([Buffer.from(`<< /Length ${c.length} /Filter /FlateDecode >>\nstream\n`, 'latin1'), c, Buffer.from('\nendstream', 'latin1')]); };
    add(pageObj(4));
    add(contentObj(allPages[0]));
    const FN = [['F1', 'CenturyGothic', 0, 80], ['F2', 'CenturyGothic-Bold', 0, 140], ['F3', 'CenturyGothic-Italic', -10.5, 80]];
    // fonts are embedded as simple TrueType fonts (descriptor + file objects are appended after the pages)
    FN.forEach((f, i) => add(`<< /Type /Font /Subtype /TrueType /BaseFont /${f[1]} /FirstChar 32 /LastChar 255 /Widths [${W[f[0]].slice(32).join(' ')}] /Encoding /WinAnsiEncoding /FontDescriptor ${FONTBASE + i * 2} 0 R >>`));
    const esc = (t) => '(' + String(t || '').replace(/[\\()]/g, '\\$&').replace(/[^\x20-\x7e]/g, '?') + ')';
    add(`<< /Title ${esc(meta && meta.title)} /Author ${esc(meta && meta.author)} /Producer (Connectivo Payroll/Attendance Portal) >>`);
    this.images.forEach(im => {
      if (im.raw) {
        const o = im.buf, rgbZ = zlib.deflateSync(o.rgb);
        add(Buffer.concat([Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${o.w} /Height ${o.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode${im.sid ? ' /SMask ' + im.sid + ' 0 R' : ''} /Length ${rgbZ.length} >>\nstream\n`, 'latin1'), rgbZ, Buffer.from('\nendstream', 'latin1')]));
        if (im.sid) { const aZ = zlib.deflateSync(o.alpha); add(Buffer.concat([Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${o.w} /Height ${o.h} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode /Length ${aZ.length} >>\nstream\n`, 'latin1'), aZ, Buffer.from('\nendstream', 'latin1')])); }
        return;
      }
      const cs = im.info.comps === 1 ? '/DeviceGray' : '/DeviceRGB';
      add(Buffer.concat([Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${im.info.width} /Height ${im.info.height} /ColorSpace ${cs} /BitsPerComponent 8 /Filter /DCTDecode /Length ${im.buf.length} >>\nstream\n`, 'latin1'), im.buf, Buffer.from('\nendstream', 'latin1')]));
    });
    extra.forEach((id, i) => { add(pageObj(id + 1)); add(contentObj(allPages[i + 1])); });
    FN.forEach((f, i) => {
      add(`<< /Type /FontDescriptor /FontName /${f[1]} /Flags 32 /FontBBox [-113 -222 1148 955] /ItalicAngle ${f[2]} /Ascent 740 /Descent -222 /CapHeight 740 /StemV ${f[3]} /FontFile2 ${FONTBASE + i * 2 + 1} 0 R >>`);
      const raw = Buffer.from(FD[f[0]], 'base64'), z = zlib.deflateSync(raw);
      add(Buffer.concat([Buffer.from(`<< /Length ${z.length} /Length1 ${raw.length} /Filter /FlateDecode >>\nstream\n`, 'latin1'), z, Buffer.from('\nendstream', 'latin1')]));
    });
    const parts = [Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', 'latin1')]; const offs = []; let pos = parts[0].length;
    objs.forEach((o, i) => { offs.push(pos); const b = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`, 'latin1'), o, Buffer.from('\nendobj\n', 'latin1')]); parts.push(b); pos += b.length; });
    let x = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('');
    x += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R /Info 8 0 R >>\nstartxref\n${pos}\n%%EOF\n`;
    parts.push(Buffer.from(x, 'latin1'));
    return Buffer.concat(parts);
  }
}

// ---------------------------------------------------------------- helpers
function money(v) { return (Math.round((+v || 0) * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function monthLabel(m) { const a = m.split('-'); return MONTHS[+a[1] - 1] + ' ' + a[0]; }
function words(n) {
  n = Math.round(n * 100) / 100; let tk = Math.floor(n); const ps = Math.round((n - tk) * 100);
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  const two = x => x < 20 ? ones[x] : tens[Math.floor(x / 10)] + (x % 10 ? ' ' + ones[x % 10] : '');
  const three = x => { let s = ''; if (x >= 100) { s = ones[Math.floor(x / 100)] + ' Hundred'; x %= 100; if (x) s += ' '; } return s + (x ? two(x) : ''); };
  if (tk === 0 && !ps) return 'Zero Taka Only';
  const parts = []; const cr = Math.floor(tk / 1e7); tk %= 1e7; const lk = Math.floor(tk / 1e5); tk %= 1e5; const th = Math.floor(tk / 1e3); tk %= 1e3;
  if (cr) parts.push(three(cr) + ' Crore'); if (lk) parts.push(two(lk) + ' Lakh'); if (th) parts.push(two(th) + ' Thousand'); if (tk) parts.push(three(tk));
  let s = parts.join(' ') + ' Taka'; if (ps) s += ' and ' + two(ps) + ' Paisa'; return s + ' Only';
}
function dataUrlJpeg(u) {
  const m = /^data:image\/jpe?g;base64,(.+)$/.exec(u || ''); if (!m) return null;
  try { const b = Buffer.from(m[1], 'base64'); jpegInfo(b); return b; } catch (e) { return null; }
}
function wrap(str, font, size, maxW) {
  const words_ = String(str || '').split(/\s+/).filter(Boolean); const lines = []; let cur = '';
  for (const w of words_) { const t = cur ? cur + ' ' + w : w; if (textWidth(t, font, size) <= maxW || !cur) cur = t; else { lines.push(cur); cur = w; } }
  if (cur) lines.push(cur); return lines;
}

// ---------------------------------------------------------------- payslip
const NAVY = '#0b2a57', BLUE = '#1b6fb5', CYAN = '#25b4ec', INK = '#14233b', MUT = '#5d6f89', LINE = '#d6e2f1', SOFT = '#f3f8fd', SOFT2 = '#e8f1fb';
let padBuf = null;
export function setPad(b) { padBuf = b; }
export function getPad() { return padBuf; }
let padL = null;
export function setPadL(b) { padL = b; }
export function getPadL() { return padL; }

function buildPayslip(slip, emp, S, bankLogo) {
  const pg = new PDF(595.32, 841.92);
  pg.image(padBuf, 0, 0, 595.32, 841.92);
  const L = 42, R = 553.3, CW = R - L;
  // ---- title
  pg.text('PAYSLIP', L, 112, { font: 'F2', size: 26, color: NAVY, spacing: 3 });
  pg.rect(L, 121, 46, 3, { fill: CYAN }); pg.rect(L + 46, 121, 22, 3, { fill: BLUE });
  pg.text(monthLabel(slip.month).toUpperCase(), R, 104, { font: 'F2', size: 12, color: BLUE, align: 'right', spacing: 1.2 });
  const ref = 'PS-' + slip.month.replace('-', '') + '-' + String(emp.id).padStart(3, '0');
  pg.text('Ref. ' + ref, R, 119, { size: 8.5, color: MUT, align: 'right' });
  // ---- employee card
  const cy = 140, ch = 78;
  pg.rect(L, cy, CW, ch, { fill: SOFT, stroke: LINE, r: 9, lw: 0.8 });
  pg.rect(L, cy, 4, ch, { fill: BLUE });
  pg.text('EMPLOYEE', L + 18, cy + 17, { font: 'F2', size: 7, color: MUT, spacing: 1.2 });
  pg.text(emp.name, L + 18, cy + 36, { font: 'F2', size: 15, color: NAVY });
  pg.text([emp.desig].filter(Boolean).join('') || '-', L + 18, cy + 52, { size: 9.5, color: INK });
  pg.text(emp.dept || '', L + 18, cy + 66, { size: 8.5, color: MUT });
  const cols = [['PAY PERIOD', monthLabel(slip.month), 112], ['WORKED DAYS', slip.days || '-', 80], ['GROSS SALARY', slip.gross ? 'Taka ' + money(slip.gross) : '-', 100]];
  let cx = L + 236;
  cols.forEach((c, i) => {
    const x = cx; cx += c[2];
    if (i) pg.line(x - 10, cy + 14, x - 10, cy + ch - 14, LINE, 0.8);
    pg.text(c[0], x, cy + 30, { font: 'F2', size: 7, color: MUT, spacing: 1 });
    pg.text(String(c[1]), x, cy + 48, { font: 'F2', size: i === 2 ? 10 : 11, color: INK });
  });
  // ---- tables
  const RN = { Medical: 'Medical Allowance', Transport: 'Transport Allowance', 'Mobile Bill': 'Mobile Bill Allowance', 'Mobile bill': 'Mobile Bill Allowance' };
  const GROSS = ['Basic', 'House Rent Allowance', 'Medical Allowance', 'Transport Allowance'], ALLOW = ['Communication Allowance', 'Mobile Bill Allowance'];
  const earnAll = (slip.earn || []).map(x => Object.assign({}, x, { l: RN[x.l] || x.l }));
  const sumA = a => a.reduce((t, x) => t + (+x.a || 0), 0);
  const eg1 = earnAll.filter(x => GROSS.includes(x.l)).sort((a, b) => GROSS.indexOf(a.l) - GROSS.indexOf(b.l)), eg3 = earnAll.filter(x => ALLOW.includes(x.l)).sort((a, b) => ALLOW.indexOf(a.l) - ALLOW.indexOf(b.l)), eg2 = earnAll.filter(x => !GROSS.includes(x.l) && !ALLOW.includes(x.l));
  const earn = [];
  [['GROSS SALARY', eg1], ['ADDITIONAL EARNINGS', eg2], ['ALLOWANCES (NOT PART OF GROSS)', eg3]].forEach(([t, g]) => { if (g.length) { earn.push({ hdr: t, a: sumA(g) }); g.forEach(x => earn.push(x)); } });
  const ded = slip.ded || [];
  const nHdr = earn.filter(x => x.hdr).length, rowsN = Math.max(earn.length - nHdr + nHdr * 0.7, ded.length, 1);
  const rh = rowsN <= 10 ? 23 : rowsN <= 14 ? 19 : 15.5, hrh = Math.round(rh * 0.72 * 10) / 10;
  const ty = 236, gap = 16, tw = (CW - gap) / 2, hh = 24;
  function table(x, title, rows, kind) {
    pg.rect(x, ty, tw, hh, { fill: NAVY, r: 6 });
    pg.rect(x, ty + hh - 8, tw, 8, { fill: NAVY });
    pg.text(title, x + 12, ty + 16, { font: 'F2', size: 8.5, color: '#ffffff', spacing: 1.4 });
    pg.text('TAKA', x + tw - 12, ty + 16, { font: 'F2', size: 8, color: '#9fd3f5', align: 'right', spacing: 1 });
    let y = ty + hh;
    if (!rows.length) { pg.rect(x, y, tw, rh, { fill: '#ffffff' }); pg.text(kind === 'ded' ? 'No deductions this month' : '-', x + 12, y + rh / 2 + 3.2, { font: 'F3', size: 8.5, color: MUT }); y += rh; }
    let zi = 0;
    rows.forEach((r, i) => {
      if (r.hdr) {
        pg.rect(x, y, tw, hrh, { fill: SOFT2 }); pg.line(x, y, x + tw, y, LINE, 0.6);
        pg.text(r.hdr, x + 12, y + hrh / 2 + 2.4, { font: 'F2', size: 6.4, color: BLUE, spacing: 0.8 });
        pg.text(money(r.a), x + tw - 12, y + hrh / 2 + 3, { font: 'F2', size: 8.2, color: NAVY, align: 'right' });
        zi = 0; y += hrh; return;
      }
      pg.rect(x, y, tw, rh, { fill: zi++ % 2 ? SOFT : '#ffffff' });
      const cut = kind === 'ded' ? Math.max(0, r.a - (r.p || 0)) : r.a;
      const hasSub = kind === 'ded' && (r.p > 0) && rh >= 19;
      pg.text(r.l, x + 12, y + (hasSub ? rh / 2 - 1.5 : rh / 2 + 3.2), { size: 9, color: INK });
      if (hasSub) pg.text('Deducted ' + money(r.a) + '  |  Pardoned ' + money(r.p), x + 12, y + rh / 2 + 8.3, { font: 'F3', size: 6.8, color: '#2e8b6a' });
      else if (kind === 'ded' && r.p > 0) pg.text('(pardoned ' + money(r.p) + ')', x + tw - 12 - textWidth(money(cut), 'F2', 9) - 8, y + rh / 2 + 3, { font: 'F3', size: 6.5, color: '#2e8b6a', align: 'right' });
      pg.text(money(cut), x + tw - 12, y + rh / 2 + 3.2, { font: kind === 'ded' ? 'F1' : 'F1', size: 9, color: INK, align: 'right' });
      y += rh;
    });
    const end = y > ty + hh ? y : ty + hh + rh;
    return end;
  }
  const e1 = table(L, 'EARNINGS', earn, 'earn'), e2 = table(L + tw + gap, 'DEDUCTIONS', ded, 'ded');
  const ey = Math.max(e1, e2);
  // pad shorter table with empty rows so the totals align
  [[L, e1], [L + tw + gap, e2]].forEach(([x, e]) => { if (e < ey) pg.rect(x, e, tw, ey - e, { fill: '#ffffff' }); });
  const totH = 28;
  const tot = (x, label, val, color) => {
    pg.rect(x, ey, tw, totH, { fill: SOFT2, r: 0 }); pg.rect(x, ey + totH - 6, tw, 6, { fill: SOFT2 });
    pg.line(x, ey, x + tw, ey, BLUE, 1.2);
    pg.text(label, x + 12, ey + 17.5, { font: 'F2', size: 8.5, color: NAVY, spacing: .6 });
    pg.text(money(val), x + tw - 12, ey + 18, { font: 'F2', size: 11, color: color || NAVY, align: 'right' });
  };
  tot(L, 'TOTAL EARNINGS', slip.te); tot(L + tw + gap, 'TOTAL DEDUCTIONS', slip.td, '#a33a2a');
  // outline both tables
  pg.rect(L, ty, tw, ey + totH - ty, { stroke: LINE, r: 6, lw: 0.8 }); pg.rect(L + tw + gap, ty, tw, ey + totH - ty, { stroke: LINE, r: 6, lw: 0.8 });
  let y = ey + totH + 10;
  if (slip.tp > 0) {
    pg.rect(L, y, CW, 20, { fill: '#e9f7f0', stroke: '#bfe6d3', r: 5, lw: 0.6 });
    pg.text('Amount pardoned by management: Taka ' + money(slip.tp) + ' (not deducted from your salary)', L + 12, y + 13, { font: 'F3', size: 8.5, color: '#1f7a56' });
    y += 30;
  } else y += 6;
  // ---- net pay band
  const nh = 72;
  pg.rect(L, y, CW, nh, { fill: NAVY, r: 10 });
  pg.rect(L, y, 6, nh, { fill: CYAN, r: 3 });
  pg.text('NET PAY', L + 24, y + 24, { font: 'F2', size: 8.5, color: '#8fc4ee', spacing: 2 });
  pg.text('Taka ' + money(slip.net), L + 24, y + 54, { font: 'F2', size: 25, color: '#ffffff' });
  const wl = wrap(words(slip.net), 'F3', 9, 250);
  pg.text('IN WORDS', R - 16, y + 22, { font: 'F2', size: 7.5, color: '#8fc4ee', align: 'right', spacing: 1.6 });
  wl.slice(0, 4).forEach((t, i) => pg.text(t, R - 16, y + 36 + i * 11, { font: 'F3', size: 9, color: '#ffffff', align: 'right' }));
  y += nh;
  // ---- bank details
  const hasBank = emp.bank || emp.accno || emp.accname;
  if (hasBank) {
    y += 12; const bh = 112, hh = 26;
    pg.rect(L, y, CW, bh, { fill: '#ffffff', stroke: '#c9d6ea', r: 10, lw: 1 });
    pg.rect(L, y, CW, hh, { fill: '#e8f0fb', r: 10 });
    pg.rect(L, y + 14, CW, 12, { fill: '#e8f0fb' });
    pg.rect(L, y, 5, bh, { fill: BLUE, r: 2 });
    pg.text('BANK DETAILS', L + 74, y + 17, { font: 'F2', size: 9, color: NAVY, spacing: 2 });
    pg.text('Salary is transferred to this account', R - 14, y + 17, { font: 'F3', size: 8, color: MUT, align: 'right' });
    const lx = L + 16, ly = y + 36, ls = 56;
    pg.rect(lx, ly, ls, ls, { fill: '#ffffff', stroke: '#d3deee', r: 10, lw: 1 });
    if (bankLogo) {
      try { const iw = bankLogo.jpeg ? jpegInfo(bankLogo.jpeg).width : bankLogo.w, ih = bankLogo.jpeg ? jpegInfo(bankLogo.jpeg).height : bankLogo.h, k = Math.min(44 / iw, 44 / ih); pg.image(bankLogo, lx + (ls - iw * k) / 2, ly + (ls - ih * k) / 2, iw * k, ih * k); } catch (e) { /* skip logo */ }
    } else pg.text(String(emp.bank || 'BANK').replace(/\b(bank|plc)\b|[^A-Za-z ]/gi, '').trim().split(/\s+/).map(w => w[0] || '').join('').slice(0, 2).toUpperCase() || 'B', lx + ls / 2, ly + 35, { font: 'F2', size: 18, color: BLUE, align: 'center' });
    const fit = (str, font, size, mw) => { str = String(str || '-'); if (textWidth(str, font, size) <= mw) return str; while (str.length > 1 && textWidth(str + '...', font, size) > mw) str = str.slice(0, -1); return str + '...'; };
    const fld = (x, yy, label, val, mw, sz) => { pg.text(label, x, yy, { font: 'F2', size: 7, color: MUT, spacing: 1.1 }); pg.text(fit(val, 'F2', sz || 10.5, mw), x, yy + 14, { font: 'F2', size: sz || 10.5, color: INK }); };
    fld(L + 88, y + 44, 'BANK', emp.bank, 190); fld(L + 292, y + 44, 'ACCOUNT NAME', emp.accname, 230);
    pg.line(L + 88, y + 66, R - 16, y + 66, '#dfe7f3', 0.8);
    fld(L + 88, y + 80, 'ACCOUNT NUMBER', emp.accno, 190, 12.5); fld(L + 280, y + 80, 'BRANCH', [emp.bbranch, emp.bdist].filter(Boolean).join(', '), 128); fld(L + 416, y + 80, 'ROUTING NUMBER', emp.routing, 100);
    y += bh;
  }
  // ---- signatures
  const sy = Math.min(Math.max(y + 92, 660), 740), sw = 200;
  const sig = (x, imgUrl, name, title) => {
    const im = dataUrlJpeg(imgUrl);
    if (im) { const info = jpegInfo(im); const h = Math.min(72, 196 * info.height / info.width), w = h * info.width / info.height; pg.image(im, x + (sw - w) / 2, sy - h - 2, w, h); }
    pg.line(x, sy, x + sw, sy, INK, 0.8);
    if (name) pg.text(name, x + sw / 2, sy + 13, { font: 'F2', size: 9.5, color: INK, align: 'center' });
    pg.text(title, x + sw / 2, sy + (name ? 25 : 13), { size: 8.5, color: MUT, align: 'center' });
  };
  sig(L + 10, S.adminSig, S.adminName, S.adminTitle || 'Admin & HR');
  sig(R - sw - 10, S.ceoSig, S.ceoName, S.ceoTitle || 'CEO');
  pg.text('This is a system-generated payslip and is valid with the authorised signatures above.', (L + R) / 2, Math.min(sy + 38, 778), { font: 'F3', size: 7.5, color: MUT, align: 'center' });
  return pg.build({ title: 'Payslip - ' + emp.name + ' - ' + monthLabel(slip.month), author: S.company || 'Connectivo' });
}


// ---------------------------------------------------------------- employee information sheet (premium)
function buildEmployeePdf(emp, S, docs) {
  const pg = new PDF(595.32, 841.92);
  if (padBuf) pg.image(padBuf, 0, 0, 595.32, 841.92);
  const L = 40, R = 555.3, CW = R - L, BOT = 706;
  const fit = (str, font, size, mw) => { str = String(str == null || str === '' ? '-' : str); if (textWidth(str, font, size) <= mw) return str; while (str.length > 1 && textWidth(str + '...', font, size) > mw) str = str.slice(0, -1); return str + '...'; };
  const dfmt = (d) => { const m = String(d || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? (+m[3]) + ' ' + MONTHS[+m[2] - 1].slice(0, 3) + ' ' + m[1] : (d || '-'); };
  const diff = (a, b) => { const x = new Date(a + 'T00:00:00'), y = new Date((b || new Date().toISOString().slice(0, 10)) + 'T00:00:00'); if (isNaN(x) || isNaN(y) || y < x) return '-'; let yy = y.getFullYear() - x.getFullYear(), mm = y.getMonth() - x.getMonth(), dd = y.getDate() - x.getDate(); if (dd < 0) { mm--; dd += new Date(y.getFullYear(), y.getMonth(), 0).getDate(); } if (mm < 0) { yy--; mm += 12; } const o = []; if (yy) o.push(yy + ' yr'); if (mm) o.push(mm + ' mo'); if (dd || !o.length) o.push(dd + ' d'); return o.join(' '); };
  const inactive = emp.status === 'Inactive';
  const hist = (emp.hist || []).slice().sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : a.id - b.id);
  const appt = hist.filter(h => h.type === 'Appointment')[0], start = appt ? appt.date : '', end = inactive && emp.exitDate ? emp.exitDate : '';
  const num = v => (v === '' || v == null || isNaN(+v)) ? 0 : +v;
  const tk = v => (v === '' || v == null || isNaN(+v) || +v === 0) ? '-' : 'Tk ' + money(+v);
  const net = num(emp.gross) + num(emp.comm) + num(emp.mob);
  const now = new Date(), ds = now.getDate() + ' ' + MONTHS[now.getMonth()] + ' ' + now.getFullYear();
  // ---- heading
  pg.text('EMPLOYEE INFORMATION', L, 104, { font: 'F2', size: 7.4, color: MUT, spacing: 1.6 });
  pg.text('Ref. EMP-' + String(emp.id).padStart(3, '0') + '   |   Printed ' + ds, R, 104, { size: 7.6, color: MUT, align: 'right' });
  // ---- hero card
  const hy = 112, hh = 84;
  pg.gradRect(L, hy, CW, hh, NAVY, BLUE, { r: 12 });
  pg.rect(L + 18, hy + hh - 3, 54, 3, { fill: CYAN });
  const ps = 60, px = L + 18, py = hy + 12;
  let drew = false;
  try {
    const jd = dataUrlJpeg(emp.photo || '');
    if (jd) { const i = jpegInfo(jd), k = Math.max(ps / i.width, ps / i.height), w = i.width * k, h = i.height * k; pg.rect(px - 2, py - 2, ps + 4, ps + 4, { fill: '#ffffff', r: 10 }); pg.image(jd, px + (ps - Math.min(w, ps)) / 2, py + (ps - Math.min(h, ps)) / 2, Math.min(w, ps), Math.min(h, ps)); drew = true; }
  } catch (e) { /* optional */ }
  if (!drew) {
    pg.rect(px - 2, py - 2, ps + 4, ps + 4, { fill: '#ffffff', r: 10 }); pg.rect(px, py, ps, ps, { fill: SOFT2, r: 8 });
    const ini = String(emp.name || '?').trim().split(/\s+/); pg.text(((ini[0] || '?')[0] + (ini.length > 1 ? ini[ini.length - 1][0] : '')).toUpperCase(), px + ps / 2, py + 39, { font: 'F2', size: 22, color: BLUE, align: 'center' });
  }
  const tx = px + ps + 20, tw = CW - 18 - ps - 20 - 110;
  pg.text(fit(emp.name, 'F2', 18, tw), tx, hy + 32, { font: 'F2', size: 18, color: '#ffffff' });
  pg.text(fit([emp.desig, emp.dept].filter(Boolean).join('  -  '), 'F1', 9.5, tw), tx, hy + 48, { size: 9.5, color: '#d6e8fb' });
  pg.text(fit([emp.email, emp.phone].filter(Boolean).join('   |   '), 'F1', 8.2, tw), tx, hy + 63, { size: 8.2, color: '#b9d3f0' });
  const pw = inactive ? 96 : 64, pxx = R - pw - 16;
  pg.rect(pxx, hy + 16, pw, 20, { fill: inactive ? '#e9edf3' : '#e3f6ec', r: 10 });
  pg.text(inactive ? 'EX-EMPLOYEE' : 'ACTIVE', pxx + pw / 2, hy + 29.6, { font: 'F2', size: 8, color: inactive ? '#4b5870' : '#1f7a56', align: 'center', spacing: 1 });
  if (inactive && emp.exitDate) pg.text('Left on ' + dfmt(emp.exitDate), R - 16, hy + 54, { size: 8.4, color: '#d6e8fb', align: 'right' });
  // ---- tiles
  let y = hy + hh + 12;
  const incs = hist.filter(h => h.type === 'Increment').length, tiles = [
    ['WORKING SINCE', start ? dfmt(start) : '-', BLUE], ['WITH COMPANY', start ? diff(start, end) : '-', '#0f9d6a'], ['GROSS SALARY', tk(emp.gross), '#7c4dff'], ['NET SALARY', net ? 'Tk ' + money(net) : '-', '#d98a06'], ['INCREMENTS', String(incs), '#1b6fb5']];
  const gap = 8, tws = (CW - gap * 4) / 5, th = 46;
  tiles.forEach((t, i) => {
    const x = L + i * (tws + gap);
    pg.rect(x, y, tws, th, { fill: '#ffffff', stroke: LINE, r: 9, lw: 0.9 }); pg.gradRect(x + 10, y, tws - 20, 3, t[2], t[2], { r: 1.5 });
    let vs = 13; while (vs > 8 && textWidth(t[1], 'F2', vs) > tws - 12) vs -= 0.5;
    pg.text(t[1], x + tws / 2, y + 26, { font: 'F2', size: vs, color: t[2], align: 'center' });
    pg.text(t[0], x + tws / 2, y + 39, { size: 5.8, color: MUT, align: 'center', spacing: 0.8 });
  });
  y += th + 14;
  // ---- two cards: contact & salary
  const gw = 8, lw = 262, rw = CW - lw - gw, rh = 16;
  const rowsL = [['Email', emp.email], ['Phone', emp.phone], ['Employment type', emp.type], ['Roster name(s)', emp.roster], ['Monthly commitment', emp.commit ? emp.commit + ' hours' : 'Default'], ['Status', inactive ? 'Ex-employee' : (emp.status || 'Active')]];
  if (inactive) rowsL.push(['Reason for leaving', emp.exitReason]);
  const rowsR = [['Basic', tk(emp.basic)], ['House rent', tk(emp.hr)], ['Medical Allowance', tk(emp.med)], ['Transport Allowance', tk(emp.trv)], ['GROSS', tk(emp.gross), 1], ['Communication Allowance', tk(emp.comm)], ['Mobile Bill Allowance', tk(emp.mob)]];
  const ch = 30 + Math.max(rowsL.length, rowsR.length + 1) * rh + 12;
  const card = (x, w, title) => { pg.rect(x, y, w, ch, { fill: SOFT, stroke: LINE, r: 10, lw: 0.8 }); pg.rect(x, y + 12, 3.5, 14, { fill: BLUE }); pg.text(title, x + 14, y + 22, { font: 'F2', size: 7.8, color: BLUE, spacing: 1.5 }); };
  card(L, lw, 'CONTACT & EMPLOYMENT'); card(L + lw + gw, rw, 'SALARY STRUCTURE');
  rowsL.forEach((r, i) => { const ry = y + 44 + i * rh; pg.text(r[0], L + 14, ry, { size: 8, color: MUT }); pg.text(fit(r[1], 'F2', 8.6, lw - 120), L + lw - 12, ry, { font: 'F2', size: 8.6, color: INK, align: 'right' }); });
  const sx0 = L + lw + gw;
  rowsR.forEach((r, i) => { const ry = y + 44 + i * rh; if (r[2]) { pg.line(sx0 + 14, ry - 10, sx0 + rw - 12, ry - 10, LINE, 0.8); }
    pg.text(r[0], sx0 + 14, ry, { font: r[2] ? 'F2' : 'F1', size: r[2] ? 7.8 : 8, color: r[2] ? NAVY : MUT, spacing: r[2] ? 1 : 0 }); pg.text(r[1], sx0 + rw - 12, ry, { font: 'F2', size: 8.6, color: INK, align: 'right' }); });
  const ny = y + 44 + rowsR.length * rh - 4;
  pg.gradRect(sx0 + 10, ny, rw - 20, 20, NAVY, BLUE, { r: 6 }); pg.text('NET SALARY', sx0 + 20, ny + 13.4, { font: 'F2', size: 7.6, color: '#d6e8fb', spacing: 1.2 }); pg.text(net ? 'Tk ' + money(net) : '-', sx0 + rw - 20, ny + 14, { font: 'F2', size: 10, color: '#ffffff', align: 'right' });
  y += ch + 10;
  // ---- bank
  const bh = 64; pg.rect(L, y, CW, bh, { fill: '#ffffff', stroke: LINE, r: 10, lw: 0.8 }); pg.rect(L, y + 12, 3.5, 14, { fill: CYAN }); pg.text('BANK DETAILS', L + 14, y + 22, { font: 'F2', size: 7.8, color: BLUE, spacing: 1.5 });
  const bi = [['BANK', emp.bank], ['ACCOUNT NAME', emp.accname], ['ACCOUNT NUMBER', emp.accno], ['BRANCH', [emp.bbranch, emp.bdist].filter(Boolean).join(', ')], ['ROUTING NUMBER', emp.routing]], bcw = (CW - 28) / 5;
  bi.forEach((b, i) => { const x = L + 14 + i * bcw; pg.text(b[0], x, y + 40, { font: 'F2', size: 5.8, color: MUT, spacing: 0.8 }); pg.text(fit(b[1], 'F2', 8.4, bcw - 8), x, y + 53, { font: 'F2', size: 8.4, color: INK }); });
  y += bh + 12;
  // ---- employment history
  const sec = (t) => { pg.text(t, L, y + 8, { font: 'F2', size: 7.8, color: BLUE, spacing: 1.5 }); pg.line(L + textWidth(t, 'F2', 7.8, 1.5) + 10, y + 5, R, y + 5, LINE, 0.8); y += 16; };
  const docsL = (docs || []).slice().sort((a, b) => b.id - a.id), dm = {}; docsL.forEach(d => { dm[d.id] = d; });
  const histRoom = Math.max(3, Math.min(8, Math.floor((BOT - y - 20 - (docsL.length ? Math.min(docsL.length, 3) * 14 + 26 : 30) - (emp.notes ? 34 : 0)) / 15)));
  sec('EMPLOYMENT HISTORY');
  if (!hist.length) { pg.text('No employment events recorded yet.', L, y + 8, { font: 'F3', size: 8.5, color: MUT }); y += 18; }
  else {
    pg.gradRect(L, y, CW, 17, NAVY, BLUE, { r: 5 });
    const hx = [L + 10, L + 82, L + 182, L + 400]; ['DATE', 'EVENT', 'POSITION / DETAILS', 'TIME SINCE'].forEach((h, i) => pg.text(h, hx[i], y + 11.4, { font: 'F2', size: 6.6, color: '#ffffff', spacing: 0.9 }));
    y += 17;
    const rev = hist.slice().reverse(), shown = rev.slice(0, hist.length > histRoom ? histRoom - 1 : histRoom);
    shown.forEach((h, i) => { if (i % 2) pg.rect(L, y, CW, 15, { fill: SOFT });
      const dd = dm[h.docId], det = [h.title, h.amount ? 'Tk ' + money(+h.amount) : '', dd ? 'Doc: ' + (dd.title || dd.orig) : ''].filter(Boolean).join('  -  ');
      pg.text(dfmt(h.date), hx[0], y + 10.4, { font: 'F2', size: 8, color: INK }); pg.text(fit(h.type, 'F2', 8, 92), hx[1], y + 10.4, { font: 'F2', size: 8, color: NAVY }); pg.text(fit(det || '-', 'F1', 8, 210), hx[2], y + 10.4, { size: 8, color: INK }); pg.text(diff(h.date) + ' ago', hx[3], y + 10.4, { size: 8, color: MUT }); y += 15; });
    if (shown.length < hist.length) { pg.text('+ ' + (hist.length - shown.length) + ' earlier event(s) in the portal', L + 10, y + 10, { font: 'F3', size: 7.8, color: MUT }); y += 15; }
    y += 4;
  }
  // ---- documents
  y += 4; sec('DOCUMENTS ON FILE');
  if (!docsL.length) { pg.text('No documents uploaded.', L, y + 8, { font: 'F3', size: 8.5, color: MUT }); y += 16; }
  else {
    const room = Math.max(1, Math.floor((BOT - y - (emp.notes ? 40 : 6)) / 14)), shown = docsL.length > room ? docsL.slice(0, Math.max(1, room - 1)) : docsL;
    shown.forEach((d, i) => { if (i % 2 === 0) pg.rect(L, y, CW, 14, { fill: SOFT }); pg.text(fit(d.type, 'F2', 8, 120), L + 10, y + 10, { font: 'F2', size: 8, color: NAVY }); pg.text(fit(d.title || d.orig, 'F1', 8, CW - 270), L + 140, y + 10, { size: 8, color: INK }); pg.text(String(d.at || '').slice(0, 10).replace(/,$/, ''), R - 10, y + 10, { size: 7.6, color: MUT, align: 'right' }); y += 14; });
    if (shown.length < docsL.length) { pg.text('+ ' + (docsL.length - shown.length) + ' more document(s) on file in the portal', L + 10, y + 10, { font: 'F3', size: 7.8, color: MUT }); y += 14; }
  }
  if (emp.notes && y < BOT - 10) { y += 6; sec('NOTES'); wrap(emp.notes, 'F1', 8.6, CW).slice(0, Math.max(1, Math.floor((BOT + 6 - y) / 11.5))).forEach(t => { pg.text(t, L, y + 8, { size: 8.6, color: INK }); y += 11.5; }); }
  // ---- sign-off
  const sy = 716, sw = 200, sx = R - sw, sImg = dataUrlJpeg(S.adminSig || '');
  if (sImg) { try { const info = jpegInfo(sImg), h = Math.min(60, sw * 0.98 * info.height / info.width), w = h * info.width / info.height; pg.image(sImg, sx + (sw - w) / 2, sy + 10 - h - 2, w, h); } catch (e) { /* optional */ } }
  pg.line(sx, sy + 10, sx + sw, sy + 10, '#0f172a', 0.8);
  pg.text(S.adminName || 'A K Fazlul Haque', sx + sw / 2, sy + 22, { font: 'F2', size: 9.2, color: '#0f172a', align: 'center' });
  pg.text(S.adminTitle || 'Admin & HR', sx + sw / 2, sy + 33, { size: 8.2, color: MUT, align: 'center' });
  pg.text('Authorised Signatory', sx + sw / 2, sy + 44, { font: 'F2', size: 7.2, color: NAVY, align: 'center' });
  pg.text('Generated ' + ds + '  |  Confidential - for internal use only', L, sy + 40, { size: 6.4, color: MUT });
  return pg.build({ title: 'Employee information - ' + emp.name, author: S.company || 'Connectivo' });
}

export { jpegInfo, PDF, buildPayslip, buildEmployeePdf, money, monthLabel, words, textWidth, wrap, dataUrlJpeg };
