import { useEffect, useState } from "react";
import clsx from "clsx";
import { ArrowLeft, Clock, Languages } from "lucide-react";
import { useNavigate } from "react-router-dom";
import type { Language, ShiftRecord } from "../../../types";
import { t } from "../../../lib/i18n";
import { formatShiftDuration } from "../../../lib/shiftEnforcement";
import { confirmLeavePosIfNeeded } from "../../../lib/posExitGuard";
import { POS_HOME_ROUTE } from "../../../lib/posNavigation";
import { WakaSymbolIcon } from "../../brand/WakaLogo";
import { useUiLanguage } from "../../../hooks/useUiLanguage";
import { languageToggleLabel, nextLanguage } from "../../../lib/language";
import { DisplayScaleControl } from "../DisplayScaleControl";
import { DesktopPosButton } from "./DesktopPosButton";
import type { TerminalIdentityView } from "../../../lib/terminalIdentity";
import { TerminalIdentityStrip } from "../TerminalIdentityStrip";

type Props = {
  lang: Language;
  sellLabelKey: string;
  identity: TerminalIdentityView;
  terminalLabel?: string | null;
  shift: ShiftRecord | null;
  todaySaleCount: number;
  todaySalesUgx: number;
  pendingCount: number;
  onCloseShift: () => void;
  exitTo?: string;
  className?: string;
};

/** Top header bar for Electron desktop POS terminal. */
export function DesktopPosHeader({
  lang,
  sellLabelKey,
  identity,
  terminalLabel,
  shift,
  todaySaleCount,
  todaySalesUgx,
  pendingCount,
  onCloseShift,
  exitTo = POS_HOME_ROUTE,
  className,
}: Props) {
  const navigate = useNavigate();
  const { setLang } = useUiLanguage();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const duration = shift ? formatShiftDuration(shift.startAt, now) : "—";
  const fmt = (n: number) => `UGX ${n.toLocaleString()}`;

  const handleExit = () => {
    void confirmLeavePosIfNeeded(window.location.pathname, exitTo).then((ok) => {
      if (ok) navigate(exitTo, { preventScrollReset: true });
    });
  };

  return (
    <header
      className={clsx(
        "desktop-pos-header flex h-14 shrink-0 items-center gap-2 border-b border-border bg-card px-2 shadow-sm sm:gap-3 sm:px-3",
        className,
      )}
    >
      <button
        type="button"
        onClick={handleExit}
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border bg-muted text-muted-foreground active:bg-muted"
        aria-label={t(lang, "posNavExit")}
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
      </button>

      <WakaSymbolIcon size="xs" className="h-8 w-8 shrink-0" />
      <div className="hidden min-w-0 sm:block">
        <p className="truncate text-sm font-black text-foreground">WAKA POS</p>
        <p className="truncate text-[10px] font-bold text-waka-700">{t(lang, sellLabelKey)}</p>
      </div>

      <div className="mx-1 hidden h-8 w-px shrink-0 bg-border lg:block" aria-hidden />

      <div className="flex min-w-0 flex-1 items-center gap-3 overflow-hidden text-xs">
        <TerminalIdentityStrip lang={lang} identity={identity} terminalLabel={terminalLabel} compact />
        <div className="hidden min-w-0 items-center gap-1 text-muted-foreground md:flex">
          <Clock className="h-3.5 w-3.5 shrink-0 text-waka-600" aria-hidden />
          <span className="truncate font-bold">{duration}</span>
        </div>
        <div className="hidden min-w-0 xl:block">
          <p className="truncate text-[9px] font-bold uppercase text-muted-foreground">{t(lang, "salesHistoryTodaySales")}</p>
          <p className="truncate font-black">{todaySaleCount} · {fmt(todaySalesUgx)}</p>
        </div>
        {pendingCount > 0 ? (
          <div className="hidden min-w-0 xl:block">
            <p className="truncate text-[9px] font-bold uppercase text-muted-foreground">{t(lang, "pendingSalesLink")}</p>
            <p className="truncate font-black text-warning-foreground">{pendingCount}</p>
          </div>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        <DisplayScaleControl lang={lang} />
        <button
          type="button"
          onClick={() => setLang(nextLanguage(lang))}
          className="hidden h-9 items-center gap-1 rounded-lg border border-border bg-card px-2 text-[10px] font-bold text-muted-foreground active:bg-muted sm:inline-flex"
          aria-label={languageToggleLabel(lang)}
        >
          <Languages className="h-3.5 w-3.5" aria-hidden />
          {languageToggleLabel(lang).slice(0, 2).toUpperCase()}
        </button>
        {shift ? (
          <DesktopPosButton size="sm" variant="success" onClick={onCloseShift} className="hidden lg:inline-flex">
            {t(lang, "shiftCloseBtn")}
          </DesktopPosButton>
        ) : null}
      </div>
    </header>
  );
}
