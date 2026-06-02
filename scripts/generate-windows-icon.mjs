#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import pngToIco from "png-to-ico";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const buildDir = resolve(root, "build");
const sourcePng = resolve(root, "resources", "brand", "icon-1024-cream.png");
const pngPath = resolve(buildDir, "icon.png");
const icoPath = resolve(buildDir, "icon.ico");

mkdirSync(buildDir, { recursive: true });

await sharp(sourcePng).resize(512, 512).png().toFile(pngPath);

const iconIco = await pngToIco([
  await sharp(sourcePng).resize(256, 256).png().toBuffer(),
  await sharp(sourcePng).resize(128, 128).png().toBuffer(),
  await sharp(sourcePng).resize(64, 64).png().toBuffer(),
  await sharp(sourcePng).resize(48, 48).png().toBuffer(),
  await sharp(sourcePng).resize(32, 32).png().toBuffer(),
  await sharp(sourcePng).resize(16, 16).png().toBuffer(),
]);

writeFileSync(icoPath, iconIco);

console.log(`Generated Windows icons:\n- ${pngPath}\n- ${icoPath}`);
