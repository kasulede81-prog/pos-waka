import clsx from "clsx";
import type { ReactNode } from "react";

type Props = {
  header: ReactNode;
  children: ReactNode;
  className?: string;
};

/** Back Office hub screens — sticky title bar; folder tiles scroll underneath. */
export function BackOfficePageLayout({ header, children, className }: Props) {
  return (
    <div className={clsx("pb-4", className)}>
      <div
        className={clsx(
          "sticky top-0 z-20 -mx-3 border-b border-stone-200/80 bg-stone-50/95 px-3 py-2 backdrop-blur-md",
          "supports-[backdrop-filter]:bg-stone-50/88",
          "sm:-mx-4 sm:px-4",
          "md:-mx-6 md:px-6",
        )}
      >
        {header}
      </div>
      <div className="space-y-3 pt-3">{children}</div>
    </div>
  );
}

/** Shared 2-column tile grid for back office folder links. */
export const OFFICE_NAV_TILE_GRID =
  "grid grid-cols-2 gap-2 sm:gap-2.5 lg:grid-cols-2 lg:gap-3 xl:grid-cols-3";
