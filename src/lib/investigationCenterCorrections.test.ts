/**
 * INVESTIGATION-CENTER-CORRECTIONS-1.0 — focused regression coverage.
 */
import { describe, expect, it } from "vitest";
import type { AuditLogEntry, StaffAccount } from "../types";
import { buildAuditCsv, auditEntriesToExportRows } from "./auditExport";
import { t } from "./i18n";
import {
  buildStaffNameById,
  CLIENT_ACTOR_NAME_KEY,
  CLIENT_ACTOR_USER_ID_KEY,
  prepareAuditCloudPush,
  resolveInvestigationActorLabel,
  restoreActorFromAuditPayload,
} from "./investigationActorAttribution";
import { restoreActorFromAuditPayload as restoreFromPull } from "./investigationActorAttribution";
import {
  getActivitySeverity,
  INVESTIGATION_CATEGORY_ACTION_SETS,
  matchesCategory,
  computeInvestigationKpis,
  purchaseVoidClaimsDurableStock,
  purchaseVoidInvestigationLabelKey,
  isSyntheticTimelineIllustrative,
  syntheticTimelineSectionLabelKey,
  buildEventTimelineSteps,
} from "../features/investigation-center/lib/activityPresentation";
import {
  shiftSalesCounterIsCanonicalRevenue,
  shiftSalesCounterLabelKey,
} from "../features/investigation-center/components/InvestigationStaffSection";
import { buildAuditLogSearchIndex } from "./auditSearch";
import { dateKeyKampala } from "./datesUg";

function entry(partial: Partial<AuditLogEntry> & Pick<AuditLogEntry, "id" | "action">): AuditLogEntry {
  return {
    at: "2026-08-10T12:00:00.000Z",
    actorUserId: "staff:cashier-1",
    actorName: "Amina",
    role: "cashier",
    payloadSummary: "test",
    payload: {},
    ...partial,
  };
}

describe("INVESTIGATION-CENTER-CORRECTIONS-1.0", () => {
  it("P1-01 — shift sales counter is not labeled as canonical revenue", () => {
    expect(shiftSalesCounterIsCanonicalRevenue()).toBe(false);
    expect(shiftSalesCounterLabelKey()).toBe("icShiftSalesTotal");
    expect(t("en", "icShiftSalesTotal").toLowerCase()).toContain("shift");
    expect(t("en", "icShiftSalesTotalHint").toLowerCase()).toContain("not certified");
    expect(t("en", "icShiftSalesTotal").toLowerCase()).not.toContain("canonical");
    expect(t("en", "icShiftSalesTotal").toLowerCase()).not.toMatch(/\brevenue\b/);
  });

  it("P1-02 — day-drawer / float actions map to cash_drawer", () => {
    const cash = INVESTIGATION_CATEGORY_ACTION_SETS.cash_drawer;
    expect(cash.has("day_drawer_open")).toBe(true);
    expect(cash.has("day_drawer_open_void")).toBe(true);
    expect(cash.has("day_drawer_open_supersede")).toBe(true);
    expect(cash.has("shift_float_verified")).toBe(true);
    expect(cash.has("shift_float_mismatch")).toBe(true);
    expect(cash.has("day_close")).toBe(true);
    expect(matchesCategory(entry({ id: "1", action: "day_drawer_open" }), "cash_drawer")).toBe(true);
  });

  it("P1-03 — actor attribution preserves staff identity (no current-user substitution)", () => {
    const staffEntry = entry({
      id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      action: "sale_completed",
      actorUserId: "staff:c1",
      actorName: "Amina",
    });
    const authUserId = "11111111-2222-4333-8444-555555555555";
    const prepared = prepareAuditCloudPush(staffEntry, authUserId);
    expect(prepared.actorUserIdForRow).toBe(authUserId);
    expect(prepared.payload[CLIENT_ACTOR_USER_ID_KEY]).toBe("staff:c1");
    expect(prepared.payload[CLIENT_ACTOR_NAME_KEY]).toBe("Amina");
    expect(prepared.actorUserIdForRow).not.toBe("staff:c1");

    const pulled = restoreActorFromAuditPayload({
      ...staffEntry,
      actorUserId: authUserId,
      actorName: undefined,
      payload: prepared.payload,
    });
    expect(pulled.actorUserId).toBe("staff:c1");
    expect(pulled.actorName).toBe("Amina");

    const staffAccounts: StaffAccount[] = [
      {
        id: "c1",
        name: "Amina",
        role: "cashier",
        pinHash: "x",
        active: true,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      } as StaffAccount,
    ];
    const map = buildStaffNameById(staffAccounts);
    expect(resolveInvestigationActorLabel("en", { ...pulled, actorName: undefined }, map)).toBe("Amina");

    const unknown = entry({ id: "u1", action: "sale_completed", actorUserId: "unknown", actorName: undefined });
    expect(resolveInvestigationActorLabel("en", unknown, new Map())).toBe(t("en", "actorUnknown"));
    expect(resolveInvestigationActorLabel("en", unknown, new Map())).not.toBe("Owner");
    expect(resolveInvestigationActorLabel("en", unknown, new Map())).not.toBe(authUserId);

    const authOnly = entry({
      id: "a1",
      action: "sale_completed",
      actorUserId: authUserId,
      actorName: "Owner",
    });
    expect(resolveInvestigationActorLabel("en", authOnly, new Map())).toBe("Owner");
    void restoreFromPull;
  });

  it("P1-04 — synthetic timeline is illustrative, not confirmed audit chain", () => {
    expect(isSyntheticTimelineIllustrative()).toBe(true);
    expect(syntheticTimelineSectionLabelKey()).toBe("icIllustrativeSequence");
    expect(t("en", "icIllustrativeSequence").toLowerCase()).toContain("illustrative");
    expect(t("en", "icIllustrativeSequenceHint").toLowerCase()).toContain("not a confirmed");
    const steps = buildEventTimelineSteps("en", "sale_completed");
    expect(steps.length).toBeGreaterThan(1);
  });

  it("P2-01 — sale_void is warning, not error", () => {
    const sev = getActivitySeverity(entry({ id: "v1", action: "sale_void" }));
    expect(sev).toBe("warning");
    expect(sev).not.toBe("error");
  });

  it("P2-02 — sales KPI label is activity/events wording", () => {
    expect(t("en", "icKpiSales").toLowerCase()).toContain("sales");
    expect(t("en", "icKpiSales").toLowerCase()).toMatch(/activit|event/);
    expect(t("lg", "icKpiSales").toLowerCase()).toContain("ebikolwa");
  });

  it("P2-03 — failed sync only includes sync_unknown_operation (not sync_override)", () => {
    expect(INVESTIGATION_CATEGORY_ACTION_SETS.failed_syncs.has("sync_unknown_operation")).toBe(true);
    expect(INVESTIGATION_CATEGORY_ACTION_SETS.failed_syncs.has("sync_override")).toBe(false);
  });

  it("P2-04 — inventory category covers count/adjust/writeoff; no shop transfer AuditAction exists", () => {
    const inv = INVESTIGATION_CATEGORY_ACTION_SETS.inventory;
    expect(inv.has("stock_adjust")).toBe(true);
    expect(inv.has("inventory_count_applied")).toBe(true);
    expect(inv.has("expired_stock_writeoff")).toBe(true);
    // Enterprise transfers use stock movement refs, not shop AuditAction — do not invent.
    expect((inv as Set<string>).has("transfer_dispatch")).toBe(false);
    expect((inv as Set<string>).has("transfer_receive")).toBe(false);
  });

  it("P2-05 — CSV export includes durable entry id", () => {
    const rows = auditEntriesToExportRows("en", [entry({ id: "entry-uuid-1", action: "sale_completed" })]);
    expect(rows[0]!.id).toBe("entry-uuid-1");
    const csv = buildAuditCsv("en", [entry({ id: "entry-uuid-1", action: "sale_completed" })]);
    expect(csv.split("\n")[0]).toContain("Entry ID");
    expect(csv).toContain("entry-uuid-1");
  });

  it("P2-06 — activities label today vs in-range", () => {
    const today = dateKeyKampala(new Date());
    const e = entry({
      id: "1",
      action: "sale_completed",
      at: `${today}T10:00:00.000Z`,
    });
    const index = buildAuditLogSearchIndex([e]);
    const todayCards = computeInvestigationKpis(index, today, today, 0);
    expect(todayCards.find((c) => c.id === "activities_today")?.labelKey).toBe("icKpiActivitiesToday");
    const rangeCards = computeInvestigationKpis(index, "2026-01-01", today, 0);
    expect(rangeCards.find((c) => c.id === "activities_today")?.labelKey).toBe("icKpiActivitiesInRange");
  });

  it("P2-07 — day_close in cash_drawer; settings empty of day_close", () => {
    expect(INVESTIGATION_CATEGORY_ACTION_SETS.cash_drawer.has("day_close")).toBe(true);
    expect(INVESTIGATION_CATEGORY_ACTION_SETS.settings.has("day_close")).toBe(false);
    expect(INVESTIGATION_CATEGORY_ACTION_SETS.debts.has("debt_payment")).toBe(true);
    expect(INVESTIGATION_CATEGORY_ACTION_SETS.purchases.has("purchase_void")).toBe(true);
  });

  it("P2-08 — purchase_void never claims durable stock from audit alone", () => {
    const e = entry({
      id: "pv1",
      action: "purchase_void",
      payload: { purchaseId: "p1", stockReversed: true },
    });
    expect(purchaseVoidClaimsDurableStock(e)).toBe(false);
    expect(purchaseVoidInvestigationLabelKey(e)).toBe("icPurchaseVoidAuditOnly");
  });

  it("P2-09 — refund integrity scope copy distinguishes global vs range list", () => {
    expect(t("en", "refundIntegrityScopeGlobal").toLowerCase()).toContain("global");
    expect(t("en", "refundHistoryRangeScoped").toLowerCase()).toContain("range");
  });

  it("P2-10 — MB-1 audit isolation is shop-scoped on cloud pull (architectural)", async () => {
    const src = await import("fs").then((fs) =>
      fs.promises.readFile(new URL("./auditCloudSync.ts", import.meta.url), "utf8"),
    );
    expect(src).toContain('.eq("shop_id", shopId)');
    expect(src).toContain("restoreActorFromAuditPayload");
  });
});
