import clsx from "clsx";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import type { TerminalIdentityView } from "../../lib/terminalIdentity";

type Props = {
  lang: Language;
  identity: TerminalIdentityView;
  terminalLabel?: string | null;
  className?: string;
  compact?: boolean;
};

/** Operator vs commercial seller indicator for shared-terminal POS (Phase 11d). */
export function TerminalIdentityStrip({ lang, identity, terminalLabel, className, compact }: Props) {
  const showTerminal = Boolean(terminalLabel?.trim());
  const sellingName = identity.splitIdentity ? identity.sellerName : identity.operatorName;

  if (compact) {
    return (
      <div className={clsx("min-w-0 shrink", className)}>
        <p className="truncate text-[9px] font-bold uppercase tracking-wide text-muted-foreground">
          {t(lang, "terminalOperator")} · {t(lang, "terminalSelling")}
        </p>
        <p className="truncate text-xs font-black text-foreground">
          {identity.operatorName}
          <span className="font-bold text-muted-foreground"> · </span>
          {sellingName}
        </p>
      </div>
    );
  }

  return (
    <div className={clsx("flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] font-bold", className)}>
      {showTerminal ? (
        <span className="truncate">
          <span className="uppercase tracking-wide text-muted-foreground">{t(lang, "terminalLabel")}: </span>
          <span className="font-black text-foreground">{terminalLabel}</span>
        </span>
      ) : null}
      <span className="truncate">
        <span className="uppercase tracking-wide text-muted-foreground">{t(lang, "terminalOperator")}: </span>
        <span className="font-black text-foreground">{identity.operatorName}</span>
      </span>
      <span className="truncate">
        <span className="uppercase tracking-wide text-muted-foreground">{t(lang, "terminalSelling")}: </span>
        <span className="font-black text-foreground">{sellingName}</span>
      </span>
    </div>
  );
}
