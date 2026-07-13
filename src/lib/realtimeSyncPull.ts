/**
 * Phase 24.1B — Supabase Realtime nudge for incremental pull.
 * Uses existing shop_activity table (no schema migration).
 */

import type { RealtimeChannel } from "@supabase/supabase-js";
import { hasSupabaseConfig, supabase } from "./supabase";
import { logSync, markRealtimeEventReceived } from "./syncDiagnostics";
import { scheduleImmediatePull, scheduleImmediateStaffPull } from "./immediateSync";
import { markStaffRealtimeEventReceived } from "./staffSyncDiagnostics";

let channel: RealtimeChannel | null = null;
let activeShopId: string | null = null;

export async function startRealtimeSyncPull(): Promise<void> {
  if (!hasSupabaseConfig || !supabase) return;

  const { resolveShopCtx } = await import("../offline/cloudSync");
  const ctx = await resolveShopCtx();
  if (!ctx?.shopId) return;
  if (activeShopId === ctx.shopId && channel) return;

  stopRealtimeSyncPull();
  activeShopId = ctx.shopId;

  channel = supabase
    .channel(`waka-sync-${ctx.shopId}`)
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "shop_activity",
        filter: `shop_id=eq.${ctx.shopId}`,
      },
      () => {
        markRealtimeEventReceived();
        scheduleImmediatePull("realtime", { force: true });
      },
    )
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "shops",
        filter: `id=eq.${ctx.shopId}`,
      },
      () => {
        markStaffRealtimeEventReceived();
        scheduleImmediateStaffPull("staff_realtime");
        scheduleImmediatePull("staff_realtime", { force: true });
      },
    )
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "sync_health",
        filter: `shop_id=eq.${ctx.shopId}`,
      },
      () => {
        logSync("realtime_event", { table: "sync_health" });
        scheduleImmediatePull("realtime", { force: true });
      },
    )
    .subscribe((status) => {
      if (status === "SUBSCRIBED") {
        logSync("realtime_event", { subscribed: true });
      }
    });
}

export function stopRealtimeSyncPull(): void {
  if (channel && supabase) {
    void supabase.removeChannel(channel);
  }
  channel = null;
  activeShopId = null;
}
