/**
 * Trim marketing mockups and device captures into Play Store phone screenshots (9:16).
 * Usage: node scripts/trim-play-store-screenshots.mjs
 */
import sharp from "sharp";
import { mkdir, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const assetsDir =
  "C:/Users/Utente/.cursor/projects/c-Projects-pos-waka/assets";
const outDir = join(root, "resources/play-store/screenshots");

const TARGET_W = 1080;
const TARGET_H = 1920;

/** Fractional crop boxes: left, top, right, bottom (0–1). */
const JOBS = [
  {
    file: "c__Users_Utente_AppData_Roaming_Cursor_User_workspaceStorage_af12a1dfa775c7e23f08ead322a13b83_images_image-a917c575-a66e-4d06-853e-b4751c17caa1.png",
    out: "01-home-dashboard.png",
    crop: { l: 0.46, t: 0.1, r: 0.97, b: 0.92 },
  },
  {
    file: "c__Users_Utente_AppData_Roaming_Cursor_User_workspaceStorage_af12a1dfa775c7e23f08ead322a13b83_images_image-31a65604-0470-46b3-a7dc-aca1558990aa.png",
    out: "02-fast-checkout.png",
    crop: { l: 0.46, t: 0.1, r: 0.97, b: 0.92 },
  },
  {
    file: "c__Users_Utente_AppData_Roaming_Cursor_User_workspaceStorage_af12a1dfa775c7e23f08ead322a13b83_images_image-beab5740-ec96-431f-88e9-885dd4b9a430.png",
    out: "03-payment-methods.png",
    crop: { l: 0.46, t: 0.1, r: 0.97, b: 0.92 },
  },
  {
    file: "c__Users_Utente_AppData_Roaming_Cursor_User_workspaceStorage_af12a1dfa775c7e23f08ead322a13b83_images_image-1620d6c5-5e62-49fc-a36b-fd3264b4d0da.png",
    out: "04-debt-management.png",
    crop: { l: 0.38, t: 0.06, r: 0.98, b: 0.9 },
  },
  {
    file: "c__Users_Utente_AppData_Roaming_Cursor_User_workspaceStorage_af12a1dfa775c7e23f08ead322a13b83_images_image-04a28d7f-7c87-4b82-ba1a-bfe6595daa15.png",
    out: "05-digital-receipts.png",
    crop: { l: 0.38, t: 0.06, r: 0.98, b: 0.9 },
  },
  {
    file: "c__Users_Utente_AppData_Roaming_Cursor_User_workspaceStorage_af12a1dfa775c7e23f08ead322a13b83_images_image-2da8ca5b-1625-428a-aa97-68e55e38ffba.png",
    out: "06-business-reports.png",
    crop: { l: 0.38, t: 0.06, r: 0.98, b: 0.9 },
  },
  {
    file: "c__Users_Utente_AppData_Roaming_Cursor_User_workspaceStorage_af12a1dfa775c7e23f08ead322a13b83_images_image-940583b1-410c-46f8-997d-fa7fdd805f5d.png",
    out: "07-pos-sell-screen.png",
    crop: { l: 0, t: 0.19, r: 1, b: 0.89 },
  },
  {
    file: "c__Users_Utente_AppData_Roaming_Cursor_User_workspaceStorage_af12a1dfa775c7e23f08ead322a13b83_images_image-2edfc21e-c2d1-4b45-8839-51df191d9f57.png",
    out: "08-back-office-hub.png",
    crop: { l: 0, t: 0.19, r: 1, b: 0.89 },
  },
];

function boxFromFractions(w, h, crop) {
  const left = Math.round(w * crop.l);
  const top = Math.round(h * crop.t);
  const right = Math.round(w * crop.r);
  const bottom = Math.round(h * crop.b);
  return {
    left,
    top,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top),
  };
}

async function cropTo916(buffer, w, h) {
  const ratio = 9 / 16;
  const current = w / h;
  let extract;
  if (current > ratio) {
    const newW = Math.round(h * ratio);
    const left = Math.round((w - newW) / 2);
    extract = { left, top: 0, width: newW, height: h };
  } else {
    const newH = Math.round(w / ratio);
    const top = Math.round((h - newH) / 2);
    extract = { left: 0, top, width: w, height: newH };
  }
  return sharp(buffer).extract(extract).resize(TARGET_W, TARGET_H, { fit: "fill" }).png().toBuffer();
}

async function processJob(job) {
  const input = join(assetsDir, job.file);
  const meta = await sharp(input).metadata();
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  const box = boxFromFractions(w, h, job.crop);
  const cropped = await sharp(input).extract(box).toBuffer();
  const meta2 = await sharp(cropped).metadata();
  const finalBuf = await cropTo916(cropped, meta2.width ?? 0, meta2.height ?? 0);
  const outPath = join(outDir, job.out);
  await sharp(finalBuf).toFile(outPath);
  const { size } = await stat(outPath);
  return { out: job.out, bytes: size, box, source: `${w}x${h}` };
}

await mkdir(outDir, { recursive: true });
const results = [];
for (const job of JOBS) {
  results.push(await processJob(job));
}
console.log("Play Store screenshots written to:", outDir);
for (const r of results) {
  console.log(
    `${r.out}: ${TARGET_W}x${TARGET_H}, ${(r.bytes / 1024).toFixed(0)} KB (from ${r.source})`,
  );
}
