import { useEffect, useMemo, useState } from "react";
import type { Language } from "../types";
import { t } from "../lib/i18n";
import { computeFloorNotifications, reservationsForDate } from "../lib/hospitalityFrontOfHouse";
import { usePosStore } from "../store/usePosStore";
import { PageBackBar } from "../components/layout/PageBackBar";

type ViewMode = "daily" | "weekly" | "timeline";

export function ReservationCalendarPage({ lang }: { lang: Language }) {
  const floor = usePosStore((s) => s.preferences.hospitalityFloor);
  const ensureHospitalityFloor = usePosStore((s) => s.ensureHospitalityFloor);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [view, setView] = useState<ViewMode>("daily");
  const updateReservation = usePosStore((s) => s.updateTableReservation);

  useEffect(() => ensureHospitalityFloor(), [ensureHospitalityFloor]);

  const reservations = useMemo(() => (floor ? reservationsForDate(floor, date) : []), [floor, date]);
  const notifications = useMemo(() => (floor ? computeFloorNotifications(floor) : []), [floor]);

  const weekDates = useMemo(() => {
    const start = new Date(date);
    const day = start.getDay();
    start.setDate(start.getDate() - day);
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return d.toISOString().slice(0, 10);
    });
  }, [date]);

  if (!floor) return null;

  return (
    <div className="space-y-4 pb-8">
      <PageBackBar lang={lang} fallbackTo="/floor" label={t(lang, "navFloor")} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-black text-stone-950">{t(lang, "reservationCalendarTitle")}</h1>
          <p className="text-sm font-medium text-stone-500">{t(lang, "reservationCalendarSub")}</p>
        </div>
        <div className="flex gap-1 rounded-xl border border-stone-200 bg-white p-1">
          {(["daily", "weekly", "timeline"] as ViewMode[]).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              className={view === v ? "rounded-lg bg-stone-900 px-3 py-1.5 text-xs font-black text-white" : "rounded-lg px-3 py-1.5 text-xs font-bold text-stone-600"}
            >
              {t(lang, `reservationView_${v}` as "reservationView_daily")}
            </button>
          ))}
        </div>
      </div>

      {notifications.length > 0 ? (
        <ul className="space-y-1 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">
          {notifications.slice(0, 5).map((n) => (
            <li key={n.id} className="text-xs font-bold text-amber-950">
              {t(lang, n.messageKey as "fohAlertReservationArriving")} — {n.tableLabel}
            </li>
          ))}
        </ul>
      ) : null}

      <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="rounded-xl border border-stone-200 px-3 py-2 text-sm font-bold" />

      {view === "daily" ? (
        <ul className="space-y-2">
          {reservations.map((r) => (
            <li key={r.id} className="rounded-xl border border-stone-200 bg-white p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-black text-stone-950">
                    {r.reservationTime} · {r.guestName} (#{r.reservationNumber})
                  </p>
                  <p className="text-xs font-semibold text-stone-500">
                    {r.guestCount} guests · {r.phone} · {t(lang, `reservationStatus_${r.status}` as "reservationStatus_confirmed")}
                  </p>
                </div>
                <select
                  value={r.preferredTableId ?? ""}
                  onChange={(e) => updateReservation(r.id, { preferredTableId: e.target.value || null })}
                  className="rounded-lg border border-stone-200 px-2 py-1 text-xs font-bold"
                >
                  <option value="">{t(lang, "reservationAnyTable")}</option>
                  {floor.tables.filter((tble) => tble.isActive).map((tble) => (
                    <option key={tble.id} value={tble.id}>{tble.label}</option>
                  ))}
                </select>
              </div>
            </li>
          ))}
          {reservations.length === 0 ? (
            <p className="py-10 text-center text-sm font-semibold text-stone-400">{t(lang, "reservationCalendarEmpty")}</p>
          ) : null}
        </ul>
      ) : null}

      {view === "weekly" ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {weekDates.map((d) => {
            const dayRes = reservationsForDate(floor, d);
            return (
              <div key={d} className="rounded-xl border border-stone-200 bg-white p-3">
                <p className="text-xs font-black uppercase text-stone-500">{d}</p>
                <p className="mt-1 text-2xl font-black text-stone-900">{dayRes.length}</p>
                <ul className="mt-2 space-y-1 text-xs font-semibold text-stone-600">
                  {dayRes.slice(0, 3).map((r) => (
                    <li key={r.id}>{r.reservationTime} {r.guestName}</li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      ) : null}

      {view === "timeline" ? (
        <div className="overflow-x-auto rounded-xl border border-stone-200 bg-white p-4">
          <div className="min-w-[600px] space-y-2">
            {Array.from({ length: 24 }, (_, h) => {
              const slot = `${String(h).padStart(2, "0")}:00`;
              const slotRes = reservations.filter((r) => r.reservationTime.startsWith(String(h).padStart(2, "0")));
              return (
                <div key={slot} className="flex gap-3 border-b border-stone-100 py-2">
                  <span className="w-12 shrink-0 text-xs font-black text-stone-400">{slot}</span>
                  <div className="flex flex-1 flex-wrap gap-2">
                    {slotRes.map((r) => (
                      <span key={r.id} className="rounded-lg bg-violet-100 px-2 py-1 text-xs font-bold text-violet-900">
                        {r.guestName} ({r.guestCount})
                      </span>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
