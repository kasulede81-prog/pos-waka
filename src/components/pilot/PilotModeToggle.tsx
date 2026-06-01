import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { usePosStore } from "../../store/usePosStore";
import { useSessionActor } from "../../context/SessionActorContext";
import { canTogglePilotMode } from "../../lib/pilotMode";

type Props = { lang: Language };

export function PilotModeToggle({ lang }: Props) {
  const actor = useSessionActor();
  const enabled = usePosStore((s) => Boolean(s.preferences.pilotModeEnabled));
  const setPilotModeEnabled = usePosStore((s) => s.setPilotModeEnabled);

  if (!canTogglePilotMode(actor.role)) return null;

  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 rounded-2xl border border-teal-200 bg-teal-50/50 px-4 py-3">
      <div>
        <p className="text-sm font-black text-stone-900">{t(lang, "pilotModeToggleTitle")}</p>
        <p className="mt-0.5 text-xs font-medium text-stone-600">{t(lang, "pilotModeToggleSub")}</p>
      </div>
      <input
        type="checkbox"
        checked={enabled}
        onChange={(e) => setPilotModeEnabled(e.target.checked)}
        className="h-5 w-5 rounded border-stone-300"
      />
    </label>
  );
}
