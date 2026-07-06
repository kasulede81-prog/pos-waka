import { useMemo, useState } from "react";
import type { HospitalityFloorState, Language, TableReservation } from "../../types";
import { t } from "../../lib/i18n";
import { lookupCustomerProfile } from "../../lib/hospitalityFrontOfHouse";
import type { Sale } from "../../types";

type Props = {
  lang: Language;
  open: boolean;
  reservation: TableReservation;
  floor: HospitalityFloorState;
  sales: Sale[];
  onClose: () => void;
  onSeat: () => void;
  onConfirm: () => void;
  onCancel: (reason: string) => void;
  onNoShow: () => void;
};

export function ReservationDetailDialog({
  lang,
  open,
  reservation,
  floor,
  sales,
  onClose,
  onSeat,
  onConfirm,
  onCancel,
  onNoShow,
}: Props) {
  const [cancelReason, setCancelReason] = useState("");
  const [showCancel, setShowCancel] = useState(false);
  const profile = useMemo(
    () => lookupCustomerProfile(reservation.phone, floor, sales),
    [reservation.phone, floor, sales],
  );

  if (!open) return null;

  const table = reservation.preferredTableId
    ? floor.tables.find((t) => t.id === reservation.preferredTableId)
    : undefined;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-3xl bg-white p-5 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-black uppercase text-violet-700">
              #{reservation.reservationNumber} · {t(lang, `reservationStatus_${reservation.status}` as "reservationStatus_confirmed")}
            </p>
            <h2 className="text-xl font-black text-stone-950">{reservation.guestName}</h2>
            <p className="text-sm font-medium text-stone-500">
              {reservation.reservationDate} · {reservation.reservationTime} · {reservation.guestCount}{" "}
              {t(lang, "tableOrderGuests")}
            </p>
          </div>
          {reservation.isVip ? (
            <span className="rounded-lg bg-violet-700 px-2 py-1 text-[10px] font-black uppercase text-white">VIP</span>
          ) : null}
        </div>

        <dl className="mt-4 space-y-2 text-sm">
          <div>
            <dt className="font-bold text-stone-500">{t(lang, "reservationPhone")}</dt>
            <dd className="font-semibold text-stone-900">{reservation.phone}</dd>
          </div>
          {reservation.email ? (
            <div>
              <dt className="font-bold text-stone-500">{t(lang, "reservationEmail")}</dt>
              <dd className="font-semibold text-stone-900">{reservation.email}</dd>
            </div>
          ) : null}
          {table ? (
            <div>
              <dt className="font-bold text-stone-500">{t(lang, "reservationTable")}</dt>
              <dd className="font-semibold text-stone-900">{table.label}</dd>
            </div>
          ) : null}
          {reservation.notes ? (
            <div>
              <dt className="font-bold text-stone-500">{t(lang, "reservationNotes")}</dt>
              <dd className="font-semibold text-stone-900">{reservation.notes}</dd>
            </div>
          ) : null}
        </dl>

        {profile ? (
          <div className="mt-4 rounded-xl border border-stone-200 bg-stone-50 p-3 text-xs">
            <p className="font-black uppercase text-stone-500">{t(lang, "customerHistoryTitle")}</p>
            <p className="mt-1 font-semibold text-stone-800">
              {profile.visitCount} {t(lang, "customerHistoryVisits")} · avg UGX {profile.averageSpendUgx.toLocaleString()}
            </p>
            {profile.preferredWaiterLabel ? (
              <p className="mt-0.5 text-stone-600">
                {t(lang, "customerHistoryPreferredWaiter")}: {profile.preferredWaiterLabel}
              </p>
            ) : null}
            {profile.specialNotes ? <p className="mt-0.5 text-stone-600">{profile.specialNotes}</p> : null}
          </div>
        ) : null}

        {showCancel ? (
          <textarea
            value={cancelReason}
            onChange={(e) => setCancelReason(e.target.value)}
            placeholder={t(lang, "reservationCancelReasonPh")}
            className="mt-4 min-h-20 w-full rounded-xl border border-stone-200 px-3 py-2 text-sm"
          />
        ) : null}

        <div className="mt-5 grid gap-2">
          {(reservation.status === "pending" || reservation.status === "confirmed") && !showCancel ? (
            <>
              {reservation.status === "pending" ? (
                <button type="button" onClick={onConfirm} className="min-h-12 rounded-xl bg-violet-600 font-black text-white">
                  {t(lang, "reservationConfirm")}
                </button>
              ) : null}
              <button type="button" onClick={onSeat} className="min-h-12 rounded-xl bg-waka-600 font-black text-white">
                {t(lang, "reservationSeat")}
              </button>
              <button type="button" onClick={onNoShow} className="min-h-11 rounded-xl border border-stone-200 font-bold text-stone-700">
                {t(lang, "reservationNoShow")}
              </button>
              <button type="button" onClick={() => setShowCancel(true)} className="min-h-11 rounded-xl border border-rose-200 font-bold text-rose-800">
                {t(lang, "reservationCancel")}
              </button>
            </>
          ) : showCancel ? (
            <button
              type="button"
              disabled={!cancelReason.trim()}
              onClick={() => {
                onCancel(cancelReason.trim());
                setShowCancel(false);
                setCancelReason("");
              }}
              className="min-h-12 rounded-xl bg-rose-600 font-black text-white disabled:opacity-50"
            >
              {t(lang, "reservationCancelConfirm")}
            </button>
          ) : null}
          <button type="button" onClick={onClose} className="min-h-11 rounded-xl border border-stone-200 font-bold text-stone-600">
            {t(lang, "cancel")}
          </button>
        </div>
      </div>
    </div>
  );
}

export function ReservationFormDialog({
  lang,
  open,
  areas,
  tables,
  onClose,
  onSubmit,
}: {
  lang: Language;
  open: boolean;
  areas: { id: string; name: string }[];
  tables: { id: string; label: string; areaId: string; capacity?: number }[];
  onClose: () => void;
  onSubmit: (input: {
    guestName: string;
    phone: string;
    email?: string;
    guestCount: number;
    reservationDate: string;
    reservationTime: string;
    areaId?: string;
    preferredTableId?: string;
    notes?: string;
    isVip: boolean;
  }) => void;
}) {
  const [guestName, setGuestName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [guestCount, setGuestCount] = useState(2);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [time, setTime] = useState("19:00");
  const [areaId, setAreaId] = useState(areas[0]?.id ?? "");
  const [tableId, setTableId] = useState("");
  const [notes, setNotes] = useState("");
  const [isVip, setIsVip] = useState(false);

  const areaTables = tables.filter((t) => t.areaId === areaId);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-3xl bg-white p-5 shadow-xl">
        <h2 className="text-xl font-black text-stone-950">{t(lang, "reservationNewTitle")}</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="sm:col-span-2">
            <span className="text-xs font-bold text-stone-600">{t(lang, "reservationGuestName")}</span>
            <input value={guestName} onChange={(e) => setGuestName(e.target.value)} className="mt-1 w-full rounded-xl border border-stone-200 px-3 py-2 text-sm" />
          </label>
          <label>
            <span className="text-xs font-bold text-stone-600">{t(lang, "reservationPhone")}</span>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} className="mt-1 w-full rounded-xl border border-stone-200 px-3 py-2 text-sm" />
          </label>
          <label>
            <span className="text-xs font-bold text-stone-600">{t(lang, "reservationEmail")}</span>
            <input value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1 w-full rounded-xl border border-stone-200 px-3 py-2 text-sm" />
          </label>
          <label>
            <span className="text-xs font-bold text-stone-600">{t(lang, "openTableGuests")}</span>
            <input type="number" min={1} value={guestCount} onChange={(e) => setGuestCount(Number(e.target.value) || 1)} className="mt-1 w-full rounded-xl border border-stone-200 px-3 py-2 text-sm" />
          </label>
          <label>
            <span className="text-xs font-bold text-stone-600">{t(lang, "reservationDate")}</span>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="mt-1 w-full rounded-xl border border-stone-200 px-3 py-2 text-sm" />
          </label>
          <label>
            <span className="text-xs font-bold text-stone-600">{t(lang, "reservationTime")}</span>
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="mt-1 w-full rounded-xl border border-stone-200 px-3 py-2 text-sm" />
          </label>
          <label>
            <span className="text-xs font-bold text-stone-600">{t(lang, "reservationArea")}</span>
            <select value={areaId} onChange={(e) => setAreaId(e.target.value)} className="mt-1 w-full rounded-xl border border-stone-200 px-3 py-2 text-sm font-bold">
              {areas.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </label>
          <label>
            <span className="text-xs font-bold text-stone-600">{t(lang, "reservationTable")}</span>
            <select value={tableId} onChange={(e) => setTableId(e.target.value)} className="mt-1 w-full rounded-xl border border-stone-200 px-3 py-2 text-sm font-bold">
              <option value="">{t(lang, "reservationAnyTable")}</option>
              {areaTables.map((tble) => (
                <option key={tble.id} value={tble.id}>{tble.label} ({tble.capacity ?? 4})</option>
              ))}
            </select>
          </label>
          <label className="sm:col-span-2 flex items-center gap-2">
            <input type="checkbox" checked={isVip} onChange={(e) => setIsVip(e.target.checked)} />
            <span className="text-sm font-bold">VIP</span>
          </label>
          <label className="sm:col-span-2">
            <span className="text-xs font-bold text-stone-600">{t(lang, "reservationNotes")}</span>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="mt-1 min-h-16 w-full rounded-xl border border-stone-200 px-3 py-2 text-sm" />
          </label>
        </div>
        <div className="mt-4 flex gap-2">
          <button type="button" onClick={onClose} className="min-h-11 flex-1 rounded-xl border border-stone-200 font-bold">{t(lang, "cancel")}</button>
          <button
            type="button"
            disabled={!guestName.trim() || !phone.trim()}
            onClick={() =>
              onSubmit({
                guestName: guestName.trim(),
                phone: phone.trim(),
                email: email.trim() || undefined,
                guestCount,
                reservationDate: date,
                reservationTime: time,
                areaId: areaId || undefined,
                preferredTableId: tableId || undefined,
                notes: notes.trim() || undefined,
                isVip,
              })
            }
            className="min-h-11 flex-1 rounded-xl bg-waka-600 font-black text-white disabled:opacity-50"
          >
            {t(lang, "reservationSave")}
          </button>
        </div>
      </div>
    </div>
  );
}
