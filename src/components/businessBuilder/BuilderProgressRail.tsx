import clsx from "clsx";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import type { BuilderUnlock } from "../../lib/businessBuilder/businessSceneState";

type Props = {
  lang: Language;
  unlocks: BuilderUnlock[];
  className?: string;
};

export function BuilderProgressRail({ lang, unlocks, className }: Props) {
  const doneCount = unlocks.filter((u) => u.done).length;

  return (
    <div
      className={clsx(
        "rounded-[24px] border border-border/70 bg-white/90 p-3 shadow-sm backdrop-blur-sm",
        className,
      )}
      role="list"
      aria-label={t(lang, "builderProgressTitle")}
    >
      <p className="text-xs font-black uppercase tracking-wide text-muted-foreground">
        {t(lang, "builderProgressTitle")}
      </p>
      <p className="mt-0.5 text-[10px] font-semibold text-muted-foreground">
        {doneCount}/{unlocks.length}
      </p>
      <ul className="mt-2 space-y-1.5">
        {unlocks.map((item) => (
          <li
            key={item.id}
            role="listitem"
            className={clsx(
              "flex items-center gap-2 rounded-xl px-2 py-1.5 text-xs font-semibold transition-all duration-500",
              item.done
                ? "builder-unlock-done bg-emerald-50 text-emerald-900"
                : "text-muted-foreground",
            )}
          >
            <span
              className={clsx(
                "flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-black",
                item.done ? "bg-emerald-500 text-white" : "bg-muted text-muted-foreground",
              )}
              aria-hidden
            >
              {item.done ? "✓" : "·"}
            </span>
            <span>{t(lang, item.labelKey)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
