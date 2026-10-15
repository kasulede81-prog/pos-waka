/**
 * "SOMETHING ABOUT YOUR PLAN CHANGED" — and nothing more than that.
 *
 * THE GAP THIS CLOSES. A plan is changed on one device and read on another: an admin
 * grants, renews, pauses or cancels in the shop console, or the lifecycle job expires a
 * row. Nothing pushed that to the shop's terminal, so the only thing that ever noticed was
 * the shared 60s tick — and a POS terminal sits in the foreground on one screen for a whole
 * shift, so a minute of showing a plan the database has stopped agreeing with was normal.
 *
 * REALTIME IS A DOORBELL, NOT A MESSENGER. Read the signature: the callback receives a
 * reason STRING, never the row. The payload is discarded here, on purpose and structurally
 * — if the changed row never reaches the caller, it cannot be mistaken for the truth, and
 * no caller can be tempted to apply it to the UI. The listener re-reads the authoritative
 * state through the exact same path it already used, so a Realtime event can never
 * activate a plan, extend access, or stand in for a payment settling. A forged or replayed
 * event buys an extra read and nothing else.
 *
 * RLS IS THE BOUNDARY, so there is no `filter`. Realtime authorises `postgres_changes` with
 * the subscriber's own JWT against the table's SELECT policy, so a client can only ever be
 * told about rows it could already have selected. Filtering by shop would add nothing and
 * would require REPLICA IDENTITY FULL to match on a non-primary-key column.
 *
 * WHO IS *NOT* COVERED, and it is deliberate. `subscriptions_select` is
 * `user_has_org_role(...)`, which reads `organization_members`; an invited cashier holds
 * only `shop_members` and so receives no `subscriptions` events at all. Those terminals
 * keep converging on the 60s tick — slower, not wrong. Widening that policy is a separate
 * decision (and would expose the raw row, not the RPC's curated projection), so it is not
 * done here. The `promotional_grants` channel does reach them, since that policy is
 * `shop_members`-based.
 *
 * RATE. Signals arrive for every row change and on every SUBSCRIBED, and a bulk update
 * emits one per row. None of that is throttled here, because it does not need to be: the
 * scheduler this feeds keeps at most one read in flight and replays at most one more, so
 * event volume cannot become read volume.
 */

import type { RealtimeChannel } from "@supabase/supabase-js";
import { hasSupabaseConfig, supabase } from "./supabase";

/** Why the nudge fired. Only ever a label — never data, never a plan. */
export type SubscriptionNudgeReason = "realtime" | "subscribed";

/**
 * A topic unique to this start, matching the Support Center's convention.
 *
 * It MUST be unique per start, and `Date.now()`/`Math.random()` is preferred over
 * `crypto.randomUUID()` here because that needs a secure context. supabase-js keys
 * channels by topic and `channel()` HANDS BACK AN EXISTING ONE with the same topic —
 * while `removeChannel()` is still awaiting its network unsubscribe. On a fast
 * stop/start (a sign-out then sign-in, which changes `user.id` and re-runs the effect)
 * a fixed topic would return the dying channel, and handlers registered on it would be
 * silently dead or doubled.
 */
function instanceId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Begin nudging on subscription-plan changes. Returns the teardown, which the caller MUST
 * run on unmount — the React effect's cleanup is the lifecycle here rather than a
 * module-level singleton, because `SubscriptionProvider` is mounted from more than one
 * place and a shared singleton would make correctness depend on the order React happens to
 * destroy one tree and create the next.
 */
export function startSubscriptionPlanNudge(
  onSignal: (reason: SubscriptionNudgeReason) => void,
): () => void {
  if (!hasSupabaseConfig || !supabase) return () => {};

  let channel: RealtimeChannel | null = null;

  const stop = (): void => {
    try {
      if (channel && supabase) void supabase.removeChannel(channel);
    } catch {
      /* socket already gone */
    }
    channel = null;
  };

  try {
    /**
     * Captured BEFORE the chain is built, and that ordering is the point. `channel` is
     * already live on the client's list the moment `channel()` returns, so if `.on()` or
     * `.subscribe()` then throws, a `channel = <whole chain>` assignment would never run
     * and the catch below would have nothing to hand back — leaving the channel stranded
     * on the client forever.
     */
    const created = supabase.channel(`waka-subscription-plan-${instanceId()}`);
    channel = created;

    created
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "subscriptions" },
        // No payload parameter: we deliberately do not take the row.
        () => onSignal("realtime"),
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "promotional_grants" }, () =>
        onSignal("realtime"),
      )
      .subscribe((status) => {
        // A (re)subscribe means events may have been missed while the socket was down —
        // including a grant that landed between the initial read and the socket opening.
        // Reading once on every transition into SUBSCRIBED closes that window. It costs
        // one extra read at mount; the sequence guard makes the overlap harmless, so do
        // not "optimise" this away.
        if (status === "SUBSCRIBED") onSignal("subscribed");
      });
  } catch {
    stop();
    return () => {};
  }

  return stop;
}
