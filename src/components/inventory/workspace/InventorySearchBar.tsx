import { useState } from "react";
import type { Language } from "../../../types";
import { t } from "../../../lib/i18n";
import { StockPinnedSearch } from "../../stock/StockPinnedSearch";

type Props = {
  lang: Language;
  onSearch: (query: string) => void;
};

export function InventorySearchBar({ lang, onSearch }: Props) {
  const [value, setValue] = useState("");

  const submit = () => {
    const q = value.trim();
    if (q) onSearch(q);
  };

  return (
    <section className="space-y-1.5" aria-label={t(lang, "iwSearchLabel")}>
      <p className="px-0.5 text-[10px] font-black uppercase tracking-wide text-stone-500">
        {t(lang, "iwSearchLabel")}
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <StockPinnedSearch
          lang={lang}
          value={value}
          onChange={(next) => {
            setValue(next);
            if (!next.trim()) return;
          }}
        />
      </form>
    </section>
  );
}
