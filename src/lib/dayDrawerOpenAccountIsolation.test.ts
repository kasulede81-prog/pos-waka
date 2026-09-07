/**
 * Account isolation for dayDrawerOpens — reset/essentials must clear Shop A
 * before Shop B remainder hydration. Does not change day-open business logic.
 */
import { afterEach, describe, expect, it } from "vitest";
import type { DayDrawerOpen, PharmacyDoctor, StockMovement } from "../types";
import { createDefaultPreferences } from "../data/defaultSeed";
import { entityKey } from "../offline/entityStore";
import { usePosStore } from "../store/usePosStore";

function opening(id: string, extra: Partial<DayDrawerOpen> = {}): DayDrawerOpen {
  const dateKey = extra.dateKey ?? "2026-09-06";
  return {
    id,
    dateKey,
    openingFloatUgx: extra.openingFloatUgx ?? 100_000,
    countedAt: extra.countedAt ?? `${dateKey}T07:00:00.000Z`,
    countedByUserId: extra.countedByUserId ?? "owner",
    countedByLabel: extra.countedByLabel ?? "Owner",
    note: extra.note ?? "",
    deviceId: extra.deviceId ?? "dev",
    status: extra.status ?? "open",
    createdAt: extra.createdAt ?? `${dateKey}T07:00:00.000Z`,
    updatedAt: extra.updatedAt ?? `${dateKey}T07:00:00.000Z`,
    pendingSync: extra.pendingSync ?? false,
    ...extra,
  };
}

function doctor(id: string): PharmacyDoctor {
  return {
    id,
    name: `Dr. ${id}`,
    clinic: "Kampala Clinic",
    phone: null,
    registrationNumber: null,
    notes: null,
    createdAt: "2026-09-06T08:00:00.000Z",
    updatedAt: "2026-09-06T08:00:00.000Z",
    version: 1,
    pendingSync: false,
  };
}

function movement(id: string): StockMovement {
  return {
    id,
    at: "2026-01-01T00:00:00.000Z",
    productId: "p1",
    productName: "Item",
    deltaBaseUnits: -1,
    kind: "sale_out",
    summary: `Move ${id}`,
    refId: id,
    supplierId: null,
  };
}

function restartStore(): void {
  usePosStore.getState().resetForSignOut();
  usePosStore.getState().hydrateEssentials({
    products: [],
    customers: [],
    preferences: createDefaultPreferences(),
  });
}

afterEach(() => {
  usePosStore.getState().resetForSignOut();
});

describe("dayDrawerOpens account isolation", () => {
  it("resetForSignOut clears dayDrawerOpens", () => {
    usePosStore.setState({ dayDrawerOpens: [opening("open-session")] });
    usePosStore.getState().resetForSignOut();
    expect(usePosStore.getState().dayDrawerOpens).toEqual([]);
  });

  it("hydrateEssentials clears dayDrawerOpens", () => {
    usePosStore.setState({ dayDrawerOpens: [opening("open-session")] });
    usePosStore.getState().hydrateEssentials({
      products: [],
      customers: [],
      preferences: createDefaultPreferences(),
    });
    expect(usePosStore.getState().dayDrawerOpens).toEqual([]);
  });

  it("same-shop remainder hydration restores persisted dayDrawerOpens", () => {
    restartStore();
    expect(usePosStore.getState().dayDrawerOpens).toEqual([]);
    usePosStore.getState().hydrateRemainder({
      dayDrawerOpens: [opening("open-shop-a", { openingFloatUgx: 80_000 })],
    });
    const rows = usePosStore.getState().dayDrawerOpens;
    expect(rows.map((r) => r.id)).toEqual(["open-shop-a"]);
    expect(rows[0]?.openingFloatUgx).toBe(80_000);
  });

  it("Shop A values do not remain when Shop B has no persisted rows", () => {
    restartStore();
    usePosStore.setState({
      dayDrawerOpens: [opening("open-shop-a", { openingFloatUgx: 250_000 })],
    });
    expect(usePosStore.getState().dayDrawerOpens.map((r) => r.id)).toEqual(["open-shop-a"]);

    usePosStore.getState().resetForSignOut();
    usePosStore.getState().hydrateEssentials({
      products: [],
      customers: [],
      preferences: createDefaultPreferences(),
    });
    expect(usePosStore.getState().dayDrawerOpens).toEqual([]);

    usePosStore.getState().hydrateRemainder({
      dayDrawerOpens: [],
    });
    expect(usePosStore.getState().dayDrawerOpens).toEqual([]);
  });

  it("Shop B remainder replaces Shop A after reset", () => {
    const shopAKey = entityKey("sb:shop-a", "dayDrawerOpen", "open-shop-a");
    const shopBKey = entityKey("sb:shop-b", "dayDrawerOpen", "open-shop-b");
    expect(shopAKey).not.toBe(shopBKey);
    expect(shopAKey).toBe("sb:shop-a::dayDrawerOpen::open-shop-a");
    expect(shopBKey).toBe("sb:shop-b::dayDrawerOpen::open-shop-b");

    const persisted = new Map<string, DayDrawerOpen>([
      [shopAKey, opening("open-shop-a", { openingFloatUgx: 100_000, note: "Shop A" })],
      [shopBKey, opening("open-shop-b", { openingFloatUgx: 40_000, note: "Shop B" })],
    ]);
    const hydrateAccount = (accountKey: string) =>
      [...persisted.entries()]
        .filter(([key]) => key.startsWith(`${accountKey}::dayDrawerOpen::`))
        .map(([, row]) => row);

    restartStore();
    usePosStore.setState({ dayDrawerOpens: hydrateAccount("sb:shop-a") });
    expect(usePosStore.getState().dayDrawerOpens.map((r) => r.id)).toEqual(["open-shop-a"]);

    usePosStore.getState().resetForSignOut();
    usePosStore.getState().hydrateEssentials({
      products: [],
      customers: [],
      preferences: createDefaultPreferences(),
    });
    expect(usePosStore.getState().dayDrawerOpens).toEqual([]);

    usePosStore.getState().hydrateRemainder({
      dayDrawerOpens: hydrateAccount("sb:shop-b"),
    });
    const rows = usePosStore.getState().dayDrawerOpens;
    expect(rows.map((r) => r.id)).toEqual(["open-shop-b"]);
    expect(rows[0]?.note).toBe("Shop B");
    expect(rows[0]?.openingFloatUgx).toBe(40_000);
    expect(rows.some((r) => r.id === "open-shop-a")).toBe(false);
  });

  it("archived and pharmacy isolation still clears on the same reset/essentials path", () => {
    usePosStore.setState({
      dayDrawerOpens: [opening("open-session")],
      archivedStockMovements: [movement("arch-session")],
      pharmacyDoctors: [doctor("doc-session")],
    });
    usePosStore.getState().resetForSignOut();
    expect(usePosStore.getState().dayDrawerOpens).toEqual([]);
    expect(usePosStore.getState().archivedStockMovements).toEqual([]);
    expect(usePosStore.getState().pharmacyDoctors).toEqual([]);

    usePosStore.setState({
      dayDrawerOpens: [opening("open-session")],
      archivedStockMovements: [movement("arch-session")],
      pharmacyDoctors: [doctor("doc-session")],
    });
    usePosStore.getState().hydrateEssentials({
      products: [],
      customers: [],
      preferences: createDefaultPreferences(),
    });
    expect(usePosStore.getState().dayDrawerOpens).toEqual([]);
    expect(usePosStore.getState().archivedStockMovements).toEqual([]);
    expect(usePosStore.getState().pharmacyDoctors).toEqual([]);
  });

  it("same-shop restart via remainder still restores after essentials clear", () => {
    restartStore();
    usePosStore.getState().hydrateRemainder({
      dayDrawerOpens: [opening("open-restart", { openingFloatUgx: 75_000 })],
    });
    expect(usePosStore.getState().dayDrawerOpens[0]?.id).toBe("open-restart");

    restartStore();
    expect(usePosStore.getState().dayDrawerOpens).toEqual([]);
    usePosStore.getState().hydrateRemainder({
      dayDrawerOpens: [opening("open-restart", { openingFloatUgx: 75_000 })],
    });
    expect(usePosStore.getState().dayDrawerOpens.map((r) => r.id)).toEqual(["open-restart"]);
    expect(usePosStore.getState().dayDrawerOpens[0]?.openingFloatUgx).toBe(75_000);
  });
});
