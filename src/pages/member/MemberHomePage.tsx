import { useCallback, useEffect, useState } from "react";
import { WakaPosLogo } from "../../components/brand/WakaLogo";
import {
  fetchMemberDashboard,
  type MemberDashboard,
  type MemberLinkedAccount,
} from "../../lib/memberDashboard";
import { LoyaltyCodeEntryForm } from "../../components/loyalty/LoyaltyCodeEntryForm";
import { useMemberEnrollmentStatus } from "../../hooks/useMemberEnrollmentStatus";

/**
 * The authenticated WAKA Loyalty member home.
 *
 * ONE DATA SOURCE. Everything here comes from `fetchMemberDashboard()` — the
 * `loyalty_member_dashboard()` projection. That function takes NO parameters and resolves the member
 * from `auth.uid()` alone, so cross-member access is structurally impossible rather than merely
 * checked, and the browser never reads `loyalty_accounts` or `loyalty_member_links` directly.
 *
 * NOTHING IS INVENTED. The projection returns exactly the accounts the member is linked to, each
 * with its own balance and lifetime figures. That is what is displayed, and nothing else is
 * implied: Activity and Rewards are NOT available to an authenticated member yet (there is no
 * member-scoped read for the points ledger or a shop's reward catalogue), so they are shown as an
 * explicitly labelled "coming next" area rather than being faked or approximated from balances.
 *
 * POINTS ARE PER MERCHANT, NEVER POOLED. Each balance belongs to one shop's account and is
 * redeemable only there. The summary total exists as a convenience and says so; every merchant card
 * repeats its own numbers so the association is never lost.
 *
 * BEARER CREDENTIALS ARE ABSENT BY DESIGN. The projection never returns `public_card_token` or
 * `qr_token` — both are credentials, and the public card token IS the public card URL. This page
 * therefore cannot link to a public card and does not try: it reports only whether one has been
 * issued. The public-card Edge Function is deliberately NOT called from here.
 *
 * PHASE 2C — THIS PAGE NO LONGER CREATES MEMBERS. A signed-in person with no `loyalty_members` row
 * used to be offered a name/phone registration form right here, which produced a WAKA Loyalty
 * identity belonging to no merchant: no programme, no card, no points, and no way to become useful
 * without enrolling somewhere anyway. The merchant's programme is the context that makes a
 * membership mean something, so it is now required FIRST — this page shows the code-entry step and
 * sends the person to `/j/<code>`, where the join actually happens.
 *
 * The same reasoning covers a member whose links are all gone: they are offered the code step, not
 * a registration form. Nothing on this page creates a member.
 */

/** Display names for the canonical business types; unknown values fall back to the raw value. */
const BUSINESS_TYPE_LABELS: Record<string, string> = {
  kiosk_duka: "Kiosk / Duka",
  wholesale: "Wholesale",
  mini_supermarket: "Mini supermarket",
  hardware: "Hardware",
  hospitality: "Hospitality",
  restaurant: "Restaurant",
  bar: "Bar",
  restaurant_bar: "Restaurant & bar",
  hotel: "Hotel",
  salon: "Salon",
  pharmacy: "Pharmacy",
  boutique: "Boutique",
  electronics: "Electronics",
  produce_market: "Produce market",
  mobile_money_agent: "Mobile money agent",
  other: "Shop",
};

/** Thousands-separated, so a five-digit balance still reads at a glance. Matches the card face. */
function formatPoints(points: number): string {
  const n = Math.max(0, Math.trunc(Number(points) || 0));
  return n.toLocaleString("en-US");
}

/** A date the member can act on, or null when the value is absent or unparseable. */
function formatDay(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function businessTypeLabel(raw: string | null | undefined): string | null {
  const value = String(raw ?? "").trim();
  if (!value) return null;
  return BUSINESS_TYPE_LABELS[value] ?? value.replace(/_/g, " ");
}

/** True when an expiry date is in the past. Absent expiry means "no expiry", not "expired". */
function isExpired(iso: string | null | undefined): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return !Number.isNaN(t) && t < Date.now();
}

const POSITIVE_STATUSES = new Set(["active", "enrolled", "approved"]);

function statusTone(status: string): "positive" | "warning" | "muted" {
  if (POSITIVE_STATUSES.has(status.toLowerCase())) return "positive";
  if (status.toLowerCase() === "suspended") return "warning";
  return "muted";
}

function StatusPill({ status, label }: { status: string; label?: string }) {
  const tone = statusTone(status);
  const toneClass =
    tone === "positive"
      ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300"
      : tone === "warning"
        ? "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300"
        : "bg-muted text-muted-foreground";
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-[11px] font-black capitalize ${toneClass}`}
    >
      {label ?? status}
    </span>
  );
}

function StatTile({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-2xl border border-border bg-card px-4 py-3">
      <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
      <p
        className={`mt-1 text-2xl font-black tabular-nums leading-none ${
          accent ? "text-waka-600 dark:text-waka-400" : "text-foreground"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

/** One shop's account. The balance always sits inside the same card as the merchant it belongs to. */
function MerchantCard({ account, prominent }: { account: MemberLinkedAccount; prominent: boolean }) {
  const type = businessTypeLabel(account.shopBusinessType);
  const place = [type, account.shopDistrict].filter(Boolean).join(" · ");
  const expiry = formatDay(account.membershipExpiresAt);
  const enrolled = formatDay(account.enrolledAt);
  const expired = isExpired(account.membershipExpiresAt);

  return (
    <article
      data-testid="member-merchant-card"
      className={`rounded-2xl border border-border p-5 ${
        prominent
          ? "bg-gradient-to-br from-waka-50 to-card dark:from-waka-950/40 dark:to-card"
          : "bg-card"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="break-words text-base font-black leading-snug text-foreground">
            {account.shopName || "WAKA merchant"}
          </p>
          {place ? (
            <p className="mt-0.5 break-words text-xs font-medium text-muted-foreground">{place}</p>
          ) : null}
        </div>
        <StatusPill status={account.accountStatus} />
      </div>

      <div className={prominent ? "mt-5 text-center" : "mt-4"}>
        <p
          className={`font-black tabular-nums leading-none text-foreground ${
            prominent ? "text-5xl" : "text-3xl"
          }`}
        >
          {formatPoints(account.balancePoints)}
        </p>
        <p className="mt-1 text-[11px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
          Points here
        </p>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-2 border-t border-border pt-3 text-xs">
        <div>
          <dt className="font-medium text-muted-foreground">Lifetime earned</dt>
          <dd className="font-bold tabular-nums text-foreground">
            {formatPoints(account.lifetimeEarnedPoints)}
          </dd>
        </div>
        <div>
          <dt className="font-medium text-muted-foreground">Lifetime redeemed</dt>
          <dd className="font-bold tabular-nums text-foreground">
            {formatPoints(account.lifetimeRedeemedPoints)}
          </dd>
        </div>
      </dl>

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-medium text-muted-foreground">
        {expiry ? (
          <span className={expired ? "font-bold text-amber-700 dark:text-amber-400" : undefined}>
            {expired ? "Membership expired" : "Membership expires"} {expiry}
          </span>
        ) : null}
        {enrolled ? <span>Joined {enrolled}</span> : null}
      </div>

      <p className="mt-3 text-[11px] font-bold text-muted-foreground">
        {account.hasPublicCard ? "Digital card ready" : "Digital card not issued yet"}
      </p>
    </article>
  );
}

/**
 * The loaded dashboard. Pure and presentational so it can be rendered directly in tests — the
 * page below owns the fetching, the states and the realtime refresh.
 */
export function MemberDashboardView({ dashboard }: { dashboard: MemberDashboard }) {
  const { member, accounts, counts } = dashboard;

  const activeAccounts = accounts.filter((a) => statusTone(a.accountStatus) === "positive");
  const sum = (pick: (a: MemberLinkedAccount) => number) =>
    activeAccounts.reduce((total, a) => total + (Number(pick(a)) || 0), 0);

  const memberSince = formatDay(member.memberSince);
  const merchantWord = counts.linkedAccounts === 1 ? "merchant" : "merchants";

  return (
    <div className="flex flex-col gap-5" data-testid="member-dashboard">
      {/* Identity — who this account belongs to, and that it is in good standing. */}
      <section
        className="rounded-2xl border border-border bg-card p-5"
        data-testid="member-identity"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
              Member
            </p>
            <p className="mt-1 break-words text-xl font-black leading-tight text-foreground">
              {member.displayName || "WAKA member"}
            </p>
            {member.phoneMasked ? (
              <p className="mt-1 text-sm font-semibold tabular-nums text-muted-foreground">
                {member.phoneMasked}
              </p>
            ) : null}
          </div>
          <StatusPill status={member.status} />
        </div>
        <p className="mt-4 text-[11px] font-medium text-muted-foreground">
          {memberSince ? `Member since ${memberSince}` : "WAKA Loyalty member"}
          {" · "}
          {counts.linkedAccounts} linked {merchantWord}
        </p>
      </section>

      {accounts.length === 0 ? (
        /* A member with nothing linked yet — the same code step as everywhere else, because the
           merchant programme is what makes a membership mean something. */
        <section
          className="rounded-2xl border border-border bg-card p-5"
          data-testid="member-no-merchants"
        >
          <p className="text-base font-black text-foreground">No merchants yet</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Enter a WAKA Loyalty code from a shop to join their programme. Your points and card
            appear here once the shop approves you.
          </p>
          <div className="mt-4">
            <LoyaltyCodeEntryForm />
          </div>
        </section>
      ) : (
        <>
          {/* Summary — a convenience view. Each balance stays separate and is repeated below. */}
          <section className="flex flex-col gap-2" data-testid="member-summary">
            <div className="grid grid-cols-2 gap-2">
              <StatTile label="Total points" value={formatPoints(sum((a) => a.balancePoints))} accent />
              <StatTile label="Merchants" value={String(counts.linkedAccounts)} />
              <StatTile label="Lifetime earned" value={formatPoints(sum((a) => a.lifetimeEarnedPoints))} />
              <StatTile
                label="Lifetime redeemed"
                value={formatPoints(sum((a) => a.lifetimeRedeemedPoints))}
              />
            </div>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Across your active merchants. Points are held by each merchant separately — they are
              never combined into one balance, and they are redeemed where you earned them.
            </p>
          </section>

          <section className="flex flex-col gap-3" data-testid="member-merchants">
            <h2 className="text-sm font-black uppercase tracking-[0.14em] text-muted-foreground">
              {accounts.length === 1 ? "Your loyalty card" : "Your merchants"}
            </h2>
            {accounts.map((account) => (
              <MerchantCard
                key={account.linkId}
                account={account}
                prominent={accounts.length === 1}
              />
            ))}
          </section>

          {/* Not built yet, and said plainly rather than approximated from balances. */}
          <section
            className="rounded-2xl border border-dashed border-border p-4"
            data-testid="member-coming-next"
          >
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
              Coming next
            </p>
            <p className="mt-1 text-sm font-black text-foreground">Activity and rewards</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              Your points history and the rewards you can claim will appear here. For now, ask the
              shop to redeem your points at checkout.
            </p>
          </section>
        </>
      )}
    </div>
  );
}

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

  const isMember = state.kind === "ready";

  /**
   * Phase 2D — the member's own enrollment requests, kept current by Realtime.
   *
   * Only enabled for an actual member: a non-member has no requests, and `/member` is also reached
   * by people who have not joined anything yet.
   */
  const { state: enrollment, refresh: refreshEnrollment } = useMemberEnrollmentStatus(isMember);

  /**
   * An approval creates a `loyalty_member_links` row, and the DASHBOARD is what reports links — not
   * the enrollment status. So when the status turns "approved" this re-reads the authoritative
   * member state and waits for the link to actually appear before showing the dashboard. The
   * realtime event told us something changed; only this read says what is true.
   */
  const hasLinkedAccounts = state.kind === "ready" && state.data.counts.linkedAccounts > 0;
  useEffect(() => {
    if (enrollment.kind !== "approved" || hasLinkedAccounts) return;
    let cancelled = false;
    void refreshEnrollment();
    void load().then((next) => {
      if (!cancelled) setState(next);
    });
    return () => {
      cancelled = true;
    };
  }, [enrollment.kind, hasLinkedAccounts, load, refreshEnrollment]);

  const retry = useCallback(() => {
    setState({ kind: "loading" });
    void load().then(setState);
  }, [load]);

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col gap-6 px-5 py-10">
      <header className="flex flex-col items-center gap-3 text-center">
        <WakaPosLogo size="sm" className="h-10" />
        <h1 className="text-2xl font-black tracking-tight text-foreground">WAKA Loyalty</h1>
        <p className="text-sm font-medium text-muted-foreground">Your member account</p>
      </header>

      {state.kind === "loading" ? (
        /* Skeleton rather than a bare line of text: the shape of the account is already known, so
           the page does not jump when the read lands. */
        <div className="flex flex-col gap-5" data-testid="member-loading" aria-busy="true">
          <div className="rounded-2xl border border-border bg-card p-5">
            <div className="h-3 w-16 rounded-full waka-skeleton-bar" />
            <div className="mt-3 h-6 w-40 rounded-full waka-skeleton-bar" />
            <div className="mt-3 h-4 w-28 rounded-full waka-skeleton-bar" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-[74px] rounded-2xl border border-border bg-card p-4">
                <div className="h-2.5 w-16 rounded-full waka-skeleton-bar" />
                <div className="mt-3 h-6 w-20 rounded-full waka-skeleton-bar" />
              </div>
            ))}
          </div>
          <div className="h-40 rounded-2xl border border-border bg-card" />
          <span className="sr-only">Loading your account…</span>
        </div>
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
        <div className="rounded-2xl border border-border bg-card p-5 text-center" data-testid="member-error">
          <p className="text-sm font-bold text-foreground">We could not load your member account.</p>
          <p className="mt-2 text-xs text-muted-foreground">
            Check your connection and try again. Nothing was changed.
          </p>
          <button
            type="button"
            onClick={retry}
            className="mt-4 inline-flex min-h-[44px] w-full items-center justify-center rounded-xl bg-waka-600 px-5 text-sm font-black text-white active:scale-[0.99]"
          >
            Try again
          </button>
        </div>
      ) : !hasLinkedAccounts && enrollment.kind === "pending" ? (
        /* The member has joined but the merchant has not reviewed them yet. Without this the page
           showed an empty account and the customer reasonably concluded the join had failed. */
        <section
          className="rounded-2xl border border-border bg-card p-5 text-center"
          data-testid="member-enrollment-pending"
        >
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-amber-100">
            <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-amber-600" aria-hidden />
          </div>
          <p className="mt-3 text-base font-black text-foreground">Waiting for merchant approval</p>
          <p className="mt-1 text-sm font-semibold text-foreground">{enrollment.request.shopName}</p>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            Your request has been sent. This updates on its own — you do not need to refresh.
          </p>
          {enrollment.request.requestedAt ? (
            <p className="mt-2 text-[11px] text-muted-foreground">
              Submitted {new Date(enrollment.request.requestedAt).toLocaleString()}
            </p>
          ) : null}
        </section>
      ) : !hasLinkedAccounts && enrollment.kind === "rejected" ? (
        /* The request was not approved. The history is kept server-side; the customer is offered
           the code step again rather than being left at a dead end. */
        <section className="flex flex-col gap-4" data-testid="member-enrollment-rejected">
          <div className="rounded-2xl border border-border bg-card p-5 text-center">
            <p className="text-base font-black text-foreground">Request not approved</p>
            <p className="mt-1 text-sm font-semibold text-foreground">{enrollment.request.shopName}</p>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              That shop did not approve your request. You can try another WAKA Loyalty code.
            </p>
          </div>
          <div className="rounded-2xl border border-border bg-card p-5">
            <LoyaltyCodeEntryForm />
          </div>
        </section>
      ) : (
        <MemberDashboardView dashboard={state.data} />
      )}
    </div>
  );
}

export default MemberHomePage;
