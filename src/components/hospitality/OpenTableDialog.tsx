import { useEffect, useState } from "react";
import { Minus, Plus } from "lucide-react";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { ModalSheet } from "../layout/ModalSheet";

export type OpenTableInput = {
  guestCount: number;
  adultCount: number;
  childrenCount: number;
  customerName?: string;
  customerPhone?: string;
  specialNotes?: string;
};

type Props = {
  lang: Language;
  open: boolean;
  tableLabel: string;
  areaName?: string;
  waiterLabel?: string;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: (input: OpenTableInput) => void;
};

export function OpenTableDialog({
  lang,
  open,
  tableLabel,
  areaName,
  waiterLabel,
  busy,
  onCancel,
  onConfirm,
}: Props) {
  const [guestCount, setGuestCount] = useState(4);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [specialNotes, setSpecialNotes] = useState("");

  useEffect(() => {
    if (!open) return;
    setGuestCount(4);
    setCustomerName("");
    setCustomerPhone("");
    setSpecialNotes("");
    setAdvancedOpen(false);
  }, [open, tableLabel]);

  const stepGuest = (delta: number) => setGuestCount((g) => Math.max(1, Math.min(99, g + delta)));

  return (
    <ModalSheet
      open={open}
      onClose={onCancel}
      clearNav
      title={
        <div className="text-center">
          <p className="text-xs font-black uppercase tracking-wide text-stone-500">{t(lang, "openTableTitle")}</p>
          <p className="mt-1 text-2xl font-black text-stone-950">{tableLabel}</p>
          {areaName ? <p className="text-sm font-semibold text-stone-500">{areaName}</p> : null}
        </div>
      }
      footer={
        <div className="grid grid-cols-2 gap-2.5">
          <button
            type="button"
            onClick={onCancel}
            className="min-h-[44px] rounded-xl border border-stone-200 bg-white text-sm font-black uppercase text-stone-700"
          >
            {t(lang, "cancel")}
          </button>
          <button
            type="button"
            disabled={busy || guestCount < 1}
            onClick={() =>
              onConfirm({
                guestCount,
                adultCount: guestCount,
                childrenCount: 0,
                customerName: customerName.trim() || undefined,
                customerPhone: customerPhone.trim() || undefined,
                specialNotes: specialNotes.trim() || undefined,
              })
            }
            className="min-h-[44px] rounded-xl bg-emerald-600 text-sm font-black uppercase text-white disabled:opacity-60"
          >
            {t(lang, "openTableConfirm")}
          </button>
        </div>
      }
    >
      <div className="space-y-5">
        <div>
          <p className="mb-3 text-center text-sm font-bold text-stone-700">{t(lang, "openTableGuests")}</p>
          <div className="flex items-center justify-center gap-6">
            <button
              type="button"
              onClick={() => stepGuest(-1)}
              className="flex h-14 w-14 items-center justify-center rounded-lg border-2 border-stone-400 bg-white text-stone-800 shadow-sm"
            >
              <Minus className="h-7 w-7" />
            </button>
            <span className="min-w-[3rem] text-center text-5xl font-black tabular-nums text-stone-950">
              {guestCount}
            </span>
            <button
              type="button"
              onClick={() => stepGuest(1)}
              className="flex h-14 w-14 items-center justify-center rounded-lg border-2 border-stone-400 bg-white text-stone-800 shadow-sm"
            >
              <Plus className="h-7 w-7" />
            </button>
          </div>
        </div>

        <div className="rounded-lg border border-stone-300 bg-stone-50 p-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-bold text-stone-700">{t(lang, "openTableCoverCharge")}</span>
            <span className="text-lg font-black text-stone-400">—</span>
          </div>
          <p className="mt-1 text-[10px] font-medium text-stone-400">{t(lang, "openTableCoverChargeHint")}</p>
        </div>

        <button
          type="button"
          onClick={() => setAdvancedOpen((v) => !v)}
          className="w-full text-center text-xs font-bold text-sky-700 underline-offset-2 hover:underline"
        >
          {advancedOpen ? t(lang, "openTableHideDetails") : t(lang, "openTableGuestDetails")}
        </button>

        {advancedOpen ? (
          <div className="space-y-2 rounded-lg border border-stone-300 bg-white p-3">
            <input
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              placeholder={t(lang, "openTableCustomerNamePh")}
              className="w-full rounded border border-stone-200 px-3 py-2 text-sm"
            />
            <input
              value={customerPhone}
              onChange={(e) => setCustomerPhone(e.target.value)}
              placeholder="+256..."
              className="w-full rounded border border-stone-200 px-3 py-2 text-sm"
            />
            <textarea
              value={specialNotes}
              onChange={(e) => setSpecialNotes(e.target.value)}
              rows={2}
              placeholder={t(lang, "openTableNotesPh")}
              className="w-full rounded border border-stone-200 px-3 py-2 text-sm"
            />
          </div>
        ) : null}

        {waiterLabel ? (
          <p className="text-center text-xs font-semibold text-stone-500">
            {t(lang, "openTableWaiter")}: {waiterLabel}
          </p>
        ) : null}
      </div>
    </ModalSheet>
  );
}
