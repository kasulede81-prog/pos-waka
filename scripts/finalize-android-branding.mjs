#!/usr/bin/env node
/**
 * Normalise the Android native branding after `capacitor-assets generate`.
 *
 * @capacitor/assets gets the DKASU artwork into the right files but applies two
 * transforms we do not want, so this runs as the last step of `npm run cap:assets`:
 *
 *   1. Its adaptive-icon template wraps BOTH layers in `<inset ... 16.7% />`.
 *      The background must be full-bleed, so the generated XML is replaced with
 *      the canonical form. The foreground needs no inset either — the mark is
 *      already drawn inside the 66dp safe zone of the 108dp layer.
 *   2. Its legacy launcher icon pipeline shrinks the art by 8px per size, which
 *      is 22% of a 36px ldpi icon. Legacy icons are re-rendered full-bleed.
 *   3. For explicit `icon-foreground` / `icon-background` inputs it sizes the
 *      layers from the 48dp legacy table (36–192px) rather than the 108dp
 *      adaptive table (81–432px), so the layers ship undersized and Android
 *      upscales them. Both layers are re-rendered at true adaptive sizes.
 *
 * It also emits `mipmap-<density>/splash_icon.png` for the Android 12+ splash,
 * built from the supplied DKASU tile.
 *
 * Finally it asserts the WAKA pipeline cannot come back — see assertDkasuOnly().
 *
 * Idempotent: same inputs always produce the same bytes.
 */
import sharp from "sharp";
import { writeFileSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const resDir = resolve(root, "android/app/src/main/res");
const iconOnly = resolve(root, "resources/icon-only.png");
const iconForeground = resolve(root, "resources/icon-foreground.png");
const iconBackground = resolve(root, "resources/icon-background.png");
const dkasuTile = resolve(root, "public/brand/dkasu/icon-tile-transparent.png");

/** Launcher icon templates: 48dp legacy scale. */
const LEGACY_SIZES = [
  ["ldpi", 36],
  ["mdpi", 48],
  ["hdpi", 72],
  ["xhdpi", 96],
  ["xxhdpi", 144],
  ["xxxhdpi", 192],
];

/** Adaptive layers and the Android 12+ splash icon: 108dp scale. */
const ADAPTIVE_SIZES = [
  ["ldpi", 81],
  ["mdpi", 108],
  ["hdpi", 162],
  ["xhdpi", 216],
  ["xxhdpi", 324],
  ["xxxhdpi", 432],
];

const ADAPTIVE_XML = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@mipmap/ic_launcher_background" />
    <foreground android:drawable="@mipmap/ic_launcher_foreground" />
</adaptive-icon>
`;

/** Angular mask that keeps a centred circle — used for the round launcher icon. */
const circleMask = (size) =>
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">` +
      `<circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="#fff"/></svg>`,
  );

for (const [label, path] of [
  ["resources/icon-only.png", iconOnly],
  ["resources/icon-foreground.png", iconForeground],
  ["resources/icon-background.png", iconBackground],
  ["public/brand/dkasu/icon-tile-transparent.png", dkasuTile],
]) {
  if (!existsSync(path)) {
    console.error(`Missing ${label} — run npm run brand:assets first.`);
    process.exit(1);
  }
}
if (!existsSync(resDir)) {
  console.error("No android/app/src/main/res — run npx cap sync android first.");
  process.exit(1);
}

/**
 * Regression guard. A WAKA build is only possible if WAKA source artwork is
 * present, so assert it is gone, that no generator still loads it, and that the
 * launcher icon actually carries DKASU orange rather than WAKA cream.
 *
 * The generator scan matches the input-path idiom specifically — a script that
 * resolves the old artwork as a source. Cleanup lists and comments that merely
 * name the file are fine, and this pattern cannot match its own source text.
 */
const WAKA_INPUT_PATH = /resolve\([^)]*["'`]resources\/w-symbol-source\.png["'`]/;

async function assertDkasuOnly() {
  const problems = [];

  for (const stale of ["logo.png", "icon.png", "w-symbol-source.png"]) {
    if (existsSync(resolve(root, "resources", stale))) {
      problems.push(`resources/${stale} exists — this was the WAKA source artwork`);
    }
  }

  const scriptsDir = resolve(root, "scripts");
  for (const file of readdirSync(scriptsDir)) {
    if (!/\.(mjs|js|ts)$/.test(file)) continue;
    const src = readFileSync(join(scriptsDir, file), "utf8");
    if (WAKA_INPUT_PATH.test(src)) {
      problems.push(`scripts/${file} still loads the retired WAKA artwork as an input`);
    }
  }

  const iconPath = resolve(resDir, "mipmap-xxxhdpi/ic_launcher.png");
  if (existsSync(iconPath)) {
    const { channels } = await sharp(iconPath).stats();
    const [r, g, b] = channels.map((c) => c.mean);
    const isOrange = r > 200 && g > 30 && g < 200 && b < 140;
    if (!isOrange) {
      problems.push(
        `mipmap-xxxhdpi/ic_launcher.png is not DKASU orange (mean rgb ${r.toFixed(0)},${g.toFixed(
          0,
        )},${b.toFixed(0)}) — did the artwork regress?`,
      );
    }
  }

  if (problems.length) {
    console.error("DKASU branding guard failed:");
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
}

async function main() {
  console.log("Finalising Android branding…\n");

  // —— 1. Adaptive icon descriptors: full-bleed background, safe-zone foreground ——
  for (const name of ["ic_launcher.xml", "ic_launcher_round.xml"]) {
    writeFileSync(resolve(resDir, "mipmap-anydpi-v26", name), ADAPTIVE_XML);
  }
  console.log("  ✓ mipmap-anydpi-v26/{ic_launcher,ic_launcher_round}.xml — insets removed");

  // —— 2. Legacy launcher icons, full-bleed at the exact template size ——
  for (const [density, size] of LEGACY_SIZES) {
    const dir = resolve(resDir, `mipmap-${density}`);
    const square = await sharp(iconOnly).resize(size, size, { fit: "cover" }).png().toBuffer();
    writeFileSync(join(dir, "ic_launcher.png"), square);
    writeFileSync(
      join(dir, "ic_launcher_round.png"),
      await sharp(square)
        .composite([{ input: circleMask(size), blend: "dest-in" }])
        .png()
        .toBuffer(),
    );
  }
  console.log("  ✓ mipmap-*{,dpi}/ic_launcher.png, ic_launcher_round.png — full-bleed");

  // —— 3. Adaptive layers at true 108dp sizes ——
  for (const [density, size] of ADAPTIVE_SIZES) {
    const dir = resolve(resDir, `mipmap-${density}`);
    writeFileSync(
      join(dir, "ic_launcher_foreground.png"),
      await sharp(iconForeground).resize(size, size, { fit: "contain" }).png().toBuffer(),
    );
    writeFileSync(
      join(dir, "ic_launcher_background.png"),
      await sharp(iconBackground).resize(size, size, { fit: "cover" }).png().toBuffer(),
    );
  }
  console.log("  ✓ mipmap-*/ic_launcher_{foreground,background}.png — 108dp layers");

  // —— 4. Android 12+ splash icon, from the supplied DKASU tile ——
  for (const [density, size] of ADAPTIVE_SIZES) {
    writeFileSync(
      resolve(resDir, `mipmap-${density}`, "splash_icon.png"),
      await sharp(dkasuTile).resize(size, size, { fit: "contain" }).png().toBuffer(),
    );
  }
  console.log("  ✓ mipmap-*/splash_icon.png — Android 12+ splash icon");

  await assertDkasuOnly();
  console.log("  ✓ DKASU guard passed — no WAKA sources or generators remain\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
