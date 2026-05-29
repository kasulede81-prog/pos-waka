import { useState } from "react";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { usePosStore } from "../../store/usePosStore";
import { PinInput } from "../ui/PinInput";

type Props = { lang: Language };

export function BackOfficePinForm({ lang }: Props) {
  const preferences = usePosStore((s) => s.preferences);
  const setPreferences = usePosStore((s) => s.setPreferences);
  const [boPinNew, setBoPinNew] = useState("");
  const [boPinConfirm, setBoPinConfirm] = useState("");
  const [boPinFeedback, setBoPinFeedback] = useState<string | null>(null);

  return (
    <article className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
      {preferences.backOfficePin ? (
        <p className="text-sm font-semibold text-emerald-800">{t(lang, "settingsBackOfficePinActiveShort")}</p>
      ) : (
        <p className="text-sm font-semibold text-stone-600">{t(lang, "settingsBackOfficePinNone")}</p>
      )}
      {boPinFeedback ? <p className="mt-2 text-sm font-bold text-waka-900">{boPinFeedback}</p> : null}
      <label className="mt-4 block text-sm font-bold text-slate-800">{t(lang, "settingsBackOfficePinNew")}</label>
      <PinInput
        autoComplete="off"
        maxLength={6}
        value={boPinNew}
        onChange={(e) => {
          setBoPinFeedback(null);
          setBoPinNew(e.target.value.replace(/\D/g, "").slice(0, 6));
        }}
        className="mt-2 w-full rounded-2xl border-2 border-slate-200 px-4 py-3 text-center text-xl font-black tracking-[0.25em]"
      />
      <label className="mt-3 block text-sm font-bold text-slate-800">{t(lang, "settingsBackOfficePinConfirm")}</label>
      <PinInput
        autoComplete="off"
        maxLength={6}
        value={boPinConfirm}
        onChange={(e) => {
          setBoPinFeedback(null);
          setBoPinConfirm(e.target.value.replace(/\D/g, "").slice(0, 6));
        }}
        className="mt-2 w-full rounded-2xl border-2 border-slate-200 px-4 py-3 text-center text-xl font-black tracking-[0.25em]"
      />
      <div className="mt-4 grid grid-cols-2 gap-2">
        <button
          type="button"
          className="min-h-[48px] rounded-2xl bg-waka-600 py-3 text-sm font-black text-white"
          onClick={() => {
            setBoPinFeedback(null);
            const a = boPinNew.replace(/\D/g, "");
            const b = boPinConfirm.replace(/\D/g, "");
            if (a.length < 4 || a.length > 6) {
              setBoPinFeedback(t(lang, "settingsBackOfficePinLength"));
              return;
            }
            if (a !== b) {
              setBoPinFeedback(t(lang, "settingsBackOfficePinMismatch"));
              return;
            }
            setPreferences({ backOfficePin: a });
            setBoPinNew("");
            setBoPinConfirm("");
            setBoPinFeedback(t(lang, "settingsBackOfficePinSaved"));
          }}
        >
          {t(lang, "settingsBackOfficePinSave")}
        </button>
        <button
          type="button"
          className="min-h-[48px] rounded-2xl border-2 border-slate-200 py-3 text-sm font-bold text-slate-800"
          onClick={() => {
            setBoPinNew("");
            setBoPinConfirm("");
            setPreferences({ backOfficePin: null });
            setBoPinFeedback(t(lang, "settingsBackOfficePinCleared"));
          }}
        >
          {t(lang, "settingsBackOfficePinClear")}
        </button>
      </div>
    </article>
  );
}
