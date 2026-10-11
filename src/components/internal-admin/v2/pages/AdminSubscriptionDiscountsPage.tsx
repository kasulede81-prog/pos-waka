import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, RefreshCw, Search, Trash2 } from "lucide-react";
import type { WakaInternalAdminRow } from "../../../../lib/wakaInternalAdmin";
import { fetchInternalOpsSearchShops, type RecentShopRow } from "../../../../lib/wakaInternalAdmin";
import { formatUgx } from "../../../../lib/subscriptionPricing";
import {
  ADMIN_DISCOUNT_PLANS,
  ADMIN_DISCOUNT_PLAN_LABELS,
  MAX_ADMIN_DISCOUNT_PERCENT,
  activateAdminFreePeriod,
  deleteAdminPlanDiscount,
  fetchAdminDiscountOverview,
  hasDiscountErrors,
  localDiscountPreview,
  parseDiscountPercent,
  previewAdminDiscount,
  saveAdminPlanDiscount,
  saveAdminSubscriptionDiscount,
  validateDiscountDraft,
  type AdminDiscountOverview,
  type AdminDiscountPreview,
  type PlanCode,
} from "../../../../lib/adminSubscriptionDiscounts";
import { notifyInternalOpsChanged } from "../../../../lib/internalAdminActionRunner";
import { statusTokens } from "../../../../lib/statusTokens";
import { adminPermissions } from "../adminRoles";

type Props = {
  adminRow: WakaInternalAdminRow | null;
  previewMode?: boolean;
};

const inputCls =
  "w-full rounded-xl border border-border bg-card px-3 py-2.5 text-sm font-semibold text-foreground outline-none focus:border-waka-500 disabled:opacity-60";
const labelCls = "mb-1 block text-[11px] font-black uppercase tracking-wide text-muted-foreground";
const primaryBtnCls =
  "inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-waka-600 px-4 text-sm font-black text-white hover:bg-waka-700 disabled:opacity-60";
const secondaryBtnCls =
  "inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-muted px-3 text-sm font-black text-muted-foreground disabled:opacity-60";
const dangerBtnCls =
  "inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-danger/30 bg-danger-muted px-4 text-sm font-black text-danger disabled:opacity-60";
const cardCls = "rounded-2xl border border-border bg-card p-4 shadow-sm";

/** A cell that renders an em dash rather than an empty gap. */
function Value({ children }: { children: React.ReactNode }) {
  return <span className="font-bold text-foreground">{children ?? "—"}</span>;
}

function Window({ startsAt, expiresAt }: { startsAt: string | null; expiresAt: string | null }) {
  if (!startsAt && !expiresAt) return <Value>—</Value>;
  const fmt = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  return (
    <Value>
      {startsAt ? fmt(startsAt) : "now"} → {expiresAt ? fmt(expiresAt) : "no end"}
    </Value>
  );
}

export function AdminSubscriptionDiscountsPage({ adminRow, previewMode = false }: Props) {
  const perms = adminPermissions(adminRow);
  // Preview mode is never editable.
  // The SERVER gate is now the same four roles (`_pricing_require_billing_admin`,
  // migration 20261011120000), so this refusals-in-the-UI copy is no longer
  // hiding a wider server: support_admin and field_agent are refused by both.
  const canEdit = perms.canManageBillingOffers && !previewMode;

  const [overview, setOverview] = useState<AdminDiscountOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // ---- global form -------------------------------------------------------
  const [globalPlan, setGlobalPlan] = useState<PlanCode>("business");
  const [globalPercent, setGlobalPercent] = useState("0");
  const [globalStartsAt, setGlobalStartsAt] = useState("");
  const [globalExpiresAt, setGlobalExpiresAt] = useState("");
  const [globalActive, setGlobalActive] = useState(true);
  const [globalReason, setGlobalReason] = useState("");
  const [globalErrors, setGlobalErrors] = useState<Record<string, string | undefined>>({});
  const [globalSaving, setGlobalSaving] = useState(false);

  // ---- individual form ---------------------------------------------------
  const [shopQuery, setShopQuery] = useState("");
  const [shopRows, setShopRows] = useState<RecentShopRow[]>([]);
  const [shopSearching, setShopSearching] = useState(false);
  const [shopSearchError, setShopSearchError] = useState<string | null>(null);
  const [selectedShop, setSelectedShop] = useState<RecentShopRow | null>(null);
  const [individualPercent, setIndividualPercent] = useState("0");
  const [individualReason, setIndividualReason] = useState("");
  const [individualStartsAt, setIndividualStartsAt] = useState("");
  const [individualExpiresAt, setIndividualExpiresAt] = useState("");
  const [individualErrors, setIndividualErrors] = useState<Record<string, string | undefined>>({});
  const [individualSaving, setIndividualSaving] = useState(false);
  const shopSeqRef = useRef(0);

  // ---- server preview ----------------------------------------------------
  const [preview, setPreview] = useState<AdminDiscountPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const previewSeqRef = useRef(0);

  // The account preview: the SAME server function with `p_individual: true`, so
  // the admin sees what this account would be charged instead of granting a
  // percentage blind. (The server supports it; nothing used to call it.)
  const [accountPreview, setAccountPreview] = useState<AdminDiscountPreview | null>(null);
  const [accountPreviewError, setAccountPreviewError] = useState<string | null>(null);
  const accountPreviewSeqRef = useRef(0);
  const [freeActivating, setFreeActivating] = useState<string | null>(null);

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);
    const result = await fetchAdminDiscountOverview();
    if (result.ok) {
      setOverview(result.data);
      setLoadError(null);
    } else {
      setLoadError(result.error);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setNotice(null), 4000);
    return () => window.clearTimeout(t);
  }, [notice]);

  /** Shop picker — reuses the fleet search the Shops page already uses. */
  useEffect(() => {
    const query = shopQuery.trim();
    if (query.length < 2) {
      setShopRows([]);
      setShopSearchError(null);
      return;
    }
    const seq = ++shopSeqRef.current;
    setShopSearching(true);
    const timer = window.setTimeout(() => {
      void fetchInternalOpsSearchShops({ query, limit: 10 }).then((res) => {
        if (seq !== shopSeqRef.current) return;
        setShopRows(res.rows);
        setShopSearchError(res.error);
        setShopSearching(false);
      });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [shopQuery]);

  const globalBase = useMemo(() => {
    const plan = overview?.plans.find((p) => p.plan_code === globalPlan);
    return plan?.monthly_ugx ?? 0;
  }, [overview, globalPlan]);

  const parsedGlobal = parseDiscountPercent(globalPercent);
  /** A primitive, so the preview effect below has a stable dependency. */
  const globalPercentValue = parsedGlobal.ok ? parsedGlobal.value : null;
  const localPreview = globalPercentValue === null ? null : localDiscountPreview(globalBase, globalPercentValue);

  /** Server preview, debounced. A failure leaves the last good preview alone. */
  useEffect(() => {
    if (!canEdit || globalPercentValue === null) {
      setPreview(null);
      return;
    }
    const seq = ++previewSeqRef.current;
    const timer = window.setTimeout(() => {
      void previewAdminDiscount({
        planCode: globalPlan,
        discountPercent: globalPercentValue,
        individual: false,
      }).then((res) => {
        if (seq !== previewSeqRef.current) return;
        if (res.ok) {
          setPreview(res.data);
          setPreviewError(null);
        } else {
          setPreviewError(res.error);
        }
      });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [canEdit, globalPlan, globalPercentValue]);

  /**
   * The account preview, debounced like the global one. `individual: true` is
   * what makes it answer "what would THIS account pay", with its own discount
   * replacing any global rule — the case the global preview deliberately does
   * not describe.
   */
  const selectedPlanCode = selectedShop?.plan_code ?? null;
  const parsedIndividual = parseDiscountPercent(individualPercent);
  const individualPercentValue = parsedIndividual.ok ? parsedIndividual.value : null;

  useEffect(() => {
    // Nothing is cleared here on purpose: the render below gates on the same
    // conditions, so a preview from a previous selection is never shown.
    if (!canEdit || !selectedPlanCode || individualPercentValue === null) return;
    const seq = ++accountPreviewSeqRef.current;
    const timer = window.setTimeout(() => {
      void previewAdminDiscount({
        planCode: selectedPlanCode,
        discountPercent: individualPercentValue,
        individual: true,
      }).then((res) => {
        if (seq !== accountPreviewSeqRef.current) return;
        if (res.ok) {
          setAccountPreview(res.data);
          setAccountPreviewError(null);
        } else {
          setAccountPreviewError(res.error);
        }
      });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [canEdit, selectedPlanCode, individualPercentValue]);

  const onSaveGlobal = async () => {
    if (!canEdit || globalSaving) return;
    const errors = validateDiscountDraft({
      percentRaw: globalPercent,
      startsAt: globalStartsAt || null,
      expiresAt: globalExpiresAt || null,
    });
    setGlobalErrors(errors);
    if (hasDiscountErrors(errors)) {
      setError("Fix the highlighted fields before saving.");
      return;
    }
    const percent = parseDiscountPercent(globalPercent);
    if (!percent.ok) return;

    setGlobalSaving(true);
    setError(null);
    try {
      const res = await saveAdminPlanDiscount({
        planCode: globalPlan,
        discountPercent: percent.value,
        active: globalActive,
        startsAt: globalStartsAt ? new Date(globalStartsAt).toISOString() : null,
        expiresAt: globalExpiresAt ? new Date(globalExpiresAt).toISOString() : null,
        reason: globalReason,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setNotice(
        percent.value > 0
          ? `${ADMIN_DISCOUNT_PLAN_LABELS[globalPlan]} now has a global ${percent.value}% discount.`
          : `The global discount on ${ADMIN_DISCOUNT_PLAN_LABELS[globalPlan]} is now inactive.`,
      );
      await load({ silent: true });
      notifyInternalOpsChanged();
    } finally {
      setGlobalSaving(false);
    }
  };

  const onRemoveGlobal = async (planCode: string) => {
      if (!canEdit || !window.confirm(`Remove the global discount on ${ADMIN_DISCOUNT_PLAN_LABELS[planCode as PlanCode] ?? planCode}?`)) return;
      setError(null);
      const res = await deleteAdminPlanDiscount(planCode);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setNotice("Global discount removed.");
      await load({ silent: true });
      notifyInternalOpsChanged();
  };

  const onSaveIndividual = async () => {
    if (!canEdit || individualSaving || !selectedShop) return;
    const errors = validateDiscountDraft({
      percentRaw: individualPercent,
      startsAt: individualStartsAt || null,
      expiresAt: individualExpiresAt || null,
    });
    setIndividualErrors(errors);
    if (hasDiscountErrors(errors)) {
      setError("Fix the highlighted fields before saving.");
      return;
    }
    const percent = parseDiscountPercent(individualPercent);
    if (!percent.ok) return;

    setIndividualSaving(true);
    setError(null);
    try {
      const res = await saveAdminSubscriptionDiscount({
        shopId: selectedShop.id,
        discountPercent: percent.value,
        reason: individualReason,
        startsAt: individualStartsAt ? new Date(individualStartsAt).toISOString() : null,
        expiresAt: individualExpiresAt ? new Date(individualExpiresAt).toISOString() : null,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setNotice(
        percent.value > 0
          ? `${selectedShop.name} now has a ${percent.value}% discount.`
          : `${selectedShop.name}'s discount was cleared.`,
      );
      await load({ silent: true });
      notifyInternalOpsChanged();
    } finally {
      setIndividualSaving(false);
    }
  };

  const onClearIndividual = async (shopId: string | null, label: string) => {
      if (!canEdit || !shopId) return;
      if (!window.confirm(`Clear the discount for ${label}?`)) return;
      setError(null);
      const res = await saveAdminSubscriptionDiscount({ shopId, discountPercent: 0, reason: null });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setNotice(`Discount cleared for ${label}.`);
      await load({ silent: true });
      notifyInternalOpsChanged();
  };

  /**
   * Grants one period to a 100% account without taking a payment. The server
   * re-checks everything (the discount really being 100%, the zero price, the
   * window) and is idempotent, so a double click returns the activation it
   * already made rather than granting a second period.
   */
  const onActivateFree = async (subscriptionId: string, label: string) => {
    if (!canEdit || freeActivating) return;
    if (
      !window.confirm(
        `Grant one free period to ${label}? No payment is recorded; the account's 100% discount covers it.`,
      )
    ) {
      return;
    }
    setFreeActivating(subscriptionId);
    setError(null);
    try {
      const res = await activateAdminFreePeriod({ subscriptionId, reason: "100% discount" });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setNotice(
        res.data.idempotent
          ? `${label} already had this period activated — nothing was granted twice.`
          : `Free period granted to ${label} until ${new Date(res.data.period_end ?? "").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}.`,
      );
      await load({ silent: true });
      notifyInternalOpsChanged();
    } finally {
      setFreeActivating(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16" data-testid="admin-discounts-loading">
        <Loader2 className="h-6 w-6 animate-spin text-waka-600" />
      </div>
    );
  }

  const global = overview?.global ?? [];
  const individual = overview?.individual ?? [];

  return (
    <div className="space-y-5" data-testid="admin-discounts-page">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-black text-foreground">Subscription Discounts</h1>
          <p className="mt-1 text-sm font-semibold text-muted-foreground">
            Discounts of up to {MAX_ADMIN_DISCOUNT_PERCENT}% against the canonical plan price. An account&apos;s own
            discount always replaces a global one — they never add up. A global rule is published on the public
            pricing and upgrade pages; an account&apos;s discount is private to that account.
          </p>
        </div>
        <button type="button" className={secondaryBtnCls} onClick={() => void load()} disabled={loading}>
          <RefreshCw className="h-4 w-4" /> Refresh
        </button>
      </header>

      {!canEdit && !previewMode ? (
        <p className={`${statusTokens.warning.banner} text-sm font-semibold`} role="status">
          Your role can view discounts but not change them.
        </p>
      ) : null}

      {loadError ? (
        <div className={statusTokens.danger.banner} role="alert" data-testid="admin-discounts-load-error">
          <p className="text-sm font-bold">{loadError}</p>
          <button type="button" className={`${secondaryBtnCls} mt-2`} onClick={() => void load()}>
            Try again
          </button>
        </div>
      ) : null}

      {error ? (
        <p className={`${statusTokens.danger.banner} text-sm font-bold`} role="alert" data-testid="admin-discounts-error">
          {error}
        </p>
      ) : null}

      {notice ? (
        <p className={`${statusTokens.success.banner} text-sm font-bold`} role="status" data-testid="admin-discounts-notice">
          {notice}
        </p>
      ) : null}

      {/* ---------------- Global discounts ---------------- */}
      <section className={cardCls} data-testid="admin-discounts-global">
        <h2 className="text-lg font-black text-foreground">Global discounts</h2>
        <p className="mt-1 text-sm font-semibold text-muted-foreground">
          One rule per plan. Applies to every account on that plan that has no discount of its own.
        </p>

        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <div>
            <label className={labelCls} htmlFor="global-plan">
              Plan
            </label>
            <select
              id="global-plan"
              className={inputCls}
              value={globalPlan}
              disabled={!canEdit}
              onChange={(e) => {
                const next = e.target.value as PlanCode;
                setGlobalPlan(next);
                const existing = overview?.global.find((g) => g.plan_code === next);
                setGlobalPercent(existing ? String(existing.discount_percent) : "0");
                setGlobalStartsAt(existing?.starts_at ? existing.starts_at.slice(0, 10) : "");
                setGlobalExpiresAt(existing?.expires_at ? existing.expires_at.slice(0, 10) : "");
                setGlobalActive(existing?.active ?? true);
                setGlobalReason(existing?.reason ?? "");
                setGlobalErrors({});
              }}
            >
              {ADMIN_DISCOUNT_PLANS.map((code) => (
                <option key={code} value={code}>
                  {ADMIN_DISCOUNT_PLAN_LABELS[code]}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className={labelCls} htmlFor="global-percent">
              Discount % (0–{MAX_ADMIN_DISCOUNT_PERCENT})
            </label>
            <input
              id="global-percent"
              className={inputCls}
              inputMode="decimal"
              value={globalPercent}
              disabled={!canEdit}
              aria-invalid={Boolean(globalErrors.percent)}
              onChange={(e) => setGlobalPercent(e.target.value)}
            />
            {globalErrors.percent ? (
              <p className="mt-1 text-xs font-bold text-destructive" role="alert">
                {globalErrors.percent}
              </p>
            ) : null}
          </div>

          <div>
            <label className={labelCls} htmlFor="global-reason">
              Reason (optional)
            </label>
            <input
              id="global-reason"
              className={inputCls}
              value={globalReason}
              disabled={!canEdit}
              onChange={(e) => setGlobalReason(e.target.value)}
            />
          </div>

          <div>
            <label className={labelCls} htmlFor="global-start">
              Starts (optional)
            </label>
            <input
              id="global-start"
              type="date"
              className={inputCls}
              value={globalStartsAt}
              disabled={!canEdit}
              onChange={(e) => setGlobalStartsAt(e.target.value)}
            />
          </div>

          <div>
            <label className={labelCls} htmlFor="global-expiry">
              Expires (optional)
            </label>
            <input
              id="global-expiry"
              type="date"
              className={inputCls}
              value={globalExpiresAt}
              disabled={!canEdit}
              onChange={(e) => setGlobalExpiresAt(e.target.value)}
            />
          </div>

          <div className="flex items-end">
            <label className="flex items-center gap-2 text-sm font-bold text-foreground">
              <input
                type="checkbox"
                checked={globalActive}
                disabled={!canEdit}
                onChange={(e) => setGlobalActive(e.target.checked)}
              />
              Active
            </label>
          </div>
        </div>

        {globalErrors.window ? (
          <p className="mt-2 text-xs font-bold text-destructive" role="alert">
            {globalErrors.window}
          </p>
        ) : null}

        {/* Price preview — the server's number whenever it has one. */}
        <div className="mt-4 rounded-xl bg-muted p-3" data-testid="admin-discounts-preview">
          <p className="text-xs font-black uppercase tracking-wide text-muted-foreground">Price preview</p>
          <p className="mt-1 text-sm font-bold text-foreground">
            {preview
              ? `${formatUgx(preview.base_monthly_ugx)} → ${formatUgx(preview.monthly_ugx)}/month (saves ${formatUgx(preview.monthly_discount_ugx)})`
              : localPreview
                ? `${formatUgx(globalBase)} → ${formatUgx(localPreview.finalUgx)}/month (saves ${formatUgx(localPreview.discountUgx)}) — verifying…`
                : "Enter a percentage to preview the price."}
          </p>
          {preview ? (
            <p className="mt-1 text-xs font-semibold text-muted-foreground">
              Annual: {formatUgx(preview.base_annual_ugx)} → {formatUgx(preview.annual_ugx)}
            </p>
          ) : null}
          {previewError ? (
            <p className="mt-1 text-xs font-bold text-destructive" role="alert">
              {previewError} — the last confirmed price is still shown above.
            </p>
          ) : null}
        </div>

        <button type="button" className={`${primaryBtnCls} mt-4`} onClick={() => void onSaveGlobal()} disabled={!canEdit || globalSaving}>
          {globalSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Save global discount
        </button>

        <div className="mt-5 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-[11px] font-black uppercase tracking-wide text-muted-foreground">
                <th className="py-2">Plan</th>
                <th className="py-2">Discount</th>
                <th className="py-2">Effective price</th>
                <th className="py-2">Window</th>
                <th className="py-2">Status</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {global.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-sm font-semibold text-muted-foreground" data-testid="admin-discounts-global-empty">
                    No global discounts yet.
                  </td>
                </tr>
              ) : (
                global.map((row) => (
                  <tr key={row.plan_code} className="border-t border-border">
                    <td className="py-3">
                      <Value>{ADMIN_DISCOUNT_PLAN_LABELS[row.plan_code as PlanCode] ?? row.plan_code}</Value>
                    </td>
                    <td className="py-3">
                      <Value>{row.discount_percent}%</Value>
                    </td>
                    <td className="py-3">
                      {/*
                        The LIVE-aware price: what a shop with no discount of its
                        own pays right now. A rule that is inactive, scheduled or
                        expired shows no discount here, with what it WOULD be worth
                        on the line beneath — previously this cell applied the
                        percentage regardless of the rule's own window.
                      */}
                      <Value>
                        {formatUgx(row.base_monthly_ugx)} →{" "}
                        {formatUgx(row.effective_monthly_ugx ?? row.final_monthly_with_discount_ugx)}
                      </Value>
                      {!row.is_active_now && row.configured_monthly_ugx ? (
                        <span className="mt-0.5 block text-[11px] font-semibold text-muted-foreground">
                          if active: {formatUgx(row.configured_monthly_ugx)}
                        </span>
                      ) : null}
                    </td>
                    <td className="py-3">
                      <Window startsAt={row.starts_at} expiresAt={row.expires_at} />
                    </td>
                    <td className="py-3">
                      <span className={row.is_active_now ? statusTokens.success.badge : statusTokens.draft.badge}>
                        {row.is_active_now ? "Live" : row.active ? "Scheduled / expired" : "Inactive"}
                      </span>
                    </td>
                    <td className="py-3 text-right">
                      <button
                        type="button"
                        className={dangerBtnCls}
                        disabled={!canEdit}
                        onClick={() => void onRemoveGlobal(row.plan_code)}
                      >
                        <Trash2 className="h-4 w-4" /> Remove
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* ---------------- Individual discounts ---------------- */}
      <section className={cardCls} data-testid="admin-discounts-individual">
        <h2 className="text-lg font-black text-foreground">Individual account discounts</h2>
        <p className="mt-1 text-sm font-semibold text-muted-foreground">
          Applies to one ACCOUNT — every shop on that account&apos;s subscription, and nothing outside it. It replaces
          any global discount on the same plan rather than adding to it.
        </p>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div>
            <label className={labelCls} htmlFor="discount-shop-search">
              Find a shop
            </label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                id="discount-shop-search"
                type="search"
                className={`${inputCls} pl-9`}
                placeholder="Shop name, number, email or ID"
                value={shopQuery}
                disabled={!canEdit}
                onChange={(e) => {
                  setShopQuery(e.target.value);
                  setSelectedShop(null);
                }}
              />
            </div>
            {shopSearching ? (
              <p className="mt-1 text-xs font-semibold text-muted-foreground">Searching…</p>
            ) : null}
            {shopSearchError ? (
              <p className="mt-1 text-xs font-bold text-destructive" role="alert">
                {shopSearchError}
              </p>
            ) : null}
            {shopRows.length > 0 && !selectedShop ? (
              <ul className="mt-2 max-h-56 overflow-y-auto rounded-xl border border-border" data-testid="admin-discounts-shop-results">
                {shopRows.map((row) => (
                  <li key={row.id}>
                    <button
                      type="button"
                      className="w-full px-3 py-2 text-left text-sm font-semibold hover:bg-muted"
                      onClick={() => {
                        setSelectedShop(row);
                        setShopQuery(`${row.name} (${row.shop_number})`);
                      }}
                    >
                      {row.name} <span className="text-muted-foreground">· {row.shop_number}</span>
                      {row.plan_code ? <span className="text-muted-foreground"> · {row.plan_code}</span> : null}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          <div>
            <label className={labelCls} htmlFor="individual-percent">
              Discount % (0–{MAX_ADMIN_DISCOUNT_PERCENT})
            </label>
            <input
              id="individual-percent"
              className={inputCls}
              inputMode="decimal"
              value={individualPercent}
              disabled={!canEdit || !selectedShop}
              aria-invalid={Boolean(individualErrors.percent)}
              onChange={(e) => setIndividualPercent(e.target.value)}
            />
            {individualErrors.percent ? (
              <p className="mt-1 text-xs font-bold text-destructive" role="alert">
                {individualErrors.percent}
              </p>
            ) : null}
          </div>

          <div>
            <label className={labelCls} htmlFor="individual-start">
              Starts (optional)
            </label>
            <input
              id="individual-start"
              type="date"
              className={inputCls}
              value={individualStartsAt}
              disabled={!canEdit || !selectedShop}
              onChange={(e) => setIndividualStartsAt(e.target.value)}
            />
            {individualErrors.start ? (
              <p className="mt-1 text-xs font-bold text-destructive" role="alert">
                {individualErrors.start}
              </p>
            ) : null}
          </div>

          <div>
            <label className={labelCls} htmlFor="individual-expiry">
              Expires (optional)
            </label>
            <input
              id="individual-expiry"
              type="date"
              className={inputCls}
              value={individualExpiresAt}
              disabled={!canEdit || !selectedShop}
              onChange={(e) => setIndividualExpiresAt(e.target.value)}
            />
            {individualErrors.expiry ? (
              <p className="mt-1 text-xs font-bold text-destructive" role="alert">
                {individualErrors.expiry}
              </p>
            ) : null}
          </div>

          {individualErrors.window ? (
            <p className="text-xs font-bold text-destructive sm:col-span-2" role="alert">
              {individualErrors.window}
            </p>
          ) : null}

          <div className="sm:col-span-2">
            <label className={labelCls} htmlFor="individual-reason">
              Reason (optional)
            </label>
            <input
              id="individual-reason"
              className={inputCls}
              value={individualReason}
              disabled={!canEdit || !selectedShop}
              onChange={(e) => setIndividualReason(e.target.value)}
            />
          </div>
        </div>

        {/*
          The account price, from the SAME server function checkout uses, with
          `p_individual: true`. Previously this side of the form showed no price
          at all, so a percentage was granted blind.
        */}
        <div className="mt-4 rounded-xl bg-muted p-3" data-testid="admin-discounts-account-preview">
          <p className="text-xs font-black uppercase tracking-wide text-muted-foreground">Account price</p>
          <p className="mt-1 text-sm font-bold text-foreground">
            {!selectedShop
              ? "Choose a shop to preview its price."
              : accountPreview && individualPercentValue !== null
                ? `${formatUgx(accountPreview.base_monthly_ugx)} → ${formatUgx(accountPreview.monthly_ugx)}/month (saves ${formatUgx(accountPreview.monthly_discount_ugx)})`
                : "Enter a percentage to preview the price."}
          </p>
          {accountPreview && selectedShop && individualPercentValue !== null ? (
            <p className="mt-1 text-xs font-semibold text-muted-foreground">
              {ADMIN_DISCOUNT_PLAN_LABELS[accountPreview.plan_code as PlanCode] ?? accountPreview.plan_code} · annual{" "}
              {formatUgx(accountPreview.base_annual_ugx)} → {formatUgx(accountPreview.annual_ugx)}. This replaces any
              global discount on the plan.
            </p>
          ) : null}
          {accountPreviewError ? (
            <p className="mt-1 text-xs font-bold text-destructive" role="alert">
              {accountPreviewError}
            </p>
          ) : null}
        </div>

        <button
          type="button"
          className={`${primaryBtnCls} mt-4`}
          onClick={() => void onSaveIndividual()}
          disabled={!canEdit || individualSaving || !selectedShop}
        >
          {individualSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Save account discount
        </button>
        <p className="mt-2 text-xs font-semibold text-muted-foreground">
          Setting 0 clears the discount and its note. An account discount covers the whole account — every shop on the
          same subscription is priced from it.
        </p>

        <div className="mt-5 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-[11px] font-black uppercase tracking-wide text-muted-foreground">
                <th className="py-2">Account</th>
                <th className="py-2">Plan</th>
                <th className="py-2">Discount</th>
                <th className="py-2">Window</th>
                <th className="py-2">Status</th>
                <th className="py-2">Price</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {individual.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-6 text-center text-sm font-semibold text-muted-foreground" data-testid="admin-discounts-individual-empty">
                    No account discounts yet.
                  </td>
                </tr>
              ) : (
                individual.map((row) => (
                  <tr key={row.subscription_id} className="border-t border-border">
                    <td className="py-3">
                      <Value>{row.account_name || row.shop_id || row.organization_id}</Value>
                    </td>
                    <td className="py-3">
                      <Value>{row.plan_code ? (ADMIN_DISCOUNT_PLAN_LABELS[row.plan_code as PlanCode] ?? row.plan_code) : null}</Value>
                    </td>
                    <td className="py-3">
                      <Value>{row.discount_percent}%</Value>
                      {/* The scope is the whole ACCOUNT, not the one shop that was picked
                          in the search box. */}
                      {typeof row.shop_count === "number" ? (
                        <span className="mt-0.5 block text-[11px] font-semibold text-muted-foreground">
                          whole account · {row.shop_count} {row.shop_count === 1 ? "shop" : "shops"}
                        </span>
                      ) : null}
                    </td>
                    <td className="py-3">
                      <Window startsAt={row.starts_at} expiresAt={row.expires_at} />
                    </td>
                    <td className="py-3">
                      <span className={row.is_active_now ? statusTokens.success.badge : statusTokens.draft.badge}>
                        {row.is_active_now
                          ? "Live"
                          : row.discount_percent > 0
                            ? "Scheduled / lapsed"
                            : "Inactive"}
                      </span>
                      {row.note ? (
                        <p className="mt-1 text-xs font-semibold text-muted-foreground">{row.note}</p>
                      ) : null}
                    </td>
                    <td className="py-3">
                      {/* The price the shop actually pays now — a lapsed rule shows
                          the fallback, not the rate it used to have. */}
                      <Value>{row.final_monthly_ugx === null ? null : `${formatUgx(row.final_monthly_ugx)}/mo`}</Value>
                    </td>
                    <td className="py-3 text-right">
                      <div className="flex flex-wrap justify-end gap-2">
                        {/*
                          A 100% account has nothing to pay, so its period is
                          granted instead of charged. The setters cap at 99%, so
                          this only appears on a legacy or hand-set row — which is
                          exactly the case the server re-checks before granting.
                        */}
                        {row.effective_percent >= 100 ? (
                          <button
                            type="button"
                            className={primaryBtnCls}
                            disabled={!canEdit || freeActivating === row.subscription_id}
                            onClick={() => void onActivateFree(row.subscription_id, row.account_name || "this account")}
                            data-testid="admin-discounts-free-activate"
                          >
                            {freeActivating === row.subscription_id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : null}
                            Grant free period
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className={dangerBtnCls}
                          disabled={!canEdit || !row.shop_id}
                          onClick={() => void onClearIndividual(row.shop_id, row.account_name || "this account")}
                        >
                          <Trash2 className="h-4 w-4" /> Clear
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
