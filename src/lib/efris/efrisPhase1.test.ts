import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { decideEfrisSubmit } from "./failClosed";
import { isEfrisEnabled } from "./gate";
import { considerEfrisEnqueue, resetEfrisConfigCache, type EfrisEnqueueDeps } from "./outbox";
import { isOfficialEfrisProviderConfigured } from "./providerConfig";
import { EFRIS_PROVIDER_NOT_CONFIGURED, EFRIS_STATES } from "./types";
import { nextEfrisStateAfterEnqueue, mayRecordFakeAcceptance } from "./states";
import { isOfficialEfrisProviderConfigured as edgeProviderConfigured } from "../../../supabase/functions/_shared/efrisFailClosed.ts";

const ROOT = process.cwd();
const SALE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SHOP_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SHOP_B = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function mockDeps(overrides: Partial<EfrisEnqueueDeps> = {}) {
  const enqueueRpc = vi.fn(
    overrides.enqueueRpc ??
      (async () => ({
        ok: true as const,
        enqueued: true,
        created: true,
        efris_state: "PENDING",
      })),
  );
  const invokeSubmitStub = vi.fn(overrides.invokeSubmitStub ?? (async () => undefined));
  const readEnabled = vi.fn(overrides.readEnabled ?? (async () => false));
  return {
    getShopId: overrides.getShopId ?? (() => SHOP_ID),
    hasCloud: overrides.hasCloud ?? (() => true),
    readEnabled,
    enqueueRpc,
    invokeSubmitStub,
  };
}

describe("EFRIS Phase 1 — fail-closed provider", () => {
  it("never reports an official URA provider as configured", () => {
    expect(isOfficialEfrisProviderConfigured()).toBe(false);
    expect(edgeProviderConfigured()).toBe(false);
  });

  it("never records a fake ACCEPTED outcome", () => {
    expect(mayRecordFakeAcceptance()).toBe(false);
  });

  it("maps disabled → NOT_REQUIRED and enabled → PENDING", () => {
    expect(nextEfrisStateAfterEnqueue(false)).toBe("NOT_REQUIRED");
    expect(nextEfrisStateAfterEnqueue(true)).toBe("PENDING");
    expect(EFRIS_STATES).toContain("RETRY_REQUIRED");
  });
});

describe("EFRIS Phase 1 — submit decision", () => {
  const base = {
    authenticated: true,
    shopAuthorized: true,
    shopId: SHOP_ID,
    saleId: SALE_ID,
    enabled: true,
    outboxExists: true,
  };

  it("rejects unauthenticated callers", () => {
    expect(decideEfrisSubmit({ ...base, authenticated: false })).toEqual({
      action: "reject",
      code: "unauthorized",
    });
  });

  it("rejects cross-shop access", () => {
    expect(decideEfrisSubmit({ ...base, shopAuthorized: false })).toEqual({
      action: "reject",
      code: "forbidden",
    });
  });

  it("does not treat a disabled shop as accepted", () => {
    expect(decideEfrisSubmit({ ...base, enabled: false })).toEqual({
      action: "reject",
      code: "efris_disabled",
    });
  });

  it("fail-closes when provider is absent — no fake acceptance", () => {
    const d = decideEfrisSubmit(base);
    expect(d).toEqual({ action: "fail_closed", code: EFRIS_PROVIDER_NOT_CONFIGURED });
    expect(d.action).not.toBe("accept");
  });
});

describe("EFRIS Phase 1 — gate", () => {
  it("is fail-closed unless enabled === true", () => {
    expect(isEfrisEnabled(undefined)).toBe(false);
    expect(isEfrisEnabled(null)).toBe(false);
    expect(isEfrisEnabled(false)).toBe(false);
    expect(isEfrisEnabled(true)).toBe(true);
  });
});

describe("EFRIS Phase 1 — outbox enqueue", () => {
  beforeEach(() => {
    resetEfrisConfigCache();
  });

  it("does not enqueue or invoke Edge when EFRIS is disabled", async () => {
    const deps = mockDeps();
    const out = await considerEfrisEnqueue({ saleId: SALE_ID, saleStatus: "completed" }, deps);
    expect(out).toMatchObject({ ok: true, enqueued: false, efris_state: "NOT_REQUIRED" });
    expect(deps.enqueueRpc).not.toHaveBeenCalled();
    expect(deps.invokeSubmitStub).not.toHaveBeenCalled();
  });

  it("does not enqueue before the WAKA sale is completed", async () => {
    const deps = mockDeps({ readEnabled: vi.fn(async () => true) });
    const pending = await considerEfrisEnqueue({ saleId: SALE_ID, saleStatus: "pending" }, deps);
    expect(pending).toMatchObject({ enqueued: false, reason: "sale_not_completed" });
    const cancelled = await considerEfrisEnqueue({ saleId: SALE_ID, saleStatus: "cancelled" }, deps);
    expect(cancelled).toMatchObject({ enqueued: false, reason: "sale_not_completed" });
    expect(deps.enqueueRpc).not.toHaveBeenCalled();
    expect(deps.invokeSubmitStub).not.toHaveBeenCalled();
  });

  it("does not enqueue without cloud or shop identity", async () => {
    const noCloud = mockDeps({ hasCloud: () => false, readEnabled: vi.fn(async () => true) });
    expect(await considerEfrisEnqueue({ saleId: SALE_ID, saleStatus: "completed" }, noCloud)).toMatchObject({
      reason: "no_cloud",
    });
    expect(noCloud.enqueueRpc).not.toHaveBeenCalled();

    const noShop = mockDeps({ getShopId: () => null, readEnabled: vi.fn(async () => true) });
    expect(await considerEfrisEnqueue({ saleId: SALE_ID, saleStatus: "completed" }, noShop)).toMatchObject({
      reason: "no_shop",
    });
    expect(noShop.enqueueRpc).not.toHaveBeenCalled();
  });

  it("creates one PENDING outbox row when enabled", async () => {
    const deps = mockDeps({ readEnabled: vi.fn(async () => true) });
    const out = await considerEfrisEnqueue({ saleId: SALE_ID, saleStatus: "completed" }, deps);
    expect(out).toMatchObject({ ok: true, enqueued: true, efris_state: "PENDING", created: true });
    expect(deps.enqueueRpc).toHaveBeenCalledTimes(1);
    expect(deps.enqueueRpc).toHaveBeenCalledWith(SHOP_ID, SALE_ID);
    expect(deps.invokeSubmitStub).toHaveBeenCalledTimes(1);
    expect(deps.invokeSubmitStub).toHaveBeenCalledWith(SHOP_ID, SALE_ID);
  });

  it("is idempotent: a second enqueue does not create a duplicate", async () => {
    const enqueueRpc = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, enqueued: true, created: true, efris_state: "PENDING" })
      .mockResolvedValueOnce({ ok: true, enqueued: true, created: false, efris_state: "PENDING" });
    const deps = mockDeps({ readEnabled: vi.fn(async () => true), enqueueRpc });
    const first = await considerEfrisEnqueue({ saleId: SALE_ID, saleStatus: "completed" }, deps);
    const second = await considerEfrisEnqueue({ saleId: SALE_ID, saleStatus: "completed" }, deps);
    expect(first).toMatchObject({ created: true, enqueued: true });
    expect(second).toMatchObject({ created: false, enqueued: true, efris_state: "PENDING" });
    expect(enqueueRpc).toHaveBeenCalledTimes(2);
    expect(enqueueRpc.mock.calls[0]).toEqual(enqueueRpc.mock.calls[1]);
  });

  it("does not use another shop's id when enqueueing", async () => {
    const deps = mockDeps({
      getShopId: () => SHOP_ID,
      readEnabled: vi.fn(async () => true),
    });
    await considerEfrisEnqueue({ saleId: SALE_ID, saleStatus: "completed" }, deps);
    expect(deps.enqueueRpc).toHaveBeenCalledWith(SHOP_ID, SALE_ID);
    expect(deps.enqueueRpc).not.toHaveBeenCalledWith(SHOP_B, expect.anything());
  });

  it("still reports the sale path as complete when the stub throws", async () => {
    const deps = mockDeps({
      readEnabled: vi.fn(async () => true),
      invokeSubmitStub: vi.fn(async () => {
        throw new Error("network");
      }),
    });
    const out = await considerEfrisEnqueue({ saleId: SALE_ID, saleStatus: "completed" }, deps);
    expect(out.ok).toBe(true);
    if (out.ok && out.enqueued) expect(out.efris_state).toBe("PENDING");
  });
});

describe("EFRIS Phase 1 — source safety (no invented URA API)", () => {
  const files = [
    "src/lib/efris/outbox.ts",
    "src/lib/efris/failClosed.ts",
    "src/lib/efris/providerConfig.ts",
    "src/store/usePosStore.ts",
    "supabase/functions/efris-submit/index.ts",
    "supabase/functions/_shared/efrisFailClosed.ts",
    "supabase/migrations/169_shop_efris_plumbing.sql",
  ];

  it("does not invent URA hosts, fetch a provider URL, or fake ACCEPTED", () => {
    const blob = files.map((f) => readFileSync(join(ROOT, f), "utf8")).join("\n");
    expect(blob).not.toMatch(/ura\.go\.ug/i);
    expect(blob).not.toMatch(/efris\.ura/i);
    expect(blob).not.toMatch(/https:\/\/[^\s"']*efris/i);
    expect(blob).not.toMatch(/api\.ura/i);
    const sql = readFileSync(join(ROOT, "supabase/migrations/169_shop_efris_plumbing.sql"), "utf8");
    expect(sql).toContain("unique (shop_id, sale_id)");
    expect(sql).toContain("enabled boolean not null default false");
    const edge = readFileSync(join(ROOT, "supabase/functions/efris-submit/index.ts"), "utf8");
    expect(edge).not.toMatch(/\bfetch\s*\(/);
    expect(edge).toContain(EFRIS_PROVIDER_NOT_CONFIGURED);
    expect(edge).toContain("accepted: false");
    expect(edge).not.toContain("accepted: true");
  });

  it("hooks enqueue after local sale persist, not before", () => {
    const store = readFileSync(join(ROOT, "src/store/usePosStore.ts"), "utf8");
    const start = store.indexOf("finalizeDraftSale: ({");
    const end = store.indexOf("voidSaleLine:", start);
    const fn = store.slice(start, end);
    expect(fn.indexOf("flushPendingPersist()")).toBeGreaterThan(0);
    expect(fn.indexOf("enqueueEfrisAfterCompletedSale")).toBeGreaterThan(fn.indexOf("flushPendingPersist()"));
    expect(fn.indexOf('void queueRemote("pending_sales"')).toBeGreaterThan(0);
    expect(fn.indexOf("enqueueEfrisAfterCompletedSale")).toBeGreaterThan(fn.indexOf('void queueRemote("pending_sales"'));
    expect(store).not.toMatch(/saleFinancialEngine[\s\S]{0,80}efris/i);
  });
});
