'use strict';
// Tiny PNG decoder (8-bit, non-interlaced; gray, RGB, palette, gray+alpha, RGBA) -> {w,h,rgb,alpha}
import zlib from 'node:zlib';
import { Buffer } from 'node:buffer';
function decodePng(buf) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buf.length < 33 || !buf.slice(0, 8).equals(sig)) throw new Error('not a PNG');
  let p = 8, w = 0, h = 0, depth = 0, ct = 0, inter = 0, plte = null, trns = null; const idat = [];
  while (p + 8 <= buf.length) {
    const len = buf.readUInt32BE(p), type = buf.toString('latin1', p + 4, p + 8), d = buf.slice(p + 8, p + 8 + len); p += 12 + len;
    if (type === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); depth = d[8]; ct = d[9]; inter = d[12]; }
    else if (type === 'PLTE') plte = d; else if (type === 'tRNS') trns = d; else if (type === 'IDAT') idat.push(d); else if (type === 'IEND') break;
  }
  if (depth !== 8 || inter !== 0 || !w || !h || w * h > 4e6) throw new Error('unsupported PNG');
  const ch = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ct]; if (!ch) throw new Error('unsupported PNG');
  const raw = zlib.inflateSync(Buffer.concat(idat)), bpp = ch, stride = w * ch, out = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, dst = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[dst + x - bpp] : 0, b = y ? out[dst - stride + x] : 0, c = x >= bpp && y ? out[dst - stride + x - bpp] : 0; let v = raw[src + x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c); v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c); }
      out[dst + x] = v & 255;
    }
  }
  const rgb = Buffer.alloc(w * h * 3); let alpha = null; if (ct === 4 || ct === 6 || (ct === 3 && trns) ) alpha = Buffer.alloc(w * h, 255);
  for (let i = 0; i < w * h; i++) {
    let r, g, b2, a = 255;
    if (ct === 6) { r = out[i * 4]; g = out[i * 4 + 1]; b2 = out[i * 4 + 2]; a = out[i * 4 + 3]; }
    else if (ct === 2) { r = out[i * 3]; g = out[i * 3 + 1]; b2 = out[i * 3 + 2]; }
    else if (ct === 0) { r = g = b2 = out[i]; }
    else if (ct === 4) { r = g = b2 = out[i * 2]; a = out[i * 2 + 1]; }
    else { const k = out[i]; r = plte[k * 3]; g = plte[k * 3 + 1]; b2 = plte[k * 3 + 2]; if (trns && k < trns.length) a = trns[k]; }
    rgb[i * 3] = r; rgb[i * 3 + 1] = g; rgb[i * 3 + 2] = b2; if (alpha) alpha[i] = a;
  }
  return { w, h, rgb, alpha };
}
export { decodePng };
