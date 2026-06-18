import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { usePosStore } from "../../store/usePosStore";
import {
  buildSharedSystemHealthSnapshot,
  readSharedSyncQueueSnapshot,
  type SharedSystemHealthSnapshot,
} from "../../lib/systemHealthSharedDiagnostics";

type Ctx = {
  queue: SharedSystemHealthSnapshot["queue"] | null;
  shared: SharedSystemHealthSnapshot | null;
  loadingShared: boolean;
  ensureShared: () => Promise<SharedSystemHealthSnapshot | null>;
  refreshQueue: () => Promise<SharedSystemHealthSnapshot["queue"]>;
};

const SystemHealthDiagnosticsContext = createContext<Ctx | null>(null);

export function SystemHealthDiagnosticsProvider({ children }: { children: ReactNode }) {
  const products = usePosStore((s) => s.products);
  const customers = usePosStore((s) => s.customers);
  const sales = usePosStore((s) => s.sales);
  const debtPayments = usePosStore((s) => s.debtPayments);
  const stockMovements = usePosStore((s) => s.stockMovements);
  const suppliers = usePosStore((s) => s.suppliers);
  const purchases = usePosStore((s) => s.purchases);
  const supplierPayments = usePosStore((s) => s.supplierPayments);
  const archivedSales = usePosStore((s) => s.archivedSales);
  const preferences = usePosStore((s) => s.preferences);

  const [queue, setQueue] = useState<SharedSystemHealthSnapshot["queue"] | null>(null);
  const [shared, setShared] = useState<SharedSystemHealthSnapshot | null>(null);
  const [loadingShared, setLoadingShared] = useState(false);

  const refreshQueue = useCallback(async () => {
    const snap = await readSharedSyncQueueSnapshot(true);
    setQueue(snap);
    return snap;
  }, []);

  useEffect(() => {
    void refreshQueue();
  }, [refreshQueue]);

  const input = useMemo(
    () => ({
      products,
      customers,
      sales,
      debtPayments,
      stockMovements,
      suppliers,
      purchases,
      supplierPayments,
      archivedSales,
      preferences,
    }),
    [
      products,
      customers,
      sales,
      debtPayments,
      stockMovements,
      suppliers,
      purchases,
      supplierPayments,
      archivedSales,
      preferences,
    ],
  );

  const ensureShared = useCallback(async () => {
    if (shared) return shared;
    setLoadingShared(true);
    try {
      const next = await buildSharedSystemHealthSnapshot(input);
      setShared(next);
      setQueue(next.queue);
      return next;
    } finally {
      setLoadingShared(false);
    }
  }, [input, shared]);

  const value = useMemo(
    (): Ctx => ({
      queue,
      shared,
      loadingShared,
      ensureShared,
      refreshQueue,
    }),
    [queue, shared, loadingShared, ensureShared, refreshQueue],
  );

  return (
    <SystemHealthDiagnosticsContext.Provider value={value}>{children}</SystemHealthDiagnosticsContext.Provider>
  );
}

export function useSystemHealthDiagnostics(): Ctx {
  const ctx = useContext(SystemHealthDiagnosticsContext);
  if (!ctx) {
    throw new Error("useSystemHealthDiagnostics requires SystemHealthDiagnosticsProvider");
  }
  return ctx;
}

export function SystemHealthSummaryStrip({ lang }: { lang: Language }) {
  const { queue, loadingShared } = useSystemHealthDiagnostics();
  const products = usePosStore((s) => s.products.length);
  const sales = usePosStore((s) => s.sales.length);
  const customers = usePosStore((s) => s.customers.length);

  return (
    <article className="rounded-2xl border border-stone-200/90 bg-white p-4 shadow-sm">
      <p className="text-base font-black text-stone-900">{t(lang, "systemHealthSummaryTitle")}</p>
      <p className="mt-1 text-sm text-stone-600">{t(lang, "systemHealthSummarySub")}</p>
      <dl className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        <div className="rounded-xl bg-stone-50 px-3 py-2">
          <dt className="text-xs font-bold uppercase text-stone-500">{t(lang, "systemHealthSummaryProducts")}</dt>
          <dd className="font-black text-stone-900">{products.toLocaleString()}</dd>
        </div>
        <div className="rounded-xl bg-stone-50 px-3 py-2">
          <dt className="text-xs font-bold uppercase text-stone-500">{t(lang, "systemHealthSummarySales")}</dt>
          <dd className="font-black text-stone-900">{sales.toLocaleString()}</dd>
        </div>
        <div className="rounded-xl bg-stone-50 px-3 py-2">
          <dt className="text-xs font-bold uppercase text-stone-500">{t(lang, "systemHealthSummaryCustomers")}</dt>
          <dd className="font-black text-stone-900">{customers.toLocaleString()}</dd>
        </div>
        <div className="rounded-xl bg-stone-50 px-3 py-2">
          <dt className="text-xs font-bold uppercase text-stone-500">{t(lang, "systemHealthSummaryQueue")}</dt>
          <dd className="font-black text-stone-900">
            {queue ? queue.queuedCount.toLocaleString() : loadingShared ? "…" : "—"}
          </dd>
        </div>
      </dl>
    </article>
  );
}

export function LazyDiagnosticsSection({
  lang,
  title,
  defaultOpen = false,
  children,
  onExpand,
}: {
  lang: Language;
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
  onExpand?: () => void;
}) {
  const [open, setOpen] = useState(defaultOpen);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next) onExpand?.();
  };

  return (
    <section className="rounded-2xl border border-stone-200/90 bg-white shadow-sm">
      <button
        type="button"
        onClick={toggle}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
        aria-expanded={open}
      >
        <span className="text-base font-black text-stone-900">{title}</span>
        <span className="text-sm font-bold text-stone-500">{open ? t(lang, "systemHealthSectionHide") : t(lang, "systemHealthSectionShow")}</span>
      </button>
      {open ? <div className="border-t border-stone-100 px-1 pb-1 pt-0">{children}</div> : null}
    </section>
  );
}
