#!/usr/bin/env node
/**
 * Resize raw phone screenshots to Google Play requirements:
 * 9:16 aspect ratio, PNG, 1080×1920 (sides within 320–3840).
 *
 * Usage: node scripts/resize-play-screenshots.mjs [inputDir] [outputDir]
 */
import sharp from "sharp";
import { readdirSync, mkdirSync, existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const defaultIn = resolve(root, "resources/play-screenshots-source");
const defaultOut = resolve(root, "resources/brand/play-screenshots");

const TARGET_W = 1080;
const TARGET_H = 1920;
const BG = { r: 255, g: 250, b: 245, alpha: 1 }; // #fffaf5

const LABELS = [
  "01-sell-shelves",
  "02-sell-products",
  "03-sell-checkout",
  "04-receipt",
  "05-back-office",
  "06-profit",
  "07-stock",
  "08-sales-history",
];

async function resizeOne(inputPath, outputPath) {
  const img = sharp(inputPath);
  const meta = await img.metadata();
  const w = meta.width ?? TARGET_W;
  const h = meta.height ?? TARGET_H;

  const scale = Math.min(TARGET_W / w, TARGET_H / h);
  const newW = Math.round(w * scale);
  const newH = Math.round(h * scale);
  const left = Math.round((TARGET_W - newW) / 2);
  const top = Math.round((TARGET_H - newH) / 2);

  const resized = await img.resize(newW, newH, { fit: "inside" }).png().toBuffer();

  await sharp({
    create: { width: TARGET_W, height: TARGET_H, channels: 4, background: BG },
  })
    .composite([{ input: resized, left, top }])
    .png({ compressionLevel: 9 })
    .toFile(outputPath);

  const outMeta = await sharp(outputPath).metadata();
  const stat = await import("node:fs").then((fs) => fs.promises.stat(outputPath));
  return { w: outMeta.width, h: outMeta.height, bytes: stat.size };
}

async function main() {
  const inputDir = process.argv[2] ? resolve(process.argv[2]) : defaultIn;
  const outputDir = process.argv[3] ? resolve(process.argv[3]) : defaultOut;

  if (!existsSync(inputDir)) {
    console.error("Input folder missing:", inputDir);
    console.error("Copy your raw PNGs into resources/play-screenshots-source/ then re-run.");
    process.exit(1);
  }

  mkdirSync(outputDir, { recursive: true });

  const files = readdirSync(inputDir)
    .filter((f) => /\.(png|jpe?g|webp)$/i.test(f))
    .sort();

  if (files.length === 0) {
    console.error("No images in", inputDir);
    process.exit(1);
  }

  console.log(`Resizing ${files.length} image(s) → ${TARGET_W}×${TARGET_H} (9:16)\n`);

  for (let i = 0; i < files.length; i++) {
    const inPath = join(inputDir, files[i]);
    const label = LABELS[i] ?? `screenshot-${String(i + 1).padStart(2, "0")}`;
    const outPath = join(outputDir, `${label}.png`);
    const info = await resizeOne(inPath, outPath);
    const mb = (info.bytes / 1024 / 1024).toFixed(2);
    console.log(`✓ ${label}.png  ${info.w}×${info.h}  ${mb} MB  ← ${files[i]}`);
  }

  console.log(`\nDone. Upload files from:\n${outputDir}\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
