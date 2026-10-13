#!/usr/bin/env node
/**
 * Publish the generated Ask WAKA knowledge artifact to PRIVATE Supabase Storage.
 *
 * Explicit, separate step (never runs during application runtime or during
 * `generate-waka-knowledge.mjs`): the repository JSON stays the source of
 * truth, and this script uploads those exact bytes to:
 *
 *     bucket: waka-knowledge   (PRIVATE — created here if missing, refused if public)
 *     object: wakaKnowledgeArtifact.json
 *
 * The ai-ask-waka Edge Function downloads the object at runtime with its
 * service-role key (see _shared/wakaKnowledgeArtifactLoad.ts).
 *
 * Usage:
 *   SUPABASE_SERVICE_ROLE_KEY=<key from Supabase dashboard> \
 *     node scripts/push-waka-knowledge.mjs
 *
 * SUPABASE_URL defaults to the linked production project
 * (https://ljaedextsenbkxzzgxcg.supabase.co from supabase/config.toml).
 * The service-role key is read from the environment only, never printed,
 * never stored in code, and never exposed via VITE_* variables.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ARTIFACT_PATH = join(ROOT, "supabase", "functions", "_shared", "wakaKnowledgeArtifact.json");
const BUCKET = "waka-knowledge";
const OBJECT = "wakaKnowledgeArtifact.json";
const DEFAULT_URL = "https://ljaedextsenbkxzzgxcg.supabase.co";

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

const url = (process.env.SUPABASE_URL || DEFAULT_URL).replace(/\/$/, "");
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!key) {
  fail(
    "SUPABASE_SERVICE_ROLE_KEY is not set.\n" +
      "  Set it in this shell from your secret store / Supabase dashboard\n" +
      "  (Settings → API → service_role). It is never read from the repo or printed.",
  );
}

if (!existsSync(ARTIFACT_PATH)) {
  fail(`artifact not found: ${ARTIFACT_PATH}\n  Run: npm run knowledge:waka`);
}

const bytes = readFileSync(ARTIFACT_PATH);
const sha256 = createHash("sha256").update(bytes).digest("hex");
const report = {
  url,
  bucket: BUCKET,
  object: OBJECT,
  bytes: bytes.length,
  sha256,
};

const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

// 1) Bucket must exist and must be PRIVATE (create it private if missing).
const { data: bucket, error: bucketErr } = await sb.storage.getBucket(BUCKET);
if (bucketErr) {
  // Missing bucket → create as private. Anything else → stop.
  const missing = /not found|404/i.test(bucketErr.message ?? "");
  if (!missing) fail(`could not read bucket '${BUCKET}': ${bucketErr.message}`);
  const { error: createErr } = await sb.storage.createBucket(BUCKET, { public: false });
  if (createErr) fail(`could not create private bucket '${BUCKET}': ${createErr.message}`);
  report.bucketCreated = true;
} else if (bucket.public === true) {
  fail(`bucket '${BUCKET}' exists but is PUBLIC — refusing to publish the knowledge artifact.`);
} else {
  report.bucketCreated = false;
}

// 2) Upload the EXACT repository bytes (upsert → stable object path).
const { error: uploadErr } = await sb.storage.from(BUCKET).upload(OBJECT, bytes, {
  contentType: "application/json",
  upsert: true,
});
if (uploadErr) fail(`upload failed: ${uploadErr.message}`);

// 3) Verify round-trip size so a truncated upload cannot pass silently.
const { data: back, error: verifyErr } = await sb.storage.from(BUCKET).download(OBJECT);
if (verifyErr || !back) fail(`verification download failed: ${verifyErr?.message ?? "no data"}`);
if (back.size !== bytes.length) {
  fail(`verification mismatch: uploaded ${bytes.length} bytes, storage has ${back.size} bytes`);
}
report.verified = true;
report.private = true;

console.log(JSON.stringify(report, null, 2));
