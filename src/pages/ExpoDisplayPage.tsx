import { useMemo } from "react";
import type { Language } from "../types";
import { t } from "../lib/i18n";
import { expoTickets } from "../lib/kitchenProduction";
import { usePosStore } from "../store/usePosStore";
import { PageBackBar } from "../components/layout/PageBackBar";
import { useHospitalityFloorPoll } from "../hooks/useHospitalityFloorPoll";

function ExpoSection({
  lang,
  title,
  tickets,
}: {
  lang: Language;
  title: string;
  tickets: ReturnType<typeof expoTickets>;
}) {
  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-4">
      <h2 className="text-sm font-black uppercase tracking-wide text-stone-600">{title}</h2>
      {tickets.length === 0 ? (
        <p className="mt-3 text-sm font-medium text-stone-400">{t(lang, "expoSectionEmpty")}</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {tickets.map((ticket) => (
            <li key={ticket.id} className="rounded-xl border border-stone-100 bg-stone-50 px-3 py-2">
              <p className="font-black text-stone-950">
                {ticket.tableLabel}
                {ticket.areaName ? ` · ${ticket.areaName}` : ""}
              </p>
              <p className="text-xs font-bold text-stone-500">
                #{ticket.ticketNumber} · {ticket.waiterLabel ?? "—"}
              </p>
              <ul className="mt-1 text-sm font-semibold text-stone-700">
                {ticket.items
                  .filter((i) => i.itemStatus !== "cancelled")
                  .map((item) => (
                    <li key={item.id}>
                      {item.quantity}× {item.productName}
                    </li>
                  ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function ExpoDisplayPage({ lang }: { lang: Language }) {
  const floor = usePosStore((s) => s.preferences.hospitalityFloor);
  const advanceTicket = usePosStore((s) => s.advanceKitchenTicket);

  useHospitalityFloorPoll(true);

  const kitchenReady = useMemo(() => (floor ? expoTickets(floor, "kitchen_ready") : []), [floor]);
  const barReady = useMemo(() => (floor ? expoTickets(floor, "bar_ready") : []), [floor]);
  const waitingPickup = useMemo(() => (floor ? expoTickets(floor, "waiting_pickup") : []), [floor]);
  const pickedUp = useMemo(() => (floor ? expoTickets(floor, "picked_up") : []), [floor]);

  return (
    <div className="space-y-4 pb-8">
      <PageBackBar lang={lang} fallbackTo="/floor" label={t(lang, "navFloor")} />
      <div>
        <h1 className="text-2xl font-black text-stone-950">{t(lang, "expoDisplayTitle")}</h1>
        <p className="mt-1 text-sm font-medium text-stone-500">{t(lang, "expoDisplaySub")}</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ExpoSection lang={lang} title={t(lang, "expoKitchenReady")} tickets={kitchenReady} />
        <ExpoSection lang={lang} title={t(lang, "expoBarReady")} tickets={barReady} />
        <ExpoSection lang={lang} title={t(lang, "expoWaitingPickup")} tickets={waitingPickup} />
        <ExpoSection lang={lang} title={t(lang, "expoPickedUp")} tickets={pickedUp} />
      </div>

      {waitingPickup.length > 0 ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
          <p className="text-sm font-bold text-emerald-900">{t(lang, "expoPickupHint")}</p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {waitingPickup.map((ticket) => (
              <button
                key={ticket.id}
                type="button"
                onClick={() => advanceTicket(ticket.id)}
                className="min-h-10 rounded-xl bg-emerald-600 px-4 text-xs font-black text-white"
              >
                {ticket.tableLabel} — {t(lang, "expoMarkPickedUp")}
              </button>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
