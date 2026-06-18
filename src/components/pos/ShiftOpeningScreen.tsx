import { useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { usePosStore } from "../../store/usePosStore";
import { AppModalOverlay } from "../layout/AppModalOverlay";
import { POS_HOME_ROUTE } from "../../lib/posNavigation";

type Props = {
  lang: Language;
  onShiftStarted: () => void;
};

/** Blocks sell flows until the cashier opens a shift with optional opening float. */
export function ShiftOpeningScreen({ lang, onShiftStarted }: Props) {
  const navigate = useNavigate();
  const beginShift = usePosStore((s) => s.beginShift);
  const [floatInput, setFloatInput] = useState("");

  const handleStart = () => {
    const raw = floatInput.replace(/\D/g, "");
    const openingFloatUgx = raw.length > 0 ? Math.floor(Number(raw)) : undefined;
    beginShift(openingFloatUgx);
    onShiftStarted();
  };

  return (
    <AppModalOverlay className="z-[80] flex items-center justify-center bg-stone-950/80 p-4" role="dialog" aria-modal>
      <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl">
        <h1 className="text-2xl font-black text-stone-900">{t(lang, "shiftOpenTitle")}</h1>
        <p className="mt-2 text-sm font-medium text-stone-600">{t(lang, "shiftOpenBody")}</p>

        <label className="mt-5 block text-sm font-bold text-stone-800">
          {t(lang, "shiftOpenFloatLabel")}
          <span className="ml-1 font-medium text-stone-500">({t(lang, "optional")})</span>
          <input
            value={floatInput}
            onChange={(e) => setFloatInput(e.target.value.replace(/\D/g, "").slice(0, 12))}
            inputMode="numeric"
            placeholder="0"
            className="mt-2 min-h-[52px] w-full rounded-2xl border-2 border-stone-200 px-4 text-2xl font-black outline-none ring-waka-300 focus:border-waka-400 focus:ring"
          />
        </label>

        <div className="mt-6 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => navigate(POS_HOME_ROUTE)}
            className="min-h-[52px] rounded-2xl border-2 border-stone-200 font-bold text-stone-800"
          >
            {t(lang, "cancel")}
          </button>
          <button
            type="button"
            onClick={handleStart}
            className="min-h-[52px] rounded-2xl bg-waka-600 font-black text-white"
          >
            {t(lang, "shiftOpenStartBtn")}
          </button>
        </div>
      </div>
    </AppModalOverlay>
  );
}
