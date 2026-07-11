import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import {
  PROMOTIONAL_PLAN_CODES,
  isGrantActive,
  promotionalPlanLabel,
  type PromotionalGrant,
  type PromotionalPlanCode,
} from "../../../lib/growthCampaigns";
import { subscriptionEngine } from "../../../lib/subscriptionEngine";
import {
  fetchPromotionalGrantsForShop,
} from "../../../lib/growthCampaignsAdmin";

type Props = {
  shopId: string;
  canManage: boolean;
  previewMode?: boolean;
};

const SOURCE_LABELS: Record<string, string> = {
  growth_campaign: "Growth campaign",
  referral_code: "Referral code",
  manual_admin: "Manual grant",
};

/**
 * Shop Management — Grant Promotional Access (grant / extend / revoke).
 * Grants give temporary premium access; the paid subscription row is untouched
 * and the shop falls back to it automatically on expiry or revoke.
 */
export function PromotionalAccessPanel({ shopId, canManage, previewMode = false }: Props) {
  const [grants, setGrants] = useState<PromotionalGrant[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [plan, setPlan] = useState<PromotionalPlanCode>("business");
  const [days, setDays] = useState(180);
  const [reason, setReason] = useState("");
  const [extendDays, setExtendDays] = useState(30);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (previewMode) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setGrants(await fetchPromotionalGrantsForShop(shopId));
    setLoading(false);
  }, [shopId, previewMode]);

  useEffect(() => {
    void load();
  }, [load]);

  const after = async (res: { ok: boolean; message?: string }, okText: string) => {
    setBusy(false);
    if (!res.ok) {
      setMessage(`Failed: ${res.message ?? "unknown error"}`);
      return;
    }
    setMessage(okText);
    await load();
  };

  const handleGrant = async () => {
    if (busy || previewMode) return;
    setBusy(true);
    setMessage(null);
    const res = await subscriptionEngine.grantPromotionalAccess({ shopId, planCode: plan, days, reason });
    await after(res, "Promotional access granted.");
  };

  const handleExtend = async (grantId: string) => {
    if (busy || previewMode) return;
    setBusy(true);
    setMessage(null);
    const res = await subscriptionEngine.extendPromotionalAccess({
      grantId,
      shopId,
      extraDays: extendDays,
      reason: reason || undefined,
    });
    await after(res, "Grant extended.");
  };

  const handleRevoke = async (grantId: string) => {
    if (busy || previewMode) return;
    if (!window.confirm("Revoke this promotional grant? The shop falls back to its real subscription.")) return;
    setBusy(true);
    setMessage(null);
    const res = await subscriptionEngine.revokePromotionalGrant({
      grantId,
      shopId,
      reason: reason || undefined,
    });
    await after(res, "Grant revoked.");
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-4">
        <Loader2 className="h-5 w-5 animate-spin text-waka-600" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Temporary premium access for growth campaigns. The paid subscription stays untouched — on expiry or
        revoke the shop falls back to it (or to Free).
      </p>

      {message ? (
        <p className="rounded-xl bg-waka-50 px-3 py-2 text-xs font-bold text-waka-900">{message}</p>
      ) : null}

      {grants.length > 0 ? (
        <ul className="space-y-2">
          {grants.map((g) => {
            const active = isGrantActive(g);
            return (
              <li key={g.id} className="rounded-xl border border-border bg-muted/70 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-black text-foreground">
                      {promotionalPlanLabel(g.planCode as PromotionalPlanCode)}
                      <span
                        className={`ml-2 rounded-full px-2 py-0.5 text-[10px] font-black uppercase ${
                          active
                            ? "bg-emerald-100 text-emerald-800"
                            : g.revokedAt
                              ? "bg-rose-100 text-rose-800"
                              : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {active ? "Active" : g.revokedAt ? "Revoked" : "Expired"}
                      </span>
                    </p>
                    <p className="text-[11px] font-semibold text-muted-foreground">
                      {SOURCE_LABELS[g.grantedBy] ?? g.grantedBy} · expires{" "}
                      {new Date(g.expiresAt).toLocaleDateString("en-GB")}
                      {g.reason ? ` · ${g.reason}` : ""}
                    </p>
                  </div>
                  {active && canManage ? (
                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void handleExtend(g.id)}
                        className="min-h-[40px] rounded-xl bg-foreground px-3 text-xs font-black text-background disabled:opacity-40"
                      >
                        Extend +{extendDays}d
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void handleRevoke(g.id)}
                        className="min-h-[40px] rounded-xl border border-rose-300 px-3 text-xs font-black text-rose-700 disabled:opacity-40"
                      >
                        Revoke
                      </button>
                    </div>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-sm font-semibold text-muted-foreground">No promotional grants for this shop.</p>
      )}

      {canManage ? (
        <div className="rounded-xl border border-border bg-card p-3">
          <p className="mb-2 text-xs font-black uppercase tracking-wide text-muted-foreground">Grant Promotional Access</p>
          <div className="grid gap-2 sm:grid-cols-3">
            <select
              value={plan}
              onChange={(e) => setPlan(e.target.value as PromotionalPlanCode)}
              disabled={busy}
              className="min-h-[44px] rounded-xl border border-border bg-card px-3 text-sm font-black text-foreground outline-none focus:ring-2 focus:ring-waka-200"
            >
              {PROMOTIONAL_PLAN_CODES.map((p) => (
                <option key={p} value={p}>
                  {promotionalPlanLabel(p)}
                </option>
              ))}
            </select>
            <input
              type="number"
              min={1}
              max={3650}
              value={days}
              onChange={(e) => setDays(Math.max(1, Number(e.target.value) || 30))}
              disabled={busy}
              className="min-h-[44px] rounded-xl border border-border bg-card px-3 text-sm font-black text-foreground outline-none focus:ring-2 focus:ring-waka-200"
              placeholder="Days"
            />
            <input
              type="number"
              min={1}
              max={3650}
              value={extendDays}
              onChange={(e) => setExtendDays(Math.max(1, Number(e.target.value) || 30))}
              disabled={busy}
              className="min-h-[44px] rounded-xl border border-border bg-card px-3 text-sm font-black text-foreground outline-none focus:ring-2 focus:ring-waka-200"
              placeholder="Extend days"
              title="Days used by the Extend button"
            />
          </div>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            disabled={busy}
            className="mt-2 min-h-[44px] w-full rounded-xl border border-border bg-card px-3 text-sm font-semibold text-foreground outline-none focus:ring-2 focus:ring-waka-200"
            placeholder="Reason (e.g. launch promo, support goodwill)"
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => void handleGrant()}
            className="mt-2 flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-waka-600 text-sm font-black text-white disabled:opacity-40"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Grant Promotional Access
          </button>
        </div>
      ) : (
        <p className="text-xs font-semibold text-muted-foreground">You don't have permission to manage grants.</p>
      )}
    </div>
  );
}
