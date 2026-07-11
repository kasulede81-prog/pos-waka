/**
 * Phase 6.7 / 7.1 — hospitality hardware print mutations.
 */

import type {
  AuditAction,
  HospitalityHardwarePrefs,
  KitchenTicket,
  Language,
  PrinterConnectionType,
  PrinterProfile,
  PrinterStationRole,
  ShopPreferences,
} from "../types";
import type { KitchenChitPrintKind } from "../lib/kitchenChitPrint";
import { buildKitchenChitEscPos, kitchenChitSummary } from "../lib/kitchenChitPrint";
import {
  defaultHospitalityHardwarePrefs,
  patchHospitalityHardware,
  resolveHospitalityHardware,
} from "../lib/hospitalityHardware";
import {
  assignPrinterToStation,
  removePrinterProfile,
  resolveDefaultReceiptPrinter,
  resolvePrinterForStation,
  upsertPrinterProfile,
} from "../lib/printerRegistry";
import {
  cancelPrintJob,
  enqueuePrintJob,
  processPrintQueue,
  reconcilePrintQueue,
  retryFailedPrintJobs,
} from "../lib/printQueue";
import {
  buildRestaurantReceiptEscPos,
  buildRestaurantReceiptLines,
  buildVoidRestaurantReceiptEscPos,
  restaurantReceiptSummary,
  type RestaurantReceiptKind,
} from "../lib/restaurantReceiptPrint";
import { dateKeyKampala, saleReportingDayKey } from "../lib/datesUg";
import { pulseDrawer, pulseDrawerOnPrinter } from "../services/hardware/cashDrawerAdapter";
import { testPrintProfile } from "../services/hardware/printerAdapter";
import { publishCustomerDisplay } from "../lib/customerDisplayChannel";
import { computeRestaurantBillTotals, billDraftFromSale } from "../lib/restaurantBilling";
import { readUiLanguageCacheSync } from "../lib/uiLanguage";
import type { PosState } from "./usePosStore";

type StoreGet = () => PosState;
type StoreSet = (partial: Partial<PosState> | ((s: PosState) => Partial<PosState>)) => void;

type Deps = {
  get: StoreGet;
  set: StoreSet;
  pushAudit: (action: AuditAction, detail: string, meta?: Record<string, unknown>) => void;
  flushPendingPersist: () => void;
};

function chitKindToJobKind(kind: KitchenChitPrintKind) {
  if (kind === "void") return "kitchen_chit_void" as const;
  if (kind === "modified") return "kitchen_chit_modified" as const;
  if (kind === "course") return "kitchen_chit_course" as const;
  if (kind === "reprint") return "kitchen_chit_reprint" as const;
  return "kitchen_chit_new" as const;
}

function printLang(): Language {
  return readUiLanguageCacheSync() ?? "en";
}

export function createHardwarePrintStoreActions(deps: Deps) {
  const { get, set, pushAudit, flushPendingPersist } = deps;

  const scheduleQueue = () => {
    const state = get();
    void (async () => {
      let prefs = await reconcilePrintQueue(state.preferences);
      prefs = await processPrintQueue(prefs);
      if (prefs !== get().preferences) {
        set({ preferences: prefs });
        flushPendingPersist();
      }
      const depth = resolveHospitalityHardware(prefs).printQueue.filter((j) => j.status === "queued").length;
      if (depth > 0) {
        window.setTimeout(() => scheduleQueue(), 2000);
      }
    })();
  };

  const enqueueKitchenTickets = async (tickets: KitchenTicket[], kind: KitchenChitPrintKind = "new") => {
    const state = get();
    const hw = resolveHospitalityHardware(state.preferences);
    if (!hw.autoPrintKitchen || !tickets.length) return;
    let prefs = state.preferences;
    for (const ticket of tickets) {
      const printer = resolvePrinterForStation(
        prefs,
        state.preferences.hospitalityFloor,
        ticket.stationId,
        ticket.stationType,
      );
      if (!printer) continue;
      const chitOpts = {
        shopName: state.preferences.shopDisplayName?.trim() || "Waka POS",
        businessDate: dateKeyKampala(ticket.firedAt),
      };
      const bytes = buildKitchenChitEscPos(ticket, printLang(), printer.paperWidth, kind, chitOpts);
      prefs = await enqueuePrintJob(prefs, {
        kind: chitKindToJobKind(kind),
        printerId: printer.id,
        stationId: ticket.stationId,
        ticketId: ticket.id,
        saleId: ticket.saleId,
        tableSessionId: ticket.tableSessionId,
        tableLabel: ticket.tableLabel,
        businessDate: chitOpts.businessDate,
        payloadSummary: kitchenChitSummary(ticket, kind),
        bytes,
      });
    }
    if (prefs !== state.preferences) {
      set({ preferences: prefs });
      flushPendingPersist();
      scheduleQueue();
    }
  };

  const syncCustomerDisplay = () => {
    const state = get();
    const hw = resolveHospitalityHardware(state.preferences);
    if (!hw.customerDisplayEnabled) return;
    const sessionId = state.preferences.activeTableSessionId;
    const floor = state.preferences.hospitalityFloor;
    const session = sessionId && floor ? floor.sessions.find((s) => s.id === sessionId) : null;
    const tableLabel = session && floor
      ? (session.tabLabel?.trim() ||
          (session.tableId ? floor.tables.find((t) => t.id === session.tableId)?.label : null) ||
          null)
      : null;
    const lines = state.draftLines.map((l) => ({
      name: l.name,
      quantity: l.quantity,
      lineTotalUgx: l.lineTotalUgx ?? 0,
    }));
    const draft = state.activePendingSaleId
      ? state.sales.find((s) => s.id === state.activePendingSaleId)
      : null;
    const totals = computeRestaurantBillTotals({
      lines: state.draftLines,
      cartDiscountUgx: state.draftCartDiscountUgx,
      billDraft: draft ? billDraftFromSale(draft, state.preferences) : undefined,
      prefs: state.preferences,
    });
    publishCustomerDisplay({
      shopName: state.preferences.shopDisplayName?.trim() || "Waka POS",
      tableLabel,
      lines,
      subtotalUgx: totals.subtotalAfterDiscountUgx,
      totalUgx: totals.grandTotalUgx,
      state: "ordering",
      updatedAt: new Date().toISOString(),
    });
  };

  return {
    enqueueKitchenTicketPrints: (ticketIds: string[], kind: KitchenChitPrintKind = "new") => {
      const state = get();
      const floor = state.preferences.hospitalityFloor;
      if (!floor?.kitchenTickets?.length) return;
      const tickets = floor.kitchenTickets.filter((t) => ticketIds.includes(t.id));
      void enqueueKitchenTickets(tickets, kind);
    },

    reprintKitchenTicket: (ticketId: string) => {
      const state = get();
      const ticket = state.preferences.hospitalityFloor?.kitchenTickets?.find((t) => t.id === ticketId);
      if (!ticket) return { ok: false as const, errorKey: "invalid" };
      const hw = resolveHospitalityHardware(state.preferences);
      if (!hw.autoPrintKitchen) return { ok: false as const, errorKey: "kitchenPrintDisabled" };
      const printer = resolvePrinterForStation(
        state.preferences,
        state.preferences.hospitalityFloor,
        ticket.stationId,
        ticket.stationType,
      );
      if (!printer) return { ok: false as const, errorKey: "kitchenNoPrinter" };
      void enqueueKitchenTickets([ticket], "reprint");
      return { ok: true as const };
    },

    upsertPrinter: (input: {
      id?: string;
      name: string;
      connectionType: PrinterConnectionType;
      paperWidth: "58mm" | "80mm";
      stationRoles: PrinterStationRole[];
      isDefaultReceipt?: boolean;
      networkHost?: string | null;
      networkPort?: number | null;
    }) => {
      const state = get();
      const profile: PrinterProfile = {
        id: input.id ?? crypto.randomUUID(),
        name: input.name.trim() || "Printer",
        connectionType: input.connectionType,
        paperWidth: input.paperWidth,
        stationRoles: input.stationRoles,
        isDefaultReceipt: input.isDefaultReceipt ?? false,
        vendorHint: "generic",
        networkHost: input.networkHost ?? null,
        networkPort: input.networkPort ?? 9100,
        isEnabled: true,
      };
      const next = upsertPrinterProfile(state.preferences, profile);
      set({ preferences: next });
      flushPendingPersist();
      return { ok: true as const, printerId: profile.id };
    },

    removePrinter: (printerId: string) => {
      const state = get();
      set({ preferences: removePrinterProfile(state.preferences, printerId) });
      flushPendingPersist();
      return { ok: true as const };
    },

    assignStationPrinter: (stationId: string, printerId: string | null) => {
      const state = get();
      const floor = state.preferences.hospitalityFloor;
      if (!floor) return { ok: false as const, errorKey: "invalid" };
      const nextFloor = assignPrinterToStation(floor, stationId, printerId);
      set({
        preferences: {
          ...state.preferences,
          hospitalityFloor: nextFloor,
        },
      });
      flushPendingPersist();
      return { ok: true as const };
    },

    testConfiguredPrinter: (printerId: string) => {
      const state = get();
      const printer = resolveHospitalityHardware(state.preferences).printers.find((p) => p.id === printerId);
      if (!printer) return Promise.resolve({ ok: false as const, error: "Printer not found." });
      const lines = [
        state.preferences.shopDisplayName?.trim() || "Waka POS",
        "Test print",
        new Date().toLocaleString("en-UG"),
      ];
      return testPrintProfile(printer, lines);
    },

    cancelQueuedPrintJob: (jobId: string) => {
      void (async () => {
        const prefs = await cancelPrintJob(get().preferences, jobId);
        set({ preferences: prefs });
        flushPendingPersist();
      })();
      return { ok: true as const };
    },

    retryFailedPrintJobs: () => {
      void (async () => {
        let prefs = await retryFailedPrintJobs(get().preferences);
        set({ preferences: prefs });
        flushPendingPersist();
        scheduleQueue();
      })();
      return { ok: true as const };
    },

    setHospitalityHardwarePrefs: (patch: Partial<HospitalityHardwarePrefs>) => {
      const state = get();
      const hw = patchHospitalityHardware(state.preferences, patch);
      set({
        preferences: {
          ...state.preferences,
          hospitalityHardware: hw,
        },
      });
      flushPendingPersist();
      return { ok: true as const };
    },

    openCashDrawerManual: async (reason = "manual") => {
      const state = get();
      const actor = state.sessionActor;
      const res = await pulseDrawer(state.preferences);
      const entry = {
        id: crypto.randomUUID(),
        at: new Date().toISOString(),
        reason: reason as "manual" | "payment" | "no_sale",
        byUserId: actor?.userId ?? null,
        byLabel: actor?.displayName ?? null,
        ok: res.ok,
        error: res.error ?? null,
      };
      const hw = resolveHospitalityHardware(state.preferences);
      set({
        preferences: {
          ...state.preferences,
          hospitalityHardware: {
            ...hw,
            drawerAudit: [entry, ...hw.drawerAudit].slice(0, 200),
          },
        },
      });
      pushAudit("drawer_open", `Manual drawer open ${res.ok ? "ok" : "failed"}`, { reason });
      flushPendingPersist();
      return res;
    },

    printRestaurantReceiptForSale: async (
      saleId: string,
      context?: {
        tableLabel?: string | null;
        waiterLabel?: string | null;
        guestCount?: number | null;
        voidReceipt?: boolean;
        reprint?: boolean;
        receiptKind?: RestaurantReceiptKind;
        splitId?: string | null;
        splitLabel?: string | null;
        splitIndex?: number | null;
        orderRound?: number | null;
      },
    ) => {
      const state = get();
      const sale = state.sales.find((s) => s.id === saleId);
      if (!sale) return { ok: false as const, error: "Sale not found." };
      const hw = resolveHospitalityHardware(state.preferences);
      const printer = resolveDefaultReceiptPrinter(state.preferences);
      const actor = state.sessionActor;
      const receiptKind: RestaurantReceiptKind =
        context?.receiptKind ??
        (context?.voidReceipt ? "void" : context?.reprint ? "reprint" : context?.splitId ? "guest" : "restaurant");
      const ctx = {
        sale,
        products: state.products,
        prefs: state.preferences,
        lang: printLang(),
        tableLabel: context?.tableLabel ?? sale.referenceLabel ?? null,
        waiterLabel: context?.waiterLabel ?? null,
        guestCount: context?.guestCount ?? null,
        cashierLabel: actor?.displayName ?? null,
        printedBy: actor?.displayName ?? null,
        template: hw.receiptTemplate,
        voidReceipt: context?.voidReceipt ?? receiptKind === "void",
        receiptKind,
        reprint: context?.reprint ?? receiptKind === "reprint",
        businessDate: saleReportingDayKey(sale),
        orderRound: context?.orderRound ?? null,
        splitId: context?.splitId ?? null,
        splitLabel: context?.splitLabel ?? null,
        splitIndex: context?.splitIndex ?? null,
      };
      if (printer) {
        const bytes =
          receiptKind === "void" || context?.voidReceipt
            ? buildVoidRestaurantReceiptEscPos(ctx, printer.paperWidth)
            : buildRestaurantReceiptEscPos(ctx, printer.paperWidth);
        const prefs = await enqueuePrintJob(state.preferences, {
          kind: "receipt",
          printerId: printer.id,
          saleId,
          tableSessionId: sale.tableSessionId ?? null,
          tableLabel: ctx.tableLabel,
          businessDate: ctx.businessDate,
          payloadSummary:
            receiptKind === "void"
              ? `VOID ${restaurantReceiptSummary(ctx)}`
              : receiptKind === "guest"
                ? `Guest ${restaurantReceiptSummary(ctx)}`
                : restaurantReceiptSummary(ctx),
          bytes,
        });
        set({ preferences: prefs });
        flushPendingPersist();
        scheduleQueue();
        if (context?.reprint || receiptKind === "reprint") {
          pushAudit("receipt_reprint", `Reprint ${restaurantReceiptSummary(ctx)}`, { saleId });
        }
        return { ok: true as const, mode: "escpos" as const };
      }
      const { printReceiptWithFallback } = await import("../lib/receiptPrint");
      const text = buildRestaurantReceiptLines(ctx).join("\n");
      const paper = state.preferences.receiptPaperSize ?? "80mm";
      const res = await printReceiptWithFallback(text, paper);
      return { ok: res.ok, mode: res.mode, error: res.error };
    },

    openCashDrawerOnPayment: async (saleId: string) => {
      const state = get();
      const hw = resolveHospitalityHardware(state.preferences);
      if (!hw.openDrawerOnPayment) return { ok: false as const, skipped: true as const };
      const printer = resolveDefaultReceiptPrinter(state.preferences);
      const res = printer ? await pulseDrawerOnPrinter(printer) : await pulseDrawer(state.preferences);
      const entry = {
        id: crypto.randomUUID(),
        at: new Date().toISOString(),
        reason: "payment" as const,
        byUserId: state.sessionActor?.userId ?? null,
        byLabel: state.sessionActor?.displayName ?? null,
        saleId,
        ok: res.ok,
        error: res.error ?? null,
      };
      set({
        preferences: {
          ...state.preferences,
          hospitalityHardware: {
            ...hw,
            drawerAudit: [entry, ...hw.drawerAudit].slice(0, 200),
          },
        },
      });
      flushPendingPersist();
      return res;
    },

    syncCustomerDisplay,
    processPendingPrintQueue: () => {
      scheduleQueue();
    },

    bootstrapResumePrintQueue: () => {
      scheduleQueue();
    },
  };
}

export function ensureHardwarePrefsOnBootstrap(prefs: ShopPreferences): ShopPreferences {
  if (prefs.hospitalityHardware) return prefs;
  if (!["restaurant", "restaurant_bar", "bar", "cafe", "hotel"].includes(prefs.businessType)) return prefs;
  return {
    ...prefs,
    hospitalityHardware: defaultHospitalityHardwarePrefs(prefs.businessType),
  };
}
