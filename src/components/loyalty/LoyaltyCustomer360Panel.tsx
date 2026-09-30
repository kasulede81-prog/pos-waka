import { useCallback, useEffect, useState } from "react";
import { t } from "../../lib/i18n";
import type { Language } from "../../types";
import {
  fetchCustomer360,
  searchShopCustomers,
  type Customer360,
  type ShopCustomerSummary,
} from "../../lib/loyalty/loyaltyCustomer360";
import { reverseLoyaltyRedemption } from "../../lib/loyalty/loyaltyRewards";

/**
 * Customer 360 — the merchant's view of one customer's relationship with THEIR shop.
 *
 * Merchant-side by construction: it is rendered inside the Loyalty hub for staff who can
 * already see this shop's customers, and the server refuses anyone else. It shows only
 * this shop's data — the points, spend, rewards and redemptions of THIS relationship —
 * and never another merchant's, even for a customer who also shops elsewhere.
 *
 * SPENDING IS SHOWN AS THREE NUMBERS, NOT ONE. Gross, refunds and net are all displayed
 * because a returned sale keeps `status='completed'`: a merchant shown only a net figure
 * cannot reconcile it against the refunds they issued, and a merchant shown only gross
 * would be looking at money the customer got back.
 *
 * The average is labelled as a derived statistic. Nothing here is called profit or
 * margin, and no cashback figure is shown — that has no authoritative source yet.
 */

function formatUgx(amount: number): string {
  return `UGX ${Math.round(amount).toLocaleString("en-US")}`;
}

function formatPoints(points: number): string {
  const n = Math.max(0, Math.trunc(Number(points) || 0));
  return n.toLocaleString("en-US");
}

function formatDay(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

const REWARD_STATE_LABEL: Record<string, string> = {
  available: "Ready to redeem",
  insufficient_points: "Not enough points",
  limit_reached: "Limit reached",
  expired: "Expired",
  inactive: "Withdrawn",
};

function StatTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card px-3 py-2">
      <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-base font-black tabular-nums text-foreground">{value}</p>
      {hint ? <p className="mt-0.5 text-[10px] font-medium text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function LoyaltyCustomer360Panel({
  lang,
  shopId,
  customerId,
  canReverse = false,
}: {
  lang: Language;
  shopId: string;
  customerId: string;
  /** Phase D reversal is offered to staff who may already redeem; the server still decides. */
  canReverse?: boolean;
}) {
  const [state, setState] = useState<
    { kind: "loading" } | { kind: "ready"; data: Customer360 } | { kind: "error"; error: string }
  >({ kind: "loading" });

  const load = useCallback(async () => {
    const r = await fetchCustomer360(shopId, customerId);
    return r.ok ? ({ kind: "ready", data: r.data } as const) : ({ kind: "error", error: r.error } as const);
  }, [shopId, customerId]);

  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    void load().then((next) => {
      if (!cancelled) setState(next);
    });
    return () => {
      cancelled = true;
    };
  }, [load]);

  if (state.kind === "loading") {
    return (
      <div className="mt-3 rounded-xl border border-border bg-muted/30 p-3" data-testid="customer-360-loading" aria-busy="true">
        <div className="h-3 w-28 rounded-full waka-skeleton-bar" />
        <div className="mt-3 grid grid-cols-2 gap-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-12 rounded-xl waka-skeleton-bar" />
          ))}
        </div>
      </div>
    );
  }

  if (state.kind === "error") {
    const message =
      state.error === "forbidden"
        ? t(lang, "loyaltyCustomer360Forbidden")
        : state.error === "not_found"
          ? t(lang, "loyaltyCustomer360NotFound")
          : t(lang, "loyaltyCustomer360Error");
    return (
      <div className="mt-3 rounded-xl border border-border bg-card p-3" data-testid="customer-360-error">
        <p className="text-xs font-semibold text-muted-foreground">{message}</p>
        <button
          type="button"
          onClick={() => void load().then(setState)}
          className="mt-2 min-h-[36px] rounded-xl border border-border px-3 text-xs font-black text-foreground"
        >
          {t(lang, "loyaltyCustomer360Retry")}
        </button>
      </div>
    );
  }

  return (
    <LoyaltyCustomer360View
      lang={lang}
      data={state.data}
      canReverse={canReverse}
      onReverse={async (redemptionId) => {
        const r = await reverseLoyaltyRedemption(shopId, redemptionId);
        if (r.ok) {
          // Re-read: the authority on what happened is the server, not this click.
          void load().then(setState);
        }
      }}
    />
  );
}

/**
 * The loaded profile. Pure and presentational, so the profile, spending, reward and
 * activity rendering can be asserted directly rather than through a fetch.
 */
export function LoyaltyCustomer360View({
  lang,
  data,
  canReverse = false,
  onReverse,
}: {
  lang: Language;
  data: Customer360;
  /** Phase D reversal is offered to staff who may already redeem. */
  canReverse?: boolean;
  onReverse?: (redemptionId: string) => void;
}) {
  const [reversingId, setReversingId] = useState<string | null>(null);
  const { customer, loyalty, spending, rewards, recentPurchases, recentLoyaltyActivity, recentRedemptions } = data;
  const available = rewards.items.filter((r) => r.state === "available");
  const personal = rewards.items.filter((r) => r.personal);

  return (
    <section className="mt-3 flex flex-col gap-3" data-testid="customer-360">
      {/* ------------------------------------------------------------ spending */}
      <div>
        <p className="text-[11px] font-black uppercase tracking-[0.14em] text-muted-foreground">
          {t(lang, "loyaltyCustomer360Spending")}
        </p>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <StatTile label={t(lang, "loyaltyCustomer360NetSpend")} value={formatUgx(spending.netSpendUgx)} />
          <StatTile
            label={t(lang, "loyaltyCustomer360Purchases")}
            value={String(spending.completedPurchases)}
            hint={
              spending.voidedPurchases > 0
                ? `${spending.voidedPurchases} ${t(lang, "loyaltyCustomer360Voided")}`
                : undefined
            }
          />
          <StatTile
            label={t(lang, "loyaltyCustomer360Average")}
            value={spending.averagePurchaseUgx == null ? "—" : formatUgx(spending.averagePurchaseUgx)}
            hint={t(lang, "loyaltyCustomer360Derived")}
          />
          <StatTile
            label={t(lang, "loyaltyCustomer360LastPurchase")}
            value={formatDay(spending.lastPurchaseAt) ?? "—"}
          />
        </div>
        {spending.returnedUgx > 0 ? (
          <p className="mt-2 text-[11px] font-medium text-muted-foreground">
            {formatUgx(spending.grossSpendUgx)} {t(lang, "loyaltyCustomer360Gross")} ·{" "}
            {formatUgx(spending.returnedUgx)} {t(lang, "loyaltyCustomer360Refunded")}
          </p>
        ) : null}
      </div>

      {/* ------------------------------------------------------------ loyalty */}
      <div>
        <p className="text-[11px] font-black uppercase tracking-[0.14em] text-muted-foreground">
          {t(lang, "loyaltyCustomer360Loyalty")}
        </p>
        {loyalty ? (
          <>
            <div className="mt-2 grid grid-cols-3 gap-2">
              <StatTile label={t(lang, "loyaltyCustomer360Points")} value={formatPoints(loyalty.balancePoints)} />
              <StatTile label={t(lang, "loyaltyCustomer360Earned")} value={formatPoints(loyalty.lifetimeEarnedPoints)} />
              <StatTile
                label={t(lang, "loyaltyCustomer360Redeemed")}
                value={formatPoints(loyalty.lifetimeRedeemedPoints)}
              />
            </div>
            <p className="mt-2 text-[11px] font-medium text-muted-foreground">
              {formatDay(loyalty.memberSince)
                ? `${t(lang, "loyaltyCustomer360MemberSince")} ${formatDay(loyalty.memberSince)}`
                : null}
              {loyalty.membershipExpiresAt
                ? ` · ${t(lang, "loyaltyCustomer360Expires")} ${formatDay(loyalty.membershipExpiresAt)}`
                : ""}
            </p>
          </>
        ) : (
          <p className="mt-2 text-xs font-medium text-muted-foreground" data-testid="customer-360-no-loyalty">
            {t(lang, "loyaltyCustomer360NoLoyalty")}
          </p>
        )}
      </div>

      {/* ------------------------------------------------------------ rewards */}
      <div>
        <p className="text-[11px] font-black uppercase tracking-[0.14em] text-muted-foreground">
          {t(lang, "loyaltyCustomer360Rewards")}
        </p>
        {rewards.items.length === 0 ? (
          <p className="mt-2 text-xs font-medium text-muted-foreground" data-testid="customer-360-no-rewards">
            {t(lang, "loyaltyCustomer360NoRewards")}
          </p>
        ) : (
          <>
            <p className="mt-1 text-[11px] font-medium text-muted-foreground">
              {available.length} {t(lang, "loyaltyCustomer360ReadyNow")}
              {personal.length > 0 ? ` · ${personal.length} ${t(lang, "loyaltyCustomer360Personal")}` : ""}
              {rewards.redemptionCount > 0
                ? ` · ${rewards.redemptionCount} ${t(lang, "loyaltyCustomer360Redemptions")} (${formatPoints(
                    rewards.pointsRedeemed,
                  )} pts)`
                : ""}
            </p>
            <ul className="mt-2 divide-y divide-border">
              {rewards.items.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-2 py-1.5">
                  <span className="min-w-0 truncate text-xs font-semibold text-foreground">
                    {r.name}
                    {r.personal ? (
                      <span className="ml-1.5 rounded-full bg-waka-100 px-1.5 py-0.5 text-[10px] font-black text-waka-800">
                        {t(lang, "loyaltyCustomer360Personal")}
                      </span>
                    ) : null}
                  </span>
                  <span className="shrink-0 text-[11px] font-bold text-muted-foreground">
                    {formatPoints(r.pointsRequired)} pts · {REWARD_STATE_LABEL[r.state] ?? r.state}
                    {r.timesRedeemed > 0 ? ` · ${r.timesRedeemed}×` : ""}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      {/* ------------------------------------------------------------ activity */}
      <div>
        <p className="text-[11px] font-black uppercase tracking-[0.14em] text-muted-foreground">
          {t(lang, "loyaltyCustomer360Activity")}
        </p>
        {recentPurchases.length === 0 && recentLoyaltyActivity.length === 0 && recentRedemptions.length === 0 ? (
          <p className="mt-2 text-xs font-medium text-muted-foreground" data-testid="customer-360-no-activity">
            {t(lang, "loyaltyCustomer360NoActivity")}
          </p>
        ) : (
          <ul className="mt-2 divide-y divide-border">
            {recentRedemptions.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                <span className="min-w-0 truncate text-xs font-semibold text-foreground">
                  {t(lang, "loyaltyCustomer360RedeemedReward")} {d.rewardName}
                  {d.status === "void" ? (
                    <span className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-black text-muted-foreground">
                      {t(lang, "loyaltyCustomer360RedemptionReversed")}
                    </span>
                  ) : null}
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <span className="text-[11px] font-bold tabular-nums text-muted-foreground">
                    −{formatPoints(d.pointsSpent)} pts · {formatDay(d.redeemedAt) ?? ""}
                  </span>
                  {/* Phase D's reversal, now reachable. Only an un-reversed redemption can be
                      reversed, and the SERVER refuses everything else — this button asks, it
                      does not decide. The points go back through the ledger. */}
                  {canReverse && d.status === "completed" ? (
                    reversingId === d.id ? (
                      <span className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => void onReverse?.(d.id)}
                          data-testid={`customer-360-reverse-confirm-${d.id}`}
                          className="min-h-[28px] rounded-md bg-danger px-2 text-[10px] font-black text-white"
                        >
                          {t(lang, "loyaltyCustomer360ReverseConfirm")}
                        </button>
                        <button
                          type="button"
                          onClick={() => setReversingId(null)}
                          className="min-h-[28px] rounded-md border border-border px-2 text-[10px] font-black text-foreground"
                        >
                          {t(lang, "cancel")}
                        </button>
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setReversingId(d.id)}
                        data-testid={`customer-360-reverse-${d.id}`}
                        className="min-h-[28px] rounded-md border border-border px-2 text-[10px] font-black text-muted-foreground"
                      >
                        {t(lang, "loyaltyCustomer360ReverseAction")}
                      </button>
                    )
                  ) : null}
                </span>
              </li>
            ))}
            {recentPurchases.map((p, i) => (
              <li key={`p${i}`} className="flex items-center justify-between gap-2 py-1.5">
                <span className="text-xs font-semibold text-foreground">
                  {t(lang, "loyaltyCustomer360Purchase")}
                </span>
                <span className="shrink-0 text-[11px] font-bold text-muted-foreground">
                  {formatUgx(p.totalUgx)}
                  {p.returnedUgx > 0 ? ` (−${formatUgx(p.returnedUgx)})` : ""} ·{" "}
                  {formatDay(p.completedAt) ?? ""}
                </span>
              </li>
            ))}
            {recentLoyaltyActivity.map((a, i) => (
              <li key={`a${i}`} className="flex items-center justify-between gap-2 py-1.5">
                <span className="text-xs font-semibold text-foreground">{a.cause || a.kind}</span>
                <span className="shrink-0 text-[11px] font-bold tabular-nums text-muted-foreground">
                  {a.points > 0 ? "+" : ""}
                  {formatPoints(a.points)} pts · {formatDay(a.createdAt) ?? ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="text-[10px] font-medium text-muted-foreground">
        {customer.name}
        {customer.phoneE164 ? ` · ${customer.phoneE164}` : ""}
        {customer.customerSince ? ` · ${t(lang, "loyaltyCustomer360CustomerSince")} ${formatDay(customer.customerSince)}` : ""}
      </p>
    </section>
  );
}

/**
 * Look up ANY of this shop's customers — including one with purchases and no loyalty card,
 * which the loyalty member search cannot find. The results open the same Customer 360,
 * so there is one profile view rather than two.
 */
export function LoyaltyCustomerLookup({ lang, shopId }: { lang: Language; shopId: string }) {
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<ShopCustomerSummary[] | null>(null);
  const [open, setOpen] = useState<ShopCustomerSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async () => {
    setBusy(true);
    setError(null);
    const r = await searchShopCustomers(shopId, query);
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      setResults([]);
      return;
    }
    setResults(r.customers);
  }, [shopId, query]);

  return (
    <div className="flex flex-col gap-3" data-testid="customer-lookup">
      <div className="flex gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t(lang, "loyaltyCustomer360LookupPlaceholder")}
          data-testid="customer-lookup-input"
          className="min-h-[44px] flex-1 rounded-xl border-2 border-border bg-card px-3 text-sm font-semibold"
        />
        <button
          type="button"
          onClick={() => void run()}
          disabled={busy}
          data-testid="customer-lookup-submit"
          className="min-h-[44px] rounded-xl bg-waka-600 px-4 text-xs font-black text-white disabled:opacity-60"
        >
          {t(lang, "loyaltyCustomer360Search")}
        </button>
      </div>

      {error ? (
        <p className="text-xs font-semibold text-destructive" data-testid="customer-lookup-error">
          {t(lang, "loyaltyCustomer360Error")}
        </p>
      ) : null}

      {results && results.length === 0 && !error ? (
        <p className="text-xs font-medium text-muted-foreground" data-testid="customer-lookup-empty">
          {t(lang, "loyaltyCustomer360LookupEmpty")}
        </p>
      ) : null}

      {results && results.length > 0 ? (
        <ul className="divide-y divide-border" data-testid="customer-lookup-results">
          {results.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => setOpen(open?.id === c.id ? null : c)}
                className="flex w-full items-center justify-between gap-2 py-2 text-left"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-bold text-foreground">{c.name}</span>
                  <span className="block text-[11px] font-medium text-muted-foreground">
                    {c.phoneE164 ?? "—"}
                    {c.hasLoyaltyAccount
                      ? ` · ${formatPoints(c.balancePoints ?? 0)} pts`
                      : ` · ${t(lang, "loyaltyCustomer360NoCard")}`}
                  </span>
                </span>
              </button>
              {open?.id === c.id ? <LoyaltyCustomer360Panel lang={lang} shopId={shopId} customerId={c.id} /> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
