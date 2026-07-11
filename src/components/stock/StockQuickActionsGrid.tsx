import { Link } from "react-router-dom";
import { FolderPlus, PackagePlus, Upload, Package } from "lucide-react";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";

type Props = {
  lang: Language;
  canAdd: boolean;
  canRestock: boolean;
  canArrangeShelves: boolean;
  freeProductLimitReached: boolean;
  onAddProduct: () => void;
  onImportProducts?: () => void;
  showImport?: boolean;
};

export function StockQuickActionsGrid({
  lang,
  canAdd,
  canRestock,
  canArrangeShelves,
  freeProductLimitReached,
  onAddProduct,
  onImportProducts,
  showImport,
}: Props) {
  const actions = [
    canAdd
      ? {
          key: "add",
          label: t(lang, "stockAddProductBtn"),
          icon: PackagePlus,
          onClick: onAddProduct,
          disabled: freeProductLimitReached,
        }
      : null,
    canRestock
      ? {
          key: "restock",
          label: t(lang, "stockGoRestock"),
          icon: Package,
          href: "/stock?tab=purchases&new=1",
        }
      : null,
    canArrangeShelves
      ? {
          key: "shelf",
          label: t(lang, "stockQuickNewShelf"),
          icon: FolderPlus,
          href: "/settings/shelves",
        }
      : null,
    showImport && onImportProducts
      ? {
          key: "import",
          label: t(lang, "stockQuickImport"),
          icon: Upload,
          onClick: onImportProducts,
          disabled: freeProductLimitReached,
        }
      : null,
  ].filter(Boolean) as Array<{
    key: string;
    label: string;
    icon: typeof PackagePlus;
    href?: string;
    onClick?: () => void;
    disabled?: boolean;
  }>;

  if (actions.length === 0) return null;

  return (
    <section className="space-y-2">
      <h3 className="px-0.5 text-[10px] font-black uppercase tracking-wide text-muted-foreground">
        {t(lang, "ownerSectionQuickActions")}
      </h3>
      <div className="grid grid-cols-2 gap-2">
        {actions.map((action) => {
          const Icon = action.icon;
          const className =
            "flex min-h-[72px] flex-col items-start justify-between rounded-xl border border-border/90 bg-card p-3 text-left shadow-sm transition-all active:scale-[0.98] active:border-waka-300 active:shadow-md disabled:opacity-50 motion-reduce:active:scale-100";
          const inner = (
            <>
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                <Icon className="h-[18px] w-[18px]" aria-hidden />
              </span>
              <span className="text-xs font-black leading-tight text-foreground">{action.label}</span>
            </>
          );
          if (action.href) {
            return (
              <Link key={action.key} to={action.href} className={className}>
                {inner}
              </Link>
            );
          }
          return (
            <button
              key={action.key}
              type="button"
              disabled={action.disabled}
              onClick={action.onClick}
              className={className}
            >
              {inner}
            </button>
          );
        })}
      </div>
    </section>
  );
}
