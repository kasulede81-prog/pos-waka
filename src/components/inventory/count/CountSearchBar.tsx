import { Search } from "lucide-react";
import type { Language } from "../../../types";
import { t } from "../../../lib/i18n";
import { WIZARD_INPUT_TEXT } from "./countTokens";

type Props = {
  lang: Language;
  value: string;
  onChange: (value: string) => void;
  placeholderKey?: string;
};

export function CountSearchBar({ lang, value, onChange, placeholderKey = "inventoryCountSearchProduct" }: Props) {
  return (
    <label className="relative block">
      <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" aria-hidden />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={t(lang, placeholderKey)}
        className={`${WIZARD_INPUT_TEXT} pl-12 text-base`}
        autoComplete="off"
      />
    </label>
  );
}
