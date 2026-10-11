// Generates sample.pdf: text (normal, bold, rotated) + embedded PNG images.
import { PDFDocument, StandardFonts, rgb, degrees } from "pdf-lib";
import zlib from "node:zlib";
import { writeFileSync } from "node:fs";

// ---- minimal PNG encoder ----
const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
export function makePng(w, h, rgbFn) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  const raw = Buffer.alloc(h * (1 + w * 3));
  for (let y = 0; y < h; y++) {
    const row = y * (1 + w * 3);
    raw[row] = 0;
    for (let x = 0; x < w; x++) {
      const [r, g, b] = rgbFn(x, y);
      raw[row + 1 + x * 3] = r;
      raw[row + 1 + x * 3 + 1] = g;
      raw[row + 1 + x * 3 + 2] = b;
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// checker + circle test pattern
const img1 = makePng(128, 128, (x, y) => {
  const cx = x - 64, cy = y - 64;
  if (cx * cx + cy * cy < 30 * 30) return [255, 200, 40];
  return (x >> 4) % 2 === (y >> 4) % 2 ? [40, 90, 200] : [120, 170, 240];
});
const img2 = makePng(96, 96, (x, y) => [Math.round(255 * (x / 95)), 60, Math.round(255 * (y / 95))]);

const doc = await PDFDocument.create();
const helv = await doc.embedFont(StandardFonts.Helvetica);
const helvB = await doc.embedFont(StandardFonts.HelveticaBold);
const times = await doc.embedFont(StandardFonts.TimesRoman);
const png1 = await doc.embedPng(img1);
const png2 = await doc.embedPng(img2);

const p1 = doc.addPage([612, 792]);
p1.drawText("Quarterly Report", { x: 72, y: 720, size: 24, font: helvB, color: rgb(0.1, 0.1, 0.3) });
p1.drawText("Revenue grew 12% this quarter.", { x: 72, y: 690, size: 12, font: helv });
p1.drawText("Contact: sales@example.com", { x: 72, y: 668, size: 12, font: helv });
p1.drawText("Times text line here", { x: 72, y: 640, size: 14, font: times });
p1.drawText("DRAFT", { x: 300, y: 400, size: 48, font: helvB, color: rgb(0.8, 0.1, 0.1), rotate: degrees(30) });
p1.drawImage(png1, { x: 380, y: 560, width: 160, height: 160 });
p1.drawImage(png2, { x: 120, y: 380, width: 220, height: 120 }); // stretched (non-uniform)
p1.drawRectangle({ x: 60, y: 600, width: 200, height: 60, color: rgb(0.93, 0.95, 1) });
p1.drawText("Text on light panel", { x: 72, y: 622, size: 12, font: helv });

const p2 = doc.addPage([612, 792]);
p2.drawText("Page two — appendix", { x: 72, y: 720, size: 18, font: helvB });
p2.drawText("Replace me too", { x: 72, y: 690, size: 12, font: helv });
p2.drawImage(png1, { x: 100, y: 300, width: 300, height: 300, rotate: degrees(15) });

writeFileSync("sample.pdf", await doc.save());
writeFileSync("replacement.png", makePng(200, 120, (x, y) =>
  (x + y) % 40 < 20 ? [20, 160, 90] : [240, 240, 240]));
console.log("wrote sample.pdf + replacement.png");
