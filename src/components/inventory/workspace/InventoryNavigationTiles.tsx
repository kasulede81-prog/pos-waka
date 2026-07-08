import { Link } from "react-router-dom";
import clsx from "clsx";
import type { Language, UserRole } from "../../../types";
import { t } from "../../../lib/i18n";
import type { InventoryWorkspaceTile } from "../../../lib/inventoryWorkspaceTiles";
import { hasPermission } from "../../../lib/permissions";

type Props = {
  lang: Language;
  role: UserRole;
  tiles: InventoryWorkspaceTile[];
  titleKey?: string;
};

export function InventoryNavigationTiles({ lang, role, tiles, titleKey = "iwSectionNavigation" }: Props) {
  const visible = tiles.filter((tile) => !tile.perm || hasPermission(role, tile.perm));
  if (visible.length === 0) return null;

  return (
    <section className="space-y-2">
      <h3 className="px-0.5 text-[10px] font-black uppercase tracking-wide text-stone-500">
        {t(lang, titleKey)}
      </h3>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {visible.map((tile) => {
          const Icon = tile.Icon;
          return (
            <Link
              key={tile.id}
              to={tile.href}
              className={clsx(
                "group relative flex min-h-[88px] flex-col justify-between rounded-2xl border border-stone-200/90 bg-white p-3 shadow-sm",
                "transition-all hover:-translate-y-0.5 hover:border-waka-200 hover:shadow-md active:scale-[0.98] motion-reduce:hover:translate-y-0 motion-reduce:active:scale-100",
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-stone-100 text-stone-700 transition-colors group-hover:bg-waka-100 group-hover:text-waka-800">
                  <Icon className="h-5 w-5" aria-hidden />
                </span>
                {tile.badge != null && tile.badge > 0 ? (
                  <span className="rounded-full bg-rose-600 px-2 py-0.5 text-[10px] font-black text-white">
                    {tile.badge > 99 ? "99+" : tile.badge}
                  </span>
                ) : null}
              </div>
              <span className="text-sm font-black leading-tight text-stone-950">{t(lang, tile.labelKey)}</span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
