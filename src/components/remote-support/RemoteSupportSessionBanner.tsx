import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import type { RemoteSupportSession, RemoteSupportUiPhase } from "../../lib/remoteSupport";

type Props = {
  lang: Language;
  session: RemoteSupportSession;
  uiPhase?: RemoteSupportUiPhase;
  busy?: boolean;
  onEnd: () => void;
};

export function RemoteSupportSessionBanner({ lang, session, uiPhase, busy, onEnd }: Props) {
  const technician = session.technician_name?.trim() || "WAKA Support";
  const phase = uiPhase ?? "unavailable";
  const headline =
    phase === "active"
      ? t(lang, "remoteSupportSessionActive")
      : phase === "ending"
        ? t(lang, "remoteSupportEnding")
        : phase === "connecting"
          ? t(lang, "remoteSupportTransportStarting")
          : t(lang, "remoteSupportWaitingTransport");

  return (
    <div className="border-b border-amber-300 bg-amber-50 px-3 py-2 text-amber-950">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-black uppercase tracking-wide">{t(lang, "remoteSupportTitle")}</p>
          <p className="text-sm font-semibold">
            {t(lang, "remoteSupportTechnician")}: {technician} — WAKA Support
          </p>
          <p className="text-xs font-bold">{headline}</p>
          {phase !== "active" ? (
            <p className="text-[11px] font-semibold text-amber-800">
              {phase === "connecting"
                ? t(lang, "remoteSupportTransportStarting")
                : t(lang, "remoteSupportEngineNotInstalled")}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={onEnd}
          className="min-h-[40px] rounded-xl bg-rose-700 px-3 text-xs font-black text-white disabled:opacity-40"
        >
          {t(lang, "remoteSupportEnd")}
        </button>
      </div>
    </div>
  );
}
