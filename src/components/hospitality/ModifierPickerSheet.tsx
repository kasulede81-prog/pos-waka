import { useMemo, useState } from "react";
import clsx from "clsx";
import type { Language, ModifierGroup, Product, ProductVariant, SaleLineComboSelection, SaleLineModifier } from "../../types";
import { t } from "../../lib/i18n";
import { formatUgx } from "../../lib/formatUgx";
import { ModalSheet } from "../layout/ModalSheet";
import {
  defaultModifierSelections,
  modifierPriceTotal,
  modifierToSaleLine,
  productMenuConfig,
  resolveProductVariant,
  validateModifierSelections,
} from "../../lib/menuModifiers";
import { defaultComboSelections, normalizeComboConfig } from "../../lib/comboMeals";

type Props = {
  lang: Language;
  open: boolean;
  product: Product;
  products: Product[];
  onClose: () => void;
  onConfirm: (input: {
    variantId?: string | null;
    modifiers: SaleLineModifier[];
    comboSelections?: SaleLineComboSelection[];
    notes?: string | null;
  }) => void;
};

export function ModifierPickerSheet({ lang, open, product, products, onClose, onConfirm }: Props) {
  const menu = productMenuConfig(product);
  const groups = menu?.modifierGroups ?? [];
  const variants = menu?.variants ?? [];
  const combo = normalizeComboConfig(menu?.combo);

  const [variantId, setVariantId] = useState<string | null>(
    variants.find((v) => v.isDefault)?.id ?? variants[0]?.id ?? null,
  );
  const [selected, setSelected] = useState<SaleLineModifier[]>(() => defaultModifierSelections(groups));
  const [comboSelections, setComboSelections] = useState<SaleLineComboSelection[]>(() =>
    combo ? defaultComboSelections(combo, products) : [],
  );
  const [notes, setNotes] = useState("");

  const variant = resolveProductVariant(product, variantId);
  const basePrice = variant?.priceUgx ?? product.sellingPricePerUnitUgx;
  const previewTotal = useMemo(() => {
    let total = basePrice + modifierPriceTotal(selected);
    if (combo?.comboPriceUgx != null) total = combo.comboPriceUgx + modifierPriceTotal(selected);
    return total;
  }, [basePrice, selected, combo]);

  const toggleOption = (group: ModifierGroup, optionId: string) => {
    const opt = group.options.find((o) => o.id === optionId);
    if (!opt) return;
    const row = modifierToSaleLine(group, opt);
    if (group.selectionMode === "single") {
      setSelected((prev) => [...prev.filter((m) => m.groupId !== group.id), row]);
      return;
    }
    const exists = selected.some((m) => m.groupId === group.id && m.optionId === optionId);
    if (exists) {
      setSelected((prev) => prev.filter((m) => !(m.groupId === group.id && m.optionId === optionId)));
      return;
    }
    const count = selected.filter((m) => m.groupId === group.id).length;
    const max = group.maxSelections ?? group.options.length;
    if (count >= max) return;
    setSelected((prev) => [...prev, row]);
  };

  const isSelected = (groupId: string, optionId: string) =>
    selected.some((m) => m.groupId === groupId && m.optionId === optionId);

  const handleConfirm = () => {
    const validated = validateModifierSelections(groups, selected);
    if (!validated.ok) return;
    onConfirm({
      variantId,
      modifiers: validated.modifiers,
      comboSelections: combo ? comboSelections : undefined,
      notes: notes.trim() || null,
    });
  };

  if (!open) return null;

  return (
    <ModalSheet
      open
      onClose={onClose}
      zIndexClass="z-[65]"
      title={
        <div>
          <h2 className="text-xl font-black text-stone-950">{product.name}</h2>
          <p className="text-lg font-black text-waka-700">{formatUgx(previewTotal)}</p>
        </div>
      }
      footer={
        <button
          type="button"
          onClick={handleConfirm}
          className="min-h-14 w-full rounded-2xl bg-waka-600 text-lg font-black text-white"
        >
          {t(lang, "modifierPickerAdd")}
        </button>
      }
    >
      {variants.length > 0 ? (
        <section className="mb-4">
          <p className="mb-2 text-sm font-black text-stone-700">{t(lang, "modifierPickerVariant")}</p>
          <div className="flex flex-wrap gap-2">
            {variants.map((v: ProductVariant) => (
              <button
                key={v.id}
                type="button"
                onClick={() => setVariantId(v.id)}
                className={clsx(
                  "min-h-10 rounded-xl border px-3 text-sm font-black",
                  variantId === v.id ? "border-waka-500 bg-waka-50" : "border-stone-200",
                )}
              >
                {v.label}
                {v.priceUgx != null ? ` · ${formatUgx(v.priceUgx)}` : ""}
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {combo ? (
        <section className="mb-4">
          <p className="mb-2 text-sm font-black text-stone-700">{t(lang, "modifierPickerCombo")}</p>
          {combo.slots.map((slot) => (
            <label key={slot.id} className="mb-2 block">
              <span className="text-xs font-bold text-stone-600">{slot.label}</span>
              <select
                className="mt-1 min-h-[44px] w-full rounded-xl border border-stone-200 px-3 text-sm font-bold"
                value={comboSelections.find((s) => s.slotId === slot.id)?.productId ?? ""}
                onChange={(e) => {
                  const choice = slot.choices.find((c) => c.productId === e.target.value);
                  const p = products.find((x) => x.id === e.target.value);
                  if (!choice || !p) return;
                  setComboSelections((prev) => [
                    ...prev.filter((s) => s.slotId !== slot.id),
                    {
                      slotId: slot.id,
                      slotLabel: slot.label,
                      productId: p.id,
                      productName: p.name,
                      priceDeltaUgx: choice.priceDeltaUgx ?? 0,
                    },
                  ]);
                }}
              >
                {slot.choices.map((c) => {
                  const p = products.find((x) => x.id === c.productId);
                  return (
                    <option key={c.productId} value={c.productId}>
                      {p?.name ?? c.productId}
                    </option>
                  );
                })}
              </select>
            </label>
          ))}
        </section>
      ) : null}

      {groups.map((group) => (
        <section key={group.id} className="mb-4">
          <p className="mb-2 text-sm font-black text-stone-800">
            {group.label}
            {group.required ? <span className="text-rose-600"> *</span> : null}
          </p>
          <div className="space-y-2">
            {group.options.map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => toggleOption(group, opt.id)}
                className={clsx(
                  "flex min-h-11 w-full items-center justify-between rounded-xl border px-3 text-sm font-bold",
                  isSelected(group.id, opt.id) ? "border-waka-500 bg-waka-50" : "border-stone-200 bg-white",
                )}
              >
                <span>{opt.label}</span>
                <span>{opt.priceDeltaUgx ? `+${formatUgx(opt.priceDeltaUgx)}` : ""}</span>
              </button>
            ))}
          </div>
        </section>
      ))}

      <label className="block">
        <span className="text-sm font-bold text-stone-700">{t(lang, "lineNotesLabel")}</span>
        <input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder={t(lang, "lineNotesPlaceholder")}
          className="mt-1 min-h-[44px] w-full rounded-xl border border-stone-200 px-3 text-sm font-medium"
        />
      </label>
    </ModalSheet>
  );
}
