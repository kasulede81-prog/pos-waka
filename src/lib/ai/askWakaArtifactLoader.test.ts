import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  getWakaKnowledgeArtifact,
  resetWakaKnowledgeArtifactCache,
  WAKA_KNOWLEDGE_BUCKET,
  WAKA_KNOWLEDGE_OBJECT,
  type KnowledgeArtifactDownload,
} from "../../../supabase/functions/_shared/wakaKnowledgeArtifactLoad.ts";
import { retrieveWakaKnowledge } from "../../../supabase/functions/_shared/askWakaKnowledge.ts";
import type { AskWakaSourceLane } from "../../../supabase/functions/_shared/askWakaSourceRouter.ts";

/**
 * M3-G deployment-size fix: the knowledge artifact loads from the PRIVATE
 * `waka-knowledge` Storage bucket at runtime instead of being statically
 * imported (which pushed ai-ask-waka over the 5 MB Edge deploy limit).
 *
 * Covers: correct bucket/object, module-scope caching, concurrent dedup,
 * one retry, no cache poisoning after failure, malformed JSON, the graceful
 * "knowledge unavailable" contract used by ai-ask-waka/index.ts, byte-for-byte
 * parity with the repository JSON through retrieveWakaKnowledge, and a static
 * guard so nothing under supabase/functions/** ever statically imports the
 * artifact again.
 */

const REAL_ARTIFACT_PATH = resolve(
  process.cwd(),
  "supabase/functions/_shared/wakaKnowledgeArtifact.json",
);
const FUNCTIONS_ROOT = resolve(process.cwd(), "supabase/functions");

beforeEach(() => {
  resetWakaKnowledgeArtifactCache();
});

function countingDownload(impl: (attempt: number) => Promise<string>): {
  download: KnowledgeArtifactDownload;
  calls: Array<{ bucket: string; object: string }>;
} {
  const calls: Array<{ bucket: string; object: string }> = [];
  const download: KnowledgeArtifactDownload = async (bucket, object) => {
    calls.push({ bucket, object });
    return await impl(calls.length);
  };
  return { download, calls };
}

describe("wakaKnowledgeArtifact loader (private Storage)", () => {
  it("1. downloads from the private bucket and stable object path", async () => {
    const { download, calls } = countingDownload(async () => JSON.stringify({ ok: true }));
    const artifact = await getWakaKnowledgeArtifact({ download });
    expect(artifact).toEqual({ ok: true });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({ bucket: WAKA_KNOWLEDGE_BUCKET, object: WAKA_KNOWLEDGE_OBJECT });
    expect(WAKA_KNOWLEDGE_BUCKET).toBe("waka-knowledge");
    expect(WAKA_KNOWLEDGE_OBJECT).toBe("wakaKnowledgeArtifact.json");
  });

  it("2. caches the parsed artifact after the first successful fetch", async () => {
    const { download, calls } = countingDownload(async () => JSON.stringify({ gen: 1 }));
    const first = await getWakaKnowledgeArtifact({ download });
    const second = await getWakaKnowledgeArtifact({ download });
    expect(second).toBe(first); // same cached object — parsed once
    expect(calls).toHaveLength(1);
  });

  it("3. concurrent callers in one isolate share a single download", async () => {
    const { download, calls } = countingDownload(async () => JSON.stringify({ gen: 2 }));
    const results = await Promise.all([
      getWakaKnowledgeArtifact({ download }),
      getWakaKnowledgeArtifact({ download }),
      getWakaKnowledgeArtifact({ download }),
    ]);
    expect(calls).toHaveLength(1);
    expect(results[0]).toBe(results[1]);
    expect(results[1]).toBe(results[2]);
  });

  it("4. a transient failure is retried exactly once and then succeeds", async () => {
    const { download, calls } = countingDownload(async (attempt) => {
      if (attempt === 1) throw new Error("transient_network");
      return JSON.stringify({ ok: true });
    });
    const artifact = await getWakaKnowledgeArtifact({ download });
    expect(artifact).toEqual({ ok: true });
    expect(calls).toHaveLength(2); // initial attempt + one retry
  });

  it("5. permanent failure rejects after one retry and does NOT poison the cache", async () => {
    let failing = true;
    const attempts: string[] = [];
    const download: KnowledgeArtifactDownload = async (bucket, object) => {
      attempts.push(`${bucket}/${object}`);
      if (failing) throw new Error("storage_unreachable");
      return JSON.stringify({ recovered: true });
    };

    await expect(getWakaKnowledgeArtifact({ download })).rejects.toThrow("storage_unreachable");
    expect(attempts).toHaveLength(2); // one retry, then give up

    // Failed promise must NOT stay latched: the next request starts a fresh load.
    failing = false;
    const recovered = await getWakaKnowledgeArtifact({ download });
    expect(recovered).toEqual({ recovered: true });
    expect(attempts).toHaveLength(3);
  });

  it("6. malformed JSON is rejected safely (no crash, cache recovers afterwards)", async () => {
    let mode: "bad-json" | "array" | "good" = "bad-json";
    const download: KnowledgeArtifactDownload = async () => {
      if (mode === "bad-json") return "{ definitely not json";
      if (mode === "array") return "[1,2,3]";
      return JSON.stringify({ good: true });
    };

    await expect(getWakaKnowledgeArtifact({ download })).rejects.toThrow();
    mode = "array";
    await expect(getWakaKnowledgeArtifact({ download })).rejects.toThrow(
      "waka_knowledge_malformed_artifact",
    );
    mode = "good";
    await expect(getWakaKnowledgeArtifact({ download })).resolves.toEqual({ good: true });
  });

  it("7. graceful 'knowledge unavailable' contract: catch → null (index.ts behaviour)", async () => {
    const download: KnowledgeArtifactDownload = async () => {
      throw new Error("waka_knowledge_download_failed:500");
    };
    // Exactly what ai-ask-waka/index.ts does at the retrieval call site.
    const artifact = await getWakaKnowledgeArtifact({ download }).catch(() => null);
    expect(artifact).toBeNull();
    // Retrieval is simply skipped — the request itself is never crashed by this.
    const knowledge = artifact ? retrieveWakaKnowledge("anything", ["PROJECT"], artifact) : null;
    expect(knowledge).toBeNull();
  });
});

describe("Storage-loaded artifact parity with the repository JSON", () => {
  it("8. loader-fetched artifact produces identical retrieveWakaKnowledge results", async () => {
    const diskText = readFileSync(REAL_ARTIFACT_PATH, "utf8");
    const diskArtifact = JSON.parse(diskText);
    const fromLoader = await getWakaKnowledgeArtifact({
      download: async () => diskText, // same bytes the bucket holds
    });

    expect(fromLoader).toEqual(diskArtifact);

    const queries: Array<[string, readonly AskWakaSourceLane[]]> = [
      ["What is WAKA?", ["PROJECT"]],
      ["How does finalizeDraftSale work?", ["PROJECT"]],
      ["Why did we introduce MB-1?", ["PROJECT", "HISTORY"]],
      ["What is the current MB-1 namespace architecture?", ["PROJECT"]],
      ["What did we work on in June 2026?", ["HISTORY"]],
    ];
    for (const [message, lanes] of queries) {
      expect(retrieveWakaKnowledge(message, lanes, fromLoader)).toEqual(
        retrieveWakaKnowledge(message, lanes, diskArtifact),
      );
    }
  }, 30_000);
});

describe("static import guard (bundle-size regression protection)", () => {
  it("9. no file under supabase/functions/** statically imports the artifact JSON", () => {
    const offenders: string[] = [];
    const staticImport = /(?:from\s+|import\s*\(\s*)["'][^"']*wakaKnowledgeArtifact\.json["']/;

    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        if (!/\.(ts|mts|js|mjs)$/.test(entry.name)) continue;
        const source = readFileSync(full, "utf8");
        if (staticImport.test(source)) {
          offenders.push(relative(FUNCTIONS_ROOT, full).replace(/\\/g, "/"));
        }
      }
    };
    walk(FUNCTIONS_ROOT);

    expect(
      offenders,
      "these files bundle wakaKnowledgeArtifact.json into an Edge Function deploy (5 MB limit)",
    ).toEqual([]);
  });
});
