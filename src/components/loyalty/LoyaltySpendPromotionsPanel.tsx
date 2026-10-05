import { useCallback, useEffect, useState } from "react";
import clsx from "clsx";
import { t } from "../../lib/i18n";
import type { Language } from "../../types";
import { searchLoyaltyAccounts } from "../../lib/loyalty/loyaltyMerchant";
import { WakaButton } from "../ui/wakaPrimitives";
import {
  createSpendPromotion,
  fetchSpendPromotions,
  updateSpendPromotion,
  validateSpendPromotionInput,
  type SpendPromotion,
  type SpendPromotionInput,
} from "../../lib/loyalty/loyaltySpendPromotions";

/**
 * Spend-threshold promotions, merchant side (Phase G).
 *
 * "Spend UGX 50,000 during this period → receive 100 bonus points." The merchant sets the
 * threshold, the bonus, the window and whether it is shop-wide or for one customer.
 *
 * LIFECYCLE REUSES PHASE F'S VOCABULARY — there is no second state model here: `active` is
 * live, `paused` temporarily stops awarding, `revoked` retires it. Every one of those is a
 * status on the same row, exactly like a reward's.
 *
 * TARGETING USES THE AUTHORITATIVE ACCOUNT ID. The picker searches this shop's loyalty
 * accounts through the existing merchant search and stores the account's id — never a name or
 * a phone number, which are display only.
 */

const EMPTY: SpendPromotionInput = {
  title: "",
  thresholdUgx: 50_000,
  bonusPoints: 100,
  maxAwards: 1,
  startsAt: null,
  endsAt: null,
  status: "active",
  accountId: null,
};

const STATUS_LABEL: Record<SpendPromotion["status"], string> = {
  active: "loyaltySpendPromoStatusActive",
  paused: "loyaltySpendPromoStatusPaused",
  revoked: "loyaltySpendPromoStatusRevoked",
};

export function LoyaltySpendPromotionsPanel({
  lang,
  shopId,
  canManage,
}: {
  lang: Language;
  shopId: string;
  canManage: boolean;
}) {
  const [rows, setRows] = useState<SpendPromotion[]>([]);
  const [draft, setDraft] = useState<SpendPromotionInput>({ ...EMPTY });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<{ accountId: string; customerName: string }[]>([]);
  const [targetName, setTargetName] = useState<string | null>(null);

  const reload = useCallback(async () => setRows(await fetchSpendPromotions(shopId)), [shopId]);
  useEffect(() => {
    void reload();
  }, [reload]);

  const runSearch = async () => {
    if (!query.trim()) return;
    const found = await searchLoyaltyAccounts(shopId, query);
    setHits(found.map((a) => ({ accountId: a.accountId, customerName: a.customerName })));
  };

  const save = async () => {
    const invalid = validateSpendPromotionInput(draft);
    if (invalid) {
      setError(t(lang, `loyaltySpendPromo_${invalid}`));
      return;
    }
    setBusy(true);
    const r = editingId
      ? await updateSpendPromotion(editingId, draft)
      : await createSpendPromotion(shopId, draft);
    setBusy(false);
    if (!r.ok) {
      setError(t(lang, "loyaltySpendPromoSaveFailed"));
      return;
    }
    setError(null);
    setDraft({ ...EMPTY });
    setEditingId(null);
    setTargetName(null);
    setHits([]);
    setQuery("");
    await reload();
  };

  const startEdit = (p: SpendPromotion) => {
    setEditingId(p.id);
    setTargetName(p.accountId ? t(lang, "loyaltySpendPromoTargeted") : null);
    setDraft({
      title: p.title,
      thresholdUgx: p.thresholdUgx,
      bonusPoints: p.bonusPoints,
      maxAwards: p.maxAwards,
      startsAt: p.startsAt,
      endsAt: p.endsAt,
      status: p.status,
      accountId: p.accountId,
    });
  };

  const field =
    "mt-1.5 min-h-[44px] w-full rounded-xl border-2 border-border bg-card px-3 py-2 text-base font-semibold";

  return (
    <div className="flex flex-col gap-4" data-testid="spend-promotions-panel">
      {rows.length === 0 ? (
        <p className="text-sm font-medium text-muted-foreground" data-testid="spend-promotions-empty">
          {t(lang, "loyaltySpendPromoNone")}
        </p>
      ) : (
        <ul className="divide-y divide-border" data-testid="spend-promotions-list">
          {rows.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-black text-foreground">{p.title}</p>
                <p className="text-[11px] font-medium text-muted-foreground">
                  UGX {p.thresholdUgx.toLocaleString("en-US")} → +{p.bonusPoints} ·{" "}
                  {t(lang, STATUS_LABEL[p.status])}
                  {p.accountId ? ` · ${t(lang, "loyaltySpendPromoTargeted")}` : ` · ${t(lang, "loyaltySpendPromoShopWide")}`}
                </p>
              </div>
              {canManage ? (
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => startEdit(p)}
                    data-testid={`spend-promotion-edit-${p.id}`}
                    className="min-h-[44px] rounded-lg border border-border px-2 text-[10px] font-black text-foreground"
                  >
                    {t(lang, "edit")}
                  </button>
                  {/* Phase F's lifecycle: paused stops awarding, revoked retires it. */}
                  {p.status !== "paused" ? (
                    <button
                      type="button"
                      onClick={() => void updateSpendPromotion(p.id, { status: "paused" }).then(reload)}
                      className="min-h-[44px] rounded-lg border border-border px-2 text-[10px] font-black text-muted-foreground"
                    >
                      {t(lang, "loyaltySpendPromoStatusPaused")}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void updateSpendPromotion(p.id, { status: "active" }).then(reload)}
                      className="min-h-[44px] rounded-lg border border-waka-600 px-2 text-[10px] font-black text-waka-700"
                    >
                      {t(lang, "loyaltySpendPromoStatusActive")}
                    </button>
                  )}
                  {p.status !== "revoked" ? (
                    <button
                      type="button"
                      onClick={() => void updateSpendPromotion(p.id, { status: "revoked" }).then(reload)}
                      className="min-h-[44px] rounded-lg border border-border px-2 text-[10px] font-black text-muted-foreground"
                    >
                      {t(lang, "loyaltySpendPromoStatusRevoked")}
                    </button>
                  ) : null}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {canManage ? (
        <div className="space-y-3 rounded-xl border border-border bg-card/60 p-3">
          <h3 className="text-sm font-black text-foreground">
            {editingId ? t(lang, "loyaltySpendPromoEditTitle") : t(lang, "loyaltySpendPromoNewTitle")}
          </h3>

          <label className="block text-sm font-bold text-foreground">
            {t(lang, "loyaltySpendPromoFieldTitle")}
            <input
              value={draft.title}
              onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
              data-testid="spend-promo-title"
              className={field}
            />
          </label>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <label className="block text-sm font-bold text-foreground">
              {t(lang, "loyaltySpendPromoFieldThreshold")}
              <input
                type="number"
                min={1}
                value={draft.thresholdUgx}
                onChange={(e) => setDraft((d) => ({ ...d, thresholdUgx: Math.floor(Number(e.target.value)) }))}
                data-testid="spend-promo-threshold"
                className={field}
              />
            </label>
            <label className="block text-sm font-bold text-foreground">
              {t(lang, "loyaltySpendPromoFieldPoints")}
              <input
                type="number"
                min={1}
                value={draft.bonusPoints}
                onChange={(e) => setDraft((d) => ({ ...d, bonusPoints: Math.floor(Number(e.target.value)) }))}
                data-testid="spend-promo-points"
                className={field}
              />
            </label>
            <label className="block text-sm font-bold text-foreground">
              {t(lang, "loyaltySpendPromoFieldMaxAwards")}
              <input
                type="number"
                min={1}
                value={draft.maxAwards}
                onChange={(e) => setDraft((d) => ({ ...d, maxAwards: Math.floor(Number(e.target.value)) }))}
                data-testid="spend-promo-max-awards"
                className={field}
              />
            </label>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block text-sm font-bold text-foreground">
              {t(lang, "loyaltySpendPromoFieldStarts")}
              <input
                type="datetime-local"
                value={draft.startsAt ? draft.startsAt.slice(0, 16) : ""}
                onChange={(e) => setDraft((d) => ({ ...d, startsAt: e.target.value || null }))}
                data-testid="spend-promo-starts"
                className={field}
              />
            </label>
            <label className="block text-sm font-bold text-foreground">
              {t(lang, "loyaltySpendPromoFieldEnds")}
              <input
                type="datetime-local"
                value={draft.endsAt ? draft.endsAt.slice(0, 16) : ""}
                onChange={(e) => setDraft((d) => ({ ...d, endsAt: e.target.value || null }))}
                data-testid="spend-promo-ends"
                className={field}
              />
            </label>
          </div>

          {/* Shop-wide or one customer — the stored key is the ACCOUNT ID. */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setDraft((d) => ({ ...d, accountId: null }));
                setTargetName(null);
              }}
              data-testid="spend-promo-shop-wide"
              aria-pressed={draft.accountId === null}
              className={clsx(
                "min-h-[44px] rounded-xl px-3 text-xs font-black",
                draft.accountId === null ? "bg-waka-600 text-white" : "bg-muted text-foreground",
              )}
            >
              {t(lang, "loyaltySpendPromoShopWide")}
            </button>
            <span className="text-xs font-semibold text-muted-foreground">
              {draft.accountId ? `${t(lang, "loyaltySpendPromoTargeted")}: ${targetName ?? ""}` : ""}
            </span>
          </div>

          <div className="flex flex-wrap gap-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t(lang, "loyaltySpendPromoTargetPlaceholder")}
              data-testid="spend-promo-target-search"
              className="min-h-[44px] flex-1 rounded-xl border-2 border-border bg-card px-3 text-sm font-semibold"
            />
            <button
              type="button"
              onClick={() => void runSearch()}
              className="min-h-[44px] rounded-xl border border-border px-3 text-xs font-black text-foreground"
            >
              {t(lang, "search")}
            </button>
          </div>
          {hits.length > 0 ? (
            <ul className="divide-y divide-border rounded-xl border border-border" data-testid="spend-promo-target-hits">
              {hits.map((h) => (
                <li key={h.accountId}>
                  <button
                    type="button"
                    onClick={() => {
                      setDraft((d) => ({ ...d, accountId: h.accountId }));
                      setTargetName(h.customerName);
                      setHits([]);
                    }}
                    className="w-full px-3 py-2 text-left text-sm font-semibold text-foreground"
                  >
                    {h.customerName}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}

          <label className="block text-sm font-bold text-foreground">
            {t(lang, "loyaltySpendPromoFieldStatus")}
            <select
              value={draft.status}
              onChange={(e) =>
                setDraft((d) => ({ ...d, status: e.target.value as SpendPromotionInput["status"] }))
              }
              data-testid="spend-promo-status"
              className={field}
            >
              {(["active", "paused", "revoked"] as const).map((s) => (
                <option key={s} value={s}>
                  {t(lang, STATUS_LABEL[s])}
                </option>
              ))}
            </select>
          </label>

          {error ? (
            <p className="text-xs font-bold text-danger" data-testid="spend-promo-error">
              {error}
            </p>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <WakaButton
              type="button"
              disabled={busy}
              onClick={() => void save()}
              data-testid="spend-promo-save"
            >
              {t(lang, "save")}
            </WakaButton>
            {editingId ? (
              <button
                type="button"
                onClick={() => {
                  setEditingId(null);
                  setDraft({ ...EMPTY });
                  setTargetName(null);
                  setError(null);
                }}
                className="min-h-[44px] rounded-xl border border-border px-4 text-xs font-black text-foreground"
              >
                {t(lang, "cancel")}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
