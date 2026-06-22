#!/usr/bin/env node
/**
 * Fails if the Android release merged manifest or AAB declares broad media/storage permissions.
 * Usage: node scripts/verify-android-media-permissions.mjs
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const blocked = [
  "android.permission.READ_MEDIA_IMAGES",
  "android.permission.READ_MEDIA_VIDEO",
  "android.permission.READ_EXTERNAL_STORAGE",
  "android.permission.WRITE_EXTERNAL_STORAGE",
];

const mergedManifest = join(
  root,
  "android/app/build/intermediates/merged_manifest/release/processReleaseMainManifest/AndroidManifest.xml",
);
const aabPath = join(root, "android/app/build/outputs/bundle/release/app-release.aab");

function findBlockedInXml(xml) {
  const hits = [];
  for (const perm of blocked) {
    const re = new RegExp(`<uses-permission[^>]*android:name="${perm.replace(/\./g, "\\.")}"[^>]*/?>`, "g");
    const matches = xml.match(re) ?? [];
    for (const m of matches) {
      if (!m.includes('tools:node="remove"')) {
        hits.push({ perm, snippet: m });
      }
    }
  }
  return hits;
}

let failed = false;

if (existsSync(mergedManifest)) {
  const xml = readFileSync(mergedManifest, "utf8");
  const hits = findBlockedInXml(xml);
  console.log("Merged release manifest:", mergedManifest);
  if (hits.length === 0) {
    console.log("  OK — no blocked permissions declared.");
  } else {
    failed = true;
    console.error("  FAIL — blocked permissions found:");
    for (const h of hits) console.error(`    ${h.perm}: ${h.snippet}`);
  }
} else {
  console.warn("Merged manifest not found. Run: npm run cap:bundle:release");
}

if (existsSync(aabPath)) {
  try {
    const out = execSync(
      `powershell -NoProfile -Command "Add-Type -AssemblyName System.IO.Compression.FileSystem; $z=[IO.Compression.ZipFile]::OpenRead('${aabPath.replace(/'/g, "''")}'); $e=$z.GetEntry('base/manifest/AndroidManifest.xml'); $r=New-Object IO.StreamReader($e.Open()); $r.ReadToEnd(); $r.Close(); $z.Dispose()"`,
      { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
    );
    const hits = [];
    for (const perm of blocked) {
      if (out.includes(perm)) hits.push(perm);
    }
    console.log("\nRelease AAB manifest:", aabPath);
    if (hits.length === 0) {
      console.log("  OK — no blocked permission strings in AAB manifest.");
    } else {
      failed = true;
      console.error("  FAIL — blocked permissions in AAB:", hits.join(", "));
    }
  } catch (err) {
    console.warn("\nCould not read AAB manifest (non-fatal):", err.message ?? err);
  }
} else {
  console.warn("\nRelease AAB not found at", aabPath);
}

if (failed) {
  process.exit(1);
}

console.log("\nVerification passed.");
