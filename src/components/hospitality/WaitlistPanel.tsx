import { useState } from "react";
import type { Language, WaitlistEntry } from "../../types";
import { t } from "../../lib/i18n";
import { activeWaitlist } from "../../lib/hospitalityFrontOfHouse";
import type { HospitalityFloorState } from "../../types";

type Props = {
  lang: Language;
  floor: HospitalityFloorState;
  onSeat: (entry: WaitlistEntry) => void;
  onCancel: (entryId: string) => void;
  onAdd: () => void;
};

export function WaitlistPanel({ lang, floor, onSeat, onCancel, onAdd }: Props) {
  const entries = activeWaitlist(floor);

  return (
    <section className="rounded-2xl border border-border bg-card p-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-black uppercase tracking-wide text-muted-foreground">{t(lang, "waitlistTitle")}</h2>
          <p className="text-xs font-medium text-muted-foreground">{entries.length} {t(lang, "waitlistWaiting")}</p>
        </div>
        <button type="button" onClick={onAdd} className="min-h-9 rounded-lg bg-waka-600 px-3 text-xs font-black text-white">
          {t(lang, "waitlistAdd")}
        </button>
      </div>
      {entries.length === 0 ? (
        <p className="mt-3 text-center text-xs font-semibold text-muted-foreground">{t(lang, "waitlistEmpty")}</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {entries.map((entry) => (
            <li key={entry.id} className="rounded-xl border border-border bg-muted px-3 py-2">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-black text-foreground">
                    {entry.name}
                    {entry.priority !== "normal" ? (
                      <span className="ml-1 text-[10px] font-black uppercase text-violet-700">{entry.priority}</span>
                    ) : null}
                  </p>
                  <p className="text-xs font-semibold text-muted-foreground">
                    {entry.guestCount} {t(lang, "tableOrderGuests")}
                    {entry.estimatedWaitMinutes ? ` · ~${entry.estimatedWaitMinutes}m` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1">
                  <button type="button" onClick={() => onSeat(entry)} className="rounded-lg bg-waka-600 px-2 py-1 text-[10px] font-black text-white">
                    {t(lang, "waitlistSeat")}
                  </button>
                  <button type="button" onClick={() => onCancel(entry.id)} className="rounded-lg border border-border px-2 py-1 text-[10px] font-black text-muted-foreground">
                    {t(lang, "cancel")}
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function WaitlistFormDialog({
  lang,
  open,
  onClose,
  onSubmit,
}: {
  lang: Language;
  open: boolean;
  onClose: () => void;
  onSubmit: (input: {
    name: string;
    guestCount: number;
    phone?: string;
    estimatedWaitMinutes?: number;
    priority: "normal" | "high" | "vip";
    notes?: string;
    source: "walk_in" | "phone";
  }) => void;
}) {
  const [name, setName] = useState("");
  const [guestCount, setGuestCount] = useState(2);
  const [phone, setPhone] = useState("");
  const [wait, setWait] = useState(15);
  const [priority, setPriority] = useState<"normal" | "high" | "vip">("normal");
  const [notes, setNotes] = useState("");
  const [source, setSource] = useState<"walk_in" | "phone">("walk_in");

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-2xl bg-card p-5 shadow-xl">
        <h2 className="text-lg font-black">{t(lang, "waitlistAddTitle")}</h2>
        <div className="mt-3 space-y-2">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t(lang, "waitlistNamePh")} className="w-full rounded-xl border border-border px-3 py-2 text-sm" />
          <input type="number" min={1} value={guestCount} onChange={(e) => setGuestCount(Number(e.target.value) || 1)} className="w-full rounded-xl border border-border px-3 py-2 text-sm" />
          <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder={t(lang, "reservationPhone")} className="w-full rounded-xl border border-border px-3 py-2 text-sm" />
          <input type="number" min={5} value={wait} onChange={(e) => setWait(Number(e.target.value) || 15)} className="w-full rounded-xl border border-border px-3 py-2 text-sm" />
          <select value={priority} onChange={(e) => setPriority(e.target.value as typeof priority)} className="w-full rounded-xl border border-border px-3 py-2 text-sm font-bold">
            <option value="normal">{t(lang, "waitlistPriorityNormal")}</option>
            <option value="high">{t(lang, "waitlistPriorityHigh")}</option>
            <option value="vip">VIP</option>
          </select>
          <select value={source} onChange={(e) => setSource(e.target.value as typeof source)} className="w-full rounded-xl border border-border px-3 py-2 text-sm font-bold">
            <option value="walk_in">{t(lang, "waitlistSourceWalkIn")}</option>
            <option value="phone">{t(lang, "waitlistSourcePhone")}</option>
          </select>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t(lang, "reservationNotes")} className="min-h-16 w-full rounded-xl border border-border px-3 py-2 text-sm" />
        </div>
        <div className="mt-4 flex gap-2">
          <button type="button" onClick={onClose} className="min-h-11 flex-1 rounded-xl border font-bold">{t(lang, "cancel")}</button>
          <button
            type="button"
            disabled={!name.trim()}
            onClick={() => {
              onSubmit({
                name: name.trim(),
                guestCount,
                phone: phone.trim() || undefined,
                estimatedWaitMinutes: wait,
                priority,
                notes: notes.trim() || undefined,
                source,
              });
              setName("");
            }}
            className="min-h-11 flex-1 rounded-xl bg-waka-600 font-black text-white disabled:opacity-50"
          >
            {t(lang, "waitlistAdd")}
          </button>
        </div>
      </div>
    </div>
  );
}