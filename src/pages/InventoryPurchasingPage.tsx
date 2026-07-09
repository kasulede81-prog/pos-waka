import { actorHasPermission } from "../lib/actorAuthorization";
import { useMemo } from "react";
import clsx from "clsx";
import { Navigate } from "react-router-dom";
import type { Language } from "../types";
import { t } from "../lib/i18n";
import { useSessionActor } from "../context/SessionActorContext";

import { EnterprisePageContainer } from "../components/layout/EnterprisePageContainer";
import { PageHeader } from "../components/layout/PageHeader";
import { StockPage } from "./StockPage";
import { usePageLoadMark } from "../hooks/usePageLoadMark";
import { InventoryPurchasingTabs } from "../features/inventory-purchasing/components/InventoryPurchasingTabs";
import { InventoryWorkspaceOverview } from "../components/inventory/workspace/InventoryWorkspaceOverview";
import { PurchasesTab } from "../features/inventory-purchasing/components/PurchasesTab";
import { SuppliersTab } from "../features/inventory-purchasing/components/SuppliersTab";
import { PaymentsTab } from "../features/inventory-purchasing/components/PaymentsTab";
import { NewPurchaseSheet } from "../features/inventory-purchasing/components/NewPurchaseSheet";
import { PurchaseDetailSheet } from "../features/inventory-purchasing/components/PurchaseDetailSheet";
import { SupplierDetailSheet } from "../features/inventory-purchasing/components/SupplierDetailSheet";
import { useInventoryPurchasingTab } from "../features/inventory-purchasing/hooks/useInventoryPurchasingTab";
import type { InventoryPurchasingTab } from "../features/inventory-purchasing/types";

export function InventoryPurchasingPage({ lang }: { lang: Language }) {
  usePageLoadMark("inventory-purchasing");
  const actor = useSessionActor();
  const canStock = actorHasPermission(actor, "stock.view");
  const canPurchasesView = actorHasPermission(actor, "purchases.view");
  const canPurchasesRecord = actorHasPermission(actor, "purchases.record");
  const canSuppliers = actorHasPermission(actor, "suppliers.view");

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

  if (!canStock && !canPurchasesView && !canPurchasesRecord && !canSuppliers) {
    return <Navigate to="/" replace />;
  }

  const openNewPurchaseFlow = () => {
    setTab("purchases");
    setOpenNewPurchase(true);
  };

  return (
    <EnterprisePageContainer className="space-y-3">
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
        <InventoryWorkspaceOverview
          lang={lang}
          onSetTab={setTab}
          onReceiveStock={openNewPurchaseFlow}
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
    </EnterprisePageContainer>
  );
}
