import { Link } from "react-router-dom";
import type { Language } from "../../../types";
import { t } from "../../../lib/i18n";
import type { InventoryWorkspaceTile } from "../../../lib/inventoryWorkspaceTiles";
import { hasActorPermission } from "../../../lib/permissions";
import { useSessionActor } from "../../../context/SessionActorContext";

type Props = {
  lang: Language;
  tiles: InventoryWorkspaceTile[];
  titleKey?: string;
};

export function InventoryNavigationTiles({ lang, tiles, titleKey = "iwSectionNavigation" }: Props) {
  const actor = useSessionActor();
  const visible = tiles.filter((tile) => !tile.perm || hasActorPermission(actor.role, tile.perm, actor.permissions));
  if (visible.length === 0) return null;

  return (
    <section className="space-y-1.5">
      <h3 className="inventory-zone-label">{t(lang, titleKey)}</h3>
      <div className="inventory-nav-dir">
        {visible.map((tile) => {
          const Icon = tile.Icon;
          return (
            <Link key={tile.id} to={tile.href} className="inventory-nav-link">
              <span className="inventory-ops-icon">
                <Icon className="h-4 w-4" aria-hidden />
              </span>
              <span className="inventory-nav-link__label">{t(lang, tile.labelKey)}</span>
              {tile.badge != null && tile.badge > 0 ? (
                <span className="rounded-full bg-danger px-2 py-0.5 text-xs font-bold text-white">
                  {tile.badge > 99 ? "99+" : tile.badge}
                </span>
              ) : null}
            </Link>
          );
        })}
      </div>
    </section>
  );
}
