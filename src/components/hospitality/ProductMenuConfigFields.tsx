import { useState } from "react";
import type { Language, ModifierGroup, ModifierOption, Product, ProductMenuConfig, ProductVariant, RecipeLine, ComboSlot } from "../../types";
import { t } from "../../lib/i18n";
import { DEFAULT_MENU_SECTIONS } from "../../lib/menuModifiers";

type Props = {
  lang: Language;
  product: Product;
  ingredientProducts: Product[];
  onSave: (menu: ProductMenuConfig) => void;
};

function newId(prefix: string) {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
}

export function ProductMenuConfigFields({ lang, product, ingredientProducts, onSave }: Props) {
  const [menu, setMenu] = useState<ProductMenuConfig>(
    product.menu ?? { productKind: "finished_menu", modifierGroups: [], variants: [], recipe: { lines: [] } },
  );

  const addModifierGroup = () => {
    const g: ModifierGroup = {
      id: newId("mg"),
      label: "Options",
      required: false,
      selectionMode: "single",
      options: [{ id: newId("mo"), label: "Option", priceDeltaUgx: 0 }],
    };
    setMenu({ ...menu, modifierGroups: [...(menu.modifierGroups ?? []), g] });
  };

  const addRecipeLine = () => {
    const line: RecipeLine = {
      ingredientProductId: ingredientProducts[0]?.id ?? "",
      quantityBase: 1,
      unitLabel: ingredientProducts[0]?.baseUnit ?? "ea",
    };
    setMenu({
      ...menu,
      recipe: { lines: [...(menu.recipe?.lines ?? []), line] },
    });
  };

  return (
    <div className="space-y-4">
      <label className="block">
        <span className="text-sm font-bold text-stone-700">{t(lang, "menuProductKind")}</span>
        <select
          value={menu.productKind ?? "finished_menu"}
          onChange={(e) => setMenu({ ...menu, productKind: e.target.value as ProductMenuConfig["productKind"] })}
          className="mt-1 min-h-[44px] w-full rounded-xl border border-stone-200 px-3 text-sm font-bold"
        >
          <option value="finished_menu">{t(lang, "menuKindFinished")}</option>
          <option value="ingredient">{t(lang, "menuKindIngredient")}</option>
          <option value="semi_finished">{t(lang, "menuKindSemiFinished")}</option>
          <option value="retail">{t(lang, "menuKindRetail")}</option>
        </select>
      </label>

      <label className="block">
        <span className="text-sm font-bold text-stone-700">{t(lang, "menuSection")}</span>
        <select
          value={menu.menuSection ?? ""}
          onChange={(e) => setMenu({ ...menu, menuSection: e.target.value || null })}
          className="mt-1 min-h-[44px] w-full rounded-xl border border-stone-200 px-3 text-sm font-bold"
        >
          <option value="">{product.category}</option>
          {DEFAULT_MENU_SECTIONS.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </label>

      <section className="rounded-2xl border border-stone-200 p-3">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-sm font-black text-stone-800">{t(lang, "menuModifiersTitle")}</p>
          <button type="button" onClick={addModifierGroup} className="text-xs font-black text-waka-700">
            + {t(lang, "menuAddGroup")}
          </button>
        </div>
        {(menu.modifierGroups ?? []).map((group, gi) => (
          <div key={group.id} className="mb-3 rounded-xl bg-stone-50 p-3">
            <input
              value={group.label}
              onChange={(e) => {
                const groups = [...(menu.modifierGroups ?? [])];
                groups[gi] = { ...group, label: e.target.value };
                setMenu({ ...menu, modifierGroups: groups });
              }}
              className="mb-2 min-h-[40px] w-full rounded-lg border border-stone-200 px-2 text-sm font-bold"
            />
            <label className="mr-3 text-xs font-bold">
              <input
                type="checkbox"
                checked={group.required}
                onChange={(e) => {
                  const groups = [...(menu.modifierGroups ?? [])];
                  groups[gi] = { ...group, required: e.target.checked };
                  setMenu({ ...menu, modifierGroups: groups });
                }}
              />{" "}
              {t(lang, "menuRequired")}
            </label>
            {group.options.map((opt, oi) => (
              <div key={opt.id} className="mt-2 grid grid-cols-[1fr_100px] gap-2">
                <input
                  value={opt.label}
                  onChange={(e) => {
                    const groups = [...(menu.modifierGroups ?? [])];
                    const options = [...group.options];
                    options[oi] = { ...opt, label: e.target.value };
                    groups[gi] = { ...group, options };
                    setMenu({ ...menu, modifierGroups: groups });
                  }}
                  className="min-h-[40px] rounded-lg border border-stone-200 px-2 text-sm"
                />
                <input
                  value={opt.priceDeltaUgx ? String(opt.priceDeltaUgx) : ""}
                  onChange={(e) => {
                    const groups = [...(menu.modifierGroups ?? [])];
                    const options = [...group.options];
                    options[oi] = {
                      ...opt,
                      priceDeltaUgx: Math.max(0, Math.floor(Number(e.target.value.replace(/\D/g, "")) || 0)),
                    };
                    groups[gi] = { ...group, options };
                    setMenu({ ...menu, modifierGroups: groups });
                  }}
                  placeholder="UGX"
                  className="min-h-[40px] rounded-lg border border-stone-200 px-2 text-sm font-black"
                />
              </div>
            ))}
            <button
              type="button"
              className="mt-2 text-xs font-bold text-waka-700"
              onClick={() => {
                const groups = [...(menu.modifierGroups ?? [])];
                const opt: ModifierOption = { id: newId("mo"), label: "Option", priceDeltaUgx: 0 };
                groups[gi] = { ...group, options: [...group.options, opt] };
                setMenu({ ...menu, modifierGroups: groups });
              }}
            >
              + {t(lang, "menuAddOption")}
            </button>
          </div>
        ))}
      </section>

      <section className="rounded-2xl border border-stone-200 p-3">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-sm font-black text-stone-800">{t(lang, "menuRecipeTitle")}</p>
          <button type="button" onClick={addRecipeLine} className="text-xs font-black text-waka-700">
            + {t(lang, "menuAddIngredient")}
          </button>
        </div>
        {(menu.recipe?.lines ?? []).map((line, li) => (
          <div key={li} className="mb-2 grid grid-cols-[1fr_80px_60px] gap-2">
            <select
              value={line.ingredientProductId}
              onChange={(e) => {
                const lines = [...(menu.recipe?.lines ?? [])];
                const ing = ingredientProducts.find((p) => p.id === e.target.value);
                lines[li] = {
                  ...line,
                  ingredientProductId: e.target.value,
                  unitLabel: ing?.baseUnit ?? line.unitLabel,
                };
                setMenu({ ...menu, recipe: { lines } });
              }}
              className="min-h-[40px] rounded-lg border border-stone-200 px-2 text-sm"
            >
              {ingredientProducts.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <input
              value={String(line.quantityBase)}
              onChange={(e) => {
                const lines = [...(menu.recipe?.lines ?? [])];
                lines[li] = { ...line, quantityBase: Math.max(0, Number(e.target.value) || 0) };
                setMenu({ ...menu, recipe: { lines } });
              }}
              className="min-h-[40px] rounded-lg border border-stone-200 px-2 text-sm font-black"
            />
            <span className="flex items-center text-xs font-bold text-stone-500">{line.unitLabel ?? "ea"}</span>
          </div>
        ))}
      </section>

      <section className="rounded-2xl border border-stone-200 p-3">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-sm font-black text-stone-800">{t(lang, "menuVariantsTitle")}</p>
          <button
            type="button"
            onClick={() => {
              const v: ProductVariant = {
                id: newId("var"),
                label: "Regular",
                priceUgx: product.sellingPricePerUnitUgx,
                isDefault: !(menu.variants?.length),
                isActive: true,
              };
              setMenu({ ...menu, variants: [...(menu.variants ?? []), v] });
            }}
            className="text-xs font-black text-waka-700"
          >
            + {t(lang, "menuAddVariant")}
          </button>
        </div>
        {(menu.variants ?? []).map((variant, vi) => (
          <div key={variant.id} className="mb-2 grid grid-cols-[1fr_100px] gap-2 rounded-xl bg-stone-50 p-2">
            <input
              value={variant.label}
              onChange={(e) => {
                const variants = [...(menu.variants ?? [])];
                variants[vi] = { ...variant, label: e.target.value };
                setMenu({ ...menu, variants });
              }}
              className="min-h-[40px] rounded-lg border border-stone-200 px-2 text-sm font-bold"
            />
            <input
              value={variant.priceUgx != null ? String(variant.priceUgx) : ""}
              onChange={(e) => {
                const variants = [...(menu.variants ?? [])];
                variants[vi] = {
                  ...variant,
                  priceUgx: Math.max(0, Math.floor(Number(e.target.value.replace(/\D/g, "")) || 0)),
                };
                setMenu({ ...menu, variants });
              }}
              placeholder="UGX"
              className="min-h-[40px] rounded-lg border border-stone-200 px-2 text-sm font-black"
            />
          </div>
        ))}
      </section>

      <section className="rounded-2xl border border-stone-200 p-3">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-sm font-black text-stone-800">{t(lang, "menuComboTitle")}</p>
          <button
            type="button"
            onClick={() => {
              const slot: ComboSlot = {
                id: newId("slot"),
                label: "Choose item",
                required: true,
                choices: [],
              };
              setMenu({
                ...menu,
                combo: { slots: [...(menu.combo?.slots ?? []), slot], comboPriceUgx: menu.combo?.comboPriceUgx ?? null },
              });
            }}
            className="text-xs font-black text-waka-700"
          >
            + {t(lang, "menuAddComboSlot")}
          </button>
        </div>
        <label className="mb-2 block text-xs font-bold">
          {t(lang, "menuComboPrice")}
          <input
            value={menu.combo?.comboPriceUgx != null ? String(menu.combo.comboPriceUgx) : ""}
            onChange={(e) =>
              setMenu({
                ...menu,
                combo: {
                  slots: menu.combo?.slots ?? [],
                  comboPriceUgx: Math.max(0, Math.floor(Number(e.target.value.replace(/\D/g, "")) || 0)) || null,
                },
              })
            }
            className="mt-1 min-h-[40px] w-full rounded-lg border border-stone-200 px-2 text-sm font-black"
          />
        </label>
        {(menu.combo?.slots ?? []).map((slot, si) => (
          <div key={slot.id} className="mb-3 rounded-xl bg-stone-50 p-2">
            <input
              value={slot.label}
              onChange={(e) => {
                const slots = [...(menu.combo?.slots ?? [])];
                slots[si] = { ...slot, label: e.target.value };
                setMenu({ ...menu, combo: { ...menu.combo!, slots } });
              }}
              className="mb-2 min-h-[40px] w-full rounded-lg border border-stone-200 px-2 text-sm font-bold"
            />
            <select
              className="min-h-[40px] w-full rounded-lg border border-stone-200 px-2 text-sm"
              value={slot.choices[0]?.productId ?? ""}
              onChange={(e) => {
                const slots = [...(menu.combo?.slots ?? [])];
                const prod = ingredientProducts.find((p) => p.id === e.target.value);
                slots[si] = {
                  ...slot,
                  choices: e.target.value
                    ? [{ productId: e.target.value, isDefault: true, priceDeltaUgx: 0 }]
                    : [],
                };
                void prod;
                setMenu({ ...menu, combo: { ...menu.combo!, slots } });
              }}
            >
              <option value="">{t(lang, "menuComboPickProduct")}</option>
              {ingredientProducts.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        ))}
      </section>

      <button
        type="button"
        onClick={() => onSave(menu)}
        className="min-h-12 w-full rounded-2xl bg-waka-600 text-base font-black text-white"
      >
        {t(lang, "menuSaveConfig")}
      </button>
    </div>
  );
}
