'use strict';
// Connectivo Invoice Portal - calculation rules + premium invoice PDF (drawn on the company pad).
// Runs in the browser (bundled into public/salary-assets/pdfkit.js) so the Worker never spends CPU on PDFs.
import { PDF, textWidth, wrap, dataUrlJpeg, money } from '../salary/pdf.js';

const NAVY = '#0b2a57', BLUE = '#1b6fb5', CYAN = '#25b4ec', SKY = '#6bcdeb', INK = '#14233b', MUT = '#62728c', LINE = '#d9e5f3', SOFT = '#f4f8fd', SOFT2 = '#e9f2fb', GREEN = '#0f9d6a', RED = '#d92d43', AMBER = '#d98a06';
let padBuf = null;
export function setInvoicePad(b) { padBuf = b; }

const r2 = x => Math.round((+x || 0) * 100) / 100;

/* ------------------------------------------------------------------ calculation (single source of truth) */
export function calcInvoice(inv) {
  const items = (inv.items || []).map(it => Object.assign({}, it, { amt: r2((+it.qty || 0) * (+it.rate || 0)) }));
  const sub = r2(items.reduce((a, i) => a + i.amt, 0));
  const dv = Math.max(0, +inv.disc || 0);
  const discount = Math.min(sub, r2(inv.discType === 'pct' ? sub * Math.min(dv, 100) / 100 : dv));
  const taxable = r2(sub - discount);
  const tax = r2(taxable * Math.max(0, +inv.taxPct || 0) / 100);
  const total = r2(taxable + tax);
  const advance = r2(Math.min(Math.max(0, +inv.advance || 0), total));
  const paid = r2((inv.payments || []).reduce((a, p) => a + (+p.amt || 0), 0));
  const due = r2(Math.max(0, total - advance - paid));
  const over = r2(Math.max(0, advance + paid - total));
  return { items, sub, discount, taxable, tax, total, advance, paid, due, over };
}
export function invStatus(inv, today) {
  if (inv.cancelled) return 'Cancelled';
  const c = calcInvoice(inv);
  if (c.total > 0 && c.due <= 0) return 'Paid';
  if (inv.due && today && inv.due < today) return 'Overdue';
  if (c.paid > 0 || c.advance > 0 && (inv.payments || []).length) return 'Partially paid';
  if ((inv.sent || []).length) return 'Sent';
  return 'Draft';
}

/* ------------------------------------------------------------------ amount in words */
const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
const two = x => x < 20 ? ONES[x] : TENS[Math.floor(x / 10)] + (x % 10 ? ' ' + ONES[x % 10] : '');
const three = x => { let s = ''; if (x >= 100) { s = ONES[Math.floor(x / 100)] + ' Hundred'; x %= 100; if (x) s += ' '; } return s + (x ? two(x) : ''); };
function intWords(n, indian) {
  if (n === 0) return 'Zero';
  const p = [];
  if (indian) {
    const cr = Math.floor(n / 1e7); n %= 1e7; const lk = Math.floor(n / 1e5); n %= 1e5; const th = Math.floor(n / 1e3); n %= 1e3;
    if (cr) p.push(intWords(cr, true) + ' Crore'); if (lk) p.push(two(lk) + ' Lakh'); if (th) p.push(two(th) + ' Thousand'); if (n) p.push(three(n));
  } else {
    const b = Math.floor(n / 1e9); n %= 1e9; const m = Math.floor(n / 1e6); n %= 1e6; const th = Math.floor(n / 1e3); n %= 1e3;
    if (b) p.push(three(b) + ' Billion'); if (m) p.push(three(m) + ' Million'); if (th) p.push(three(th) + ' Thousand'); if (n) p.push(three(n));
  }
  return p.join(' ');
}
export function amountWords(amount, cur) {
  const n = r2(amount); const whole = Math.floor(n + 1e-9), sub = Math.round((n - whole) * 100);
  if (cur === 'USD') return intWords(whole, false) + (whole === 1 ? ' US Dollar' : ' US Dollars') + (sub ? ' and ' + two(sub) + (sub === 1 ? ' Cent' : ' Cents') : '') + ' Only';
  return intWords(whole, true) + ' Taka' + (sub ? ' and ' + two(sub) + ' Paisa' : '') + ' Only';
}

/* ------------------------------------------------------------------ helpers */
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function fmtDate(d) { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d || ''); return m ? m[3] + ' ' + MON[+m[2] - 1] + ' ' + m[1] : (d || ''); }
export function curName(c) { return c === 'USD' ? 'USD - US Dollar' : 'BDT - Bangladeshi Taka'; }
export function amt(c, v) { return (c === 'USD' ? 'USD ' : 'BDT ') + money(v); }
function qtyText(it) {
  const q = +it.qty || 0; let t = (Math.round(q * 100) / 100).toString(); const u = (it.unit || '').trim();
  if (u && u !== '-') t += ' ' + (u.toLowerCase().endsWith('s') || q === 1 ? u : u + 's');
  return t;
}
export function invoiceFileName(inv) { return 'Invoice_' + String(inv.no || 'draft').replace(/[^A-Za-z0-9._-]+/g, '_') + '.pdf'; }

/* ------------------------------------------------------------------ the invoice PDF */
export function buildInvoicePdf(inv, S, opts) {
  opts = opts || {};
  const cur = inv.cur === 'USD' ? 'USD' : 'BDT';
  const C = calcInvoice(inv), status = invStatus(inv, opts.today || '');
  const company = S.company || 'Connectivo';
  const pg = new PDF(595.32, 841.92);
  const L = 40, R = 555.3, CW = R - L, TOP = 84, BOT = 790;
  let y = TOP, page = 1;

  const drawPad = () => { if (padBuf) pg.image(padBuf, 0, 0, 595.32, 841.92); };
  drawPad();

  /* ---- title block */
  pg.text('INVOICE', L, 116, { font: 'F2', size: 31, color: NAVY, spacing: 3.6 });
  pg.rect(L, 126, 54, 3.2, { fill: CYAN }); pg.rect(L + 54, 126, 26, 3.2, { fill: BLUE });
  const paidFull = status === 'Paid';
  pg.text(inv.cancelled ? 'INVOICE TOTAL' : paidFull ? 'PAID IN FULL' : 'AMOUNT DUE', L, 150, { font: 'F2', size: 7.5, color: MUT, spacing: 1.5 });
  pg.text(amt(cur, inv.cancelled || paidFull ? C.total : C.due), L, 174, { font: 'F2', size: 22, color: paidFull ? GREEN : inv.cancelled ? RED : BLUE });
  pg.text(inv.cancelled ? 'This invoice has been cancelled' : paidFull ? 'Thank you - payment received' : (inv.due ? 'Please pay by ' + fmtDate(inv.due) : ''), L, 190, { size: 9, color: MUT });

  /* ---- meta card (Date, Customer ID, Invoice No, Due Date, Currency) */
  const mx = 322, mw = R - mx, mh = 94, my = 82;
  pg.rect(mx, my, mw, mh, { fill: SOFT, stroke: LINE, r: 10, lw: 0.8 });
  pg.rect(mx, my + 10, 3.5, mh - 20, { fill: BLUE });
  const meta = [['Date', fmtDate(inv.date)], ['Customer ID', inv.custId || '-'], ['Invoice No', inv.no || '-'], ['Due Date', fmtDate(inv.due) || '-']];
  meta.forEach((m, i) => {
    const ry = my + 23 + i * 21;
    pg.text(m[0], mx + 16, ry, { size: 8.5, color: MUT });
    pg.text(m[1], R - 14, ry, { font: 'F2', size: i === 2 ? 10.5 : 9.5, color: i === 2 ? BLUE : INK, align: 'right' });
    if (i < meta.length - 1) pg.line(mx + 16, ry + 7.5, R - 14, ry + 7.5, LINE, 0.5);
  });

  /* ---- invoice to / from cards */
  y = Math.max(my + mh, 192) + 12;
  const cw = (CW - 14) / 2, lx = L, rx = L + cw + 14;
  const client = inv.client || {};
  const rowsOf = (o, labels) => labels.map(l => [l[0], o[l[1]]]).filter(r => r[1] && String(r[1]).trim());
  const toRows = rowsOf(client, [['Address', 'addr'], ['Email', 'email'], ['Phone', 'phone'], ['Web', 'web']]);
  const frRows = rowsOf({ addr: S.address, email: S.email, phone: S.phone, web: S.web }, [['Address', 'addr'], ['Email', 'email'], ['Mobile', 'phone'], ['Web', 'web']]);
  const LABW = 0;
  const layoutRows = rows => rows.map(r => ({ l: r[0], lines: wrap(String(r[1]).replace(/\s*[\r\n]+\s*/g, ', '), 'F1', 8.8, cw - 28 - LABW) }));
  const toL = layoutRows(toRows), frL = layoutRows(frRows);
  const rowsH = L_ => L_.reduce((a, r) => a + Math.max(1, r.lines.length) * 11.5 + 4, 0);
  const cardH = 58 + Math.max(rowsH(toL), rowsH(frL)) + 8;
  const drawCard = (x, title, name, L_, extra) => {
    pg.rect(x, y, cw, cardH, { fill: '#ffffff', stroke: LINE, r: 10, lw: 0.9 });
    pg.gradRect(x, y, cw, 4, SKY, BLUE, { r: 2 });
    pg.text(title, x + 14, y + 25, { font: 'F2', size: 10.5, color: BLUE, spacing: 1.6 });
    if (extra) { pg.text(extra[1], x + cw - 14, y + 25, { font: 'F2', size: 8, color: INK, align: 'right' }); pg.text(extra[0], x + cw - 14 - textWidth(extra[1], 'F2', 8) - 5, y + 25, { size: 7.5, color: MUT, align: 'right' }); }
    const nl = wrap(name || '-', 'F2', 13, cw - 28).slice(0, 2);
    nl.forEach((t, i) => pg.text(t, x + 14, y + 46 + i * 15, { font: 'F2', size: 13, color: NAVY }));
    let ry = y + 46 + (nl.length - 1) * 15 + 17;
    L_.forEach(r => {
      (r.lines.length ? r.lines : ['']).forEach((t, i) => pg.text(t, x + 14, ry + i * 11.5, { size: 8.8, color: INK }));
      ry += Math.max(1, r.lines.length) * 11.5 + 4;
    });
  };
  const showCid = client.cid && client.cid !== inv.custId;
  drawCard(lx, 'INVOICE TO', client.name, toL, showCid ? ['Client ID', client.cid] : null);
  drawCard(rx, 'INVOICE FROM', company, frL, null);
  y += cardH + 14;

  /* ---- services table */
  const cQty = L + 338, cRate = L + 410, cAmt = R - 14, descX = L + 36, descW = cQty - 62 - descX;
  const tableHead = () => {
    pg.gradRect(L, y, CW, 25, NAVY, BLUE, { r: 7 });
    const ty = y + 16.5, o = { font: 'F2', size: 7.8, color: '#ffffff', spacing: 1.1 };
    pg.text('#', L + 14, ty, o); pg.text('DESCRIPTION', descX, ty, o);
    pg.text('QTY', cQty, ty, Object.assign({ align: 'right' }, o)); pg.text('RATE (' + cur + ')', cRate, ty, Object.assign({ align: 'right' }, o)); pg.text('AMOUNT (' + cur + ')', cAmt, ty, Object.assign({ align: 'right' }, o));
    y += 25;
  };
  const newPage = () => {
    pg.newPage(); page++; drawPad();
    pg.text('Invoice ' + (inv.no || ''), L, 100, { font: 'F2', size: 10, color: NAVY });
    pg.text((client.name || '') + '  |  continued', R, 100, { size: 8.5, color: MUT, align: 'right' });
    pg.line(L, 108, R, 108, LINE, 0.8);
    y = 122;
  };
  tableHead();
  const items = C.items.length ? C.items : [];
  items.forEach((it, idx) => {
    const nameL = wrap(it.name || '-', 'F2', 9.6, descW), detL = [];
    String(it.desc || '').split(/\r?\n/).forEach(p => { if (p.trim()) wrap(p, 'F1', 8.2, descW).forEach(x => detL.push(x)); });
    const h = Math.max(32, 12 + nameL.length * 12 + detL.length * 10.5 + 7);
    if (y + h > BOT - 8) { newPage(); tableHead(); }
    if (idx % 2 === 1) pg.rect(L, y, CW, h, { fill: SOFT });
    const base = y + 18;
    pg.text(String(idx + 1).padStart(2, '0'), L + 14, base, { font: 'F2', size: 8.5, color: CYAN });
    nameL.forEach((t, i) => pg.text(t, descX, base + i * 12, { font: 'F2', size: 9.6, color: NAVY }));
    detL.forEach((t, i) => pg.text(t, descX, base + nameL.length * 12 - 1 + i * 10.5, { size: 8.2, color: MUT }));
    pg.text(qtyText(it), cQty, base, { size: 9.2, color: INK, align: 'right' });
    pg.text(money(it.rate), cRate, base, { size: 9.2, color: INK, align: 'right' });
    pg.text(money(it.amt), cAmt, base, { font: 'F2', size: 9.6, color: NAVY, align: 'right' });
    pg.line(L, y + h, R, y + h, LINE, 0.6);
    y += h;
  });
  if (!items.length) { pg.text('No services added yet.', L + 14, y + 22, { font: 'F3', size: 9, color: MUT }); y += 36; }
  y += 12;

  /* ---- summary: totals (right, directly under the table) -> words (full width, one line) -> payment details + signature */
  const bank = (S.banks || []).find(b => b.id === inv.bankId) || null;
  const bankLines = bank ? (bank.lines || []).filter(l => l[1] && String(l[1]).trim()) : [];
  const tx = 330, tw = R - tx;
  const trows = [['Subtotal', money(C.sub), 0]];
  if (C.discount > 0) trows.push(['Discount' + (inv.discType === 'pct' ? ' (' + (+inv.disc) + '%)' : ''), '- ' + money(C.discount), 0]);
  if (C.tax > 0) trows.push([(S.taxLabel || 'VAT') + ' (' + (+inv.taxPct) + '%)', money(C.tax), 0]);
  if (C.discount > 0 || C.tax > 0) trows.push(['Invoice Total', money(C.total), 1]);
  trows.push(['Advance Amount', C.advance > 0 ? '- ' + money(C.advance) : 'N/A', 0]);
  if (C.paid > 0) trows.push(['Payments Received', '- ' + money(C.paid), 0]);
  const totH = trows.length * 21 + 12 + 40;
  const wordsAmt = (paidFull || inv.cancelled) ? C.total : C.due;
  const wordsH = 30, SGW = 178, NW = CW - SGW - 14;
  const bankH = bankLines.length ? 30 + bankLines.length * 13 + 6 : 0;
  const rowH = Math.max(bankH, 84);
  const need = totH + 12 + wordsH + 16 + rowH + 22;
  const movedOn = y + need > BOT; if (movedOn) newPage();
  const sy = y;
  // totals
  let ty = sy;
  trows.forEach((r) => {
    const bold = r[2];
    if (bold) pg.rect(tx, ty, tw, 21, { fill: SOFT });
    pg.text(r[0], tx + 12, ty + 14.5, { font: bold ? 'F2' : 'F1', size: 9, color: bold ? NAVY : MUT });
    pg.text(r[1], R - 12, ty + 14.5, { font: 'F2', size: 9.4, color: r[1] === 'N/A' ? MUT : INK, align: 'right' });
    pg.line(tx, ty + 21, R, ty + 21, LINE, 0.5);
    ty += 21;
  });
  ty += 12;
  const dueCol = paidFull ? [GREEN, '#2cc48c'] : inv.cancelled ? [RED, '#f0586b'] : [NAVY, BLUE];
  pg.gradRect(tx, ty, tw, 40, dueCol[0], dueCol[1], { r: 9 });
  pg.text(paidFull ? 'TOTAL PAID' : inv.cancelled ? 'CANCELLED' : 'AMOUNT DUE', tx + 14, ty + 24.5, { font: 'F2', size: 8.4, color: '#ffffff', spacing: 1.4 });
  pg.text(amt(cur, paidFull || inv.cancelled ? C.total : C.due), R - 14, ty + 25.5, { font: 'F2', size: 14.5, color: '#ffffff', align: 'right' });
  // amount in words: one horizontal line, just below the amount-due band
  const wy = ty + 40 + 12, wLabel = paidFull || inv.cancelled ? 'AMOUNT (IN WORDS)' : 'AMOUNT DUE (IN WORDS)', wTxt = amountWords(wordsAmt, cur);
  pg.rect(L, wy, CW, wordsH, { fill: SOFT2, r: 9 });
  pg.rect(L, wy + 7, 3.5, wordsH - 14, { fill: CYAN });
  pg.text(wLabel, L + 16, wy + 18.6, { font: 'F2', size: 7.3, color: BLUE, spacing: 1.3 });
  const lblW = textWidth(wLabel, 'F2', 7.3, 1.3) + 14 + 16, availW = CW - lblW - 14;
  let wfs = 10; while (wfs > 6 && textWidth(wTxt, 'F3', wfs) > availW) wfs -= 0.2;
  pg.text(wTxt, L + lblW, wy + 19, { font: 'F3', size: wfs, color: NAVY });
  y = wy + wordsH + 16;
  // payment details (left) and signature (right) sit lower, just above the thank-you line
  const shift = movedOn ? 0 : Math.max(0, Math.min(100, (BOT - 8 - 26) - (y + rowH)));
  y += shift;
  if (bankH) {
    pg.rect(L, y, NW, bankH, { fill: '#ffffff', stroke: LINE, r: 9, lw: 0.9 });
    pg.text('PAYMENT DETAILS', L + 16, y + 20, { font: 'F2', size: 7.3, color: BLUE, spacing: 1.3 });
    pg.text(bank.label ? 'Through ' + bank.label : 'Through Bank', L + NW - 14, y + 20, { size: 7.6, color: MUT, align: 'right' });
    bankLines.forEach((l, i) => {
      const ly = y + 37 + i * 13;
      pg.text(String(l[0] || '') + (l[0] ? ':' : ''), L + 16, ly, { size: 8.3, color: MUT });
      pg.text(String(l[1] || ''), L + 98, ly, { font: 'F2', size: 8.6, color: INK });
    });
  }
  const sgx = R - SGW, sigImg = dataUrlJpeg(S.sigImg || '');
  if (sigImg) {
    try { const im = jpegDims(sigImg), mh = 56, mw = SGW - 8, sc = Math.min(mh / im.height, mw / im.width), w = im.width * sc, h = im.height * sc; pg.image(sigImg, sgx + (SGW - w) / 2, y + 1 + (mh - h), w, h); } catch (e) { /* ignore a bad signature image */ }
  }
  pg.line(sgx, y + 60, R, y + 60, '#9fb3cc', 0.8);
  pg.text(S.sigName || 'Authorised Signatory', sgx + SGW / 2, y + 72, { font: 'F2', size: 8.8, color: NAVY, align: 'center' });
  if (S.sigTitle) pg.text(S.sigTitle, sgx + SGW / 2, y + 82, { size: 7.8, color: MUT, align: 'center' });
  y += rowH + 10;
  // thank you (anchored near the pad footer)
  const thY = Math.max(y + 22, BOT - 8);
  const thx = 297.66, tt = S.thanks || 'Thank You For Your Business!';
  const tww = textWidth(tt, 'F2', 15, 0.4);
  pg.text(tt, thx, thY, { font: 'F2', size: 15, color: BLUE, align: 'center', spacing: 0.4 });
  pg.gradRect(L, thY - 5, thx - tww / 2 - 16 - L, 1.6, '#ffffff', CYAN, { r: 0.8 }); pg.gradRect(thx + tww / 2 + 16, thY - 5, R - (thx + tww / 2 + 16), 1.6, CYAN, '#ffffff', { r: 0.8 });

  /* ---- stamps (first page) */
  // draw on page 1: the writer keeps finished pages in pg.done
  const stampOn = (str, color, a) => { const cur_ = pg.ops; pg.ops = (pg.done && pg.done[0]) || pg.ops; pg.stamp(str, 318, 480, -22, 66, color, a); pg.ops = cur_; };
  if (paidFull) stampOn('PAID', GREEN, 0.16);
  else if (inv.cancelled) stampOn('CANCELLED', RED, 0.15);

  return pg.build({ title: 'Invoice ' + (inv.no || ''), author: company });
}

function jpegDims(buf) {
  let i = 2;
  while (i < buf.length) {
    if (buf[i] !== 0xFF) { i++; continue; }
    const m = buf[i + 1];
    if (m === 0xD8 || (m >= 0xD0 && m <= 0xD7) || m === 0x01 || m === 0xFF) { i += (m === 0xFF ? 1 : 2); continue; }
    const len = buf.readUInt16BE(i + 2);
    if (m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC) return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    i += 2 + len;
  }
  throw new Error('bad JPEG');
}

/* ------------------------------------------------------------------ client profile PDF (on the company pad) */
export function clientFileName(c) { return 'Client_profile_' + String((c && c.name) || 'client').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '') + '.pdf'; }
export function buildClientPdf(cl, invs, S, today) {
  const pg = new PDF(595.32, 841.92), L = 40, R = 555.3, CW = R - L, TOP = 84, BOT = 790;
  let y = TOP, page = 1;
  const drawPad = () => { if (padBuf) pg.image(padBuf, 0, 0, 595.32, 841.92); };
  drawPad();
  const stCol = s => s === 'Paid' ? GREEN : s === 'Overdue' ? RED : s === 'Cancelled' ? '#6a3fc2' : s === 'Partially paid' ? AMBER : s === 'Sent' ? BLUE : MUT;
  const newPage = () => {
    pg.newPage(); page++; drawPad();
    pg.text('Client profile', L, 100, { font: 'F2', size: 10, color: NAVY });
    pg.text((cl.name || '') + '  |  continued', R, 100, { size: 8.5, color: MUT, align: 'right' });
    pg.line(L, 108, R, 108, LINE, 0.8); y = 122;
  };
  pg.text('CLIENT PROFILE', L, 116, { font: 'F2', size: 27, color: NAVY, spacing: 3 });
  pg.rect(L, 126, 54, 3.2, { fill: CYAN }); pg.rect(L + 54, 126, 26, 3.2, { fill: BLUE });
  pg.text('Generated on ' + fmtDate(today), R, 116, { size: 8.5, color: MUT, align: 'right' });
  y = 144;

  /* details card */
  const rowsAll = [['Client ID', cl.cid], ['Address', cl.addr], ['Email', cl.email], ['Phone', cl.phone], ['Web', cl.web], ['Usual currency', cl.cur ? curName(cl.cur) : ''], ['Invoice code', cl.code], ['Client since', cl.created ? fmtDate(String(cl.created).slice(0, 10)) : ''], ['Notes', cl.notes]].filter(r => r[1] && String(r[1]).trim());
  const LABW = 82, rl = rowsAll.map(r => ({ l: r[0], lines: wrap(String(r[1]).replace(/\s*[\r\n]+\s*/g, ', '), 'F1', 9, CW - 28 - LABW) }));
  const nameL = wrap(cl.name || '-', 'F2', 15, CW - 28).slice(0, 2);
  const ch = 38 + (nameL.length - 1) * 17 + 14 + rl.reduce((a, r) => a + r.lines.length * 11.5 + 6, 0) + 8;
  pg.rect(L, y, CW, ch, { fill: '#ffffff', stroke: LINE, r: 10, lw: 0.9 });
  pg.gradRect(L, y, CW, 4, SKY, BLUE, { r: 2 });
  pg.text('CLIENT DETAILS', L + 14, y + 22, { font: 'F2', size: 7.5, color: BLUE, spacing: 1.5 });
  nameL.forEach((t, i) => pg.text(t, L + 14, y + 42 + i * 17, { font: 'F2', size: 15, color: NAVY }));
  let ry = y + 42 + (nameL.length - 1) * 17 + 20;
  rl.forEach(r => { pg.text(r.l.toUpperCase(), L + 14, ry, { font: 'F2', size: 6.8, color: MUT, spacing: 0.7 }); r.lines.forEach((t, i) => pg.text(t, L + 14 + LABW, ry + i * 11.5, { size: 9, color: INK })); ry += r.lines.length * 11.5 + 6; });
  y += ch + 14;

  /* summary cards per currency */
  const act = invs.filter(i => !i.cancelled);
  ['BDT', 'USD'].forEach(cur => {
    const L1 = act.filter(i => i.cur === cur); if (!L1.length) return;
    const sum = f => r2(L1.reduce((a, i) => a + f(calcInvoice(i), i), 0));
    const tot = sum(c => c.total), rec = sum(c => c.advance + c.paid), out = sum(c => c.due), od = r2(L1.filter(i => invStatus(i, today) === 'Overdue').reduce((a, i) => a + calcInvoice(i).due, 0));
    if (y + 74 > BOT) newPage();
    pg.text(cur + ' SUMMARY', L, y + 8, { font: 'F2', size: 7.5, color: BLUE, spacing: 1.5 });
    const cells = [['Invoices', String(L1.length), INK], ['Total invoiced', money(tot), NAVY], ['Received', money(rec), GREEN], ['Outstanding', money(out), out > 0 ? AMBER : INK], ['Overdue', money(od), od > 0 ? RED : INK]], w = (CW - 4 * 8) / 5;
    cells.forEach((c, i) => { const x = L + i * (w + 8); pg.rect(x, y + 16, w, 46, { fill: SOFT, stroke: LINE, r: 8, lw: 0.7 }); pg.rect(x, y + 24, 3, 30, { fill: i === 3 ? AMBER : i === 4 ? RED : i === 2 ? GREEN : BLUE }); pg.text(c[0].toUpperCase(), x + 11, y + 31, { font: 'F2', size: 6.4, color: MUT, spacing: 0.6 }); let fs = 11.5; while (fs > 7 && textWidth(c[1], 'F2', fs) > w - 18) fs -= 0.5; pg.text(c[1], x + 11, y + 50, { font: 'F2', size: fs, color: c[2] }); });
    y += 74;
  });
  y += 4;

  /* generic table */
  const table = (title, cols, rows, emptyMsg) => {
    if (y + 70 > BOT) newPage();
    pg.text(title, L, y + 8, { font: 'F2', size: 7.5, color: BLUE, spacing: 1.5 }); y += 16;
    const head = () => { pg.gradRect(L, y, CW, 22, NAVY, BLUE, { r: 6 }); let x = L; cols.forEach(c => { const o = { font: 'F2', size: 7, color: '#ffffff', spacing: 0.8 }; if (c.al === 'r') pg.text(c.h, x + c.w - 8, y + 14.5, Object.assign({ align: 'right' }, o)); else pg.text(c.h, x + 8, y + 14.5, o); x += c.w; }); y += 22; };
    head();
    if (!rows.length) { pg.text(emptyMsg, L + 10, y + 18, { font: 'F3', size: 9, color: MUT }); y += 30; return; }
    rows.forEach((r, ix) => {
      if (y + 24 > BOT - 6) { newPage(); head(); }
      if (ix % 2) pg.rect(L, y, CW, 24, { fill: SOFT });
      let x = L; cols.forEach((c, k) => { const v = r[k], t = typeof v === 'object' ? v.t : String(v == null ? '' : v), col = typeof v === 'object' ? v.c : INK, f = typeof v === 'object' && v.b ? 'F2' : 'F1'; let s = 8.6; while (s > 5.5 && textWidth(t, f, s) > c.w - 14) s -= 0.4; if (c.al === 'r') pg.text(t, x + c.w - 8, y + 15.5, { font: f, size: s, color: col, align: 'right' }); else pg.text(t, x + 8, y + 15.5, { font: f, size: s, color: col }); x += c.w; });
      pg.line(L, y + 24, R, y + 24, LINE, 0.5); y += 24;
    });
    y += 14;
  };
  const sorted = invs.slice().sort((a, b) => a.date < b.date ? 1 : a.date > b.date ? -1 : 0);
  table('INVOICES (' + invs.length + ')', [{ h: 'INVOICE NO', w: 112 }, { h: 'DATE', w: 62 }, { h: 'DUE', w: 62 }, { h: 'TOTAL', w: 78, al: 'r' }, { h: 'RECEIVED', w: 70, al: 'r' }, { h: 'BALANCE', w: 70, al: 'r' }, { h: 'STATUS', w: 61.3 }],
    sorted.map(i => { const c = calcInvoice(i), s = invStatus(i, today); return [{ t: i.no || '-', b: 1, c: NAVY }, fmtDate(i.date), fmtDate(i.due), (i.cur) + ' ' + money(c.total), money(c.advance + c.paid), { t: money(c.due), b: 1 }, { t: s.replace('Partially paid', 'Part paid'), c: stCol(s), b: 1 }]; }), 'No invoices yet.');
  const pays = [];
  invs.forEach(i => { if (i.cancelled) return; const c = calcInvoice(i); if (c.advance > 0) pays.push([i.date, i, 'Advance', 'Advance on invoice', c.advance, 'Advance']); (i.payments || []).forEach(p => pays.push([p.date || '', i, p.method || '', p.note || '', +p.amt || 0, (p.proof && p.proof.length ? 'Receipt' : 'No receipt')])); });
  pays.sort((a, b) => a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0);
  table('PAYMENT HISTORY (' + pays.length + ')', [{ h: 'DATE', w: 64 }, { h: 'INVOICE NO', w: 104 }, { h: 'METHOD', w: 76 }, { h: 'NOTE', w: 96 }, { h: 'RECEIPT', w: 66 }, { h: 'AMOUNT', w: 109.3, al: 'r' }],
    pays.map(p => [fmtDate(p[0]), p[1].no || '-', p[2], p[3], { t: p[5], b: 1, c: p[5] === 'Receipt' ? GREEN : p[5] === 'Advance' ? BLUE : MUT }, { t: p[1].cur + ' ' + money(p[4]), b: 1, c: GREEN }]), 'No payments recorded yet.');
  return pg.build({ title: 'Client profile - ' + (cl.name || ''), author: S.company || 'Connectivo' });
}
