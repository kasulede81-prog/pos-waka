import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { Language } from "../types";
import { t } from "../lib/i18n";
import { useShopAction } from "../hooks/useShopAction";
import {
  activeProductionTickets,
  computeProductionAlerts,
  computeStationProductionDashboard,
} from "../lib/kitchenProduction";
import { hospitalityRoutingLabelKey } from "../lib/productHospitalityRouting";
import { usePosStore } from "../store/usePosStore";
import { PageBackBar } from "../components/layout/PageBackBar";
import { useHospitalityFloorPoll } from "../hooks/useHospitalityFloorPoll";
import { ProductionStationDashboard } from "../components/hospitality/ProductionStationDashboard";
import {
  CancelItemDialog,
  ProductionTicketCard,
  RecallTicketDialog,
} from "../components/hospitality/ProductionTicketCard";

export function KitchenDisplayPage({ lang }: { lang: Language }) {
  const { run: runShopAction } = useShopAction();
  const [params, setParams] = useSearchParams();
  const stationParam = params.get("station");
  const advanceTicket = usePosStore((s) => s.advanceKitchenTicket);
  const cancelTicket = usePosStore((s) => s.cancelKitchenTicket);
  const recallTicket = usePosStore((s) => s.recallKitchenTicket);
  const cancelItem = usePosStore((s) => s.cancelKitchenTicketItem);
  const reprintKitchenTicket = usePosStore((s) => s.reprintKitchenTicket);
  const cleanupTickets = usePosStore((s) => s.cleanupKitchenTickets);
  const floor = usePosStore((s) => s.preferences.hospitalityFloor);
  const actor = usePosStore((s) => s.sessionActor);

  const [recallId, setRecallId] = useState<string | null>(null);
  const [cancelItemCtx, setCancelItemCtx] = useState<{ ticketId: string; itemId: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useHospitalityFloorPoll(true);

  const activeStations = useMemo(
    () => (floor?.stations ?? []).filter((s) => s.isActive).sort((a, b) => a.sortOrder - b.sortOrder),
    [floor?.stations],
  );

  const selectedStationId = useMemo(() => {
    if (!stationParam) return activeStations[0]?.id;
    const byId = activeStations.find((s) => s.id === stationParam);
    if (byId) return byId.id;
    const byType = activeStations.find((s) => s.stationType === stationParam);
    return byType?.id ?? activeStations[0]?.id;
  }, [activeStations, stationParam]);

  const selectedStation = activeStations.find((s) => s.id === selectedStationId);

  const tickets = useMemo(() => {
    if (!floor || !selectedStationId) return [];
    return activeProductionTickets(floor, { stationId: selectedStationId });
  }, [floor, selectedStationId]);

  const dashboard = useMemo(() => {
    if (!floor || !selectedStationId) {
      return {
        pendingTickets: 0,
        preparingCount: 0,
        readyCount: 0,
        averagePrepMinutes: null,
        longestWaitMinutes: null,
        completedToday: 0,
      };
    }
    return computeStationProductionDashboard(floor, selectedStationId);
  }, [floor, selectedStationId, tickets.length]);

  const alerts = useMemo(() => (floor ? computeProductionAlerts(floor) : []), [floor, tickets.length]);
  const stationAlerts = alerts.filter((a) => a.stationId === selectedStationId);

  const canRecall =
    actor?.role === "owner" || actor?.role === "manager" || actor?.role === "supervisor";

  const pageTitle = selectedStation
    ? selectedStation.name
    : stationParam === "bar"
      ? t(lang, "hospitalityStation_bar")
      : t(lang, "kitchenDisplayTitle");

  return (
    <div className="space-y-4 pb-8">
      <PageBackBar lang={lang} fallbackTo="/floor" label={t(lang, "navFloor")} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-black text-foreground">{pageTitle}</h1>
          <p className="mt-1 text-sm font-medium text-muted-foreground">
            {tickets.length} {t(lang, "kitchenDisplayWaiting")}
          </p>
        </div>
        <button
          type="button"
          onClick={() => cleanupTickets()}
          className="min-h-10 rounded-xl border border-border px-3 text-xs font-black text-muted-foreground"
        >
          {t(lang, "kitchenCleanup")}
        </button>
      </div>

      {activeStations.length > 1 ? (
        <div className="flex flex-wrap gap-2">
          {activeStations.map((st) => (
            <button
              key={st.id}
              type="button"
              onClick={() => setParams({ station: st.id })}
              className={
                st.id === selectedStationId
                  ? "rounded-xl bg-foreground px-3 py-2 text-xs font-black text-background"
                  : "rounded-xl border border-border bg-card px-3 py-2 text-xs font-black text-muted-foreground"
              }
            >
              {st.name}
            </button>
          ))}
        </div>
      ) : selectedStation ? (
        <p className="text-xs font-bold uppercase text-muted-foreground">
          {t(lang, hospitalityRoutingLabelKey(selectedStation.stationType) as "hospitalityStation_kitchen")}
        </p>
      ) : null}

      <ProductionStationDashboard lang={lang} dashboard={dashboard} />

      {stationAlerts.length > 0 ? (
        <ul className="space-y-1 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2">
          {stationAlerts.map((a) => (
            <li key={a.id} className="text-xs font-bold text-amber-950">
              {t(lang, a.messageKey as "productionAlertOverdue")} — {a.tableLabel}
            </li>
          ))}
        </ul>
      ) : null}

      {err ? <p className="text-sm font-bold text-rose-700">{err}</p> : null}

      {tickets.length === 0 ? (
        <p className="rounded-2xl border border-border bg-card px-4 py-10 text-center text-sm font-bold text-muted-foreground">
          {t(lang, "kitchenDisplayEmpty")}
        </p>
      ) : (
        <ul className="space-y-3">
          {tickets.map((ticket) => (
            <ProductionTicketCard
              key={ticket.id}
              lang={lang}
              ticket={ticket}
              stationName={selectedStation?.name}
              canRecall={canRecall}
              onAdvance={() => advanceTicket(ticket.id)}
              onCancel={() => cancelTicket(ticket.id)}
              onRecall={() => setRecallId(ticket.id)}
              onCancelItem={(itemId) => setCancelItemCtx({ ticketId: ticket.id, itemId })}
              onReprint={() => {
                void runShopAction({ lang, action: "kitchen.reprint" }, () => reprintKitchenTicket(ticket.id));
              }}
            />
          ))}
        </ul>
      )}

      <RecallTicketDialog
        lang={lang}
        open={recallId != null}
        onClose={() => setRecallId(null)}
        onConfirm={(reason) => {
          if (!recallId) return;
          const res = recallTicket(recallId, reason);
          if (!res.ok && res.errorKey) setErr(t(lang, res.errorKey as "kitchenRecallNeedsManager"));
          else setErr(null);
          setRecallId(null);
        }}
      />

      <CancelItemDialog
        lang={lang}
        open={cancelItemCtx != null}
        onClose={() => setCancelItemCtx(null)}
        onConfirm={(reason) => {
          if (!cancelItemCtx) return;
          const res = cancelItem(cancelItemCtx.ticketId, cancelItemCtx.itemId, reason);
          if (!res.ok && res.errorKey) setErr(t(lang, res.errorKey as "kitchenCancelItemNeedsManager"));
          else setErr(null);
          setCancelItemCtx(null);
        }}
      />
    </div>
  );
}
