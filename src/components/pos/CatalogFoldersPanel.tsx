import { useMemo, useState } from "react";
import clsx from "clsx";
import { ChevronDown, ChevronRight, FolderPlus, Search } from "lucide-react";
import type { Language } from "../../types";
import { t, tTemplate } from "../../lib/i18n";
import { usePosStore } from "../../store/usePosStore";
import {
  buildCatalogFolderTreeRows,
  buildCatalogPickerItems,
  catalogChildren,
  catalogItemPathText,
  catalogReparentTargets,
  catalogShopIdFromPreferences,
  visibleCatalogFolderTreeRows,
  type CatalogFolderTreeRow,
} from "../../lib/catalogHierarchy";
import { formatShelfProductCountLabel } from "../../lib/posShelfDisplayLabel";

type Props = {
  lang: Language;
};

export function CatalogFoldersPanel({ lang }: Props) {
  const products = usePosStore((s) => s.products);
  const preferences = usePosStore((s) => s.preferences);
  const createCatalogShelf = usePosStore((s) => s.createCatalogShelf);
  const reparentCatalogShelf = usePosStore((s) => s.reparentCatalogShelf);
  const reorderCatalogSiblings = usePosStore((s) => s.reorderCatalogSiblings);
  const renameShelfCategory = usePosStore((s) => s.renameShelfCategory);
  const deleteEmptyShelf = usePosStore((s) => s.deleteEmptyShelf);

  const shopId = catalogShopIdFromPreferences(preferences);
  const nodes = useMemo(() => preferences.posCatalogNodes ?? [], [preferences.posCatalogNodes]);
  const layout = useMemo(() => preferences.posShelfLayout ?? {}, [preferences.posShelfLayout]);
  const orderKeys = useMemo(() => preferences.posPinnedShelfKeys ?? [], [preferences.posPinnedShelfKeys]);

  const allRows = useMemo(
    () => buildCatalogFolderTreeRows({ nodes, shopId, products }),
    [nodes, shopId, products],
  );
  const pickerItems = useMemo(
    () =>
      buildCatalogPickerItems({
        products,
        layout,
        orderKeys,
        nodes,
        shopId,
      }),
    [products, layout, orderKeys, nodes, shopId],
  );
  const virtualItems = useMemo(
    () => pickerItems.filter((item) => !item.persisted),
    [pickerItems],
  );

  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [parentId, setParentId] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [movingId, setMovingId] = useState<string | null>(null);
  const [moveParentId, setMoveParentId] = useState("");
  const [moveError, setMoveError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");

  const searching = query.trim().length > 0;
  const visibleRows = useMemo(
    () => visibleCatalogFolderTreeRows(allRows, expanded, query),
    [allRows, expanded, query],
  );
  const selected = allRows.find((r) => r.id === selectedId) ?? null;
  const persistedParents = pickerItems.filter((i) => i.persisted);
  const moveTargets = movingId ? catalogReparentTargets(nodes, shopId, movingId) : [];

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const submitCreate = () => {
    setCreateError(null);
    const result = createCatalogShelf({
      name: newName,
      parentId: parentId || null,
    });
    if (!result.ok) {
      setCreateError(t(lang, result.errorKey ?? "shelfRenameEmpty"));
      return;
    }
    setCreating(false);
    setNewName("");
    setParentId("");
    setStatus(tTemplate(lang, "catalogFoldersCreated", { name: result.legacyShelfKey ?? newName.trim() }));
    const created = (usePosStore.getState().preferences.posCatalogNodes ?? []).find(
      (n) => n.legacyShelfKey === result.legacyShelfKey,
    );
    if (created) {
      setSelectedId(created.id);
      if (created.parentId) {
        setExpanded((prev) => {
          const next = new Set(prev);
          let pid: string | null = created.parentId;
          while (pid) {
            next.add(pid);
            pid = nodes.find((n) => n.id === pid)?.parentId ?? null;
          }
          return next;
        });
      }
    }
  };

  const submitMove = () => {
    if (!movingId) return;
    setMoveError(null);
    const result = reparentCatalogShelf(movingId, moveParentId || null);
    if (!result.ok) {
      setMoveError(t(lang, result.errorKey ?? "invalid"));
      return;
    }
    setMovingId(null);
    setStatus(t(lang, "catalogFoldersMoved"));
  };

  const moveSibling = (row: CatalogFolderTreeRow, direction: -1 | 1) => {
    const siblings = catalogChildren(nodes, row.parentId);
    const ids = siblings.map((n) => n.id);
    const index = ids.indexOf(row.id);
    const next = index + direction;
    if (index < 0 || next < 0 || next >= ids.length) return;
    const ordered = [...ids];
    const [moved] = ordered.splice(index, 1);
    ordered.splice(next, 0, moved!);
    const result = reorderCatalogSiblings(row.parentId, ordered);
    if (!result.ok) setStatus(t(lang, result.errorKey ?? "invalid"));
  };

  const submitRename = () => {
    if (!selected) return;
    const result = renameShelfCategory(selected.legacyShelfKey, renameDraft);
    if (!result.ok) {
      setStatus(t(lang, result.errorKey ?? "invalid"));
      return;
    }
    setStatus(t(lang, "posShelfRenamed"));
  };

  const submitDelete = () => {
    if (!selected) return;
    if (selected.hasChildren) {
      setStatus(t(lang, "catalogFoldersCannotDeleteChildren"));
      return;
    }
    const ok = window.confirm(
      tTemplate(lang, "posShelfDeleteConfirm", { name: selected.name }),
    );
    if (!ok) return;
    const result = deleteEmptyShelf(selected.legacyShelfKey);
    if (!result.ok) {
      setStatus(t(lang, result.errorKey ?? "invalid"));
      return;
    }
    setSelectedId(null);
    setStatus(t(lang, "catalogFoldersDeleted"));
  };

  const makeFolder = (legacyShelfKey: string) => {
    const result = createCatalogShelf({ name: legacyShelfKey, parentId: null });
    if (!result.ok) {
      setStatus(t(lang, result.errorKey ?? "invalid"));
      return;
    }
    setStatus(tTemplate(lang, "catalogFoldersPromoted", { name: legacyShelfKey }));
  };

  return (
    <section className="space-y-3 overflow-x-hidden rounded-2xl border-2 border-waka-200 bg-card p-3">
      <div>
        <p className="text-xs font-black uppercase tracking-wide text-muted-foreground">
          {t(lang, "catalogFoldersTitle")}
        </p>
        <p className="mt-1 text-sm font-medium text-muted-foreground">{t(lang, "catalogFoldersHint")}</p>
      </div>

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
          className="min-h-[44px] w-full rounded-xl border-2 border-border px-3 text-sm font-semibold outline-none focus:border-waka-400"
        />
      </label>

      <button
        type="button"
        onClick={() => {
          setCreating((open) => !open);
          setCreateError(null);
          setStatus(null);
        }}
        className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-waka-600 px-4 text-sm font-black text-white active:bg-waka-700"
      >
        <FolderPlus className="h-5 w-5" aria-hidden />
        {t(lang, "catalogFoldersCreate")}
      </button>

      {creating ? (
        <div className="space-y-3 rounded-2xl border border-border bg-muted/30 p-3">
          <p className="text-sm font-medium text-muted-foreground">{t(lang, "catalogShelfCreatedHint")}</p>
          <label className="block space-y-1">
            <span className="text-xs font-bold text-muted-foreground">{t(lang, "catalogShelfName")}</span>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={t(lang, "catalogFoldersNamePh")}
              autoFocus
              autoComplete="off"
              className="min-h-[44px] w-full rounded-xl border-2 border-border px-3 text-sm font-semibold"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-bold text-muted-foreground">{t(lang, "catalogShelfParent")}</span>
            <select
              value={parentId}
              onChange={(e) => setParentId(e.target.value)}
              className="min-h-[44px] w-full rounded-xl border-2 border-border bg-card px-3 text-sm font-semibold"
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
              className="min-h-[44px] rounded-xl border border-border px-3 text-sm font-black"
            >
              {t(lang, "cancel")}
            </button>
            <button
              type="button"
              onClick={submitCreate}
              className="min-h-[44px] rounded-xl bg-waka-600 px-3 text-sm font-black text-white"
            >
              {t(lang, "catalogFoldersCreateAction")}
            </button>
          </div>
        </div>
      ) : null}

      {visibleRows.length === 0 ? (
        <p className="text-sm font-semibold text-muted-foreground">
          {allRows.length === 0 ? t(lang, "catalogFoldersEmpty") : t(lang, "catalogShelfNoMatches")}
        </p>
      ) : (
        <ul className="space-y-1">
          {visibleRows.map((row) => {
            const open = searching || expanded.has(row.id);
            const indent = Math.min(row.depth, 8) * 12;
            const siblings = catalogChildren(nodes, row.parentId);
            const index = siblings.findIndex((n) => n.id === row.id);
            return (
              <li key={row.id}>
                <div
                  className={clsx(
                    "rounded-xl border px-2 py-1.5",
                    selectedId === row.id ? "border-waka-500 bg-waka-50" : "border-border bg-muted/30",
                  )}
                >
                  <div className="flex min-w-0 items-start gap-1" style={{ paddingLeft: indent }}>
                    {row.hasChildren ? (
                      <button
                        type="button"
                        aria-expanded={open}
                        onClick={() => toggleExpand(row.id)}
                        className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg active:bg-muted"
                      >
                        {open ? <ChevronDown className="h-5 w-5" /> : <ChevronRight className="h-5 w-5" />}
                      </button>
                    ) : (
                      <span className="h-10 w-10 shrink-0" aria-hidden />
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedId(row.id);
                        setRenameDraft(row.name);
                        setStatus(null);
                      }}
                      className="min-h-[44px] min-w-0 flex-1 py-1 text-left"
                    >
                      <span className="block break-words text-sm font-black uppercase text-foreground">{row.name}</span>
                      <span className="mt-0.5 block break-words text-xs font-medium text-muted-foreground">
                        {row.pathText}
                      </span>
                      <span className="block text-xs font-medium text-muted-foreground">
                        {formatShelfProductCountLabel(lang, row.directProductCount)}
                        {row.hasChildren
                          ? ` · ${tTemplate(lang, "catalogFoldersInclusive", { count: row.inclusiveProductCount })}`
                          : ""}
                      </span>
                    </button>
                    <div className="flex shrink-0 flex-col gap-1">
                      <button
                        type="button"
                        disabled={index <= 0}
                        onClick={() => moveSibling(row, -1)}
                        className="min-h-[36px] rounded-lg border border-border px-2 text-xs font-black disabled:opacity-30"
                      >
                        {t(lang, "catalogFoldersUp")}
                      </button>
                      <button
                        type="button"
                        disabled={index < 0 || index >= siblings.length - 1}
                        onClick={() => moveSibling(row, 1)}
                        className="min-h-[36px] rounded-lg border border-border px-2 text-xs font-black disabled:opacity-30"
                      >
                        {t(lang, "catalogFoldersDown")}
                      </button>
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {selected ? (
        <div className="space-y-3 rounded-2xl border border-waka-200 bg-waka-50/50 p-3">
          <p className="text-sm font-black text-foreground">{selected.name}</p>
          <label className="block space-y-1">
            <span className="text-xs font-bold text-muted-foreground">{t(lang, "posShelfEditName")}</span>
            <input
              value={renameDraft}
              onChange={(e) => setRenameDraft(e.target.value)}
              className="min-h-[44px] w-full rounded-xl border border-border px-3 text-sm font-semibold"
            />
          </label>
          <button
            type="button"
            onClick={submitRename}
            className="min-h-[44px] w-full rounded-xl bg-waka-600 px-4 text-sm font-black text-white"
          >
            {t(lang, "posShelfRenameSave")}
          </button>
          <button
            type="button"
            onClick={() => {
              setMovingId(selected.id);
              setMoveParentId(selected.parentId ?? "");
              setMoveError(null);
            }}
            className="min-h-[44px] w-full rounded-xl border-2 border-waka-300 px-4 text-sm font-black text-waka-900"
          >
            {t(lang, "catalogFoldersMove")}
          </button>
          {selected.hasChildren ? (
            <p className="text-xs font-bold text-muted-foreground">{t(lang, "catalogFoldersCannotDeleteChildren")}</p>
          ) : (
            <button
              type="button"
              onClick={submitDelete}
              className="min-h-[44px] w-full rounded-xl border-2 border-danger/40 bg-danger-muted px-4 text-sm font-black text-danger"
            >
              {t(lang, "posShelfDelete")}
            </button>
          )}
        </div>
      ) : null}

      {movingId ? (
        <div className="space-y-3 rounded-2xl border border-border bg-muted/40 p-3">
          <p className="text-sm font-black text-foreground">{t(lang, "catalogFoldersMoveTitle")}</p>
          <label className="block space-y-1">
            <span className="text-xs font-bold text-muted-foreground">{t(lang, "catalogShelfParent")}</span>
            <select
              value={moveParentId}
              onChange={(e) => setMoveParentId(e.target.value)}
              className="min-h-[44px] w-full rounded-xl border-2 border-border bg-card px-3 text-sm font-semibold"
            >
              <option value="">{t(lang, "catalogShelfParentNone")}</option>
              {moveTargets.map((n) => {
                const row = allRows.find((r) => r.id === n.id);
                return (
                  <option key={n.id} value={n.id}>
                    {row?.pathText ?? n.name}
                  </option>
                );
              })}
            </select>
          </label>
          {moveError ? <p className="text-xs font-bold text-danger">{moveError}</p> : null}
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setMovingId(null)}
              className="min-h-[44px] rounded-xl border border-border px-3 text-sm font-black"
            >
              {t(lang, "cancel")}
            </button>
            <button
              type="button"
              onClick={submitMove}
              className="min-h-[44px] rounded-xl bg-waka-600 px-3 text-sm font-black text-white"
            >
              {t(lang, "catalogFoldersMoveAction")}
            </button>
          </div>
        </div>
      ) : null}

      {virtualItems.length > 0 ? (
        <div className="space-y-2 rounded-2xl border border-dashed border-border p-3">
          <p className="text-xs font-black uppercase tracking-wide text-muted-foreground">
            {t(lang, "catalogFoldersLegacyTitle")}
          </p>
          <p className="text-xs font-medium text-muted-foreground">{t(lang, "catalogFoldersLegacyHint")}</p>
          <ul className="space-y-2">
            {virtualItems.map((item) => (
              <li key={item.id} className="flex min-h-[44px] items-center justify-between gap-2">
                <span className="min-w-0 break-words text-sm font-bold">{item.name}</span>
                <button
                  type="button"
                  onClick={() => makeFolder(item.legacyShelfKey)}
                  className="shrink-0 rounded-xl border border-waka-300 px-3 py-2 text-xs font-black text-waka-900"
                >
                  {t(lang, "catalogFoldersMakeFolder")}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {status ? <p className="text-sm font-bold text-foreground">{status}</p> : null}
    </section>
  );
}
