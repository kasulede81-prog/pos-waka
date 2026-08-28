import { useMemo, useState } from "react";
import clsx from "clsx";
import { FolderPlus, Search } from "lucide-react";
import type { Language } from "../../types";
import { t, tTemplate } from "../../lib/i18n";
import { usePosStore } from "../../store/usePosStore";
import { useSubscription } from "../../context/SubscriptionContext";
import { canPersistCatalogShelfPreferences } from "../../lib/settingsAuthorization";
import {
  assignmentCategoryFromPickerItem,
  buildCatalogPickerItems,
  catalogCreateInsideParentId,
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
import { CatalogCreateFolderForm } from "../pos/CatalogCreateFolderForm";

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
  const [parentLocked, setParentLocked] = useState(false);
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
  const parentItem = persistedParents.find((item) => item.id === parentId);
  const insideLabel = parentItem ? catalogItemPathText(parentItem) : t(lang, "catalogFolderInsideTop");

  const selectItem = (item: CatalogPickerItem) => {
    onChange(assignmentCategoryFromPickerItem(item));
  };

  const openCreate = () => {
    const nextParent = catalogCreateInsideParentId(selectedItem);
    setParentId(nextParent);
    setParentLocked(Boolean(nextParent));
    setCreating(true);
    setNewName("");
    setCreateError(null);
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
    setParentLocked(false);
  };

  const createLabel =
    selectedItem?.persisted
      ? tTemplate(lang, "catalogCreateInside", { name: selectedItem.name })
      : t(lang, "catalogFoldersCreate");

  return (
    <div className="space-y-3 overflow-x-hidden">
      {selectedItem && selectedPath ? (
        <div className="w-full min-w-0 overflow-hidden rounded-xl border border-waka-200 bg-waka-50/80 px-3 py-2">
          <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
            {t(lang, "catalogProductFolderBanner")}
          </p>
          <p className="mt-0.5 break-words text-sm font-black leading-snug text-foreground">{selectedPath}</p>
        </div>
      ) : null}

      {chrome.showSearch ? (
        <label className="block">
          <span className="mb-1.5 flex items-center gap-2 text-sm font-bold text-foreground">
            <Search className="h-4 w-4" aria-hidden />
            {t(lang, "catalogFoldersSearch")}
          </span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t(lang, "catalogFoldersSearchPlaceholder")}
            autoComplete="off"
            className={inputClass ?? WIZARD_INPUT_TEXT}
          />
        </label>
      ) : null}

      {chrome.showCreate ? (
        <button
          type="button"
          onClick={() => {
            if (creating) {
              setCreating(false);
              setCreateError(null);
              return;
            }
            openCreate();
          }}
          className={clsx(wizardChoiceButtonClass(creating), "flex w-full items-center justify-center gap-2")}
        >
          <FolderPlus className="h-5 w-5" aria-hidden />
          {createLabel}
        </button>
      ) : null}

      {chrome.showCreate && creating ? (
        <CatalogCreateFolderForm
          lang={lang}
          newName={newName}
          onNameChange={setNewName}
          parentId={parentId}
          onParentChange={setParentId}
          parentOptions={persistedParents.map((item) => ({ id: item.id, path: catalogItemPathText(item) }))}
          insideLabel={insideLabel}
          parentLocked={parentLocked}
          onUnlockParent={() => setParentLocked(false)}
          error={createError}
          onCancel={() => {
            setCreating(false);
            setNewName("");
            setCreateError(null);
          }}
          onSubmit={submitCreate}
          nameClassName={inputClass ?? WIZARD_INPUT_TEXT}
          selectClassName={clsx(inputClass ?? WIZARD_INPUT_TEXT, "bg-card")}
          cancelClassName={wizardChoiceButtonClass(false)}
          submitClassName={wizardChoiceButtonClass(true)}
        />
      ) : null}

      {visible.length === 0 ? (
        <p className="text-sm font-medium text-muted-foreground">
          {items.length === 0 ? t(lang, "catalogFoldersEmpty") : t(lang, "catalogFolderNoMatches")}
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
