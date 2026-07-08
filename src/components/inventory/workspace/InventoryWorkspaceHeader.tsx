import type { Language } from "../../../types";
import { t } from "../../../lib/i18n";

type Props = {
  lang: Language;
};

export function InventoryWorkspaceHeader({ lang }: Props) {
  return (
    <header className="space-y-1">
      <h2 className="text-lg font-black tracking-tight text-stone-950">{t(lang, "iwWorkspaceTitle")}</h2>
      <p className="text-xs font-semibold text-stone-500">{t(lang, "iwWorkspaceSub")}</p>
    </header>
  );
}
