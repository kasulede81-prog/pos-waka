import { useMemo, useState } from "react";
import clsx from "clsx";
import { FolderPlus, Search } from "lucide-react";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { usePosStore } from "../../store/usePosStore";
import {
  assignmentCategoryFromPickerItem,
  buildCatalogPickerItems,
  catalogItemPathText,
  catalogShopIdFromPreferences,
  searchCatalogPickerItems,
  type CatalogPickerItem,
} from "../../lib/catalogHierarchy";
import { wizardChoiceButtonClass, WIZARD_INPUT_TEXT } from "./wizard/wizardTokens";

type Props = {
  lang: Language;
  value: string;
  onChange: (value: string) => void;
  inputClass?: string;
};

export function HierarchyShelfPicker({ lang, value, onChange, inputClass }: Props) {
  const products = usePosStore((s) => s.products);
  const preferences = usePosStore((s) => s.preferences);
  const createCatalogShelf = usePosStore((s) => s.createCatalogShelf);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [parentId, setParentId] = useState<string>("");
  const [createError, setCreateError] = useState<string | null>(null);

  const items = useMemo(
    () =>
      buildCatalogPickerItems({
        products,
        layout: preferences.posShelfLayout ?? {},
        orderKeys: preferences.posPinnedShelfKeys ?? [],
        nodes: preferences.posCatalogNodes ?? [],
        shopId: catalogShopIdFromPreferences(preferences),
      }),
    [products, preferences],
  );

  const visible = useMemo(() => searchCatalogPickerItems(items, query), [items, query]);
  const persistedParents = useMemo(() => items.filter((i) => i.persisted), [items]);
  const selectedKey = value.trim();

  const selectItem = (item: CatalogPickerItem) => {
    onChange(assignmentCategoryFromPickerItem(item));
  };

  const submitCreate = () => {
    setCreateError(null);
    const result = createCatalogShelf({
      name: newName,
      parentId: parentId || null,
    });
    if (!result.ok) {
      const key = result.errorKey;
      setCreateError(key ? t(lang, key) : t(lang, "shelfRenameEmpty"));
      const fallback = newName.trim();
      if (fallback) onChange(fallback);
      return;
    }
    if (result.legacyShelfKey) onChange(result.legacyShelfKey);
    setCreating(false);
    setNewName("");
    setParentId("");
  };

  return (
    <div className="space-y-3">
      <label className="block">
        <span className="mb-1.5 flex items-center gap-2 text-sm font-bold text-foreground">
          <Search className="h-4 w-4" aria-hidden />
          {t(lang, "catalogShelfSearch")}
        </span>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t(lang, "catalogShelfSearchPlaceholder")}
          autoComplete="off"
          className={inputClass ?? WIZARD_INPUT_TEXT}
        />
      </label>

      <button
        type="button"
        onClick={() => {
          setCreating((open) => !open);
          setCreateError(null);
        }}
        className={clsx(wizardChoiceButtonClass(creating), "flex w-full items-center justify-center gap-2")}
      >
        <FolderPlus className="h-5 w-5" aria-hidden />
        {t(lang, "catalogShelfCreate")}
      </button>

      {creating ? (
        <div className="space-y-3 rounded-2xl border border-border bg-muted/30 p-3">
          <p className="text-sm font-medium text-muted-foreground">{t(lang, "catalogShelfCreatedHint")}</p>
          <label className="block space-y-1">
            <span className="text-xs font-bold text-muted-foreground">{t(lang, "catalogShelfName")}</span>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={t(lang, "simpleAddShelfPlaceholder")}
              autoFocus
              autoComplete="off"
              className={inputClass ?? WIZARD_INPUT_TEXT}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-bold text-muted-foreground">{t(lang, "catalogShelfParent")}</span>
            <select
              value={parentId}
              onChange={(e) => setParentId(e.target.value)}
              className={clsx(inputClass ?? WIZARD_INPUT_TEXT, "bg-card")}
            >
              <option value="">{t(lang, "catalogShelfParentNone")}</option>
              {persistedParents.map((item) => (
                <option key={item.id} value={item.id}>
                  {catalogItemPathText(item)}
                </option>
              ))}
            </select>
          </label>
          {createError ? <p className="text-xs font-bold text-danger">{createError}</p> : null}
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => {
                setCreating(false);
                setNewName("");
                setCreateError(null);
              }}
              className={wizardChoiceButtonClass(false)}
            >
              {t(lang, "cancel")}
            </button>
            <button type="button" onClick={submitCreate} className={wizardChoiceButtonClass(true)}>
              {t(lang, "catalogShelfCreateAction")}
            </button>
          </div>
        </div>
      ) : null}

      {visible.length === 0 ? (
        <p className="text-sm font-medium text-muted-foreground">
          {items.length === 0 ? t(lang, "catalogShelfEmpty") : t(lang, "catalogShelfNoMatches")}
        </p>
      ) : (
        <div className="grid gap-2">
          {visible.map((item) => {
            const selected = item.legacyShelfKey === selectedKey;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => selectItem(item)}
                style={{ paddingLeft: `${12 + item.depth * 16}px` }}
                className={clsx(wizardChoiceButtonClass(selected), "flex w-full flex-col items-start justify-center py-3")}
              >
                <span className="truncate text-left">{item.name}</span>
                {item.depth > 0 || query.trim() ? (
                  <span className="mt-0.5 truncate text-left text-xs font-semibold opacity-70">
                    {catalogItemPathText(item)}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
