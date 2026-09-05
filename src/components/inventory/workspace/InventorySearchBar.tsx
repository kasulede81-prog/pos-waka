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
    <section aria-label={t(lang, "iwSearchLabel")}>
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
