import type { Language } from "../../types";
import { isCatalogHierarchyEnabled } from "../../lib/catalogHierarchy";
import { usePosStore } from "../../store/usePosStore";
import { CategoryShelfPicker } from "./CategoryShelfPicker";
import { HierarchyShelfPicker } from "./HierarchyShelfPicker";

type Props = {
  lang: Language;
  options: string[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  hint?: string;
  inputClass?: string;
  showHint?: boolean;
  requireModeChoice?: boolean;
};

/** Flat CategoryShelfPicker when hierarchy is off; folder picker when on. */
export function ShelfDestinationPicker({
  lang,
  options,
  value,
  onChange,
  placeholder,
  hint,
  inputClass,
  showHint,
  requireModeChoice,
}: Props) {
  const enabled = usePosStore((s) => isCatalogHierarchyEnabled(s.preferences));
  if (!enabled) {
    return (
      <CategoryShelfPicker
        lang={lang}
        options={options}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        hint={hint}
        inputClass={inputClass}
        showHint={showHint}
        requireModeChoice={requireModeChoice}
      />
    );
  }
  return <HierarchyShelfPicker lang={lang} value={value} onChange={onChange} inputClass={inputClass} />;
}
