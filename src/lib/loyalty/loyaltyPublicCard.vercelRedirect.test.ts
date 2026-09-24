import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

type VercelRedirect = {
  source: string;
  destination: string;
  permanent?: boolean;
  statusCode?: number;
  has?: Array<{ type: string; value: string }>;
};

describe("B3 vercel legacy loyalty redirect", () => {
  const vercel = JSON.parse(
    readFileSync(resolve(process.cwd(), "vercel.json"), "utf8"),
  ) as { redirects?: VercelRedirect[]; rewrites?: unknown[] };

  const legacy = (vercel.redirects ?? []).filter((r) =>
    r.source.includes("/loyalty/:token"),
  );

  it("defines host-scoped 301 redirects for pos.waka.ug only", () => {
    expect(legacy.length).toBeGreaterThanOrEqual(1);
    for (const rule of legacy) {
      expect(rule.statusCode).toBe(301);
      // Trailing `?` forces Vercel to drop unexpected inbound query strings.
      expect(rule.destination).toBe("https://loyalty.waka.ug/c/:token?");
      expect(rule.has).toEqual([{ type: "host", value: "pos.waka.ug" }]);
      // Token constrained to 64 hex — no open redirect / next= / redirect=
      expect(rule.source).toMatch(/:token\(\[a-fA-F0-9\]\{64\}\)/);
      expect(rule.destination).not.toMatch(/next=|redirect=/i);
      expect(rule.source).not.toMatch(/next=|redirect=/i);
    }
  });

  it("preserves SPA fallback rewrite", () => {
    expect(Array.isArray(vercel.rewrites)).toBe(true);
    expect(vercel.rewrites!.length).toBeGreaterThan(0);
  });

  it("does not accept user-controlled destinations", () => {
    for (const rule of vercel.redirects ?? []) {
      const dest = rule.destination.replace(/\?$/, "");
      expect(dest.startsWith("https://loyalty.waka.ug/") || dest.startsWith("/")).toBe(true);
      expect(dest).not.toContain("?");
      expect(dest).not.toMatch(/\$\{|next=|redirect=/i);
    }
  });
});
