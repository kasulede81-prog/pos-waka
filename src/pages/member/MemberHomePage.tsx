import { useCallback, useEffect, useState } from "react";
import { WakaPosLogo } from "../../components/brand/WakaLogo";
import { fetchMemberDashboard, type MemberDashboard } from "../../lib/memberDashboard";
import { becomeLoyaltyMember, memberRegistrationErrorText } from "../../lib/memberRegistration";

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
        <MemberRegistrationForm
          onRegistered={async () => {
            setState({ kind: "loading" });
            setState(await load());
          }}
        />
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

/**
 * The one action this page offers a session that is not yet a member.
 *
 * Registration is explicit and never automatic: reaching `/member` alone changes nothing, and a
 * merchant or customer who merely has a phone on file does not become a member by existing. The
 * phone is required because Phase 2A links a shop's loyalty account to this identity by matching
 * it, and it is normalised through the shared helper before it ever reaches the RPC.
 */
function MemberRegistrationForm({ onRegistered }: { onRegistered: () => void | Promise<void> }) {
  const [displayName, setDisplayName] = useState("");
  const [phone, setPhone] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    const result = await becomeLoyaltyMember({ displayName, phone });
    if (result.ok) {
      await onRegistered();
      return;
    }
    setError(memberRegistrationErrorText(result.error));
    setSubmitting(false);
  }

  return (
    <section className="rounded-2xl border border-border bg-card p-5">
      <h2 className="text-base font-black text-foreground">Join WAKA Loyalty</h2>
      <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
        Create your Loyalty account to collect points at the shops you already visit and keep your
        cards in one place.
      </p>

      <form className="mt-4 flex flex-col gap-3" onSubmit={submit}>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">
            Your name
          </span>
          <input
            className="waka-input"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="e.g. John Ssemakula"
            autoComplete="name"
            maxLength={120}
            required
            disabled={submitting}
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">
            Phone number
          </span>
          <input
            className="waka-input tabular-nums"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="0772 123 456"
            inputMode="tel"
            autoComplete="tel"
            required
            disabled={submitting}
          />
          <span className="text-[11px] leading-relaxed text-muted-foreground">
            Use the same number you gave at the shop, so your cards can be matched to you.
          </span>
        </label>

        {error ? (
          <p className="rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs font-semibold text-destructive">
            {error}
          </p>
        ) : null}

        <button type="submit" disabled={submitting} className="waka-btn-primary mt-1 w-full">
          {submitting ? "Creating your account…" : "Join WAKA Loyalty"}
        </button>
      </form>

      <p className="mt-3 text-center text-[11px] leading-relaxed text-muted-foreground">
        This creates a Loyalty membership only. It does not create a shop or a business account.
      </p>
    </section>
  );
}

export default MemberHomePage;
