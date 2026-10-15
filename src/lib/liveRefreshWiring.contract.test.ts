import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Contract tests for the shared live-refresh wiring.
 *
 * This repo has no DOM test project (vitest runs `environment: "node"`), so — like the other UI
 * contracts here — the React wiring is pinned by reading the source and asserting it: that there is
 * exactly ONE place the app decides when to re-read, that every surface uses it, and that no
 * surface has quietly kept a second private listener or interval beside it.
 *
 * The scheduling itself is covered behaviourally in `src/lib/foregroundRefresh.test.ts`, and the
 * checkout quote rules in `src/lib/paymentCheckoutPricingRefresh.test.ts`.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (relative: string) => readFileSync(join(ROOT, relative), "utf8");

const hook = read("src/hooks/useForegroundRefresh.ts");
const subscription = read("src/context/SubscriptionContext.tsx");
const pricing = read("src/hooks/usePublicPricing.ts");
const checkout = read("src/components/subscription/CheckoutFlow.tsx");
const deviceLimit = read("src/pages/DeviceLimitReachedPage.tsx");
const accountCenter = read("src/components/subscription/AccountSubscriptionCenter.tsx");
const nudge = read("src/lib/subscriptionRealtimeNudge.ts");
const refreshLib = read("src/lib/foregroundRefresh.ts");
const upgrade = read("src/pages/UpgradePage.tsx");

describe("live refresh — one mechanism, not several", () => {
  it("1. the subscription context no longer registers its own visibility listener", () => {
    // The 1145addd listener lived here. It is now the shared hook's job, and a
    // second one would double every read on Android resume.
    expect(subscription).not.toContain('document.addEventListener("visibilitychange"');
    expect(subscription).toContain("useForegroundRefresh(");
  });

  it("2. the pricing hook uses the shared mechanism too", () => {
    expect(pricing).toContain("useForegroundRefresh(");
    expect(pricing).not.toContain("setInterval(");
    expect(pricing).not.toContain('document.addEventListener("visibilitychange"');
  });

  it("3. the shared hook is the only place that listens for visibility or native resume", () => {
    expect(hook).toContain('document.addEventListener("visibilitychange"');
    expect(hook).toContain('App.addListener("appStateChange"');
    expect(hook).toContain("Capacitor.isNativePlatform()");
  });

  it("4. every listener and timer the hook owns is torn down on unmount", () => {
    expect(hook).toContain('document.removeEventListener("visibilitychange"');
    expect(hook).toContain("removeNative?.()");
    expect(hook).toContain("refresher.stop()");
  });

  it("5. a surface that has nothing remote to refresh does not poll", () => {
    // Signed out, or offline-only mode: there is no plan and no price book to read.
    expect(subscription).toContain('enabled: authMode === "supabase" && Boolean(user?.id)');
    expect(pricing).toContain("enabled: options?.enabled");
  });

  it("6. the plan-name surface that fetched once now follows the same signal", () => {
    expect(deviceLimit).toContain("useForegroundRefresh(");
    expect(deviceLimit).toContain("loadContext({ silent: true })");
  });
});

describe("live refresh — ordering guards", () => {
  it("7. every subscription write is gated on still being the newest read", () => {
    // The guard used to sit on the shop-change reload alone while the mount and
    // same-tab paths went through an unguarded `load`.
    expect(subscription).toContain("const seq = ++requestSeqRef.current;");
    expect(subscription).toContain("if (seq !== requestSeqRef.current) return;");
    expect(subscription).not.toContain("const reload = useCallback");
  });

  it("8. pricing writes are gated the same way, and a superseded read is dropped", () => {
    expect(pricing).toContain("const seq = ++seqRef.current;");
    expect(pricing).toContain("if (!mountedRef.current || seq !== seqRef.current) return;");
  });

  it("9. a checkout quote request is gated on being the newest request", () => {
    expect(checkout).toContain("const seq = ++quoteSeqRef.current;");
    expect(checkout).toContain("if (!live || seq !== quoteSeqRef.current) return;");
  });

  it("10. the subscription history cannot show one shop's rows under another's name", () => {
    expect(accountCenter).toContain("const seq = ++historySeqRef.current;");
    expect(accountCenter).toContain("if (seq !== historySeqRef.current) return;");
  });
});

describe("live refresh — a failure never fabricates data", () => {
  it("11. pricing never falls back to the default catalogue on a failed refresh", () => {
    // `fetchPublicSubscriptionPricing` answers every failure with the hardcoded
    // default book; using it behind a 60s poll would repaint real prices as
    // defaults on one blip.
    expect(pricing).toContain("fetchPublicSubscriptionPricingResult");
    expect(pricing).not.toContain("fetchPublicSubscriptionPricing(");
    expect(pricing).toContain("// Keep the last valid price book. Never fall back to the default catalogue.");
  });

  it("12. the pricing fetch reports failure instead of substituting defaults", () => {
    const admin = read("src/lib/pricingCampaignsAdmin.ts");
    const result = admin.slice(admin.indexOf("export async function fetchPublicSubscriptionPricingResult"));
    expect(result).toContain("return { ok: false, error: error.message };");
    expect(result).not.toContain("buildDefaultPublicPricing");
  });

  it("13. a failed subscription read stays `unavailable` and never becomes Free", () => {
    expect(subscription).toContain('setSnapshot({ kind: "unavailable" });');
    expect(subscription).toContain("failuresRef.current.report(error);");
  });

  it("14. refresh failures are recorded, on transition rather than once a tick", () => {
    expect(subscription).toContain('createRefreshFailureReporter("subscription")');
    expect(pricing).toContain('createRefreshFailureReporter("public_pricing")');
    const diagnostics = read("src/lib/liveRefreshDiagnostics.ts");
    expect(diagnostics).toContain("if (reason === lastReason) return;");
    expect(diagnostics).toContain("reportSwallowedSyncFailure(");
  });
});

/**
 * A Realtime event is a doorbell, not a value. These pin the two halves of that: the nudge
 * has no way to write a plan, and its signal is handed to the shared scheduler rather than
 * becoming a way to read on its own.
 */
describe("live refresh — realtime only ever asks for a re-read", () => {
  it("18. the nudge module has no write path and never sees the row", () => {
    const src = nudge.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    expect(src).not.toMatch(/\.insert\(|\.update\(|\.delete\(|\.upsert\(|rpc\(|setSnapshot/);
    // The changed row must not reach a caller who could apply it as the truth.
    expect(src).not.toMatch(/payload\.(new|old)|payload\?\.(new|old)/);
    expect(src).toContain('event: "*"');
    // RLS is the boundary; a filter would imply the client narrows the audience itself.
    expect(src).not.toContain("filter:");
    expect(src).toContain('if (status === "SUBSCRIBED") onSignal("subscribed")');
  });

  it("19. the nudge's signal lands on the shared scheduler, not a private read", () => {
    expect(subscription).toContain("startSubscriptionPlanNudge(");
    expect(subscription).toContain("() => poke()");
    // Still exactly one writer, still sequence-guarded.
    expect(subscription).toContain("const seq = ++requestSeqRef.current;");
    expect(subscription).toContain("if (seq !== requestSeqRef.current) return;");
  });

  it("20. the nudge is created by an effect that returns its own teardown", () => {
    // The React cleanup IS the lifecycle. A module-level singleton would make correctness
    // depend on the order React destroys one provider tree and creates the next, and
    // SubscriptionProvider is mounted from more than one place.
    expect(subscription).toMatch(/return startSubscriptionPlanNudge\(/);
    expect(subscription).toMatch(/if \(authMode !== "supabase" \|\| !user\?\.id\) return;/);
    expect(nudge).toMatch(/return \(\) => \{[\s\S]*?removeChannel\(/);
  });

  it("21. a poke can never wake a hidden surface or arm the tick", () => {
    expect(refreshLib).toContain("poke: () => void");
    expect(refreshLib).toContain("if (stopped || !visible) return;");
    // One timer shared with resume(): an Android resume and an event in the same
    // window must be one read, not two.
    expect(refreshLib).toContain("scheduleRun()");
    expect(refreshLib).not.toContain("const poke = (): void => {\n    resume()");
  });

  it("22. a confirmed checkout re-reads the plan without re-broadcasting the admin signal", () => {
    expect(checkout).toContain("useSubscription()");
    expect(checkout).toMatch(/if \(state\.phase !== "confirmed"\) return;[\s\S]{0,160}?refetchSubscription\(\)/);
    // `waka:subscription-updated` is the same-tab ADMIN mirror; a customer paying is
    // not an admin acting, and its listeners include the internal ops hook.
    expect(checkout).not.toContain('dispatchEvent(new Event("waka:subscription-updated")');
  });
});

describe("live refresh — nothing is displayed that the records do not say", () => {
  it("23. the plan card does not show an invented renewal date", () => {
    // Two tiles rendered the same `effective.expiresAt`, one of them labelled
    // "Renewal date" — but nothing renews automatically and no renewal date is
    // recorded anywhere. The duplicate is gone; if it returns, so does the claim.
    expect(accountCenter).not.toContain('t(lang, "billingRenewalDate")');
    expect(accountCenter).toContain('t(lang, "billingSubscriptionEnds")');
  });

  it("24. a cancellation date is only ever read through the guarded resolver", () => {
    expect(accountCenter).toContain("resolveSubscriptionCancelledAt(");
    // Reaching into metadata directly would skip the "only while still cancelled"
    // guard, which is what stops a pause stamp being shown as a cancellation date.
    expect(accountCenter).not.toContain("status_set_at");
  });

  it("25. fixing the upgrade page's display did not widen checkout eligibility", () => {
    // `hasFuturePeriodEnd` is handed to CheckoutFlow. It must keep deriving from the
    // status-gated countdown, NOT from the display-only value added beside it.
    expect(upgrade).toContain("hasFuturePeriodEnd={Boolean(renewalCountdown)}");
    expect(upgrade).not.toContain("hasFuturePeriodEnd={Boolean(lapsedAccessDays)}");
  });
});

describe("live refresh — the checkout cannot pay a stale price", () => {
  it("15. a pricing change invalidates the held quote", () => {
    expect(checkout).toContain('dispatch({ type: "PRICING_CHANGED" });');
    expect(checkout).toContain("quotePricingSignature({");
  });

  it("16. the invalidation does not fire before the price book is known", () => {
    // Arming on the first real signature would discard a valid quote at mount.
    expect(checkout).toContain("if (pricingLoading) return;");
    expect(checkout).toContain("if (previous === null || previous === pricingSignature) return;");
  });

  it("17. the pay button is unavailable whenever there is no current quote", () => {
    expect(checkout).toContain("disabled={busy || pending || !state.quote || state.quoteLoading}");
  });
});
