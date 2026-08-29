import { useMemo, useState } from "react";
import { actorHasPermission } from "../lib/actorAuthorization";
import { useNavigate } from "react-router-dom";
import type { BusinessType, Language, Sale } from "../types";
import { t } from "../lib/i18n";
import { formatUgx } from "../lib/formatUgx";
import { pendingSales } from "../lib/saleStatus";
import { cartVoidCopyKeys, type CartVoidMode } from "../lib/saleLifecycle";
import { isHospitalityMode } from "../lib/hospitality";
import { isPharmacyMode } from "../lib/pharmacy";
import { isWholesaleMode } from "../lib/wholesale";
import { usePosStore } from "../store/usePosStore";
import { PageBackBar } from "../components/layout/PageBackBar";
import { CartVoidConfirmDialog } from "../components/pos/CartVoidConfirmDialog";
import { useSessionActor } from "../context/SessionActorContext";
import { useProtectedAction } from "../hooks/useProtectedAction";

function formatWhen(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, { hour: "2-digit", minute: "2-digit", month: "short", day: "numeric" });
  } catch {
    return iso;
  }
}

function pendingCancelVoidMode(
  sale: Sale | null,
  prefs: {
    businessType: BusinessType;
    pharmacyModeEnabled?: boolean | null;
    hospitalityModeEnabled?: boolean | null;
  },
): CartVoidMode {
  if (sale?.tableSessionId) return "hospitality";
  if (isPharmacyMode(prefs.businessType, prefs.pharmacyModeEnabled)) return "pharmacy";
  if (isWholesaleMode(prefs.businessType)) return "wholesale";
  if (isHospitalityMode(prefs.businessType, prefs.hospitalityModeEnabled)) return "hospitality";
  return "retail";
}

export function PendingSalesPage({ lang }: { lang: Language }) {
  const navigate = useNavigate();
  const actor = useSessionActor();
  const { runProtected } = useProtectedAction();
  const sales = usePosStore((s) => s.sales);
  const resumePendingSale = usePosStore((s) => s.resumePendingSale);
  const cancelPendingSale = usePosStore((s) => s.cancelPendingSale);
  const preferences = usePosStore((s) => s.preferences);
  const floor = preferences.hospitalityFloor;
  const [voidingSale, setVoidingSale] = useState<Sale | null>(null);

  const rows = useMemo(() => pendingSales(sales).sort((a, b) => (b.updatedAt ?? b.createdAt).localeCompare(a.updatedAt ?? a.createdAt)), [sales]);

  const voidCopy = useMemo(
    () =>
      cartVoidCopyKeys({
        activePendingSaleId: voidingSale?.id ?? "pending",
        mode: pendingCancelVoidMode(voidingSale, preferences),
      }),
    [voidingSale, preferences],
  );

  const resume = (sale: Sale) => {
    const res = resumePendingSale(sale.id);
    if (!res.ok) return;
    if (sale.tableSessionId) {
      navigate(`/floor/order/${sale.tableSessionId}`);
      return;
    }
    navigate("/pos");
  };

  const canCancel = actorHasPermission(actor, "pending_sales.manage");

  return (
    <div className="space-y-4 pb-8">
      <PageBackBar lang={lang} fallbackTo="/" label={t(lang, "navHome")} />
      <div>
        <h1 className="text-2xl font-black text-foreground">{t(lang, "pendingSalesTitle")}</h1>
        <p className="mt-1 text-sm font-medium text-muted-foreground">{t(lang, "pendingSalesSub")}</p>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-2xl border border-border bg-card px-4 py-10 text-center text-sm font-bold text-muted-foreground">
          {t(lang, "pendingSalesEmpty")}
        </p>
      ) : (
        <ul className="space-y-2">
          {rows.map((sale) => {
            const session = sale.tableSessionId
              ? floor?.sessions.find((s) => s.id === sale.tableSessionId)
              : undefined;
            const table = session ? floor?.tables.find((t) => t.id === session.tableId) : undefined;
            const label = sale.referenceLabel || table?.label || t(lang, "pendingSalesWaiting");
            return (
              <li key={sale.id} className="rounded-2xl border border-border bg-card p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-base font-black text-foreground">{label}</p>
                    <p className="text-sm font-bold text-waka-700">{formatUgx(sale.totalUgx)}</p>
                    <p className="text-xs font-medium text-muted-foreground">
                      {sale.lines.length} {t(lang, "pendingSalesItems")} · {formatWhen(sale.updatedAt ?? sale.createdAt)}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col gap-2">
                    <button
                      type="button"
                      onClick={() => resume(sale)}
                      className="min-h-10 rounded-xl bg-waka-600 px-4 text-xs font-black text-white"
                    >
                      {t(lang, "pendingSalesResume")}
                    </button>
                    {canCancel ? (
                      <button
                        type="button"
                        onClick={() => setVoidingSale(sale)}
                        className="min-h-10 rounded-xl border border-rose-200 px-4 text-xs font-black text-rose-800"
                      >
                        {t(lang, "pendingSalesCancel")}
                      </button>
                    ) : null}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <CartVoidConfirmDialog
        lang={lang}
        open={Boolean(voidingSale)}
        copy={voidCopy}
        onKeep={() => setVoidingSale(null)}
        onConfirm={() => {
          const saleId = voidingSale?.id;
          if (!saleId) return;
          void runProtected("delete_transaction", () => {
            const res = cancelPendingSale(saleId);
            if (res.ok) setVoidingSale(null);
          });
        }}
      />
    </div>
  );
}
