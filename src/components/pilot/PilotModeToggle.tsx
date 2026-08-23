import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { usePosStore } from "../../store/usePosStore";
import { useSessionActor } from "../../context/SessionActorContext";
import { authOperatorRole } from "../../lib/sessionActor";
import { canTogglePilotMode } from "../../lib/pilotMode";
import { WakaSwitch } from "../enterprise/WakaSwitch";

type Props = { lang: Language };

export function PilotModeToggle({ lang }: Props) {
  const actor = useSessionActor();
  const enabled = usePosStore((s) => Boolean(s.preferences.pilotModeEnabled));
  const setPilotModeEnabled = usePosStore((s) => s.setPilotModeEnabled);

  if (!canTogglePilotMode(authOperatorRole(actor))) return null;

  return (
    <div className="rounded-2xl border border-teal-200 bg-teal-50/50 px-4 py-3">
      <WakaSwitch
        checked={enabled}
        onCheckedChange={setPilotModeEnabled}
        label={t(lang, "pilotModeToggleTitle")}
        description={t(lang, "pilotModeToggleSub")}
      />
    </div>
  );
}
