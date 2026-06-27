import { useMemo } from "react";
import clsx from "clsx";
import { Navigate } from "react-router-dom";
import type { Language } from "../types";
import { t } from "../lib/i18n";
import { usePosStore } from "../store/usePosStore";
import { useSessionActor } from "../context/SessionActorContext";
import { hasPermission } from "../lib/permissions";
import { PageHeader } from "../components/layout/PageHeader";
import { StockPage } from "./StockPage";
import { usePageLoadMark } from "../hooks/usePageLoadMark";
import { purchaseFilterFromDateFilter } from "../lib/purchaseReporting";
import type { DateFilterValue } from "../lib/dateFilters";
import { InventoryPurchasingTabs } from "../features/inventory-purchasing/components/InventoryPurchasingTabs";
import { OverviewTab } from "../features/inventory-purchasing/components/OverviewTab";
import { PurchasesTab } from "../features/inventory-purchasing/components/PurchasesTab";
import { SuppliersTab } from "../features/inventory-purchasing/components/SuppliersTab";
import { PaymentsTab } from "../features/inventory-purchasing/components/PaymentsTab";
import { NewPurchaseSheet } from "../features/inventory-purchasing/components/NewPurchaseSheet";
import { PurchaseDetailSheet } from "../features/inventory-purchasing/components/PurchaseDetailSheet";
import { SupplierDetailSheet } from "../features/inventory-purchasing/components/SupplierDetailSheet";
import { useInventoryPurchasingTab } from "../features/inventory-purchasing/hooks/useInventoryPurchasingTab";
import {
  computeMonthlyPurchaseTrend,
  computeOverviewStats,
  computeTopSupplierSpend,
} from "../features/inventory-purchasing/lib/overviewStats";
import type { InventoryPurchasingTab } from "../features/inventory-purchasing/types";

const DEFAULT_FILTER: DateFilterValue = { kind: "preset", preset: "this_month" };

export function InventoryPurchasingPage({ lang }: { lang: Language }) {
  usePageLoadMark("inventory-purchasing");
  const actor = useSessionActor();
  const canStock = hasPermission(actor.role, "stock.view");
  const canPurchasesView = hasPermission(actor.role, "purchases.view");
  const canPurchasesRecord = hasPermission(actor.role, "purchases.record");
  const canSuppliers = hasPermission(actor.role, "suppliers.view");

  const purchases = usePosStore((s) => s.purchases);
  const supplierPayments = usePosStore((s) => s.supplierPayments);
  const suppliers = usePosStore((s) => s.suppliers);
  const products = usePosStore((s) => s.products);

  const {
    tab,
    setTab,
    supplierId,
    setSupplierId,
    purchaseId,
    setPurchaseId,
    openNewPurchase,
    setOpenNewPurchase,
  } = useInventoryPurchasingTab();

  const visibleTabs = useMemo(() => {
    const tabs: InventoryPurchasingTab[] = ["overview"];
    if (canPurchasesView || canPurchasesRecord) tabs.push("purchases");
    if (canSuppliers) tabs.push("suppliers");
    if (canStock) tabs.push("products");
    if (canPurchasesView || canSuppliers) tabs.push("payments");
    return tabs;
  }, [canStock, canPurchasesView, canPurchasesRecord, canSuppliers]);

  const listFilter = useMemo(() => purchaseFilterFromDateFilter(DEFAULT_FILTER), []);
  const overviewStats = useMemo(
    () => computeOverviewStats(purchases, supplierPayments, suppliers, products, listFilter),
    [purchases, supplierPayments, suppliers, products, listFilter],
  );
  const monthlyTrend = useMemo(() => computeMonthlyPurchaseTrend(purchases), [purchases]);
  const topSuppliers = useMemo(
    () => computeTopSupplierSpend(purchases, suppliers, listFilter),
    [purchases, suppliers, listFilter],
  );

  if (!canStock && !canPurchasesView && !canPurchasesRecord && !canSuppliers) {
    return <Navigate to="/" replace />;
  }

  const openNewPurchaseFlow = () => {
    setTab("purchases");
    setOpenNewPurchase(true);
  };

  return (
    <div className="page-content-pad space-y-3 pb-24">
      <PageHeader
        lang={lang}
        title={t(lang, "ipPageTitle")}
        subtitle={t(lang, "ipPageSub")}
        backLabel={t(lang, "officeBackToHub")}
        compact
      >
        {canPurchasesRecord ? (
          <button
            type="button"
            onClick={openNewPurchaseFlow}
            className="inline-flex min-h-[40px] items-center rounded-xl bg-waka-600 px-4 text-xs font-black text-white shadow-sm"
          >
            + {t(lang, "ipActionNewPurchase")}
          </button>
        ) : null}
      </PageHeader>

      <div
        className={clsx(
          "sticky top-0 z-20 -mx-3 border-b border-stone-200/80 bg-stone-50/95 px-3 py-2 backdrop-blur-md",
          "supports-[backdrop-filter]:bg-stone-50/88 md:-mx-6 md:px-6",
        )}
      >
        <InventoryPurchasingTabs lang={lang} active={tab} onChange={setTab} visibleTabs={visibleTabs} />
      </div>

      {tab === "overview" ? (
        <OverviewTab
          lang={lang}
          stats={overviewStats}
          monthlyTrend={monthlyTrend}
          topSuppliers={topSuppliers}
          onNewPurchase={openNewPurchaseFlow}
          onAddSupplier={() => setTab("suppliers")}
          onReceiveStock={openNewPurchaseFlow}
          onViewPurchases={() => setTab("purchases")}
          onViewLowStock={() => setTab("products", { stockView: "low" })}
        />
      ) : null}

      {tab === "purchases" && (canPurchasesView || canPurchasesRecord) ? (
        <PurchasesTab lang={lang} onOpenPurchase={setPurchaseId} onNewPurchase={() => setOpenNewPurchase(true)} />
      ) : null}

      {tab === "suppliers" && canSuppliers ? (
        <SuppliersTab lang={lang} onOpenSupplier={setSupplierId} />
      ) : null}

      {tab === "products" && canStock ? <StockPage lang={lang} workspaceEmbed /> : null}

      {tab === "payments" && (canPurchasesView || canSuppliers) ? (
        <PaymentsTab
          lang={lang}
          onRecordPayment={() => setTab("suppliers")}
          onOpenSupplier={setSupplierId}
        />
      ) : null}

      {canPurchasesRecord ? (
        <NewPurchaseSheet lang={lang} open={openNewPurchase} onClose={() => setOpenNewPurchase(false)} />
      ) : null}

      {canPurchasesView ? (
        <PurchaseDetailSheet lang={lang} purchaseId={purchaseId} onClose={() => setPurchaseId(null)} />
      ) : null}

      {canSuppliers ? (
        <SupplierDetailSheet
          lang={lang}
          supplierId={supplierId}
          onClose={() => setSupplierId(null)}
          onOpenPurchase={(id) => {
            setSupplierId(null);
            setPurchaseId(id);
            setTab("purchases");
          }}
        />
      ) : null}
    </div>
  );
}
