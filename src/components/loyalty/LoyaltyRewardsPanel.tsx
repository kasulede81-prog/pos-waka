import { useCallback, useEffect, useState } from "react";
import clsx from "clsx";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import {
  createLoyaltyReward,
  fetchLoyaltyRewards,
  isProductBackedReward,
  isRewardUnexpiredClient,
  searchShopProductsForReward,
  updateLoyaltyReward,
  validateRewardInput,
  type LoyaltyProductSearchHit,
  type LoyaltyReward,
  type RewardInput,
} from "../../lib/loyalty/loyaltyRewards";
import { WakaSwitch } from "../enterprise/WakaSwitch";

const KIND_OPTIONS: LoyaltyReward["rewardKind"][] = ["custom", "product", "voucher"];

function kindLabelKey(kind: LoyaltyReward["rewardKind"]): string {
  if (kind === "product") return "loyaltyRewardKindProduct";
  if (kind === "voucher") return "loyaltyRewardKindVoucher";
  return "loyaltyRewardKindCustom";
}

const EMPTY_INPUT: RewardInput = {
  name: "",
  description: "",
  pointsRequired: 100,
  rewardKind: "custom",
  productId: null,
  productQuantity: 1,
  maxRedemptionsPerAccount: null,
  active: true,
  expiresOn: null,
};

/** Merchant reward catalog management — simple name + points first; advanced collapsed. */
export function LoyaltyRewardsPanel({
  lang,
  shopId,
  onChanged,
}: {
  lang: Language;
  shopId: string;
  onChanged: () => void;
}) {
  const [rewards, setRewards] = useState<LoyaltyReward[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [draft, setDraft] = useState<RewardInput>({ ...EMPTY_INPUT });
  const [saveState, setSaveState] = useState<"idle" | "saving" | "done" | "error">("idle");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [editingExpiryId, setEditingExpiryId] = useState<string | null>(null);
  const [productQuery, setProductQuery] = useState("");
  const [productHits, setProductHits] = useState<LoyaltyProductSearchHit[]>([]);
  const [selectedProduct, setSelectedProduct] = useState<LoyaltyProductSearchHit | null>(null);
  const [productSearching, setProductSearching] = useState(false);

  const reload = useCallback(async () => {
    const rows = await fetchLoyaltyRewards(shopId);
    setRewards(rows);
    setLoaded(true);
  }, [shopId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    const q = productQuery.trim();
    if (q.length < 1) {
      setProductHits([]);
      return;
    }
    let cancelled = false;
    setProductSearching(true);
    const timer = window.setTimeout(() => {
      void (async () => {
        const hits = await searchShopProductsForReward(shopId, q);
        if (cancelled) return;
        setProductHits(hits);
        setProductSearching(false);
      })();
    }, 220);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [productQuery, shopId]);

  const inputError = validateRewardInput(draft);

  const selectProduct = (hit: LoyaltyProductSearchHit) => {
    setSelectedProduct(hit);
    setDraft((d) => ({
      ...d,
      productId: hit.id,
      productQuantity: d.productQuantity > 0 ? d.productQuantity : 1,
      rewardKind: "product",
      name: d.name.trim() ? d.name : `Free ${hit.name}`,
    }));
    setProductQuery("");
    setProductHits([]);
  };

  const clearProduct = () => {
    setSelectedProduct(null);
    setDraft((d) => ({ ...d, productId: null, productQuantity: 1 }));
  };

  const submitCreate = async () => {
    if (inputError) return;
    setSaveState("saving");
    const result = await createLoyaltyReward(shopId, draft);
    if (result.ok) {
      setSaveState("done");
      setDraft({ ...EMPTY_INPUT });
      setSelectedProduct(null);
      setProductQuery("");
      setShowAdvanced(false);
      await reload();
      onChanged();
    } else {
      setSaveState("error");
    }
  };

  const toggleActive = async (reward: LoyaltyReward) => {
    await updateLoyaltyReward(reward.id, { active: !reward.active });
    await reload();
    onChanged();
  };

  const saveExpiry = async (reward: LoyaltyReward, expiresOn: string | null) => {
    if (expiresOn != null && expiresOn !== "" && !/^\d{4}-\d{2}-\d{2}$/.test(expiresOn)) return;
    await updateLoyaltyReward(reward.id, { expiresOn });
    setEditingExpiryId(null);
    await reload();
    onChanged();
  };

  return (
    <article className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <p className="text-base font-black text-foreground">{t(lang, "loyaltyRewardsTitle")}</p>
      <p className="mt-1 text-sm font-medium text-muted-foreground">{t(lang, "loyaltyRewardsSub")}</p>
      <p className="mt-2 text-xs font-medium text-muted-foreground">{t(lang, "loyaltyRewardExampleHint")}</p>

      {loaded && rewards.length === 0 ? (
        <p className="mt-3 text-sm font-medium text-muted-foreground">{t(lang, "loyaltyNoRewards")}</p>
      ) : (
        <ul className="mt-3 divide-y divide-border">
          {rewards.map((reward) => {
            const expired = reward.active && !isRewardUnexpiredClient(reward.expiresOn);
            return (
              <li key={reward.id} className="py-2.5">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-black text-foreground">
                      {reward.name}
                      <span
                        className={clsx(
                          "ml-2 rounded-full px-2 py-0.5 text-[10px] font-black",
                          !reward.active
                            ? "bg-muted text-muted-foreground"
                            : expired
                              ? "bg-destructive/15 text-destructive"
                              : "bg-success-muted text-success",
                        )}
                      >
                        {!reward.active
                          ? t(lang, "loyaltyRewardInactive")
                          : expired
                            ? t(lang, "loyaltyRewardExpired")
                            : t(lang, "loyaltyRewardActive")}
                      </span>
                    </p>
                    <p className="text-xs font-medium text-muted-foreground">
                      {reward.pointsRequired} {t(lang, "loyaltyPointsUnit")}
                      {reward.description ? ` · ${reward.description}` : ""}
                      {isProductBackedReward(reward)
                        ? ` · ${t(lang, "loyaltyRewardProductLinked")}`
                        : ""}
                      {reward.expiresOn
                        ? ` · ${t(lang, "loyaltyRewardExpiresOn")}: ${reward.expiresOn}`
                        : ` · ${t(lang, "loyaltyRewardNeverExpires")}`}
                    </p>
                  </div>
                  <WakaSwitch
                    checked={reward.active}
                    onCheckedChange={() => void toggleActive(reward)}
                    label={undefined}
                    aria-label={reward.name}
                  />
                </div>
                {editingExpiryId === reward.id ? (
                  <div className="mt-2 space-y-2 rounded-xl border border-border bg-muted/40 p-3">
                    <p className="text-xs font-black text-foreground">{t(lang, "loyaltyRewardExpiry")}</p>
                    <label className="flex items-center gap-2 text-sm font-semibold text-foreground">
                      <input
                        type="radio"
                        name={`expiry-${reward.id}`}
                        checked={reward.expiresOn == null}
                        onChange={() => void saveExpiry(reward, null)}
                      />
                      {t(lang, "loyaltyRewardNeverExpires")}
                    </label>
                    <label className="flex flex-wrap items-center gap-2 text-sm font-semibold text-foreground">
                      <input
                        type="radio"
                        name={`expiry-${reward.id}`}
                        checked={reward.expiresOn != null}
                        onChange={() => {
                          if (reward.expiresOn == null) {
                            void saveExpiry(reward, new Date().toISOString().slice(0, 10));
                          }
                        }}
                      />
                      {t(lang, "loyaltyRewardExpiresOn")}
                      <input
                        type="date"
                        value={reward.expiresOn ?? ""}
                        onChange={(e) => {
                          const v = e.target.value;
                          if (v) void saveExpiry(reward, v);
                        }}
                        className="min-h-[40px] rounded-lg border-2 border-border bg-card px-2 text-sm font-semibold"
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => setEditingExpiryId(null)}
                      className="text-xs font-bold text-muted-foreground"
                    >
                      {t(lang, "loyaltyCancel")}
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setEditingExpiryId(reward.id)}
                    className="mt-1.5 text-xs font-bold text-waka-700"
                  >
                    {t(lang, "loyaltyRewardEditExpiry")}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-4 rounded-2xl border border-border bg-muted/50 p-3">
        <p className="text-sm font-black text-foreground">{t(lang, "loyaltyAddReward")}</p>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block text-sm font-bold text-foreground">
            {t(lang, "loyaltyRewardNameLabel")}
            <input
              value={draft.name}
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
              placeholder={t(lang, "loyaltyRewardNamePlaceholder")}
              className="mt-1.5 min-h-[44px] w-full rounded-xl border-2 border-border bg-card px-3 py-2 text-base font-semibold"
            />
          </label>
          <label className="block text-sm font-bold text-foreground">
            {t(lang, "loyaltyRewardPointsLabel")}
            <input
              type="number"
              min={1}
              value={draft.pointsRequired}
              onChange={(e) => setDraft((d) => ({ ...d, pointsRequired: Number(e.target.value) }))}
              className="mt-1.5 min-h-[44px] w-full rounded-xl border-2 border-border bg-card px-3 py-2 text-base font-semibold"
            />
          </label>
        </div>

        <div className="mt-3 space-y-2 rounded-xl border border-border bg-card/60 p-3">
          <p className="text-sm font-black text-foreground">{t(lang, "loyaltyRewardProductToGive")}</p>
          <p className="text-xs font-medium text-muted-foreground">{t(lang, "loyaltyRewardProductToGiveHint")}</p>
          {selectedProduct ? (
            <div className="flex items-start justify-between gap-2 rounded-xl border border-waka-200 bg-waka-50 px-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-black text-foreground">{selectedProduct.name}</p>
                <p className="text-xs font-medium text-muted-foreground">
                  {selectedProduct.sku ? `SKU: ${selectedProduct.sku} · ` : ""}
                  {t(lang, "loyaltyRewardProductStock")}: {selectedProduct.stockOnHand}
                </p>
              </div>
              <button
                type="button"
                onClick={clearProduct}
                className="shrink-0 text-xs font-bold text-waka-700"
              >
                {t(lang, "loyaltyRewardProductClear")}
              </button>
            </div>
          ) : (
            <>
              <input
                value={productQuery}
                onChange={(e) => setProductQuery(e.target.value)}
                placeholder={t(lang, "loyaltyRewardProductSearchPlaceholder")}
                className="min-h-[44px] w-full rounded-xl border-2 border-border bg-card px-3 py-2 text-base font-semibold"
                autoComplete="off"
              />
              {productSearching ? (
                <p className="text-xs font-medium text-muted-foreground">{t(lang, "loyaltyScanResolving")}</p>
              ) : null}
              {productHits.length > 0 ? (
                <ul className="max-h-48 overflow-y-auto rounded-xl border border-border bg-card">
                  {productHits.map((hit) => (
                    <li key={hit.id}>
                      <button
                        type="button"
                        onClick={() => selectProduct(hit)}
                        className="flex w-full flex-col items-start gap-0.5 border-b border-border px-3 py-2 text-left last:border-b-0 hover:bg-muted/60"
                      >
                        <span className="text-sm font-black text-foreground">{hit.name}</span>
                        <span className="text-xs font-medium text-muted-foreground">
                          {hit.sku ? `SKU: ${hit.sku} · ` : ""}
                          {t(lang, "loyaltyRewardProductStock")}: {hit.stockOnHand}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </>
          )}
          {selectedProduct ? (
            <label className="block text-sm font-bold text-foreground">
              {t(lang, "loyaltyRewardProductQty")}
              <input
                type="number"
                min={1}
                step={1}
                value={draft.productQuantity}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, productQuantity: Number(e.target.value) || 1 }))
                }
                className="mt-1.5 min-h-[44px] w-full rounded-xl border-2 border-border bg-card px-3 py-2 text-base font-semibold"
              />
            </label>
          ) : null}
        </div>

        <div className="mt-3 space-y-2 rounded-xl border border-border bg-card/60 p-3">
          <p className="text-sm font-black text-foreground">{t(lang, "loyaltyRewardExpiry")}</p>
          <label className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <input
              type="radio"
              name="draftExpiryMode"
              checked={draft.expiresOn == null}
              onChange={() => setDraft((d) => ({ ...d, expiresOn: null }))}
            />
            {t(lang, "loyaltyRewardNeverExpires")}
          </label>
          <label className="flex flex-wrap items-center gap-2 text-sm font-semibold text-foreground">
            <input
              type="radio"
              name="draftExpiryMode"
              checked={draft.expiresOn != null}
              onChange={() =>
                setDraft((d) => ({
                  ...d,
                  expiresOn: d.expiresOn ?? new Date().toISOString().slice(0, 10),
                }))
              }
            />
            {t(lang, "loyaltyRewardExpiresOn")}
            <input
              type="date"
              value={draft.expiresOn ?? ""}
              disabled={draft.expiresOn == null}
              onChange={(e) =>
                setDraft((d) => ({ ...d, expiresOn: e.target.value || null }))
              }
              className="min-h-[40px] rounded-lg border-2 border-border bg-card px-2 text-sm font-semibold disabled:opacity-40"
            />
          </label>
        </div>

        <div className="mt-3 rounded-xl border border-dashed border-border p-3">
          <button
            type="button"
            onClick={() => setShowAdvanced((v) => !v)}
            className="flex w-full items-center justify-between gap-2 text-left"
          >
            <span className="text-sm font-black text-foreground">{t(lang, "loyaltyAdvancedSettings")}</span>
            <span className="text-xs font-bold text-muted-foreground">
              {showAdvanced ? t(lang, "loyaltyHideAdvanced") : t(lang, "loyaltyShowAdvanced")}
            </span>
          </button>
          {showAdvanced ? (
            <div className="mt-3 space-y-3">
              <p className="text-xs font-medium text-muted-foreground">{t(lang, "loyaltyRewardHonestyNote")}</p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="block text-sm font-bold text-foreground">
                  {t(lang, "loyaltyRewardKindLabel")}
                  <select
                    value={draft.rewardKind}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, rewardKind: e.target.value as RewardInput["rewardKind"] }))
                    }
                    className="mt-1.5 min-h-[44px] w-full rounded-xl border-2 border-border bg-card px-3 py-2 text-base font-semibold"
                  >
                    {KIND_OPTIONS.map((kind) => (
                      <option key={kind} value={kind}>
                        {t(lang, kindLabelKey(kind))}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-sm font-bold text-foreground">
                  {t(lang, "loyaltyRewardLimitLabel")}
                  <input
                    type="number"
                    min={1}
                    value={draft.maxRedemptionsPerAccount ?? ""}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        maxRedemptionsPerAccount: e.target.value === "" ? null : Number(e.target.value),
                      }))
                    }
                    className="mt-1.5 min-h-[44px] w-full rounded-xl border-2 border-border bg-card px-3 py-2 text-base font-semibold"
                  />
                </label>
              </div>
              <label className="block text-sm font-bold text-foreground">
                {t(lang, "loyaltyRewardDescriptionLabel")}
                <input
                  value={draft.description}
                  onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
                  className="mt-1.5 min-h-[44px] w-full rounded-xl border-2 border-border bg-card px-3 py-2 text-base font-semibold"
                />
              </label>
            </div>
          ) : null}
        </div>

        <div className="mt-3 flex items-center gap-3">
          <button
            type="button"
            onClick={() => void submitCreate()}
            disabled={saveState === "saving" || inputError != null}
            className="min-h-[44px] rounded-xl bg-waka-600 px-4 text-sm font-black text-white disabled:opacity-50"
          >
            {t(lang, "loyaltyRewardCreate")}
          </button>
          {saveState === "done" ? (
            <span className="text-sm font-bold text-success">{t(lang, "loyaltyRewardCreated")}</span>
          ) : null}
          {saveState === "error" ? (
            <span className="text-sm font-bold text-destructive">{t(lang, "loyaltyRewardFailed")}</span>
          ) : null}
        </div>
      </div>
    </article>
  );
}
