import clsx from "clsx";
import type { BusinessType, Language, Permission } from "../../types";
import { t } from "../../lib/i18n";
import { permissionCategoriesForBusiness, permissionLabel, summarizePermissionsByCategory } from "../../lib/enterpriseRoles";
import { WakaCheckbox } from "../enterprise/WakaCheckbox";

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
        <section key={cat.id} className="rounded-2xl border border-border bg-muted/80 p-4 dark:bg-foreground/40">
          <h3 className="text-sm font-black uppercase tracking-wide text-muted-foreground dark:text-muted-foreground">
            {t(lang, cat.labelKey as "permCategory_sales")}
          </h3>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {cat.permissions.map((perm) => {
              const checked = selectedSet.has(perm);
              return (
                <li key={perm}>
                  <div
                    className={clsx(
                      "rounded-xl border px-3 py-2.5 transition",
                      checked
                        ? "border-waka-300 bg-waka-50 text-waka-950 dark:border-waka-700 dark:bg-waka-950/30 dark:text-waka-100"
                        : "border-border bg-card text-muted-foreground dark:bg-foreground dark:text-muted-foreground",
                      disabled && "cursor-not-allowed opacity-60",
                    )}
                  >
                    <WakaCheckbox
                      checked={checked}
                      disabled={disabled}
                      onCheckedChange={() => toggle(perm)}
                      label={permissionLabel(lang, perm)}
                      className="text-sm font-semibold"
                    />
                  </div>
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
      <p className="text-sm font-black text-foreground dark:text-background">{t(lang, "enterpriseRolesPreviewTitle")}</p>
      <ul className="mt-3 space-y-1 text-sm font-semibold text-muted-foreground dark:text-muted-foreground">
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
