import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { Language, Product } from "../../types";
import { t, tTemplate } from "../../lib/i18n";
import { useActorCan } from "../../hooks/useActorCan";
import { usePosStore } from "../../store/usePosStore";
import { isCatalogHierarchyEnabled } from "../../lib/catalogHierarchy";
import { isPharmacyMode } from "../../lib/pharmacy";
import { isHospitalityMode } from "../../lib/hospitality";
import {
  filterProductsForEmptyShelfRefill,
  listEmptyShelfRows,
  type EmptyShelfRow,
} from "../../lib/emptyShelfManager";
import { WakaCheckbox } from "../enterprise/WakaCheckbox";

type Props = {
  lang: Language;
};

export function EmptyShelvesPanel({ lang }: Props) {
  const products = usePosStore((s) => s.products);
  const layoutRaw = usePosStore((s) => s.preferences.posShelfLayout);
  const orderRaw = usePosStore((s) => s.preferences.posPinnedShelfKeys);
  const nodesRaw = usePosStore((s) => s.preferences.posCatalogNodes);
  const preferences = usePosStore((s) => s.preferences);
  const deleteEmptyShelves = usePosStore((s) => s.deleteEmptyShelves);
  const refillEmptyShelf = usePosStore((s) => s.refillEmptyShelf);
  const { can } = useActorCan();
  const canRefill = can("stock.adjust");

  const pharmacyMode = isPharmacyMode(preferences.businessType, preferences.pharmacyModeEnabled);
  const hospitalityMode = isHospitalityMode(preferences.businessType, preferences.hospitalityModeEnabled);
  const hierarchyEnabled = isCatalogHierarchyEnabled(preferences);

  const rows = useMemo(
    () =>
      listEmptyShelfRows({
        products,
        layout: layoutRaw ?? {},
        orderKeys: orderRaw ?? [],
        nodes: nodesRaw ?? [],
        hierarchyEnabled,
        shopId: preferences.wakaShopId ?? undefined,
        pharmacyMode,
        hospitalityMode,
        businessType: preferences.businessType,
      }),
    [
      products,
      layoutRaw,
      orderRaw,
      nodesRaw,
      hierarchyEnabled,
      preferences.wakaShopId,
      pharmacyMode,
      hospitalityMode,
      preferences.businessType,
    ],
  );

  const deletableKeys = useMemo(() => rows.filter((r) => r.deletable).map((r) => r.key), [rows]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState<string | null>(null);
  const [refillDest, setRefillDest] = useState<EmptyShelfRow | null>(null);

  const visibleSelected = useMemo(() => {
    const keys = new Set(rows.map((r) => r.key));
    const next = new Set<string>();
    for (const key of selected) {
      if (keys.has(key)) next.add(key);
    }
    return next;
  }, [rows, selected]);

  const selectedDeletable = deletableKeys.filter((k) => visibleSelected.has(k));
  const selectedRows = rows.filter((r) => visibleSelected.has(r.key));
  const allDeletableSelected = deletableKeys.length > 0 && selectedDeletable.length === deletableKeys.length;

  const toggle = useCallback((key: string, checked: boolean) => {
    setStatus(null);
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(
    (checked: boolean) => {
      setStatus(null);
      setSelected(checked ? new Set(deletableKeys) : new Set());
    },
    [deletableKeys],
  );

  const confirmDelete = useCallback(() => {
    if (selectedDeletable.length === 0) return;
    const confirmKey = selectedDeletable.length === 1 ? "emptyShelvesDeleteConfirmOne" : "emptyShelvesDeleteConfirm";
    const ok = window.confirm(tTemplate(lang, confirmKey, { count: selectedDeletable.length }));
    if (!ok) return;
    const result = deleteEmptyShelves(selectedDeletable);
    if (!result.ok) {
      setStatus(t(lang, result.errorKey ?? "invalid"));
      return;
    }
    const parts: string[] = [];
    if ((result.deletedCount ?? 0) === 1) parts.push(t(lang, "emptyShelvesDeletedOne"));
    else if ((result.deletedCount ?? 0) > 1) {
      parts.push(tTemplate(lang, "emptyShelvesDeleted", { count: result.deletedCount ?? 0 }));
    }
    if ((result.skippedOccupiedCount ?? 0) === 1) parts.push(t(lang, "emptyShelvesSkippedOccupiedOne"));
    else if ((result.skippedOccupiedCount ?? 0) > 1) {
      parts.push(tTemplate(lang, "emptyShelvesSkippedOccupied", { count: result.skippedOccupiedCount ?? 0 }));
    }
    if ((result.skippedBlockedCount ?? 0) > 0) {
      parts.push(
        tTemplate(lang, "emptyShelvesSkippedBlocked", { count: result.skippedBlockedCount ?? 0 }),
      );
    }
    setStatus(parts.join(" ") || t(lang, "emptyShelvesNoneDeleted"));
    setSelected(new Set());
  }, [deleteEmptyShelves, lang, selectedDeletable]);

  const openRefill = useCallback(() => {
    if (selectedRows.length !== 1) return;
    setStatus(null);
    setRefillDest(selectedRows[0]!);
  }, [selectedRows]);

  const countLabel =
    rows.length === 1
      ? t(lang, "emptyShelvesCountOne")
      : tTemplate(lang, "emptyShelvesCount", { count: rows.length });

  return (
    <section className="space-y-3 overflow-x-hidden rounded-2xl border border-border bg-card p-3">
      <div>
        <p className="text-xs font-black uppercase tracking-wide text-muted-foreground">
          {t(lang, "emptyShelvesTitle")}
        </p>
        <p className="mt-1 text-sm font-medium text-muted-foreground">{countLabel}</p>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm font-semibold text-muted-foreground">{t(lang, "emptyShelvesNone")}</p>
      ) : (
        <>
          {deletableKeys.length > 0 ? (
            <WakaCheckbox
              checked={allDeletableSelected}
              onCheckedChange={toggleSelectAll}
              label={t(lang, "emptyShelvesSelectAll")}
              className="rounded-lg px-1"
            />
          ) : null}

          <ul className="space-y-2">
            {rows.map((row) => (
              <li key={row.key} className="rounded-xl border border-border bg-muted/40 px-3 py-2">
                {row.deletable ? (
                  <WakaCheckbox
                    checked={visibleSelected.has(row.key)}
                    onCheckedChange={(checked) => toggle(row.key, checked)}
                    label={<span className="break-words font-black uppercase">{row.label}</span>}
                    description={
                      <span className="block space-y-0.5">
                        <span className="block break-words">{row.pathText}</span>
                        <span className="block">{t(lang, "emptyShelvesZeroProducts")}</span>
                      </span>
                    }
                  />
                ) : (
                  <div className="min-h-[44px] py-1">
                    <p className="break-words text-sm font-black uppercase text-foreground">{row.label}</p>
                    <p className="mt-0.5 break-words text-xs font-medium text-muted-foreground">{row.pathText}</p>
                    <p className="text-xs font-medium text-muted-foreground">{t(lang, "emptyShelvesZeroProducts")}</p>
                    <p className="mt-1 text-xs font-bold text-muted-foreground">
                      {row.hasChildFolders
                        ? t(lang, "emptyShelvesHasChildren")
                        : row.presetProtected
                          ? t(lang, "emptyShelvesPresetProtected")
                          : t(lang, "emptyShelvesCannotDelete")}
                    </p>
                  </div>
                )}
              </li>
            ))}
          </ul>

          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              disabled={!canRefill || selectedRows.length !== 1}
              onClick={openRefill}
              className="min-h-[44px] flex-1 rounded-xl border-2 border-waka-300 bg-waka-50 px-4 text-sm font-black text-waka-900 active:bg-waka-100 disabled:opacity-40"
            >
              {t(lang, "emptyShelvesRefillSelected")}
            </button>
            <button
              type="button"
              disabled={selectedDeletable.length === 0}
              onClick={confirmDelete}
              className="min-h-[44px] flex-1 rounded-xl border-2 border-danger/40 bg-danger-muted px-4 text-sm font-black text-danger active:opacity-80 disabled:opacity-40"
            >
              {selectedDeletable.length > 0
                ? tTemplate(lang, "emptyShelvesDeleteSelectedN", { count: selectedDeletable.length })
                : t(lang, "emptyShelvesDeleteSelected")}
            </button>
          </div>
          {selectedRows.length !== 1 ? (
            <p className="text-xs font-medium text-muted-foreground">{t(lang, "emptyShelvesRefillOneHint")}</p>
          ) : null}
          {!canRefill ? (
            <p className="text-xs font-medium text-muted-foreground">{t(lang, "emptyShelvesRefillDenied")}</p>
          ) : null}
        </>
      )}

      {status ? <p className="text-sm font-bold text-foreground">{status}</p> : null}

      {refillDest ? (
        <EmptyShelfRefillPicker
          lang={lang}
          destination={refillDest}
          products={products}
          canRefill={canRefill}
          onClose={() => setRefillDest(null)}
          onCommit={(ids) => {
            const result = refillEmptyShelf(refillDest.key, ids);
            if (!result.ok) {
              setStatus(t(lang, result.errorKey ?? "invalid"));
              setRefillDest(null);
              return;
            }
            const destName = refillDest.label;
            if (result.failedCount > 0) {
              setStatus(
                tTemplate(lang, "emptyShelvesRefillPartial", {
                  moved: result.movedCount,
                  failed: result.failedCount,
                }),
              );
            } else if (result.movedCount === 1) {
              setStatus(tTemplate(lang, "emptyShelvesRefillDoneOne", { name: destName }));
            } else {
              setStatus(tTemplate(lang, "emptyShelvesRefillDone", { count: result.movedCount, name: destName }));
            }
            setRefillDest(null);
            setSelected(new Set());
          }}
        />
      ) : null}
    </section>
  );
}

function EmptyShelfRefillPicker({
  lang,
  destination,
  products,
  canRefill,
  onClose,
  onCommit,
}: {
  lang: Language;
  destination: EmptyShelfRow;
  products: Product[];
  canRefill: boolean;
  onClose: () => void;
  onCommit: (productIds: string[]) => void;
}) {
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const matches = useMemo(
    () => filterProductsForEmptyShelfRefill(products, destination.key, query),
    [products, destination.key, query],
  );

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const togglePick = (id: string, checked: boolean) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const confirmMove = () => {
    if (!canRefill || picked.size === 0) return;
    const count = picked.size;
    const confirmKey = count === 1 ? "emptyShelvesRefillConfirmOne" : "emptyShelvesRefillConfirm";
    const ok = window.confirm(tTemplate(lang, confirmKey, { count, name: destination.label }));
    if (!ok) return;
    onCommit([...picked]);
  };

  const moveLabel =
    picked.size === 1
      ? tTemplate(lang, "emptyShelvesMoveOne", { name: destination.label })
      : tTemplate(lang, "emptyShelvesMoveN", { count: picked.size, name: destination.label });

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex min-h-0 flex-col bg-card"
      style={{
        paddingTop: "max(0.5rem, env(safe-area-inset-top, 0px))",
        paddingBottom: "env(safe-area-inset-bottom, 0px)",
      }}
      role="dialog"
      aria-modal
      aria-labelledby="empty-shelf-refill-title"
    >
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-3">
        <button
          type="button"
          className="min-h-[44px] rounded-xl px-3 py-2 text-sm font-bold text-muted-foreground active:bg-muted"
          onClick={onClose}
        >
          {t(lang, "cancel")}
        </button>
        <h2 id="empty-shelf-refill-title" className="min-w-0 flex-1 break-words text-center text-base font-black text-foreground">
          {tTemplate(lang, "emptyShelvesRefillTitle", { name: destination.label })}
        </h2>
        <span className="w-[4.5rem]" aria-hidden />
      </header>

      <div className="shrink-0 px-4 py-3">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t(lang, "emptyShelvesRefillSearch")}
          className="min-h-[48px] w-full rounded-xl border-2 border-border px-4 text-base font-semibold outline-none focus:border-waka-400 focus:ring-2 focus:ring-waka-200"
          autoFocus
        />
      </div>

      <ul className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-y-contain px-4 pb-4 [-webkit-overflow-scrolling:touch]">
        {matches.length === 0 ? (
          <li className="py-12 text-center text-sm font-semibold text-muted-foreground">
            {t(lang, "emptyShelvesRefillNoMatch")}
          </li>
        ) : (
          matches.map((p) => {
            const shelf = (p.category ?? "").trim() || t(lang, "emptyShelvesNoShelf");
            return (
              <li key={p.id} className="mb-2 rounded-2xl border border-border bg-muted px-3 py-2">
                <WakaCheckbox
                  checked={picked.has(p.id)}
                  onCheckedChange={(checked) => togglePick(p.id, checked)}
                  label={<span className="break-words">{p.name}</span>}
                  description={
                    <span className="block space-y-0.5">
                      {p.sku ? (
                        <span className="block break-words">
                          {tTemplate(lang, "emptyShelvesSku", { sku: p.sku })}
                        </span>
                      ) : null}
                      <span className="block break-words">
                        {tTemplate(lang, "emptyShelvesCurrentShelf", { name: shelf })}
                      </span>
                      <span className="block">{tTemplate(lang, "emptyShelvesStock", { count: p.stockOnHand })}</span>
                    </span>
                  }
                />
              </li>
            );
          })
        )}
      </ul>

      <div className="shrink-0 border-t border-border px-4 py-3">
        <button
          type="button"
          disabled={!canRefill || picked.size === 0}
          onClick={confirmMove}
          className="min-h-[48px] w-full rounded-xl bg-waka-600 px-4 text-sm font-black text-white active:bg-waka-700 disabled:opacity-40"
        >
          {picked.size > 0 ? moveLabel : t(lang, "emptyShelvesMoveNone")}
        </button>
      </div>
    </div>,
    document.body,
  );
}
