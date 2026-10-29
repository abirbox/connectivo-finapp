'use strict';
// Salary-sheet PDF: draws the exact table model the portal shows (same cells, merges, colours), A3 landscape.
import { Buffer } from 'node:buffer';
import { PDF, textWidth, wrap, dataUrlJpeg, jpegInfo, getPad, getPadL } from './pdf.js';
import { decodePng } from './png.js';
let logoBuf = null;
export function setLogo(b) { logoBuf = b; }

function buildSheetPdf(M, company) {
  const W = 1190.55, H = 841.89, ML = 30, MT = 34;
  const pg = new PDF(W, H);
  const tw = M.w.reduce((a, b) => a + b, 0), k = (W - 2 * ML) / tw;
  const xs = [0]; M.w.forEach((w, i) => xs.push(xs[i] + w * k));
  const ys = [0]; M.rows.forEach((r, i) => ys.push(ys[i] + r.h * k * 0.92));
  const X = i => ML + xs[i], Y = i => MT + ys[i];
  const fszK = 0.74;
  // logo
  try {
    let lg = null; const jd = dataUrlJpeg(M.logo || '');
    if (jd) { const i = jpegInfo(jd); lg = { jpeg: jd, w: i.width, h: i.height }; } else { const b = decodePng(logoBuf); lg = b; }
    const lh = Y(4) - Y(0) - 6, iw = lg.w, ih = lg.h, lw = lh * iw / ih; pg.image(lg.jpeg ? { jpeg: lg.jpeg } : lg, X(0) + 4, Y(0) + 3, lw, lh);
  } catch (e) { /* logo is optional */ }
  const cells = [];
  M.rows.forEach((r, ri) => r.c.forEach((c, ci) => { if (!c.cov) cells.push({ c, ri, ci }); }));
  cells.forEach(({ c, ri, ci }) => {
    const st = M.sty[c.s] || {}, cs = c.cs || 1, rs = c.rs || 1;
    const x = X(ci), y = Y(ri), w = X(ci + cs) - x, h = Y(ri + rs) - y;
    if (st.f) pg.rect(x, y, w, h, { fill: '#' + st.f });
    const lw = v => v === 2 ? 1.5 : 0.55;
    if (st.bd) { const b = st.bd; pg.line(x, y, x + w, y, '#000000', lw(b)); pg.line(x, y + h, x + w, y + h, '#000000', lw(b)); pg.line(x + w, y, x + w, y + h, '#000000', lw(b)); pg.line(x, y, x, y + h, '#000000', c.tl ? 1.6 : lw(b)); }
    else if (st.bt) pg.line(x, y, x + w, y, '#000000', 0.8);
    const t = String(c.t || ''); if (!t) return;
    const font = st.b ? 'F2' : 'F1'; let size = (st.sz || 11) * fszK; const pad = 3.5, mw = w - 2 * pad;
    let lines = st.w ? wrap(t, font, size, mw) : [t];
    if (!st.w) while (size > 4.5 && textWidth(t, font, size) > mw) size -= 0.3;
    const lh = size * 1.18, top = y + (h - lines.length * lh) / 2 + size * 0.95;
    lines.forEach((ln, i) => { const yy = top + i * lh; const tx = st.al === 'r' ? x + w - pad : st.al === 'l' ? x + pad : x + w / 2; pg.text(ln, tx, yy, { font, size, align: st.al === 'r' ? 'right' : st.al === 'l' ? 'left' : 'center' }); });
  });
  // admin + CEO signature images
  const sigImg = (url, c0, c1) => { try { const jd = dataUrlJpeg(url || ''); if (!jd) return; const i = jpegInfo(jd), hh = Y(M.sigRow) - Y(M.imgRow) - 3, ww = Math.min(hh * i.width / i.height, 200), h2 = ww * i.height / i.width, cx = (X(c0) + X(c1)) / 2; pg.image(jd, cx - ww / 2, Y(M.sigRow) - 2 - h2, ww, h2); } catch (e) { /* optional */ } };
  sigImg(M.sig, 2, 3); sigImg(M.ceo, 16, 18);
  return pg.build({ title: 'Salary Sheet', author: company || 'Connectivo' });
}
export { buildSheetPdf };
// ---------------------------------------------------------------- generic multi-page report
// R = { title, sub, orient:'P'|'L'|'L3', tiles:[[label,value,color]], tables:[{title,head,w,al,rows:[{c:[cell],k}]}] }
// cell = string | {t,bg,fg,b};  row kinds: 'grp' (one spanning line), 'hd' (column heading line), 'tot' (totals), default = data
function hexOk(h, d) { return /^#[0-9a-f]{6}$/i.test(h || '') ? h : d; }
function hslToHex(h) { // accepts #rrggbb or hsl(h,s%,l%)
  const m = /^hsl\((\d+),\s*(\d+)%,\s*(\d+)%\)$/.exec(h || ''); if (!m) return hexOk(h, '#64748b');
  const H = +m[1], S = +m[2] / 100, L = +m[3] / 100, a = S * Math.min(L, 1 - L);
  const f = n => { const k = (n + H / 30) % 12, c = L - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); return Math.round(c * 255).toString(16).padStart(2, '0'); };
  return '#' + f(0) + f(8) + f(4);
}
// ---------------------------------------------------------------- premium report on the company pad (A4 portrait)
// R.meta = [[label, value], ...] (max 4) shown in the card top-right; R.eyebrow = small caption above the title.
function buildPremiumReport(R, company) {
  const NAVY = '#0b2a57', BLUE = '#1b6fb5', CYAN = '#25b4ec', INK = '#14233b', MUT = '#62728c', LINE = '#d9e5f3', SOFT = '#f4f8fd', SOFT2 = '#e9f2fb';
  const LS = R.orient === 'L' && !!getPadL(), W = LS ? 841.92 : 595.32, H = LS ? 595.32 : 841.92, L = 40, Rr = W - 40.02, CW = Rr - L, TOP = 84, BOT = LS ? 526 : 786, PY = LS ? 538 : 792;
  const acc = hexOk(R.accent, BLUE);
  const gen = new Date().toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const pad = LS ? getPadL() : getPad();
  function run(total) {
    const pg = new PDF(W, H); let page = 1, y = 0;
    const drawPad = () => pg.image(pad, 0, 0, W, H);
    const pageNo = () => pg.text('Page ' + page + (total ? ' of ' + total : ''), Rr, PY, { size: 7, color: MUT, align: 'right', font: 'F2' });
    drawPad();
    // title block
    pg.text(String(R.eyebrow || 'PAYROLL / ATTENDANCE REPORT').toUpperCase(), L, 104, { font: 'F2', size: 7.4, color: MUT, spacing: 1.6 });
    const tt = String(R.title).toUpperCase(); let ts = 24; while (ts > 14 && textWidth(tt, 'F2', ts, 2.4) > 270) ts -= 1;
    pg.text(tt, L, 104 + ts + 6, { font: 'F2', size: ts, color: NAVY, spacing: 2.4 });
    pg.rect(L, 104 + ts + 16, 54, 3.2, { fill: acc }); pg.rect(L + 54, 104 + ts + 16, 26, 3.2, { fill: CYAN });
    const subL = wrap(String(R.sub || ''), 'F1', 9, 270);
    subL.slice(0, 3).forEach((ln, i) => pg.text(ln, L, 104 + ts + 38 + i * 12, { size: 9, color: MUT }));
    // meta card
    const meta = (R.meta || []).slice(0, 5), mx = Rr - 233, mw = 233, mh = 22 + meta.length * 21, my = 84;
    if (meta.length) {
      pg.rect(mx, my, mw, mh, { fill: SOFT, stroke: LINE, r: 10, lw: 0.8 }); pg.rect(mx, my + 10, 3.5, mh - 20, { fill: acc });
      meta.forEach((m, i) => { const ry = my + 23 + i * 21; pg.text(String(m[0]), mx + 16, ry, { size: 8.5, color: MUT }); pg.text(String(m[1]), Rr - 14, ry, { font: 'F2', size: 8.8, color: INK, align: 'right' }); if (i < meta.length - 1) pg.line(mx + 14, ry + 7.5, Rr - 12, ry + 7.5, LINE, 0.5); });
    }
    y = Math.max(104 + ts + 38 + Math.min(3, subL.length) * 12, my + mh) + 14;
    // tiles
    if (R.tiles && R.tiles.length) {
      const n = R.tiles.length, gap = 9, tw = (CW - gap * (n - 1)) / n, th = 50;
      R.tiles.forEach((t, i) => {
        const x = L + i * (tw + gap), col = hexOk(t[2], acc);
        pg.rect(x, y, tw, th, { fill: '#ffffff', stroke: LINE, r: 9, lw: 0.9 });
        pg.gradRect(x + 10, y, tw - 20, 3, col, col, { r: 1.5 });
        let vs = 17; const v = String(t[1]); while (vs > 10 && textWidth(v, 'F2', vs) > tw - 14) vs -= 1;
        pg.text(v, x + tw / 2, y + 28, { font: 'F2', size: vs, color: col, align: 'center' });
        pg.text(String(t[0]).toUpperCase(), x + tw / 2, y + 42, { size: 6.2, color: MUT, align: 'center', spacing: 0.8 });
      });
      y += th + 18;
    }
    const newPage = () => { pageNo(); pg.newPage(); page++; drawPad(); pg.text(R.title + (R.sub ? '  -  ' + R.sub : ''), L, 98, { font: 'F2', size: 8.4, color: NAVY }); pg.line(L, 106, Rr, 106, acc, 1.2); y = 118; };
    (R.tables || []).forEach(T => {
      const wsum = T.w.reduce((a, b) => a + b, 0), cw = T.w.map(w => w * CW / wsum), xs = [L]; cw.forEach((w, i) => xs.push(xs[i] + w));
      const al = T.al || [], cellOf = c => (c && typeof c === 'object') ? c : { t: c }, sz = 8.2;
      const rowH = row => { let mx = 1; row.c.forEach((c, i) => { const o = cellOf(c), t = String(o.t == null ? '' : o.t); if (!t) return; const n = wrap(t, o.b ? 'F2' : 'F1', sz, cw[i] - 14).length; if (n > mx) mx = n; }); return mx * (sz + 2.6) + 12; };
      const drawHead = () => {
        pg.gradRect(L, y, CW, 24, NAVY, BLUE, { r: 6 });
        T.head.forEach((h, i) => { const a = al[i] || 'l', tx = a === 'r' ? xs[i + 1] - 8 : a === 'c' ? (xs[i] + xs[i + 1]) / 2 : xs[i] + 8; pg.text(String(h).toUpperCase(), tx, y + 15.4, { font: 'F2', size: 6.8, color: '#ffffff', spacing: 0.9, align: a === 'r' ? 'right' : a === 'c' ? 'center' : 'left' }); });
        y += 24;
      };
      if (T.title) { if (y + 60 > BOT) newPage(); pg.text(T.title, L, y + 10, { font: 'F2', size: 10.5, color: NAVY }); y += 18; }
      if (y + 24 + 40 > BOT) newPage();
      drawHead();
      T.rows.forEach((row, ri) => {
        if (row.k === 'grp') { const gh = 20; if (y + gh > BOT) { newPage(); drawHead(); } pg.rect(L, y, CW, gh, { fill: SOFT2 }); pg.text(String(cellOf(row.c[0]).t || '').toUpperCase(), L + 8, y + 13.4, { font: 'F2', size: 7.4, color: NAVY, spacing: 1 }); y += gh; return; }
        const isTot = row.k === 'tot', h = rowH(row);
        if (y + h > BOT) { newPage(); drawHead(); }
        if (isTot) { pg.rect(L, y, CW, h, { fill: SOFT2 }); pg.line(L, y, Rr, y, acc, 0.9); } else if (ri % 2 === 1) pg.rect(L, y, CW, h, { fill: SOFT });
        row.c.forEach((c0, i) => {
          const c = isTot ? Object.assign({}, cellOf(c0), { b: 1 }) : c0, o = cellOf(c), t = String(o.t == null ? '' : o.t); if (!t) return;
          const a = al[i] || 'l', bold = !!o.b, font = bold ? 'F2' : 'F1', lines = wrap(t, font, sz, cw[i] - 14), lh = sz + 2.6;
          const top = y + (h - lines.length * lh) / 2 + sz * 0.95;
          lines.forEach((ln, k) => pg.text(ln, a === 'r' ? xs[i + 1] - 8 : a === 'c' ? (xs[i] + xs[i + 1]) / 2 : xs[i] + 8, top + k * lh, { font, size: sz, color: hexOk(o.fg, INK), align: a === 'r' ? 'right' : a === 'c' ? 'center' : 'left' }));
        });
        pg.line(L, y + h, Rr, y + h, LINE, 0.5); y += h;
      });
      y += 16;
    });
    if (!(R.tables || []).some(T => T.rows.length)) {
      pg.rect(L, y, CW, 44, { fill: SOFT2, r: 9 }); pg.rect(L, y + 8, 3.5, 28, { fill: acc });
      pg.text(R.note || 'No records in this period.', L + 18, y + 26, { font: 'F3', size: 9.5, color: NAVY }); y += 60;
    }
    // sign-off block
    if (y + 100 > BOT) newPage();
    const sy = Math.min(Math.max(y + 26, BOT - 78), BOT - 54);
    const sw = 200, sx = Rr - sw, sImg = dataUrlJpeg(R.sigImg || '');
    if (sImg) { try { const info = jpegInfo(sImg), h = Math.min(72, sw * 0.98 * info.height / info.width), w = h * info.width / info.height; pg.image(sImg, sx + (sw - w) / 2, sy + 14 - h - 2, w, h); } catch (e) { /* optional */ } }
    pg.line(sx, sy + 14, sx + sw, sy + 14, '#0f172a', 0.8);
    pg.text(R.sigName || 'A K Fazlul Haque', sx + sw / 2, sy + 27, { font: 'F2', size: 9.5, color: '#0f172a', align: 'center' });
    pg.text(R.sigTitle || 'Admin & HR', sx + sw / 2, sy + 39, { size: 8.5, color: MUT, align: 'center' });
    pg.text('Authorised Signatory', sx + sw / 2, sy + 50, { font: 'F2', size: 7.4, color: NAVY, align: 'center' });
    pg.text('Generated ' + gen + '  |  Confidential - for internal use only', L, sy + 40, { size: 6.4, color: MUT });
    pageNo();
    return { pg, pages: page };
  }
  const n = run(0).pages;
  return run(n).pg.build({ title: R.title, author: company || 'Connectivo' });
}

function buildReportPdf(R, company, logoUrl) {
  if (R.premium && getPad()) return buildPremiumReport(R, company);
  const SZ = { P: [595.28, 841.89], L: [841.89, 595.28], L3: [1190.55, 841.89] }[R.orient || 'L'] || [841.89, 595.28];
  const W = SZ[0], H = SZ[1], ML = 28, MR = 28, FOOT = 26, UW = W - ML - MR;
  const base = R.orient === 'L3' ? 8.6 : R.orient === 'P' ? 8 : 7.8;
  const gen = new Date().toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  let logo = null;
  try { const jd = dataUrlJpeg(logoUrl || ''); if (jd) { const i = jpegInfo(jd); logo = { jpeg: jd, w: i.width, h: i.height }; } else if (logoBuf) logo = decodePng(logoBuf); } catch (e) { logo = null; }
  function run(total) {
    const pg = new PDF(W, H); let pageNo = 1, y = 0;
    const footer = () => {
      pg.line(ML, H - FOOT, W - MR, H - FOOT, '#cbd5e1', 0.6);
      pg.text((company || 'Connectivo') + '  |  ' + R.title + '  |  Generated ' + gen + '  |  Confidential', ML, H - FOOT + 12, { size: 6.8, color: '#64748b' });
      pg.text('Page ' + pageNo + (total ? ' of ' + total : ''), W - MR, H - FOOT + 12, { size: 6.8, color: '#64748b', align: 'right', font: 'F2' });
    };
    const first = () => {
      let lx = ML;
      if (logo) { const lh = 34, lw = Math.min(lh * logo.w / logo.h, 110); try { pg.image(logo.jpeg ? { jpeg: logo.jpeg } : logo, ML, 22, lw, lh); lx = ML + lw + 10; } catch (e) { /* optional */ } }
      pg.text(company || 'Connectivo', lx, 38, { font: 'F2', size: 14, color: '#0f172a' });
      pg.text('Payroll/Attendance Portal', lx, 51, { size: 7.5, color: '#64748b' });
      pg.text(R.title, W - MR, 38, { font: 'F2', size: 15, color: '#0f172a', align: 'right' });
      if (R.sub) pg.text(R.sub, W - MR, 51, { size: 8.2, color: '#475569', align: 'right' });
      pg.line(ML, 64, W - MR, 64, '#1b6fb5', 1.6);
      y = 76;
    };
    const cont = () => {
      pg.text((company || 'Connectivo') + '  -  ' + R.title + (R.sub ? '  (' + R.sub + ')' : ''), ML, 30, { font: 'F2', size: 8.5, color: '#334155' });
      pg.line(ML, 37, W - MR, 37, '#1b6fb5', 1); y = 48;
    };
    first();
    if (R.tiles && R.tiles.length) {
      const n = R.tiles.length, gap = 8, tw = Math.min(150, (UW - gap * (n - 1)) / n), th = 40;
      R.tiles.forEach((t, i) => {
        const x = ML + i * (tw + gap);
        pg.rect(x, y, tw, th, { fill: '#f8fafc', stroke: '#e2e8f0', r: 5 });
        pg.text(String(t[1]), x + tw / 2, y + 20, { font: 'F2', size: 15, color: hexOk(t[2], '#1b6fb5'), align: 'center' });
        pg.text(String(t[0]), x + tw / 2, y + 33, { size: 6.8, color: '#64748b', align: 'center' });
      });
      y += th + 14;
    }
    const limit = () => H - FOOT - 8;
    const newPage = () => { footer(); pg.newPage(); pageNo++; cont(); };
    (R.tables || []).forEach(T => {
      const nc = T.head ? T.head.length : (T.rows[0] ? T.rows[0].c.length : 1);
      const wsum = T.w.reduce((a, b) => a + b, 0), cw = T.w.map(w => w * UW / wsum), xs = [ML]; cw.forEach((w, i) => xs.push(xs[i] + w));
      const al = T.al || [];
      const cellOf = c => (c && typeof c === 'object') ? c : { t: c };
      const rowH = (row) => {
        if (row.k === 'grp') return 20;
        let mx = 1;
        row.c.forEach((c, i) => { const o = cellOf(c), t = String(o.t == null ? '' : o.t); if (!t) return; const sz = row.k === 'hd' ? base - 1 : base; const font = (o.b || row.k === 'tot' || row.k === 'hd' || o.bg) ? 'F2' : 'F1'; const n = wrap(t, font, sz, cw[i] - 8).length; if (n > mx) mx = n; });
        return mx * (base + 2.2) + 7;
      };
      const drawRow = (row, h, zebra) => {
        if (row.k === 'grp') {
          pg.rect(ML, y, UW, h, { fill: '#e8eef6' }); pg.line(ML, y, W - MR, y, '#94a3b8', 0.8);
          pg.text(String(cellOf(row.c[0]).t), ML + 7, y + 13.2, { font: 'F2', size: base + 1.6, color: '#0f172a' }); y += h; return;
        }
        if (row.k === 'hd') pg.rect(ML, y, UW, h, { fill: '#f1f5f9' });
        else if (row.k === 'tot') pg.rect(ML, y, UW, h, { fill: '#eef2f7' });
        else if (zebra) pg.rect(ML, y, UW, h, { fill: '#fafbfd' });
        row.c.forEach((c, i) => {
          const o = cellOf(c), t = String(o.t == null ? '' : o.t); if (!t) return;
          const hd = row.k === 'hd', bold = o.b || row.k === 'tot' || hd || !!o.bg, sz = hd ? base - 1 : base, font = bold ? 'F2' : 'F1';
          const a = o.bg ? 'c' : (al[i] || 'l'), lines = wrap(t, font, sz, cw[i] - 8), lh = sz + 2.2;
          let bx = xs[i] + 2.5, bw = cw[i] - 5;
          if (o.bg) { const tw2 = Math.min(bw, Math.max(...lines.map(l => textWidth(l, font, sz))) + 10); bx = xs[i] + (cw[i] - tw2) / 2; bw = tw2; pg.rect(bx, y + 2.5, bw, h - 5, { fill: hslToHex(o.bg), r: 3.5 }); }
          const top = y + (h - lines.length * lh) / 2 + sz * 0.92;
          const color = hd ? '#475569' : o.bg ? '#ffffff' : hexOk(o.fg, '#0f172a');
          lines.forEach((ln, k) => { const tx = a === 'r' ? xs[i + 1] - 5 : a === 'c' ? (xs[i] + xs[i + 1]) / 2 : xs[i] + 5; pg.text(ln, tx, top + k * lh, { font, size: sz, color, align: a === 'r' ? 'right' : a === 'c' ? 'center' : 'left' }); });
        });
        pg.line(ML, y + h, W - MR, y + h, row.k === 'tot' ? '#475569' : '#e2e8f0', row.k === 'tot' ? 0.9 : 0.5);
        y += h;
      };
      const head = T.head ? { k: 'hd', c: T.head } : null;
      if (T.title) { if (y + 60 > limit()) newPage(); pg.text(T.title, ML, y + 11, { font: 'F2', size: 11, color: '#0f172a' }); y += 18; }
      const drawHead = () => { if (head) drawRow(head, rowH(head)); };
      if (head && y + rowH(head) + 30 > limit()) newPage();
      drawHead();
      let z = 0;
      T.rows.forEach((row, ri) => {
        const h = rowH(row);
        let need = h;
        if (row.k === 'grp') { need += 4; for (let j = ri + 1; j < Math.min(T.rows.length, ri + 3); j++) need += rowH(T.rows[j]); }
        if (y + need > limit()) { newPage(); if (head && row.k !== 'grp') drawHead(); }
        if (row.k === 'grp') z = 0;
        drawRow(row, h, (z++ % 2) === 1);
      });
      y += 14;
    });
    if (R.note) { if (y + 20 > limit()) newPage(); pg.text(R.note, ML, y + 8, { size: 7.5, color: '#64748b', font: 'F3' }); }
    footer();
    return { pg, pages: pageNo };
  }
  const n = run(0).pages;
  return run(n).pg.build({ title: R.title, author: company || 'Connectivo' });
}
export { buildReportPdf };

