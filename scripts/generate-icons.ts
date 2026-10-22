// Generates PNG app icons without external dependencies (tiny PNG encoder over zlib).
// Run: npx tsx scripts/generate-icons.ts
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

function png(size: number, draw: (x: number, y: number) => [number, number, number, number]) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = draw(x, y);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
      raw[o + 3] = a;
    }
  }
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

const BRAND: [number, number, number] = [180, 83, 42];
const CREAM: [number, number, number] = [251, 247, 242];

function icon(size: number, maskable: boolean) {
  const c = size / 2;
  const radius = maskable ? size : size * 0.22; // corner radius of background
  const scale = maskable ? 0.72 : 0.86; // keep artwork inside the maskable safe zone
  return png(size, (x, y) => {
    // Rounded-square background (full bleed when maskable).
    const dx = Math.max(Math.abs(x + 0.5 - c) - (c - radius), 0);
    const dy = Math.max(Math.abs(y + 0.5 - c) - (c - radius), 0);
    if (!maskable && Math.hypot(dx, dy) > radius) return [0, 0, 0, 0];
    const d = Math.hypot(x + 0.5 - c, y + 0.5 - c) / (c * scale);
    // Plate: cream disc with brand ring, a cloche dome on top.
    if (d < 0.62) {
      const nx = (x + 0.5 - c) / (c * scale);
      const ny = (y + 0.5 - c) / (c * scale);
      const inDome = ny < 0.12 && Math.hypot(nx, (ny - 0.12) * 1.25) < 0.42;
      const inBase = Math.abs(ny - 0.16) < 0.045 && Math.abs(nx) < 0.5;
      const inKnob = Math.hypot(nx, ny + 0.36) < 0.07;
      if (inDome || inBase || inKnob) return [...BRAND, 255];
      return [...CREAM, 255];
    }
    if (d < 0.7) return [...CREAM, 255];
    return [...BRAND, 255];
  });
}

const dir = path.join(process.cwd(), "public", "icons");
mkdirSync(dir, { recursive: true });
writeFileSync(path.join(dir, "icon-192.png"), icon(192, false));
writeFileSync(path.join(dir, "icon-512.png"), icon(512, false));
writeFileSync(path.join(dir, "icon-maskable-512.png"), icon(512, true));
writeFileSync(path.join(dir, "apple-touch-icon.png"), icon(180, true));
console.log("Icons written to", dir);
