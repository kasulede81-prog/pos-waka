import { useCallback, useEffect, useState } from "react";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { useToast } from "../../context/ToastProvider";
import { loyaltyErrorKey } from "../../lib/loyalty/loyaltyErrorMessages";
import {
  listEnrollmentRequests,
  reviewEnrollmentRequest,
  type EnrollmentRequestRow,
  type EnrollmentRequestStatus,
  type LoyaltyUsage,
} from "../../lib/loyalty/loyaltyEnrollmentRequests";

type Props = {
  lang: Language;
  shopId: string;
  /** Approval/rejection requires settings.shop — the RPC re-checks it server-side too. */
  canManage: boolean;
  /**
   * Fired after a request is settled, so the hub can refresh the Overview, the usage
   * counter and the member list from the server rather than guessing at the delta.
   */
  onChanged?: () => void;
  /** Open the member an approved request produced, in the Members section (keyed by loyalty account id). */
  onOpenMember?: (loyaltyAccountId: string | null) => void;
};

const FILTERS: Array<{ id: EnrollmentRequestStatus | "all"; labelKey: string }> = [
  { id: "pending", labelKey: "loyaltyRequestsFilterPending" },
  { id: "approved", labelKey: "loyaltyRequestsFilterApproved" },
  { id: "rejected", labelKey: "loyaltyRequestsFilterRejected" },
  { id: "expired", labelKey: "loyaltyRequestsFilterExpired" },
  { id: "all", labelKey: "loyaltyRequestsFilterAll" },
];

/**
 * Merchant queue for public enrollment requests (Phase 2).
 *
 * Approval runs entirely in the database — this panel collects the decision and shows
 * the outcome. A refusal at the member allowance is reported as such and the request
 * stays pending, so the merchant can free a slot or upgrade and retry.
 */
export function LoyaltyEnrollmentRequestsPanel({
  lang,
  shopId,
  canManage,
  onChanged,
  onOpenMember,
}: Props) {
  const toast = useToast();
  const [filter, setFilter] = useState<EnrollmentRequestStatus | "all">("pending");
  const [requests, setRequests] = useState<EnrollmentRequestRow[]>([]);
  const [usage, setUsage] = useState<LoyaltyUsage | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const result = await listEnrollmentRequests(shopId, filter);
    setLoading(false);
    if (!result.ok) {
      setRequests([]);
      setUsage(null);
      return;
    }
    setRequests(result.requests);
    setUsage(result.usage);
  }, [shopId, filter]);

  useEffect(() => {
    void load();
  }, [load]);

  const decide = async (row: EnrollmentRequestRow, action: "approve" | "reject", reason?: string) => {
    setBusyId(row.id);
    const result = await reviewEnrollmentRequest({
      shopId,
      requestId: row.id,
      action,
      rejectionReason: reason ?? null,
    });
    setBusyId(null);

    if (!result.ok) {
      // Never imply success, and never show the raw RPC code: say what blocked it.
      toast.error(t(lang, loyaltyErrorKey(result.error)));
      await load();
      onChanged?.();
      return;
    }
    toast.success(
      action === "approve" ? t(lang, "loyaltyRequestsApproved") : t(lang, "loyaltyRequestsRejected"),
    );
    setRejectingId(null);
    setRejectReason("");
    // Refresh the queue AND the hub: an approval changes the member count and the
    // allowance, and the request must disappear from pending immediately.
    await load();
    onChanged?.();
  };

  return (
    <section className="space-y-4">
      <article className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <p className="text-sm font-black text-foreground">{t(lang, "loyaltyRequestsTitle")}</p>
        <p className="mt-1 text-xs font-medium text-muted-foreground">
          {t(lang, "loyaltyRequestsSub")}
        </p>
        {usage ? (
          <p className="mt-2 text-xs font-bold text-muted-foreground">
            {usage.loyaltyEnabled
              ? t(lang, "loyaltyRequestsUsage")
                  .replace("{used}", String(usage.activeMembers))
                  .replace("{limit}", String(usage.memberLimit))
              : t(lang, "loyaltyRequestsNotEnabled")}
          </p>
        ) : null}
        {usage?.loyaltyEnabled && usage.pendingQueueFull ? (
          <p className="mt-2 rounded-xl border border-warning/40 bg-warning-muted px-3 py-2 text-xs font-bold text-warning-foreground">
            {t(lang, "loyaltyRequestsQueueFull").replace("{limit}", String(usage.pendingQueueLimit))}
          </p>
        ) : null}
        <div className="mt-3 flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              className={`min-h-[36px] rounded-xl px-3 text-xs font-black ${
                filter === f.id ? "bg-waka-600 text-white" : "bg-muted text-foreground"
              }`}
            >
              {t(lang, f.labelKey)}
            </button>
          ))}
        </div>
      </article>

      {loading ? (
        <p className="text-sm font-medium text-muted-foreground">{t(lang, "loyaltyLoading")}</p>
      ) : requests.length === 0 ? (
        <p className="rounded-2xl border border-border bg-card p-4 text-sm font-medium text-muted-foreground">
          {t(lang, "loyaltyRequestsEmpty")}
        </p>
      ) : (
        <ul className="space-y-2">
          {requests.map((row) => (
            <li key={row.id} className="rounded-2xl border border-border bg-card p-4 shadow-sm">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-black text-foreground">{row.name}</p>
                <span className="rounded-lg bg-muted px-2 py-0.5 text-[10px] font-black uppercase text-muted-foreground">
                  {row.status}
                </span>
              </div>
              <p className="mt-1 text-xs font-semibold text-muted-foreground">{row.phoneE164}</p>
              {row.email ? (
                <p className="text-xs font-semibold text-muted-foreground">{row.email}</p>
              ) : null}
              <p className="mt-1 text-xs font-medium text-muted-foreground">
                {t(lang, "loyaltyRequestsRequested")}: {row.requestedAt.slice(0, 16).replace("T", " ")}
              </p>
              {row.reviewedAt ? (
                <p className="text-xs font-medium text-muted-foreground">
                  {t(lang, "loyaltyRequestsReviewed")}: {row.reviewedAt.slice(0, 16).replace("T", " ")}
                </p>
              ) : null}
              {row.rejectionReason ? (
                <p className="mt-1 text-xs font-semibold text-rose-800">{row.rejectionReason}</p>
              ) : null}
              {/* An approved request points at the member it produced; the member itself
                  lives in the Members list (expanded by loyalty account id). */}
              {row.status === "approved" && row.approvedLoyaltyAccountId ? (
                <button
                  type="button"
                  onClick={onOpenMember ? () => onOpenMember(row.approvedLoyaltyAccountId) : undefined}
                  disabled={!onOpenMember || !row.approvedLoyaltyAccountId}
                  className="mt-2 text-xs font-black text-waka-700 underline disabled:no-underline disabled:opacity-60"
                >
                  {t(lang, "loyaltyRequestsViewMember")}
                </button>
              ) : null}

              {canManage && row.status === "pending" ? (
                rejectingId === row.id ? (
                  <div className="mt-3 space-y-2">
                    <input
                      value={rejectReason}
                      onChange={(e) => setRejectReason(e.target.value.slice(0, 280))}
                      placeholder={t(lang, "loyaltyRequestsRejectReason")}
                      className="min-h-[44px] w-full rounded-xl border-2 border-border bg-background px-3 text-sm font-semibold"
                    />
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setRejectingId(null);
                          setRejectReason("");
                        }}
                        className="min-h-[44px] flex-1 rounded-xl border border-border bg-card text-sm font-bold text-muted-foreground"
                      >
                        {t(lang, "pendingSalesCancel")}
                      </button>
                      <button
                        type="button"
                        disabled={busyId === row.id}
                        onClick={() => void decide(row, "reject", rejectReason)}
                        className="min-h-[44px] flex-1 rounded-xl bg-rose-700 text-sm font-black text-white disabled:opacity-50"
                      >
                        {t(lang, "loyaltyRequestsReject")}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={busyId === row.id}
                      onClick={() => void decide(row, "approve")}
                      className="min-h-[44px] rounded-xl bg-waka-600 px-4 text-sm font-black text-white disabled:opacity-50"
                    >
                      {t(lang, "loyaltyRequestsApprove")}
                    </button>
                    <button
                      type="button"
                      disabled={busyId === row.id}
                      onClick={() => {
                        setRejectingId(row.id);
                        setRejectReason("");
                      }}
                      className="min-h-[44px] rounded-xl border-2 border-border px-4 text-sm font-black disabled:opacity-50"
                    >
                      {t(lang, "loyaltyRequestsReject")}
                    </button>
                  </div>
                )
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
