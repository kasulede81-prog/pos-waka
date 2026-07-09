import { useMemo, useState } from "react";
import type { Language } from "../types";
import { t } from "../lib/i18n";
import { usePosStore } from "../store/usePosStore";
import { useSessionActor } from "../context/SessionActorContext";
import { EnterprisePageContainer } from "../components/layout/EnterprisePageContainer";
import { PageHeader } from "../components/layout/PageHeader";
import { dateKeyKampala } from "../lib/datesUg";
import {
  buildTransferDraftMetadata,
  filterTransferProducts,
  resolveTransferLocations,
  summarizeTransferDraft,
  toEnterpriseTransferShape,
  validateTransferLinePresentation,
  type TransferLineDraft,
  type TransferProgressStage,
  type TransferDraftMetadata,
} from "../lib/transferWorkspace";
import { getProductBatches } from "../lib/pharmacyBatches";
import { TransferOperationShell } from "../components/inventory/transfers/TransferOperationShell";
import { TransferProgress } from "../components/inventory/transfers/TransferProgress";
import { TransferStatusStrip } from "../components/inventory/transfers/TransferStatusStrip";
import { TransferSourceSelector } from "../components/inventory/transfers/TransferSourceSelector";
import { TransferDestinationSelector } from "../components/inventory/transfers/TransferDestinationSelector";
import { TransferProductSelector } from "../components/inventory/transfers/TransferProductSelector";
import { TransferLineEditor } from "../components/inventory/transfers/TransferLineEditor";
import { TransferSummaryPanel } from "../components/inventory/transfers/TransferSummaryPanel";
import { TransferCompletionScreen } from "../components/inventory/transfers/TransferCompletionScreen";
import { TransferFooter } from "../components/inventory/transfers/TransferFooter";

type LineState = {
  quantity: string;
  batchId: string;
};

type Props = { lang: Language };

export function InventoryTransferPage({ lang }: Props) {
  const actor = useSessionActor();
  const products = usePosStore((s) => s.products);
  const preferences = usePosStore((s) => s.preferences);

  const [stage, setStage] = useState<TransferProgressStage>("location");
  const [destinationId, setDestinationId] = useState<string | null>(null);
  const [lineIds, setLineIds] = useState<string[]>([]);
  const [lineState, setLineState] = useState<Record<string, LineState>>({});
  const [searchQuery, setSearchQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [preparedDraft, setPreparedDraft] = useState<TransferDraftMetadata | null>(null);

  const shopName = preferences.shopDisplayName?.trim() || "Shop";
  const { source, destinations, isSingleBranch } = useMemo(
    () => resolveTransferLocations(shopName),
    [shopName],
  );

  const destination = destinations.find((d) => d.id === destinationId) ?? null;
  const searchResults = useMemo(
    () => filterTransferProducts(products, searchQuery),
    [products, searchQuery],
  );
  const selectedIds = useMemo(() => new Set(lineIds), [lineIds]);

  const lines: TransferLineDraft[] = useMemo(() => {
    const out: TransferLineDraft[] = [];
    for (const id of lineIds) {
      const st = lineState[id];
      const qty = Math.max(0, Math.floor(Number(st?.quantity) || 0));
      if (qty <= 0) continue;
      const ln: TransferLineDraft = { productId: id, quantity: qty };
      if (st?.batchId) ln.batchId = st.batchId;
      out.push(ln);
    }
    return out;
  }, [lineIds, lineState]);

  const summary = useMemo(() => summarizeTransferDraft(lines, products), [lines, products]);

  const resetWorkflow = () => {
    setStage("location");
    setDestinationId(null);
    setLineIds([]);
    setLineState({});
    setSearchQuery("");
    setError(null);
    setPreparedDraft(null);
  };

  const addProduct = (productId: string) => {
    if (lineIds.includes(productId)) return;
    setLineIds((ids) => [...ids, productId]);
    setLineState((s) => ({ ...s, [productId]: { quantity: "1", batchId: "" } }));
  };

  const removeProduct = (productId: string) => {
    setLineIds((ids) => ids.filter((id) => id !== productId));
    setLineState((s) => {
      const next = { ...s };
      delete next[productId];
      return next;
    });
  };

  const validateAllLines = (): boolean => {
    for (const id of lineIds) {
      const product = products.find((p) => p.id === id);
      if (!product) continue;
      const st = lineState[id];
      const qty = Math.max(0, Math.floor(Number(st?.quantity) || 0));
      const batch = st?.batchId
        ? getProductBatches(product).find((b) => b.id === st.batchId)
        : undefined;
      const v = validateTransferLinePresentation(product, qty, batch?.quantityRemaining);
      if (!v.ok) {
        setError(t(lang, v.errorKey ?? "invalid"));
        return false;
      }
    }
    if (lines.length === 0) {
      setError(t(lang, "xferLinesRequired"));
      return false;
    }
    setError(null);
    return true;
  };

  const prepareTransfer = () => {
    if (!validateAllLines()) return;
    const draft = buildTransferDraftMetadata({ source, destination, lines, products });
    // Future hook: persist via enterprise transfer mutation using toEnterpriseTransferShape(draft, products)
    void toEnterpriseTransferShape(draft, products);
    setPreparedDraft(draft);
    setStage("complete");
  };

  const goNext = () => {
    setError(null);
    if (stage === "location") {
      setStage("products");
      return;
    }
    if (stage === "products") {
      if (!validateAllLines()) return;
      setStage("review");
      return;
    }
    if (stage === "review") {
      setStage("transfer");
    }
  };

  const goBack = () => {
    setError(null);
    if (stage === "products") setStage("location");
    else if (stage === "review") setStage("products");
    else if (stage === "transfer") setStage("review");
  };

  const primaryLabelKey =
    stage === "transfer" ? "xferPrepareCta" : stage === "review" ? "xferReviewContinue" : "xferNext";

  const footer =
    stage !== "complete" ? (
      <TransferFooter
        lang={lang}
        onCancel={stage === "location" ? undefined : goBack}
        cancelLabelKey="back"
        layout={stage === "location" ? "single" : "dual"}
        primaryLabelKey={primaryLabelKey}
        onPrimary={stage === "transfer" ? prepareTransfer : goNext}
        primaryDisabled={stage === "products" && lines.length === 0}
      />
    ) : null;

  return (
    <EnterprisePageContainer>
      <PageHeader
        lang={lang}
        title={t(lang, "xferPageTitle")}
        subtitle={t(lang, "xferPageSub")}
        backLabel={t(lang, "navStock")}
        backFallback="/stock"
      />

      <TransferOperationShell
        lang={lang}
        variant="page"
        title={t(lang, "xferPageTitle")}
        error={error}
        warning={isSingleBranch ? t(lang, "xferSingleBranchHint") : null}
        statusStrip={<TransferStatusStrip lang={lang} />}
        footer={footer}
      >
        <TransferProgress lang={lang} stage={stage} />

        {stage === "complete" && preparedDraft ? (
          <TransferCompletionScreen
            lang={lang}
            draft={preparedDraft}
            products={products}
            onCreateAnother={resetWorkflow}
          />
        ) : null}

        {stage === "location" ? (
          <>
            <TransferSourceSelector lang={lang} source={source} />
            <TransferDestinationSelector
              lang={lang}
              destinations={destinations}
              isSingleBranch={isSingleBranch}
              value={destinationId}
              onChange={setDestinationId}
            />
          </>
        ) : null}

        {stage === "products" ? (
          <>
            <TransferProductSelector
              lang={lang}
              value={searchQuery}
              onChange={setSearchQuery}
              products={searchResults}
              onAdd={addProduct}
              selectedIds={selectedIds}
            />
            {lineIds.length > 0 ? (
              <ul className="space-y-3">
                {lineIds.map((id) => {
                  const product = products.find((p) => p.id === id);
                  if (!product) return null;
                  const st = lineState[id] ?? { quantity: "1", batchId: "" };
                  return (
                    <TransferLineEditor
                      key={id}
                      lang={lang}
                      product={product}
                      businessType={preferences.businessType}
                      pharmacyModeEnabled={preferences.pharmacyModeEnabled}
                      quantity={st.quantity}
                      batchId={st.batchId}
                      onQuantityChange={(v) =>
                        setLineState((s) => ({ ...s, [id]: { ...st, quantity: v } }))
                      }
                      onBatchIdChange={(v) =>
                        setLineState((s) => ({ ...s, [id]: { ...st, batchId: v } }))
                      }
                      onRemove={() => removeProduct(id)}
                    />
                  );
                })}
              </ul>
            ) : (
              <p className="rounded-2xl border border-dashed border-border/60 px-4 py-8 text-center text-sm font-semibold text-muted-foreground">
                {t(lang, "xferAddProductsHint")}
              </p>
            )}
          </>
        ) : null}

        {stage === "review" || stage === "transfer" ? (
          <>
            <TransferSummaryPanel
              lang={lang}
              productCount={summary.productCount}
              totalUnits={summary.totalUnits}
              estimatedValueUgx={summary.estimatedValueUgx}
              operatorName={actor.displayName ?? actor.userId}
              businessDate={dateKeyKampala(new Date())}
              sourceName={source.name}
              destinationName={destination?.name ?? null}
            />
            <ul className="space-y-3">
              {lines.map((ln) => {
                const product = products.find((p) => p.id === ln.productId);
                if (!product) return null;
                return (
                  <li
                    key={ln.productId}
                    className="rounded-2xl border border-border/60 bg-card px-4 py-3 text-sm font-semibold text-foreground"
                  >
                    <span className="font-black">{product.name}</span>
                    <span className="text-muted-foreground"> · −{ln.quantity}</span>
                  </li>
                );
              })}
            </ul>
            {stage === "transfer" ? (
              <p className="text-sm font-semibold text-muted-foreground">{t(lang, "xferPrepareHint")}</p>
            ) : null}
          </>
        ) : null}
      </TransferOperationShell>
    </EnterprisePageContainer>
  );
}
