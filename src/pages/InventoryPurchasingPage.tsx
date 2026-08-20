import { actorHasPermission } from "../lib/actorAuthorization";
import { useMemo } from "react";
import clsx from "clsx";
import { Navigate } from "react-router-dom";
import type { Language } from "../types";
import { t } from "../lib/i18n";
import { useSessionActor } from "../context/SessionActorContext";

import { EnterprisePageContainer } from "../components/layout/EnterprisePageContainer";
import { EnterprisePageHeader } from "../components/enterprise/EnterprisePageHeader";
import { WakaButton } from "../components/ui/wakaPrimitives";
import { StockPage } from "./StockPage";
import { usePageLoadMark } from "../hooks/usePageLoadMark";
import { InventoryPurchasingTabs } from "../features/inventory-purchasing/components/InventoryPurchasingTabs";
import { InventoryWorkspaceOverview } from "../components/inventory/workspace/InventoryWorkspaceOverview";
import { PurchasesTab } from "../features/inventory-purchasing/components/PurchasesTab";
import { SuppliersTab } from "../features/inventory-purchasing/components/SuppliersTab";
import { PaymentsTab } from "../features/inventory-purchasing/components/PaymentsTab";
import { useInventoryPurchasingTab } from "../features/inventory-purchasing/hooks/useInventoryPurchasingTab";
import type { InventoryPurchasingTab } from "../features/inventory-purchasing/types";
import { PurchaseDetailPage } from "./PurchaseDetailPage";
import { SupplierDetailPage } from "./SupplierDetailPage";
import { RestockPage } from "./RestockPage";

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
    setTab("purchases", { new: "1" });
  };

  return (
    <EnterprisePageContainer className="space-y-3">
      <EnterprisePageHeader
        lang={lang}
        title={t(lang, "ipPageTitle")}
        subtitle={t(lang, "ipPageSub")}
        backFallback="/office"
        backLabel={t(lang, "officeBackToHub")}
        compact
      >
        {canPurchasesRecord ? (
          <WakaButton type="button" variant="primary" onClick={openNewPurchaseFlow}>
            + {t(lang, "ipActionNewPurchase")}
          </WakaButton>
        ) : null}
      </EnterprisePageHeader>

      <div
        className={clsx(
          "sticky top-0 z-20 -mx-3 border-b border-border/80 bg-muted/95 px-3 py-2 backdrop-blur-md",
          "supports-[backdrop-filter]:bg-muted/88 md:-mx-6 md:px-6",
        )}
      >
        <InventoryPurchasingTabs lang={lang} active={tab} onChange={setTab} visibleTabs={visibleTabs} />
      </div>

      {tab === "overview" ? (
        <InventoryWorkspaceOverview
          lang={lang}
          onSetTab={setTab}
          onReceiveStock={openNewPurchaseFlow}
          onAddProduct={() => setTab("products", { add: "1", stockView: null })}
        />
      ) : null}

      {tab === "purchases" && (canPurchasesView || canPurchasesRecord) ? (
        purchaseId && canPurchasesView ? (
          <PurchaseDetailPage lang={lang} purchaseId={purchaseId} embedded onClose={() => setPurchaseId(null)} />
        ) : openNewPurchase && canPurchasesRecord ? (
          <RestockPage lang={lang} embedded onSaved={() => setOpenNewPurchase(false)} />
        ) : (
          <PurchasesTab lang={lang} onOpenPurchase={setPurchaseId} onNewPurchase={() => setOpenNewPurchase(true)} />
        )
      ) : null}

      {tab === "suppliers" && canSuppliers ? (
        supplierId ? (
          <SupplierDetailPage
            lang={lang}
            supplierId={supplierId}
            embedded
            onClose={() => setSupplierId(null)}
            onOpenPurchase={(id) => {
              setSupplierId(null);
              setPurchaseId(id);
              setTab("purchases");
            }}
          />
        ) : (
          <SuppliersTab lang={lang} onOpenSupplier={setSupplierId} />
        )
      ) : null}

      {tab === "products" && canStock ? <StockPage lang={lang} workspaceEmbed /> : null}

      {tab === "payments" && (canPurchasesView || canSuppliers) ? (
        <PaymentsTab
          lang={lang}
          onRecordPayment={() => setTab("suppliers")}
          onOpenSupplier={(id) => setTab("suppliers", { supplierId: id })}
        />
      ) : null}
    </EnterprisePageContainer>
  );
}
