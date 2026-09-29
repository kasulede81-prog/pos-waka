import { useCallback, useEffect, useState } from "react";
import { WakaPosLogo } from "../../components/brand/WakaLogo";
import { fetchMemberDashboard, type MemberDashboard } from "../../lib/memberDashboard";
import { LoyaltyCodeEntryForm } from "../../components/loyalty/LoyaltyCodeEntryForm";

/**
 * Phase 1 placeholder — identity and status ONLY.
 *
 * The Member Dashboard is Phase 2 by explicit scope. This page exists to prove that `/member/*`
 * routes, that the member gate keeps a member out of the merchant bootstrap, and that the
 * projection is reachable and correctly scoped. It deliberately renders NO balances, NO activity
 * and NO rewards: building those now would mean designing the dashboard's information
 * architecture before it has been reviewed, and the projection already returns them for Phase 2.
 *
 * When it says "N linked accounts", that is a scoping check, not a balance display.
 *
 * PHASE 2C — THIS PAGE NO LONGER CREATES MEMBERS. A signed-in person with no `loyalty_members` row
 * used to be offered a name/phone registration form right here, which produced a WAKA Loyalty
 * identity belonging to no merchant: no programme, no card, no points, and no way to become
 * useful without enrolling somewhere anyway. The merchant's programme is the context that makes a
 * membership mean something, so it is now required FIRST — this page shows the code-entry step and
 * sends the person to `/j/<code>`, where the join actually happens.
 *
 * Existing members are unaffected: they reach the dashboard exactly as before, and are never asked
 * to register again.
 */
export function MemberHomePage() {
  const [state, setState] = useState<
    { kind: "loading" } | { kind: "ready"; data: MemberDashboard } | { kind: "error"; error: string }
  >({ kind: "loading" });

  const load = useCallback(async () => {
    const r = await fetchMemberDashboard();
    return r.ok ? ({ kind: "ready", data: r.data } as const) : ({ kind: "error", error: r.error } as const);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void load().then((next) => {
      if (!cancelled) setState(next);
    });
    return () => {
      cancelled = true;
    };
  }, [load]);

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col gap-6 px-5 py-10">
      <header className="flex flex-col items-center gap-3 text-center">
        <WakaPosLogo size="sm" className="h-10" />
        <h1 className="text-2xl font-black tracking-tight text-foreground">WAKA Loyalty</h1>
        <p className="text-sm font-medium text-muted-foreground">Your member account</p>
      </header>

      {state.kind === "loading" ? (
        <p className="text-center text-sm text-muted-foreground">Loading your account…</p>
      ) : state.kind === "error" && state.error === "not_a_member" ? (
        /* Not a member yet. Deliberately NOT a registration form — see the note at the top of the
           file. Nothing here creates a `loyalty_members` row; the code leads to the join, and the
           join is the only place a member is created. */
        <section className="rounded-2xl border border-border bg-card p-5" data-testid="member-not-a-member">
          <LoyaltyCodeEntryForm
            title="Join WAKA Loyalty"
            subtitle="Enter a merchant's Loyalty code to get started."
          />
        </section>
      ) : state.kind === "error" ? (
        <div className="rounded-2xl border border-border bg-card p-5 text-center">
          <p className="text-sm font-bold text-foreground">We could not load your member account.</p>
          <p className="mt-2 text-xs text-muted-foreground">Nothing was changed.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <section className="rounded-2xl border border-border bg-card p-5">
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
              Member
            </p>
            <p className="mt-1 text-lg font-black text-foreground">
              {state.data.member.displayName || "—"}
            </p>
            <dl className="mt-3 flex flex-col gap-1 text-sm">
              {state.data.member.phoneMasked ? (
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Phone</dt>
                  <dd className="font-semibold tabular-nums text-foreground">
                    {state.data.member.phoneMasked}
                  </dd>
                </div>
              ) : null}
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Status</dt>
                <dd className="font-semibold capitalize text-foreground">{state.data.member.status}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Linked accounts</dt>
                <dd className="font-semibold tabular-nums text-foreground">
                  {state.data.counts.linkedAccounts}
                </dd>
              </div>
            </dl>
          </section>

          <p className="text-center text-xs leading-relaxed text-muted-foreground">
            Your Loyalty dashboard — balances, activity and rewards — arrives in the next phase.
          </p>
        </div>
      )}
    </div>
  );
}

export default MemberHomePage;
