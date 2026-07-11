import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { usePosStore } from "../../store/usePosStore";
import {
  buildSharedSystemHealthSnapshot,
  readSharedSyncQueueSnapshot,
  type SharedSystemHealthInput,
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

function readSharedInputFromStore(): SharedSystemHealthInput {
  const s = usePosStore.getState();
  return {
    products: s.products,
    customers: s.customers,
    sales: s.sales,
    debtPayments: s.debtPayments,
    stockMovements: s.stockMovements,
    suppliers: s.suppliers,
    purchases: s.purchases,
    supplierPayments: s.supplierPayments,
    archivedSales: s.archivedSales,
    preferences: s.preferences,
  };
}

export function SystemHealthDiagnosticsProvider({ children }: { children: ReactNode }) {
  const [queue, setQueue] = useState<SharedSystemHealthSnapshot["queue"] | null>(null);
  const [shared, setShared] = useState<SharedSystemHealthSnapshot | null>(null);
  const [loadingShared, setLoadingShared] = useState(false);

  const refreshQueue = useCallback(async () => {
    const snap = await readSharedSyncQueueSnapshot(true);
    setQueue(snap);
    return snap;
  }, []);

  const ensureShared = useCallback(async () => {
    if (shared) return shared;
    setLoadingShared(true);
    try {
      const next = await buildSharedSystemHealthSnapshot(readSharedInputFromStore());
      setShared(next);
      setQueue(next.queue);
      return next;
    } finally {
      setLoadingShared(false);
    }
  }, [shared]);

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
  const { queue, loadingShared, refreshQueue } = useSystemHealthDiagnostics();
  const products = usePosStore((s) => s.products.length);
  const sales = usePosStore((s) => s.sales.length);
  const customers = usePosStore((s) => s.customers.length);

  useEffect(() => {
    void refreshQueue();
  }, [refreshQueue]);

  return (
    <article className="rounded-2xl border border-border/90 bg-card p-4 shadow-sm">
      <p className="text-base font-black text-foreground">{t(lang, "systemHealthSummaryTitle")}</p>
      <p className="mt-1 text-sm text-muted-foreground">{t(lang, "systemHealthSummarySub")}</p>
      <dl className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        <div className="rounded-xl bg-muted px-3 py-2">
          <dt className="text-xs font-bold uppercase text-muted-foreground">{t(lang, "systemHealthSummaryProducts")}</dt>
          <dd className="font-black text-foreground">{products.toLocaleString()}</dd>
        </div>
        <div className="rounded-xl bg-muted px-3 py-2">
          <dt className="text-xs font-bold uppercase text-muted-foreground">{t(lang, "systemHealthSummarySales")}</dt>
          <dd className="font-black text-foreground">{sales.toLocaleString()}</dd>
        </div>
        <div className="rounded-xl bg-muted px-3 py-2">
          <dt className="text-xs font-bold uppercase text-muted-foreground">{t(lang, "systemHealthSummaryCustomers")}</dt>
          <dd className="font-black text-foreground">{customers.toLocaleString()}</dd>
        </div>
        <div className="rounded-xl bg-muted px-3 py-2">
          <dt className="text-xs font-bold uppercase text-muted-foreground">{t(lang, "systemHealthSummaryPending")}</dt>
          <dd className="font-black text-foreground">
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
    <section className="rounded-2xl border border-border/90 bg-card shadow-sm">
      <button
        type="button"
        onClick={toggle}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
        aria-expanded={open}
      >
        <span className="text-base font-black text-foreground">{title}</span>
        <span className="text-sm font-bold text-muted-foreground">{open ? t(lang, "systemHealthSectionHide") : t(lang, "systemHealthSectionShow")}</span>
      </button>
      {open ? <div className="border-t border-border px-1 pb-1 pt-0">{children}</div> : null}
    </section>
  );
}
