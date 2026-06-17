import type { Language } from "../../types";
import { OfficeRestockSuggestionsCard } from "./OfficeRestockSuggestionsCard";
import { OfficeSupplierSummaryCard } from "./OfficeSupplierSummaryCard";

type Props = {
  lang: Language;
  showSuppliers: boolean;
  showRestock: boolean;
};

/** Heavy hub cards — loaded after first paint so Back Office opens fast on Android. */
export function OfficeHubDeferredCards({ lang, showSuppliers, showRestock }: Props) {
  return (
    <>
      {showSuppliers ? <OfficeSupplierSummaryCard lang={lang} /> : null}
      {showRestock ? <OfficeRestockSuggestionsCard lang={lang} /> : null}
    </>
  );
}
