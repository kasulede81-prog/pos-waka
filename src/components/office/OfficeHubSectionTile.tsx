import { Link } from "react-router-dom";
import clsx from "clsx";
import type { CSSProperties, PointerEvent } from "react";
import type { ResolvedOfficeHubSection } from "../../lib/officeHubSections";
import { officeHubSectionPath } from "../../lib/officeHubSections";
import { launcherTileColorClasses, launcherTileSurfaceStyle } from "../../lib/launcherTiles";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";

type Props = {
  section: ResolvedOfficeHubSection;
  lang: Language;
  mode: "live" | "arrange";
  dragging?: boolean;
  dragOver?: boolean;
  selected?: boolean;
  className?: string;
  onClick?: () => void;
  onDragPointerDown?: (e: PointerEvent) => void;
};

export function OfficeHubSectionTile({
  section,
  lang,
  mode,
  dragging = false,
  dragOver = false,
  selected = false,
  className,
  onClick,
  onDragPointerDown,
}: Props) {
  const isArrange = mode === "arrange";
  const customStyle = launcherTileSurfaceStyle({
    color: section.color,
    customColor: section.customColor,
    pinned: false,
  });
  const isBold = Boolean(customStyle) || section.color !== "default";
  const colorClass = customStyle ? "" : launcherTileColorClasses(section.color, false);
  const combinedStyle: CSSProperties | undefined = customStyle ?? undefined;

  const body = (
    <>
      {isArrange ? (
        <span
          className={clsx(
            "absolute right-1.5 top-1.5 rounded-full px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wide",
            isBold ? "bg-white/20 text-white" : "bg-stone-900/10 text-stone-600",
          )}
          aria-hidden
        >
          ⋮⋮
        </span>
      ) : null}
      {section.hidden && isArrange ? (
        <span className="absolute left-1.5 top-1.5 rounded-full bg-stone-800/80 px-1.5 py-0.5 text-[9px] font-bold text-white">
          {t(lang, "homeMenuTileHidden")}
        </span>
      ) : null}
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/15">
        <section.Icon className="h-5 w-5 text-white" strokeWidth={2.25} aria-hidden />
      </span>
      <span className="w-full min-w-0 text-left">
        <span className="line-clamp-2 text-sm font-black uppercase leading-tight tracking-wide">
          {t(lang, section.titleKey)}
        </span>
        <span className="mt-0.5 line-clamp-1 text-[10px] font-semibold leading-snug text-white/85">
          {t(lang, section.subKey)}
        </span>
      </span>
    </>
  );

  const sharedClass = clsx(
    "relative flex min-h-[84px] flex-col items-start justify-center gap-1.5 rounded-xl border-2 px-3 py-2.5 text-white shadow-md transition-all",
    "hover:shadow-lg active:scale-[0.98] motion-reduce:active:scale-100",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-waka-500 focus-visible:ring-offset-2",
    isBold
      ? colorClass
      : "border-white/25 bg-gradient-to-br from-waka-600 via-waka-600 to-waka-700 shadow-[0_6px_20px_rgba(234,88,12,0.3)] hover:from-waka-500 hover:to-waka-600",
    section.hidden && isArrange && "opacity-45",
    isArrange && "cursor-grab active:cursor-grabbing",
    isArrange && selected && "ring-2 ring-waka-500 ring-offset-2",
    isArrange && dragging && "z-20 scale-[1.02] opacity-90 shadow-lg",
    isArrange && dragOver && "ring-2 ring-dashed ring-waka-400",
    className,
  );

  if (isArrange) {
    return (
      <div
        role="button"
        tabIndex={0}
        data-office-hub-key={section.id}
        style={combinedStyle}
        onClick={onClick}
        onPointerDown={onDragPointerDown}
        className={sharedClass}
      >
        {body}
      </div>
    );
  }

  return (
    <Link to={officeHubSectionPath(section.id)} style={combinedStyle} className={sharedClass}>
      {body}
    </Link>
  );
}
