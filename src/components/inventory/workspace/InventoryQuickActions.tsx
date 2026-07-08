import { Link } from "react-router-dom";
import clsx from "clsx";
import type { Language, UserRole } from "../../../types";
import { t } from "../../../lib/i18n";
import type { InventoryQuickActionDef } from "../../../lib/inventoryWorkspaceTiles";
import { hasPermission } from "../../../lib/permissions";

type Props = {
  lang: Language;
  role: UserRole;
  actions: InventoryQuickActionDef[];
  onAction: (actionId: string) => void;
};

export function InventoryQuickActions({ lang, role, actions, onAction }: Props) {
  const visible = actions.filter((a) => !a.perm || hasPermission(role, a.perm));
  if (visible.length === 0) return null;

  return (
    <section className="space-y-2">
      <h3 className="px-0.5 text-[10px] font-black uppercase tracking-wide text-stone-500">
        {t(lang, "ipQuickActions")}
      </h3>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {visible.map((action) => {
          const Icon = action.Icon;
          const className = clsx(
            "flex min-h-[72px] flex-col items-start justify-between rounded-2xl border p-3 text-left shadow-sm transition-all",
            "active:scale-[0.98] motion-reduce:active:scale-100",
            action.primary
              ? "border-waka-200 bg-gradient-to-br from-waka-50 to-white active:border-waka-300"
              : "border-stone-200/90 bg-white active:border-waka-300 active:shadow-md",
          );
          const inner = (
            <>
              <span
                className={clsx(
                  "flex h-9 w-9 items-center justify-center rounded-xl",
                  action.primary ? "bg-waka-600 text-white" : "bg-stone-100 text-stone-700",
                )}
              >
                <Icon className="h-[18px] w-[18px]" aria-hidden />
              </span>
              <span className="text-xs font-black leading-tight text-stone-950">{t(lang, action.labelKey)}</span>
            </>
          );

          if (action.href) {
            return (
              <Link key={action.id} to={action.href} className={className}>
                {inner}
              </Link>
            );
          }

          return (
            <button
              key={action.id}
              type="button"
              className={className}
              onClick={() => action.actionId && onAction(action.actionId)}
            >
              {inner}
            </button>
          );
        })}
      </div>
    </section>
  );
}
