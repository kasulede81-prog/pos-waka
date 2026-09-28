import { useEffect, useState } from "react";
import { WakaPosLogo } from "../../components/brand/WakaLogo";
import { fetchMemberDashboard, type MemberDashboard } from "../../lib/memberDashboard";

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
 */
export function MemberHomePage() {
  const [state, setState] = useState<
    { kind: "loading" } | { kind: "ready"; data: MemberDashboard } | { kind: "error"; error: string }
  >({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    void fetchMemberDashboard().then((r) => {
      if (cancelled) return;
      setState(r.ok ? { kind: "ready", data: r.data } : { kind: "error", error: r.error });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col gap-6 px-5 py-10">
      <header className="flex flex-col items-center gap-3 text-center">
        <WakaPosLogo size="sm" className="h-10" />
        <h1 className="text-2xl font-black tracking-tight text-foreground">WAKA Loyalty</h1>
        <p className="text-sm font-medium text-muted-foreground">Your member account</p>
      </header>

      {state.kind === "loading" ? (
        <p className="text-center text-sm text-muted-foreground">Loading your account…</p>
      ) : state.kind === "error" ? (
        <div className="rounded-2xl border border-border bg-card p-5 text-center">
          <p className="text-sm font-bold text-foreground">
            {state.error === "not_a_member"
              ? "This account is not a WAKA Loyalty member yet."
              : "We could not load your member account."}
          </p>
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
