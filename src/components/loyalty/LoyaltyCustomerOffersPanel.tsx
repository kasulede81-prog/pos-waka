import { useCallback, useEffect, useState } from "react";
import { t } from "../../lib/i18n";
import type { Language } from "../../types";
import {
  createCustomerLoyaltyOffer,
  listCustomerLoyaltyOffers,
  previewAccountLoyaltyOffers,
  setCustomerLoyaltyOfferStatus,
  type LoyaltyCustomerOffer,
  type LoyaltyOfferKind,
} from "../../lib/loyalty/loyaltyCustomerOffers";
import { fetchLoyaltyRewards, type LoyaltyReward } from "../../lib/loyalty/loyaltyRewards";

type Props = {
  lang: Language;
  shopId: string;
  accountId: string;
  canManage: boolean;
};

const KINDS: LoyaltyOfferKind[] = [
  "earn_multiplier",
  "earn_bonus_flat",
  "reward_grant",
  "status_badge",
  "campaign",
];

export function LoyaltyCustomerOffersPanel({ lang, shopId, accountId, canManage }: Props) {
  const [offers, setOffers] = useState<LoyaltyCustomerOffer[]>([]);
  const [rewards, setRewards] = useState<LoyaltyReward[]>([]);
  const [preview, setPreview] = useState<Record<string, unknown> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<LoyaltyOfferKind>("earn_multiplier");
  const [title, setTitle] = useState("VIP 2x");
  const [priority, setPriority] = useState("0");
  const [multiplier, setMultiplier] = useState("2");
  const [bonusPoints, setBonusPoints] = useState("100");
  const [badgeLabel, setBadgeLabel] = useState("VIP");
  const [rewardId, setRewardId] = useState("");

  const reload = useCallback(async () => {
    const [rows, prev, rewardRows] = await Promise.all([
      listCustomerLoyaltyOffers(shopId, accountId),
      previewAccountLoyaltyOffers(shopId, accountId),
      fetchLoyaltyRewards(shopId),
    ]);
    setOffers(rows);
    setPreview(prev);
    setRewards(rewardRows.filter((r) => r.active));
    if (!rewardId && rewardRows[0]?.id) setRewardId(rewardRows[0].id);
  }, [shopId, accountId, rewardId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const buildConfig = (): Record<string, unknown> | null => {
    if (kind === "earn_multiplier") {
      const m = Number(multiplier);
      if (!Number.isFinite(m) || m <= 0) return null;
      return { multiplier: m };
    }
    if (kind === "earn_bonus_flat") {
      const p = Number(bonusPoints);
      if (!Number.isInteger(p) || p < 0) return null;
      return { points: p };
    }
    if (kind === "reward_grant") {
      if (!rewardId) return null;
      return { reward_ids: [rewardId] };
    }
    if (kind === "status_badge") {
      const label = badgeLabel.trim();
      if (!label) return null;
      return { label };
    }
    if (kind === "campaign") {
      return {
        effects: [
          { kind: "earn_multiplier", multiplier: Number(multiplier) || 2 },
          { kind: "status_badge", label: badgeLabel.trim() || "Campaign" },
        ],
      };
    }
    return null;
  };

  const onCreate = async () => {
    if (!canManage) return;
    const config = buildConfig();
    if (!config || !title.trim()) {
      setError("invalid");
      return;
    }
    setBusy(true);
    setError(null);
    const result = await createCustomerLoyaltyOffer({
      shopId,
      accountId,
      offerKind: kind,
      title: title.trim(),
      config,
      priority: Number(priority) || 0,
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    await reload();
  };

  const onStatus = async (offerId: string, status: "active" | "paused" | "revoked") => {
    if (!canManage) return;
    setBusy(true);
    const result = await setCustomerLoyaltyOfferStatus(shopId, offerId, status);
    setBusy(false);
    if (!result.ok) setError(result.error);
    else await reload();
  };

  const mult = preview ? Number(preview.effective_multiplier ?? 1) : 1;
  const flat = preview ? Number(preview.flat_bonus_points ?? 0) : 0;
  const badges = Array.isArray(preview?.status_badges) ? preview!.status_badges : [];

  return (
    <div className="rounded-2xl border border-border bg-card p-3">
      <p className="text-sm font-black text-foreground">{t(lang, "loyaltyOffersTitle")}</p>
      <p className="mt-0.5 text-xs font-medium text-muted-foreground">{t(lang, "loyaltyOffersSub")}</p>

      {preview ? (
        <div className="mt-2 flex flex-wrap gap-2 text-xs font-bold text-foreground">
          <span className="rounded-lg bg-muted px-2 py-1">
            {t(lang, "loyaltyOffersEffectiveMult")}: {mult}×
          </span>
          <span className="rounded-lg bg-muted px-2 py-1">
            {t(lang, "loyaltyOffersFlatBonus")}: +{flat}
          </span>
          {badges.map((b, i) => {
            const row = b as { label?: string };
            return (
              <span key={i} className="rounded-lg bg-waka-600/15 px-2 py-1 text-waka-700">
                {row.label}
              </span>
            );
          })}
        </div>
      ) : null}

      <ul className="mt-3 max-h-48 space-y-2 overflow-y-auto text-sm">
        {offers.length === 0 ? (
          <li className="text-xs font-medium text-muted-foreground">{t(lang, "loyaltyOffersEmpty")}</li>
        ) : (
          offers.map((o) => (
            <li key={o.id} className="rounded-xl border border-border px-2 py-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-bold text-foreground">
                    {o.title}{" "}
                    <span className="text-xs font-semibold text-muted-foreground">
                      ({o.offerKind} · {o.status}
                      {o.windowActive ? "" : ` · ${t(lang, "loyaltyOffersInactiveWindow")}`})
                    </span>
                  </p>
                  <p className="text-xs text-muted-foreground">priority {o.priority}</p>
                </div>
                {canManage && o.status !== "revoked" ? (
                  <div className="flex gap-1">
                    {o.status === "active" ? (
                      <button
                        type="button"
                        disabled={busy}
                        className="rounded-lg border border-border px-2 py-1 text-xs font-bold"
                        onClick={() => void onStatus(o.id, "paused")}
                      >
                        {t(lang, "loyaltyOffersPause")}
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={busy}
                        className="rounded-lg border border-border px-2 py-1 text-xs font-bold"
                        onClick={() => void onStatus(o.id, "active")}
                      >
                        {t(lang, "loyaltyOffersResume")}
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={busy}
                      className="rounded-lg border border-destructive/40 px-2 py-1 text-xs font-bold text-destructive"
                      onClick={() => void onStatus(o.id, "revoked")}
                    >
                      {t(lang, "loyaltyOffersRevoke")}
                    </button>
                  </div>
                ) : null}
              </div>
            </li>
          ))
        )}
      </ul>

      {canManage ? (
        <div className="mt-3 space-y-2 border-t border-border pt-3">
          <p className="text-xs font-black text-foreground">{t(lang, "loyaltyOffersCreate")}</p>
          <select
            className="w-full rounded-xl border border-border bg-background px-2 py-2 text-sm"
            value={kind}
            onChange={(e) => setKind(e.target.value as LoyaltyOfferKind)}
          >
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
          <input
            className="w-full rounded-xl border border-border bg-background px-2 py-2 text-sm"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t(lang, "loyaltyOffersTitleField")}
          />
          <input
            className="w-full rounded-xl border border-border bg-background px-2 py-2 text-sm"
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
            placeholder={t(lang, "loyaltyOffersPriority")}
          />
          {kind === "earn_multiplier" || kind === "campaign" ? (
            <input
              className="w-full rounded-xl border border-border bg-background px-2 py-2 text-sm"
              value={multiplier}
              onChange={(e) => setMultiplier(e.target.value)}
              placeholder="multiplier"
            />
          ) : null}
          {kind === "earn_bonus_flat" ? (
            <input
              className="w-full rounded-xl border border-border bg-background px-2 py-2 text-sm"
              value={bonusPoints}
              onChange={(e) => setBonusPoints(e.target.value)}
              placeholder="points"
            />
          ) : null}
          {kind === "status_badge" || kind === "campaign" ? (
            <input
              className="w-full rounded-xl border border-border bg-background px-2 py-2 text-sm"
              value={badgeLabel}
              onChange={(e) => setBadgeLabel(e.target.value)}
              placeholder="badge"
            />
          ) : null}
          {kind === "reward_grant" ? (
            <select
              className="w-full rounded-xl border border-border bg-background px-2 py-2 text-sm"
              value={rewardId}
              onChange={(e) => setRewardId(e.target.value)}
            >
              {rewards.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          ) : null}
          <button
            type="button"
            disabled={busy}
            onClick={() => void onCreate()}
            className="min-h-[40px] rounded-xl bg-waka-600 px-3 text-xs font-black text-white disabled:opacity-50"
          >
            {t(lang, "loyaltyOffersSave")}
          </button>
          {error ? <p className="text-xs font-bold text-destructive">{error}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
