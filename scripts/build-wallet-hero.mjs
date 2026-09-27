/**
 * Rasterise the WAKA Loyalty Google Wallet hero.
 *
 *   node scripts/build-wallet-hero.mjs
 *
 * Source: public/brand/waka-loyalty-wallet-hero.svg
 * Output: public/brand/waka-loyalty-wallet-hero.png  (1032x336)
 *
 * The WAKA mark is composited from the real brand asset rather than redrawn, so the artwork and
 * the app can never drift apart. The oversized watermark is the same asset with its alpha scaled
 * down — `ensureAlpha()` would replace the alpha channel outright and fill the transparent
 * background, so the alpha is multiplied per pixel instead.
 *
 * Google Wallet renders a fixed template over this banner: it carries the STATIC brand identity
 * only. Member id, name, points, expiry, CVC and the QR stay dynamic Wallet fields and must never
 * be baked in here.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const svgPath = join(root, "public", "brand", "waka-loyalty-wallet-hero.svg");
const markPath = join(root, "public", "brand", "w-icon-128.png");
const outPath = join(root, "public", "brand", "waka-loyalty-wallet-hero.png");

const WIDTH = 1032;
const HEIGHT = 336;

/**
 * The shipped `w-icon-*.png` files are the app-icon treatment: an orange W sitting on an opaque
 * WHITE rounded tile. On a navy card that tile reads as a white box, so the tile is keyed out
 * here, leaving just the orange mark on transparency.
 */
async function bareMark(size) {
  const { data, info } = await sharp(markPath)
    .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += 4) {
    // near-white (the tile) -> fully transparent; the orange mark and its antialiased edge stay
    if (data[i] > 232 && data[i + 1] > 232 && data[i + 2] > 232) data[i + 3] = 0;
  }
  return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
    .png()
    .toBuffer();
}

/** Scale a copy of the bare mark's alpha so it reads as a watermark, not a second logo. */
async function fadedMark(size, alpha) {
  const { data, info } = await sharp(await bareMark(size))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  for (let i = 3; i < data.length; i += 4) data[i] = Math.round(data[i] * alpha);
  return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
    .png()
    .toBuffer();
}

const background = await sharp(readFileSync(svgPath))
  .resize(WIDTH, HEIGHT)
  .png()
  .toBuffer();

// `composite` requires every overlay to fit inside the canvas, so the watermark is sized to the
// 336px height rather than bleeding off the edge.
const [mark, watermark] = await Promise.all([bareMark(92), fadedMark(320, 0.07)]);

const png = await sharp(background)
  .composite([
    { input: watermark, left: 708, top: 8 },
    { input: mark, left: 72, top: 68 },
  ])
  .png({ compressionLevel: 9 })
  .toBuffer();

writeFileSync(outPath, png);

const meta = await sharp(png).metadata();
console.log(
  `wrote ${outPath} — ${meta.width}x${meta.height} ${meta.format} ${(png.length / 1024).toFixed(1)} KiB`,
);
if (meta.width !== WIDTH || meta.height !== HEIGHT) {
  throw new Error(`unexpected dimensions ${meta.width}x${meta.height}`);
}
