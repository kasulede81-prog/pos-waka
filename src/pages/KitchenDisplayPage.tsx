import { useMemo } from "react";
import clsx from "clsx";
import { useSearchParams } from "react-router-dom";
import type { KitchenTicketStatus, Language } from "../types";
import { t } from "../lib/i18n";
import { activeKitchenTickets } from "../lib/hospitalityOps";
import { usePosStore } from "../store/usePosStore";
import { PageBackBar } from "../components/layout/PageBackBar";

const STATUS_FLOW: KitchenTicketStatus[] = ["queued", "preparing", "ready", "served"];

export function KitchenDisplayPage({ lang }: { lang: Language }) {
  const [params] = useSearchParams();
  const stationParam = params.get("station");
  const updateStatus = usePosStore((s) => s.updateKitchenTicketStatus);
  const floor = usePosStore((s) => s.preferences.hospitalityFloor);

  const tickets = useMemo(() => {
    if (!floor) return [];
    const stationFilter =
      stationParam === "bar" ? "bar" : stationParam === "kitchen" ? "kitchen" : undefined;
    return activeKitchenTickets(floor, stationFilter);
  }, [floor, stationParam]);

  const bump = (ticketId: string, current: KitchenTicketStatus) => {
    const idx = STATUS_FLOW.indexOf(current);
    const next = STATUS_FLOW[Math.min(idx + 1, STATUS_FLOW.length - 1)]!;
    updateStatus(ticketId, next);
  };

  return (
    <div className="space-y-4 pb-8">
      <PageBackBar lang={lang} fallbackTo="/floor" label={t(lang, "navFloor")} />
      <div>
        <h1 className="text-2xl font-black text-stone-950">{t(lang, "kitchenDisplayTitle")}</h1>
        <p className="mt-1 text-sm font-medium text-stone-500">
          {tickets.length} {t(lang, "kitchenDisplayWaiting")}
        </p>
      </div>

      {tickets.length === 0 ? (
        <p className="rounded-2xl border border-slate-200 bg-white px-4 py-10 text-center text-sm font-bold text-slate-500">
          {t(lang, "kitchenDisplayEmpty")}
        </p>
      ) : (
        <ul className="space-y-3">
          {tickets.map((ticket) => (
            <li key={ticket.id} className="rounded-2xl border-2 border-amber-200 bg-amber-50 p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-lg font-black text-stone-950">
                    {ticket.tableLabel}
                    {ticket.areaName ? ` · ${ticket.areaName}` : ""}
                  </p>
                  <p className="text-xs font-bold uppercase text-stone-600">
                    #{ticket.ticketNumber} · {ticket.stationType} · {ticket.waiterLabel ?? "—"}
                  </p>
                </div>
                <span className="rounded-lg bg-white px-2 py-1 text-xs font-black uppercase text-amber-900">
                  {ticket.status}
                </span>
              </div>
              <ul className="mt-3 space-y-1 text-sm font-bold text-stone-800">
                {ticket.items.map((item) => (
                  <li key={item.id}>
                    {item.quantity}× {item.productName}
                  </li>
                ))}
              </ul>
              <button
                type="button"
                onClick={() => bump(ticket.id, ticket.status)}
                className={clsx(
                  "mt-4 min-h-12 w-full rounded-xl text-sm font-black text-white",
                  ticket.status === "ready" ? "bg-emerald-600" : "bg-stone-900",
                )}
              >
                {ticket.status === "ready" ? t(lang, "kitchenMarkServed") : t(lang, "kitchenMarkNext")}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
