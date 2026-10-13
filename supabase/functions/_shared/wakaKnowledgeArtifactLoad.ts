/**
 * Ask WAKA knowledge-artifact loader (runtime fetch from PRIVATE Storage).
 *
 * Deployment-size fix (audited): this module used to statically import
 * `./wakaKnowledgeArtifact.json` (4,693,468 bytes), which esbuild inlined into
 * the ai-ask-waka bundle and pushed it over Supabase's 5 MB deployment limit.
 * The artifact now lives in the private `waka-knowledge` Storage bucket
 * (object `wakaKnowledgeArtifact.json`, exact bytes as generated into the
 * repository) and is downloaded at runtime instead.
 *
 * Contracts:
 *   - PRIVATE bucket, service-role fetch only (SUPABASE_URL +
 *     SUPABASE_SERVICE_ROLE_KEY from the Edge runtime — never VITE_*, never
 *     hardcoded, never a public URL);
 *   - module-scope promise cache: each isolate downloads AT MOST once;
 *   - ONE retry for transient failures;
 *   - a failed attempt never poisons the cache (the promise entry is dropped,
 *     so the next request re-attempts a fresh download);
 *   - malformed/missing artifact rejects so callers can degrade to
 *     "knowledge unavailable" without crashing the Ask WAKA request;
 *   - retrieval semantics live in askWakaKnowledge.ts and are untouched —
 *     the artifact still arrives there as a plain parsed object.
 *
 * The repository JSON (`supabase/functions/_shared/wakaKnowledgeArtifact.json`)
 * remains the source of truth: `scripts/generate-waka-knowledge.mjs` writes it
 * and `scripts/push-waka-knowledge.mjs` uploads those exact bytes. Nothing in
 * `supabase/functions/**` statically imports it (enforced by test).
 */

import type { WakaKnowledgeArtifact } from "./askWakaKnowledge.ts";

export const WAKA_KNOWLEDGE_BUCKET = "waka-knowledge";
export const WAKA_KNOWLEDGE_OBJECT = "wakaKnowledgeArtifact.json";

/** Fetches the raw object text. Production: Storage REST API; tests: fakes. */
export type KnowledgeArtifactDownload = (bucket: string, object: string) => Promise<string>;

/** One retry → two attempts total for transient failures. */
const MAX_ATTEMPTS = 2;

/** Module-scope cache: one download per isolate (shared promise deduplicates concurrent callers). */
let artifactPromise: Promise<WakaKnowledgeArtifact> | null = null;

/**
 * Edge-runtime env access. Guarded with `typeof Deno` so this module can be
 * imported by the node/vitest suites, where the loader is always injected.
 */
function runtimeEnv(name: string): string | undefined {
  if (typeof Deno === "undefined") return undefined;
  const value = (Deno as unknown as { env: { get(k: string): string | undefined } }).env.get(name);
  return value === "" ? undefined : value;
}

/** Production downloader: private-bucket read via the service role. */
function storageDownload(): KnowledgeArtifactDownload {
  return async (bucket, object) => {
    const base = runtimeEnv("SUPABASE_URL");
    const key = runtimeEnv("SUPABASE_SERVICE_ROLE_KEY");
    if (!base || !key) {
      throw new Error("waka_knowledge_storage_unconfigured");
    }
    const res = await fetch(
      `${base.replace(/\/$/, "")}/storage/v1/object/${bucket}/${encodeURIComponent(object)}`,
      {
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
        },
      },
    );
    if (!res.ok) {
      throw new Error(`waka_knowledge_download_failed:${res.status}`);
    }
    return await res.text();
  };
}

function parseArtifact(text: string): WakaKnowledgeArtifact {
  const parsed: unknown = JSON.parse(text);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("waka_knowledge_malformed_artifact");
  }
  return parsed as WakaKnowledgeArtifact;
}

async function loadOnce(download: KnowledgeArtifactDownload): Promise<WakaKnowledgeArtifact> {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const text = await download(WAKA_KNOWLEDGE_BUCKET, WAKA_KNOWLEDGE_OBJECT);
      return parseArtifact(text);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("waka_knowledge_unavailable");
}

/**
 * Returns the knowledge artifact, downloading it at most once per isolate.
 *
 * Rejects (after one retry) when the object is missing/malformed/unreachable —
 * callers must catch and degrade to "knowledge unavailable" rather than fail
 * the request. A rejected load clears the cache entry, so a later request
 * starts a fresh attempt.
 */
export function getWakaKnowledgeArtifact(
  deps?: { download?: KnowledgeArtifactDownload },
): Promise<WakaKnowledgeArtifact> {
  if (artifactPromise) return artifactPromise;

  const download = deps?.download ?? storageDownload();
  const started: Promise<WakaKnowledgeArtifact> = loadOnce(download).catch((err: unknown) => {
    // Never poison the module cache: drop the failed promise so the next
    // caller re-attempts with a fresh download.
    if (artifactPromise === started) artifactPromise = null;
    throw err;
  });
  artifactPromise = started;
  return started;
}

/** Test-only: reset the module-scope cache so each test behaves like a fresh isolate. */
export function resetWakaKnowledgeArtifactCache(): void {
  artifactPromise = null;
}
