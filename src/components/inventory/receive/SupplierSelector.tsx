import { Link } from "react-router-dom";
import clsx from "clsx";
import type { Language } from "../../../types";
import { t } from "../../../lib/i18n";
import { isWalkInSupplierId, WALK_IN_SUPPLIER_ID } from "../../../lib/walkInSupplier";
import { RECEIVE_FIELD_LABEL, WIZARD_INPUT_TEXT, wizardChoiceButtonClass } from "./receiveTokens";
import { ReceiveHeader } from "./ReceiveHeader";

export type SupplierSelectorMode = "dropdown" | "town-or-supplier";

type Supplier = { id: string; name: string };

type Props = {
  lang: Language;
  mode: SupplierSelectorMode;
  suppliers: Supplier[];
  supplierId: string;
  onSupplierIdChange: (id: string) => void;
  buySource?: "town" | "supplier";
  onBuySourceChange?: (source: "town" | "supplier") => void;
  townPlace?: string;
  onTownPlaceChange?: (value: string) => void;
  addSupplierHref?: string;
};

export function SupplierSelector({
  lang,
  mode,
  suppliers,
  supplierId,
  onSupplierIdChange,
  buySource = "town",
  onBuySourceChange,
  townPlace = "",
  onTownPlaceChange,
  addSupplierHref,
}: Props) {
  const walkIn = mode === "town-or-supplier" ? buySource === "town" : isWalkInSupplierId(supplierId);

  return (
    <section className="space-y-3">
      <ReceiveHeader
        title={t(lang, "receiveSupplierTitle")}
        action={
          addSupplierHref ? (
            <Link to={addSupplierHref} className="text-xs font-black text-primary hover:underline">
              + {t(lang, "ipActionAddSupplier")}
            </Link>
          ) : null
        }
      />

      {mode === "town-or-supplier" ? (
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => onBuySourceChange?.("town")}
            className={wizardChoiceButtonClass(buySource === "town")}
          >
            {t(lang, "restockSourceTown")}
          </button>
          <button
            type="button"
            onClick={() => onBuySourceChange?.("supplier")}
            className={wizardChoiceButtonClass(buySource === "supplier")}
          >
            {t(lang, "restockSourceSupplier")}
          </button>
        </div>
      ) : null}

      {mode === "town-or-supplier" && walkIn ? (
        <input
          value={townPlace}
          onChange={(e) => onTownPlaceChange?.(e.target.value)}
          placeholder={t(lang, "restockTownPlacePh")}
          className={WIZARD_INPUT_TEXT}
        />
      ) : (
        <label className="block">
          <span className={clsx(RECEIVE_FIELD_LABEL, mode === "dropdown" && "sr-only")}>
            {t(lang, "restockSupplier")}
          </span>
          <select
            value={walkIn && mode === "town-or-supplier" ? "" : supplierId}
            onChange={(e) => onSupplierIdChange(e.target.value)}
            className={`${WIZARD_INPUT_TEXT} mt-2`}
            disabled={mode === "town-or-supplier" && walkIn}
          >
            {mode === "dropdown" ? (
              <option value={WALK_IN_SUPPLIER_ID}>{t(lang, "restockTownBuy")}</option>
            ) : suppliers.length === 0 ? (
              <option value="">{t(lang, "restockNoSuppliersShort")}</option>
            ) : null}
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      )}

      {mode === "town-or-supplier" && !walkIn && suppliers.length === 0 ? (
        <p className="text-sm font-semibold text-muted-foreground">{t(lang, "restockNoSuppliersShort")}</p>
      ) : null}
    </section>
  );
}
