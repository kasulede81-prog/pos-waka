import { useMemo, useState } from "react";
import clsx from "clsx";
import { FolderPlus, Search } from "lucide-react";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { usePosStore } from "../../store/usePosStore";
import { useSubscription } from "../../context/SubscriptionContext";
import { canPersistCatalogShelfPreferences } from "../../lib/settingsAuthorization";
import {
  assignmentCategoryFromPickerItem,
  buildCatalogPickerItems,
  catalogItemPathText,
  catalogShopIdFromPreferences,
  findCatalogPickerItemByIdentity,
  hierarchyPickerChrome,
  isCatalogHierarchyEnabled,
  nextDestinationAfterCatalogCreate,
  searchCatalogPickerItems,
  selectedCatalogDestinationPath,
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
  const sessionActor = usePosStore((s) => s.sessionActor);
  const createCatalogShelf = usePosStore((s) => s.createCatalogShelf);
  const { snapshot, authMode } = useSubscription();
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [parentId, setParentId] = useState<string>("");
  const [createError, setCreateError] = useState<string | null>(null);

  const canCreateFolder = canPersistCatalogShelfPreferences(sessionActor, { snapshot, authMode });
  const chrome = hierarchyPickerChrome(isCatalogHierarchyEnabled(preferences), canCreateFolder);

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
  const selectedItem = findCatalogPickerItemByIdentity(items, value);
  const selectedPath = selectedCatalogDestinationPath(items, value);
  const selectedKey = value.trim();

  const selectItem = (item: CatalogPickerItem) => {
    onChange(assignmentCategoryFromPickerItem(item));
  };

  const submitCreate = () => {
    if (!canCreateFolder) return;
    setCreateError(null);
    const result = createCatalogShelf({
      name: newName,
      parentId: parentId || null,
    });
    const next = nextDestinationAfterCatalogCreate({
      ok: result.ok,
      legacyShelfKey: result.legacyShelfKey,
      currentValue: value,
    });
    if (!result.ok) {
      const key = result.errorKey;
      setCreateError(key ? t(lang, key) : t(lang, "shelfRenameEmpty"));
      return;
    }
    if (next.assigned) onChange(next.value);
    setCreating(false);
    setNewName("");
    setParentId("");
  };

  return (
    <div className="space-y-3 overflow-x-hidden">
      {selectedItem && selectedPath ? (
        <div className="w-full min-w-0 overflow-hidden rounded-xl border border-waka-200 bg-waka-50/80 px-3 py-2">
          <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
            {t(lang, "catalogSelectedFolder")}
          </p>
          <p className="mt-0.5 break-words text-sm font-black leading-snug text-foreground">{selectedPath}</p>
        </div>
      ) : null}

      {chrome.showSearch ? (
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
      ) : null}

      {chrome.showCreate ? (
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
      ) : null}

      {chrome.showCreate && creating ? (
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
            const selected = selectedItem?.id === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => selectItem(item)}
                style={{ paddingLeft: `${12 + Math.min(item.depth, 8) * 12}px` }}
                className={clsx(wizardChoiceButtonClass(selected), "flex w-full min-w-0 flex-col items-start justify-center py-3")}
              >
                <span className="w-full min-w-0 break-words text-left">{item.name}</span>
                {item.depth > 0 || query.trim() ? (
                  <span className="mt-0.5 w-full min-w-0 break-words text-left text-xs font-semibold opacity-70">
                    {catalogItemPathText(item)}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      )}
      {selectedKey && !selectedItem ? (
        <p className="break-words text-xs font-semibold text-muted-foreground">{selectedKey}</p>
      ) : null}
    </div>
  );
}
