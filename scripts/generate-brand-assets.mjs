#!/usr/bin/env node
/**
 * Generate DKASU POS app icon, splash, and brand exports.
 *
 * Source of truth is the supplied DKASU artwork in `public/brand/dkasu/`
 * (derived from `dkasu-brand-assets/logo-1..4`). The DKASU logo is never
 * redrawn here — it is sampled, cropped, and composited only. The one
 * derived value is the app-icon tile gradient, which is measured from
 * `icon-tile-transparent.png` on every run so it stays tied to the artwork.
 *
 * Writes the Capacitor asset masters consumed by `npm run cap:assets`:
 *   resources/icon-only.png       legacy launcher icon + iOS app icon (opaque)
 *   resources/icon-foreground.png Android adaptive foreground (white mark, no bg)
 *   resources/icon-background.png Android adaptive background (full-bleed)
 *   resources/splash.png          light splash master
 *   resources/splash-dark.png     dark splash master
 *
 * Run: npm run brand:assets
 */
import sharp from "sharp";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dkasuDir = resolve(root, "public/brand/dkasu");
const outDir = resolve(root, "resources/brand");

const TILE = resolve(dkasuDir, "icon-tile-transparent.png");
const LOCKUP_LIGHT = resolve(dkasuDir, "logo-horizontal-on-light-transparent.png");
const LOCKUP_DARK = resolve(dkasuDir, "logo-horizontal-on-dark-transparent.png");

/** DKASU surfaces, matched to the supplied artwork backgrounds. */
const CREAM = "#fffaf5";
const CHARCOAL = "#1c1917";
const WHITE = "#ffffff";

/**
 * Fraction of the canvas the mark occupies.
 * Android adaptive foreground art must sit inside the central 66dp of the
 * 108dp layer, i.e. 66/108 = 0.611. Legacy/iOS icons can carry a slightly
 * larger mark, matching the supplied tile (625/945 = 0.661).
 */
const ADAPTIVE_MARK_SCALE = 0.611;
const LEGACY_MARK_SCALE = 0.661;
const LOCKUP_SPLASH_SCALE = 0.5;

const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 };

for (const [label, path] of [
  ["icon-tile-transparent.png", TILE],
  ["logo-horizontal-on-light-transparent.png", LOCKUP_LIGHT],
  ["logo-horizontal-on-dark-transparent.png", LOCKUP_DARK],
]) {
  if (!existsSync(path)) {
    console.error(`Missing DKASU source artwork: public/brand/dkasu/${label}`);
    process.exit(1);
  }
}

/** Raw RGBA read helper — all pixel maths below works on this shape. */
async function readRgba(path) {
  const { data, info } = await sharp(path)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

/**
 * Measure the tile's diagonal gradient so the adaptive background can be
 * rendered full-bleed. Two points are sampled along the tile diagonal, walking
 * inward from the requested position until enough orange body is found — the
 * tile's rounded corners and the mark both fall outside the body, so a fixed
 * position is not safe. The returned geometry is where the samples were
 * actually taken, so the SVG gradient needs no extrapolation.
 */
async function measureTileGradient() {
  const { data, width, height } = await readRgba(TILE);

  const sampleAt = (t) => {
    const x = Math.round(t * (width - 1));
    const y = Math.round(t * (height - 1));
    let r = 0;
    let g = 0;
    let b = 0;
    let n = 0;
    for (let dy = -6; dy <= 6; dy++) {
      for (let dx = -6; dx <= 6; dx++) {
        const X = x + dx;
        const Y = y + dy;
        if (X < 0 || Y < 0 || X >= width || Y >= height) continue;
        const i = (Y * width + X) * 4;
        const [pr, pg, pb, pa] = [data[i], data[i + 1], data[i + 2], data[i + 3]];
        // Orange body only: opaque and clearly not the white mark.
        if (pa > 245 && Math.min(pr, pg, pb) <= 170) {
          r += pr;
          g += pg;
          b += pb;
          n++;
        }
      }
    }
    return n > 0 ? { r: r / n, g: g / n, b: b / n, n } : null;
  };

  const find = (from, step) => {
    for (let t = from; t > 0.02 && t < 0.98; t += step) {
      const s = sampleAt(t);
      if (s && s.n >= 60) {
        return { t, color: `rgb(${Math.round(s.r)},${Math.round(s.g)},${Math.round(s.b)})` };
      }
    }
    throw new Error("Could not sample the DKASU tile gradient — is the artwork intact?");
  };

  const a = find(0.1, 0.01);
  const b = find(0.9, -0.01);
  return { t0: a.t, start: a.color, t1: b.t, end: b.color };
}

/**
 * Linear gradient across the full square canvas. Stops are placed exactly
 * where they were measured on the tile, so the ramp is the artwork's own;
 * beyond the stops SVG pads, which fills the corners full-bleed.
 */
function gradientSvg(size, { t0, t1, start, end }) {
  const p0 = Math.round(t0 * size);
  const p1 = Math.round(t1 * size);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <linearGradient id="g" gradientUnits="userSpaceOnUse" x1="${p0}" y1="${p0}" x2="${p1}" y2="${p1}">
      <stop offset="0%" stop-color="${start}"/>
      <stop offset="100%" stop-color="${end}"/>
    </linearGradient>
  </defs>
  <rect width="${size}" height="${size}" fill="url(#g)"/>
</svg>`;
}

/**
 * Extract the white DKASU mark from the supplied tile as white-on-transparent.
 * Alpha ramps between the tile's own extremes: its lightest amber body colour
 * bottoms out around min-channel 80, the mark is 255. Starting the ramp at 110
 * keeps the amber body and its corner antialiasing fully transparent while
 * preserving the mark's soft edges.
 */
async function extractMark() {
  const { data, width, height } = await readRgba(TILE);
  const out = Buffer.alloc(width * height * 4);
  const LO = 110;
  const HI = 205;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const a = data[i + 3];
      const mn = Math.min(data[i], data[i + 1], data[i + 2]);
      const ramp = Math.max(0, Math.min(1, (mn - LO) / (HI - LO)));
      const alpha = Math.round(a * ramp);
      const o = i;
      out[o] = 255;
      out[o + 1] = 255;
      out[o + 2] = 255;
      out[o + 3] = alpha;
      if (alpha > 8) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX < 0) throw new Error("Could not isolate the DKASU mark from icon-tile-transparent.png");

  const markBuf = await sharp(out, { raw: { width, height, channels: 4 } })
    .extract({ left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 })
    .png()
    .toBuffer();

  const meta = await sharp(markBuf).metadata();
  return { buffer: markBuf, width: meta.width, height: meta.height };
}

/** Scale the mark to `scale` of a square canvas and centre it. */
async function placeMark(mark, size, scale) {
  const targetW = Math.round(size * scale);
  const resized = await sharp(mark.buffer)
    .resize(targetW, Math.round((mark.height / mark.width) * targetW), { fit: "inside" })
    .png()
    .toBuffer();
  const meta = await sharp(resized).metadata();
  return {
    input: resized,
    left: Math.round((size - meta.width) / 2),
    top: Math.round((size - meta.height) / 2),
  };
}

/** Opaque branded square: full-bleed gradient + centred white mark. */
async function brandedSquare(size, gradient, mark, scale) {
  return sharp(Buffer.from(gradientSvg(size, gradient)))
    .composite([await placeMark(mark, size, scale)])
    .png();
}

/** White-on-transparent mark scaled into the adaptive safe zone. */
async function adaptiveForeground(size, mark, scale) {
  return sharp({ create: { width: size, height: size, channels: 4, background: TRANSPARENT } })
    .composite([await placeMark(mark, size, scale)])
    .png();
}

/** Recolour the supplied tile to a single flat colour, keeping its alpha. */
async function monoFromTile(color) {
  const { data, width, height } = await readRgba(TILE);
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16));
  const out = Buffer.alloc(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    out[i] = r;
    out[i + 1] = g;
    out[i + 2] = b;
    out[i + 3] = data[i + 3];
  }
  return sharp(out, { raw: { width, height, channels: 4 } }).png().toBuffer();
}

/** Compose a splash master: solid background + centred DKASU lockup. */
async function splashMaster(lockupPath, background, size) {
  const lockupW = Math.round(size * LOCKUP_SPLASH_SCALE);
  const resized = await sharp(lockupPath)
    .resize(lockupW, null, { fit: "inside" })
    .png()
    .toBuffer();
  const meta = await sharp(resized).metadata();
  return sharp({ create: { width: size, height: size, channels: 4, background } })
    .composite([
      {
        input: resized,
        left: Math.round((size - meta.width) / 2),
        top: Math.round((size - meta.height) / 2),
      },
    ])
    .png();
}

async function main() {
  console.log("Generating DKASU brand assets…\n");

  mkdirSync(outDir, { recursive: true });
  mkdirSync(resolve(root, "public/icons"), { recursive: true });

  const gradient = await measureTileGradient();
  const mark = await extractMark();
  console.log(`  tile gradient: ${gradient.start} → ${gradient.end}`);
  console.log(`  mark extents:  ${mark.width}×${mark.height}\n`);

  // —— Capacitor masters (consumed by npm run cap:assets) ——
  // Custom-mode names only: icon-only/icon-foreground/icon-background/splash.
  // No logo.png or icon.png, so @capacitor/assets stays out of "Easy Mode"
  // and cannot synthesise icons from a single flat logo + background colour.
  await (
    await brandedSquare(1024, gradient, mark, LEGACY_MARK_SCALE)
  ).toFile(resolve(root, "resources/icon-only.png"));

  await (
    await adaptiveForeground(1024, mark, ADAPTIVE_MARK_SCALE)
  ).toFile(resolve(root, "resources/icon-foreground.png"));

  await sharp(Buffer.from(gradientSvg(1024, gradient)))
    .flatten({ background: CREAM })
    .png()
    .toFile(resolve(root, "resources/icon-background.png"));

  await (
    await splashMaster(LOCKUP_LIGHT, CREAM, 2732)
  ).toFile(resolve(root, "resources/splash.png"));

  await (
    await splashMaster(LOCKUP_DARK, CHARCOAL, 2732)
  ).toFile(resolve(root, "resources/splash-dark.png"));

  // Retire the WAKA-era masters so the generator can never read them again.
  for (const stale of ["logo.png", "icon.png", "w-symbol-source.png"]) {
    const p = resolve(root, "resources", stale);
    if (existsSync(p)) {
      rmSync(p);
      console.log(`  removed stale WAKA master: resources/${stale}`);
    }
  }

  // —— Brand export library ——
  await (
    await brandedSquare(1024, gradient, mark, LEGACY_MARK_SCALE)
  ).toFile(resolve(outDir, "icon-1024.png"));
  await (
    await brandedSquare(512, gradient, mark, LEGACY_MARK_SCALE)
  ).toFile(resolve(outDir, "icon-512.png"));
  await (
    await adaptiveForeground(1024, mark, LEGACY_MARK_SCALE)
  ).toFile(resolve(outDir, "icon-1024-transparent.png"));
  await (
    await adaptiveForeground(1024, mark, ADAPTIVE_MARK_SCALE)
  ).toFile(resolve(outDir, "icon-adaptive-foreground.png"));

  await sharp(Buffer.from(gradientSvg(1024, gradient)))
    .png()
    .toFile(resolve(outDir, "icon-adaptive-background.png"));

  await sharp(LOCKUP_LIGHT)
    .flatten({ background: CREAM })
    .png()
    .toFile(resolve(outDir, "logo-horizontal-on-light.png"));
  await sharp(LOCKUP_DARK)
    .flatten({ background: CHARCOAL })
    .png()
    .toFile(resolve(outDir, "logo-horizontal-on-dark.png"));

  // —— Splash exports ——
  await (
    await splashMaster(LOCKUP_LIGHT, CREAM, 1080)
  ).toFile(resolve(outDir, "splash-light.png"));
  await (
    await splashMaster(LOCKUP_DARK, CHARCOAL, 1080)
  ).toFile(resolve(outDir, "splash-dark.png"));

  // —— Monochrome: the mark, flat — for print and constrained surfaces ——
  const blackTile = await monoFromTile("#000000");
  const whiteTile = await monoFromTile(WHITE);
  await sharp(blackTile)
    .flatten({ background: WHITE })
    .png()
    .toFile(resolve(outDir, "icon-mono-black-on-white.png"));
  await sharp(whiteTile)
    .flatten({ background: CHARCOAL })
    .png()
    .toFile(resolve(outDir, "icon-mono-white-on-dark.png"));
  await sharp(blackTile).png().toFile(resolve(outDir, "icon-mono-black-transparent.png"));
  await sharp(whiteTile).png().toFile(resolve(outDir, "icon-mono-white-transparent.png"));

  // —— Small sizes ——
  // Two variants per size, matching the shape this library had before the
  // DKASU migration: brand (transparent corners) and light-surface (on cream).
  // This script owns the directory outright, so it is rebuilt from scratch —
  // a variant that is no longer generated cannot linger as a stale file.
  const sizesDir = resolve(outDir, "sizes");
  rmSync(sizesDir, { recursive: true, force: true });
  mkdirSync(sizesDir, { recursive: true });
  const smallSizes = [16, 24, 32, 48, 64, 96, 128, 192, 256];
  for (const s of smallSizes) {
    await (
      await brandedSquare(s, gradient, mark, LEGACY_MARK_SCALE)
    ).toFile(resolve(sizesDir, `d-icon-${s}.png`));
    await (
      await brandedSquare(s, gradient, mark, LEGACY_MARK_SCALE)
    )
      .flatten({ background: CREAM })
      .png()
      .toFile(resolve(sizesDir, `d-icon-${s}-cream.png`));
  }

  // Retire WAKA-era exports so no stale branding lingers in the brand library.
  for (const stale of [
    "icon-1024-cream.png",
    "icon-1024-cream.svg",
    "icon-1024-white.png",
    "icon-512-cream.png",
    "splash-light-portrait.png",
    "splash-light-white.png",
    "splash-dark-portrait.png",
    "splash-capacitor-master.png",
    "splash-light.svg",
    "w-symbol.svg",
  ]) {
    const p = resolve(outDir, stale);
    if (existsSync(p)) rmSync(p);
  }
  // `sizes/` needs no entry here — it is rebuilt from scratch above, which
  // also clears the WAKA-era `sizes/w-icon-*` exports.

  // —— Web / public copies (same filenames, DKASU artwork) ——
  await (
    await brandedSquare(1024, gradient, mark, LEGACY_MARK_SCALE)
  ).png().toFile(resolve(root, "public/waka-logo.png"));

  // PWA / favicon set. `manifest.webmanifest` and `index.html` reference these
  // by name, so every size must be rewritten — a stale one is shipped branding.
  const webIcons = resolve(root, "public/icons");
  for (const size of [48, 72, 96, 128, 256]) {
    await (await brandedSquare(size, gradient, mark, LEGACY_MARK_SCALE))
      .webp({ quality: 92 })
      .toFile(resolve(webIcons, `icon-${size}.webp`));
  }
  for (const size of [192, 512]) {
    await (await brandedSquare(size, gradient, mark, LEGACY_MARK_SCALE))
      .webp({ quality: 92 })
      .toFile(resolve(webIcons, `icon-${size}.webp`));
    await (
      await brandedSquare(size, gradient, mark, LEGACY_MARK_SCALE)
    ).png().toFile(resolve(webIcons, `icon-${size}.png`));
  }
  await (
    await brandedSquare(512, gradient, mark, LEGACY_MARK_SCALE)
  ).png().toFile(resolve(webIcons, "icon-512-playstore.png"));

  // Maskable icons are cropped to a circle by the launcher, so the mark is
  // pulled in to 50% to stay inside the safe zone.
  await (
    await brandedSquare(512, gradient, mark, 0.5)
  ).png().toFile(resolve(webIcons, "icon-maskable-512.png"));

  // iOS home-screen icon must be opaque — no alpha channel.
  await (
    await brandedSquare(180, gradient, mark, LEGACY_MARK_SCALE)
  ).flatten({ background: CREAM }).png().toFile(resolve(webIcons, "apple-touch-icon.png"));

  await (
    await brandedSquare(32, gradient, mark, LEGACY_MARK_SCALE)
  ).png().toFile(resolve(root, "public/favicon-32.png"));

  const tileB64 = (await sharp(TILE).resize(64, 64).png().toBuffer()).toString("base64");
  writeFileSync(
    resolve(root, "public/favicon.svg"),
    `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 64 64" role="img" aria-label="DKASU">
  <image width="64" height="64" preserveAspectRatio="xMidYMid meet" xlink:href="data:image/png;base64,${tileB64}"/>
</svg>
`,
  );

  writeFileSync(
    resolve(outDir, "README.md"),
    `# DKASU POS brand assets

Generated from the supplied DKASU artwork in \`public/brand/dkasu/\` — the logo is
sampled and composited, never redrawn. Regenerate with:

\`\`\`bash
npm run brand:assets
npm run cap:assets
\`\`\`

## App icon
| File | Use |
|------|-----|
| \`icon-1024.png\` | Master app icon (full-bleed tile gradient + white mark) |
| \`icon-512.png\` | Play Store icon |
| \`icon-1024-transparent.png\` | Mark only, transparent |
| \`icon-adaptive-foreground.png\` | Android adaptive foreground (mark in 66dp safe zone) |
| \`icon-adaptive-background.png\` | Android adaptive background (full-bleed gradient) |

## Splash
| File | Use |
|------|-----|
| \`splash-light.png\` | Light splash |
| \`splash-dark.png\` | Dark splash |
| \`logo-horizontal-on-light.png\` | Flattened light lockup |
| \`logo-horizontal-on-dark.png\` | Flattened dark lockup |

## Monochrome
| File | Use |
|------|-----|
| \`icon-mono-black-on-white.png\` | Print / light UI |
| \`icon-mono-white-on-dark.png\` | Dark UI |
| \`icon-mono-black-transparent.png\` | Black tile, transparent |
| \`icon-mono-white-transparent.png\` | White tile, transparent |

## Small sizes
\`sizes/d-icon-*.png\` — 16–256px, brand and light-surface (on cream).

Tile gradient (measured from the artwork): \`${gradient.start}\` → \`${gradient.end}\` · Cream: \`${CREAM}\`
`,
  );

  console.log("✓ resources/icon-only.png, icon-foreground.png, icon-background.png");
  console.log("✓ resources/splash.png, splash-dark.png");
  console.log("✓ resources/brand/ — all exports");
  console.log("✓ public/waka-logo.png, favicon.svg, PWA icons updated");
  console.log("\nNext: npm run cap:assets\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
