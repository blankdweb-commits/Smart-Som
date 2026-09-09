// scripts/_gen-pwa-icons.mjs
// Deterministic icon generator for the PWA manifest / iOS web push.
// Renders a purple rounded-square with the white ECG zig-zag, then encodes a
// lossless PNG directly (no external rasterizer dependency).
//
// Usage: node scripts/_gen-pwa-icons.mjs   (writes public/pwa-192.png,
//        public/pwa-512.png, public/apple-touch-icon.png)
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ---------- tiny PNG encoder ----------
const crcTable = [];
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  crcTable[n] = c >>> 0;
}
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
};
const encodePng = (width, height, rgba) => {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
};

// ---------- shape helpers ----------
const BRAND = [128, 0, 128]; // #800080

// Signed distance to a rounded box centered at origin (half extents h, radius r).
const sdRoundedBox = (px, py, hx, hy, r) => {
  const qx = Math.abs(px) - (hx - r);
  const qy = Math.abs(py) - (hy - r);
  const mx = Math.max(qx, 0);
  const my = Math.max(qy, 0);
  return Math.hypot(mx, my) + Math.min(Math.max(qx, qy), 0) - r;
};

const segDist = (px, py, ax, ay, bx, by) => {
  const vx = bx - ax, vy = by - ay;
  const wx = px - ax, wy = py - ay;
  const len2 = vx * vx + vy * vy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, (wx * vx + wy * vy) / len2));
  return Math.hypot(wx - t * vx, wy - t * vy);
};

// Rounded-line stroke along the ECG polyline, returned as signed-ish distance.
const sdPolyline = (px, py, pts, halfW) => {
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) {
    best = Math.min(best, segDist(px, py, pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]));
  }
  return best - halfW;
};

const coverage = (d, aa) => Math.max(0, Math.min(1, 0.5 - d / aa));

function renderIcon(size) {
  const aa = 2; // supersample factor
  const W = size * aa;
  const p = size / 24.0;
  const pad = size * 0.05;
  const hx = (size / 2) - pad;
  const hy = (size / 2) - pad;
  const radius = size * 0.22;
  const scale = (u, v) => [u * p, v * p];
  const pts = [
    scale(3, 12), scale(7, 12), scale(9, 6), scale(13, 18),
    scale(15, 12), scale(21, 12),
  ];
  const halfW = size * 0.0425;

  const rgba = Buffer.alloc(W * W * 4);
  for (let sy = 0; sy < W; sy++) {
    for (let sx = 0; sx < W; sx++) {
      // Continuous pixel center in image coords, shifted to origin-centered.
      const x = (sx + 0.5) / aa;
      const y = (sy + 0.5) / aa;
      const cx = x - size / 2;
      const cy = y - size / 2;
      const dBox = sdRoundedBox(cx, cy, hx, hy, radius);
      const boxCov = coverage(dBox, 1.6);
      const dStroke = sdPolyline(cx, cy, pts, halfW);
      const strokeCov = coverage(dStroke, 1.6) * boxCov;

      const r = Math.round(BRAND[0] + (255 - BRAND[0]) * strokeCov);
      const g = Math.round(BRAND[1] + (255 - BRAND[1]) * strokeCov);
      const b = Math.round(BRAND[2] + (255 - BRAND[2]) * strokeCov);
      const a = Math.round(boxCov * 255);

      const o = (sy * W + sx) * 4;
      rgba[o] = r; rgba[o + 1] = g; rgba[o + 2] = b; rgba[o + 3] = a;
    }
  }

  // Downsample (box filter) back to the target size.
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let dy = 0; dy < aa; dy++) {
        for (let dx = 0; dx < aa; dx++) {
          const o = ((y * aa + dy) * W + (x * aa + dx)) * 4;
          r += rgba[o]; g += rgba[o + 1]; b += rgba[o + 2]; a += rgba[o + 3];
        }
      }
      const n = aa * aa;
      const o = (y * size + x) * 4;
      out[o] = Math.round(r / n);
      out[o + 1] = Math.round(g / n);
      out[o + 2] = Math.round(b / n);
      out[o + 3] = Math.round(a / n);
    }
  }
  return encodePng(size, size, out);
}

for (const size of [192, 512, 180]) {
  const name = size === 180 ? 'apple-touch-icon.png' : `pwa-${size}.png`;
  fs.writeFileSync(path.join(ROOT, 'public', name), renderIcon(size));
  console.log(`wrote public/${name} (${size}px)`);
}