import { actorHasPermission } from "../lib/actorAuthorization";
import { useMemo } from "react";
import { Navigate } from "react-router-dom";
import type { Language } from "../types";
import { t } from "../lib/i18n";
import { useSessionActor } from "../context/SessionActorContext";

import { EnterprisePageContainer } from "../components/layout/EnterprisePageContainer";
import { EnterprisePageHeader } from "../components/enterprise/EnterprisePageHeader";
import { Package, ShoppingCart } from "lucide-react";
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
    <EnterprisePageContainer variant="workspace" className="inventory-workspace">
      <div className="inventory-hub-header inventory-enter inventory-enter--0 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <span className="inventory-hub-mark mt-6 hidden sm:flex">
            <Package className="h-5 w-5" aria-hidden />
          </span>
          <EnterprisePageHeader
            lang={lang}
            title={t(lang, "ipPageTitle")}
            subtitle={t(lang, "ipPageSub")}
            backFallback="/office"
            backLabel={t(lang, "officeBackToHub")}
            compact
            className="inventory-hub-header__identity min-w-0 flex-1"
          />
        </div>
        {canPurchasesRecord ? (
          <WakaButton
            type="button"
            variant="primary"
            className="inventory-hub-cta shrink-0 sm:mt-6"
            iconLeft={<ShoppingCart className="h-5 w-5" aria-hidden />}
            onClick={openNewPurchaseFlow}
          >
            <span className="flex flex-col items-start leading-tight">
              <span>{t(lang, "ipActionNewPurchase")}</span>
              <span className="hidden text-xs font-semibold opacity-90 sm:inline">
                {t(lang, "ipActionNewPurchaseHint")}
              </span>
            </span>
          </WakaButton>
        ) : null}
      </div>

      <div className="inventory-hub-nav sticky top-0 z-20 -mx-3 px-3 py-2 md:-mx-6 md:px-6">
        <InventoryPurchasingTabs lang={lang} active={tab} onChange={setTab} visibleTabs={visibleTabs} />
      </div>

      {tab === "overview" ? (
        <InventoryWorkspaceOverview
          lang={lang}
          onSetTab={setTab}
          onReceiveStock={openNewPurchaseFlow}
          onAddProduct={() => setTab("products", { add: "1", stockView: null, import: null })}
          onImportCsv={() => setTab("products", { import: "csv", stockView: null, add: null })}
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
