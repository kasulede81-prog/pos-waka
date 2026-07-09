import clsx from "clsx";
import type { BusinessType, Language, Permission } from "../../types";
import { t } from "../../lib/i18n";
import { permissionCategoriesForBusiness, permissionLabel, summarizePermissionsByCategory } from "../../lib/enterpriseRoles";

type Props = {
  lang: Language;
  businessType: BusinessType;
  selected: Permission[];
  onChange: (next: Permission[]) => void;
  disabled?: boolean;
};

export function CustomRolePermissionEditor({ lang, businessType, selected, onChange, disabled }: Props) {
  const selectedSet = new Set(selected);
  const categories = permissionCategoriesForBusiness(businessType);

  const toggle = (perm: Permission) => {
    if (disabled) return;
    const next = new Set(selectedSet);
    if (next.has(perm)) next.delete(perm);
    else next.add(perm);
    onChange([...next]);
  };

  return (
    <div className="space-y-4">
      {categories.map((cat) => (
        <section key={cat.id} className="rounded-2xl border border-stone-200 bg-stone-50/80 p-4 dark:border-stone-700 dark:bg-stone-900/40">
          <h3 className="text-sm font-black uppercase tracking-wide text-stone-600 dark:text-stone-300">
            {t(lang, cat.labelKey as "permCategory_sales")}
          </h3>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {cat.permissions.map((perm) => {
              const checked = selectedSet.has(perm);
              return (
                <li key={perm}>
                  <label
                    className={clsx(
                      "flex min-h-[44px] cursor-pointer items-start gap-3 rounded-xl border px-3 py-2.5 text-sm font-semibold transition",
                      checked
                        ? "border-waka-300 bg-waka-50 text-waka-950 dark:border-waka-700 dark:bg-waka-950/30 dark:text-waka-100"
                        : "border-stone-200 bg-white text-stone-700 dark:border-stone-700 dark:bg-stone-950 dark:text-stone-200",
                      disabled && "cursor-not-allowed opacity-60",
                    )}
                  >
                    <input
                      type="checkbox"
                      className="mt-0.5 h-4 w-4 shrink-0"
                      checked={checked}
                      disabled={disabled}
                      onChange={() => toggle(perm)}
                    />
                    <span>{permissionLabel(lang, perm)}</span>
                  </label>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

export function CustomRolePermissionPreview({
  lang,
  businessType,
  permissions,
}: {
  lang: Language;
  businessType: BusinessType;
  permissions: Permission[];
}) {
  const rows = summarizePermissionsByCategory(permissions, businessType);
  const total = permissions.length;

  return (
    <div className="rounded-2xl border border-waka-200 bg-waka-50/80 p-4 dark:border-waka-800 dark:bg-waka-950/20">
      <p className="text-sm font-black text-stone-900 dark:text-stone-100">{t(lang, "enterpriseRolesPreviewTitle")}</p>
      <ul className="mt-3 space-y-1 text-sm font-semibold text-stone-700 dark:text-stone-300">
        {rows.map((row) => (
          <li key={row.id} className="flex items-center justify-between gap-3">
            <span>{t(lang, row.labelKey as "permCategory_sales")}</span>
            <span className="font-black tabular-nums">{row.count}</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 border-t border-waka-200 pt-3 text-sm font-black text-waka-900 dark:border-waka-800 dark:text-waka-200">
        {t(lang, "enterpriseRolesPreviewTotal")}: {total}
      </p>
    </div>
  );
}
