import type { Language, UserRole } from "../../types";
import { t, tTemplate } from "../../lib/i18n";

type Props = {
  lang: Language;
  role: UserRole;
  label: string | null;
};

export function BackOfficeUnlockBanner({ lang, role, label }: Props) {
  return (
    <div className="border-b border-emerald-200 bg-emerald-50 px-4 py-2 text-center text-xs font-bold text-emerald-950">
      {tTemplate(lang, "backOfficeUnlockedBanner", {
        role: t(lang, `roleLabel_${role}` as Parameters<typeof t>[1]),
        name: label ?? "",
      })}
    </div>
  );
}
