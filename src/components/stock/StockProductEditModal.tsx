import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import type { Language, Product } from "../../types";
import { t, tTemplate } from "../../lib/i18n";
import {
  packKindLabel,
  parseSellUnitFromBaseUnit,
  resolveSellBaseUnit,
  sellUnitLabel,
  type PackKind,
  type SellUnitKind,
} from "../../lib/simpleProductWizard";
import { formatStockLabel, stockBreakdown } from "../../lib/sellingEngine";
import { unitCostFromPackTotal } from "../../lib/costPrecision";
import { validateAuditReason } from "../../lib/auditReasons";
import { usePosStore } from "../../store/usePosStore";
import { isPharmacyMode } from "../../lib/pharmacy";
import { normalizeExpiryDate } from "../../lib/pharmacyExpiry";
import { normalizeMedicineForm, normalizeMedicineStrength } from "../../lib/pharmacyMedicine";
import { usePharmacyTerms } from "../../lib/pharmacyTerms";
import { uiPlaceholder } from "../../lib/pharmacyUx";
import {
  buildPharmacyMasterFromState,
  masterStateFromProduct,
  PharmacyMedicineMasterFields,
} from "../pharmacy/PharmacyMedicineMasterFields";
import {
  buildPackagingFromState,
  packagingStateFromProduct,
  PharmacyPackagingFields,
  type PharmacyPackagingFieldState,
} from "./PharmacyPackagingFields";
import {
  buyingUnitFromPackaging,
  formatPharmacyStockEquivalent,
  formatPharmacyStockPrimary,
  isPharmacyPackagingActive,
} from "../../lib/pharmacyPackaging";
import { PACK_TYPE_OPTIONS } from "../../lib/simpleProductWizard";
import { ProductEditorShell } from "./editor/ProductEditorShell";
import { EditorFooter } from "./editor/EditorFooter";
import { EditorSection } from "./editor/EditorSection";
import { EditorIdentitySection } from "./editor/EditorIdentitySection";
import { EditorPricingSection } from "./editor/EditorPricingSection";
import { EditorInventorySection } from "./editor/EditorInventorySection";
import { EditorAdvancedSection } from "./editor/EditorAdvancedSection";
import { RetailUnitSection } from "./editor/RetailUnitSection";
import { RetailPackSection } from "./editor/RetailPackSection";
import { RetailStockEntry } from "./editor/RetailStockEntry";
import { WIZARD_INPUT_TEXT } from "./wizard/wizardTokens";
import clsx from "clsx";

type Props = {
  lang: Language;
  product: Product | null;
  open: boolean;
  onClose: () => void;
  categorySuggestions?: string[];
  canPresets?: boolean;
  updateProduct: (
    productId: string,
    patch: Partial<
      Pick<
        Product,
        | "name"
        | "baseUnit"
        | "buyingUnit"
        | "conversionRate"
        | "sellingPricePerUnitUgx"
        | "costPricePerUnitUgx"
        | "buyingPackCostUgx"
        | "stockOnHand"
        | "minimumStockAlert"
        | "category"
        | "sku"
        | "expiryDate"
        | "medicineStrength"
        | "medicineForm"
        | "quickPresetsMoneyUgx"
        | "quickPresetsQty"
        | "pharmacyPackaging"
        | "pharmacyMaster"
      >
    >,
    opts?: { auditReason?: string },
  ) => { ok: boolean; errorKey?: string };
};

function packKindFromBuyingUnit(raw: string | null | undefined): { kind: PackKind; custom: string } {
  if (!raw) return { kind: "crate", custom: "" };
  const label = raw.split("·")[0]?.trim().toLowerCase() ?? "";
  const found = PACK_TYPE_OPTIONS.find((o) => o.id === label);
  if (found) return { kind: found.id, custom: "" };
  return { kind: "custom", custom: label };
}

export function StockProductEditModal({
  lang,
  product,
  open,
  onClose,
  categorySuggestions,
  canPresets,
  updateProduct,
}: Props) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [sellUnit, setSellUnit] = useState<SellUnitKind>("piece");
  const [sellUnitCustom, setSellUnitCustom] = useState("");
  const [hasPack, setHasPack] = useState(false);
  const [packKind, setPackKind] = useState<PackKind>("crate");
  const [packCustom, setPackCustom] = useState("");
  const [piecesPerPack, setPiecesPerPack] = useState("");
  const [packCount, setPackCount] = useState("");
  const [looseCount, setLooseCount] = useState("");
  const [pieceOnlyStock, setPieceOnlyStock] = useState("");
  const [price, setPrice] = useState("");
  const [buyPricePerUnit, setBuyPricePerUnit] = useState("");
  const [minAlert, setMinAlert] = useState("");
  const [sku, setSku] = useState("");
  const [buyPackPrice, setBuyPackPrice] = useState("");
  const [moneyPresets, setMoneyPresets] = useState("");
  const [qtyPresets, setQtyPresets] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [medicineStrength, setMedicineStrength] = useState("");
  const [medicineForm, setMedicineForm] = useState("");
  const [packagingState, setPackagingState] = useState<PharmacyPackagingFieldState>(() =>
    packagingStateFromProduct(null),
  );
  const [masterState, setMasterState] = useState(() => masterStateFromProduct(null));
  const [auditReason, setAuditReason] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  const preferences = usePosStore((s) => s.preferences);
  const pharmacyMode = isPharmacyMode(preferences.businessType, preferences.pharmacyModeEnabled);
  const pt = usePharmacyTerms(lang, preferences.businessType, preferences.pharmacyModeEnabled);

  const markDirty = useCallback(() => setDirty(true), []);

  useEffect(() => {
    if (!open || !product) return;
    setName(product.name);
    setCategory((product.category ?? "").trim());
    const su = parseSellUnitFromBaseUnit(product.baseUnit);
    setSellUnit(su.kind);
    setSellUnitCustom(su.custom);
    const b = stockBreakdown(product);
    const pk = packKindFromBuyingUnit(product.buyingUnit);
    setHasPack(b.hasPackTracking);
    setPackKind(pk.kind);
    setPackCustom(pk.custom);
    const rate = product.conversionRate && product.conversionRate > 1 ? product.conversionRate : 24;
    setPiecesPerPack(b.hasPackTracking ? String(rate) : "");
    setPackCount(b.hasPackTracking ? String(b.fullPacks) : "");
    setLooseCount(b.hasPackTracking ? String(b.loosePieces) : "");
    setPieceOnlyStock(
      b.hasPackTracking && !isPharmacyPackagingActive(product) ? "" : String(Math.floor(product.stockOnHand)),
    );
    setPrice(String(Math.max(0, Math.floor(product.sellingPricePerUnitUgx))));
    setBuyPricePerUnit(String(Math.max(0, Math.floor(product.costPricePerUnitUgx))));
    setMinAlert(String(Math.max(0, Math.floor(product.minimumStockAlert))));
    setSku(product.sku ?? "");
    const conv = product.conversionRate && product.conversionRate > 0 ? product.conversionRate : 0;
    if (conv > 0 && product.costPricePerUnitUgx >= 0) {
      setBuyPackPrice(String(Math.floor(product.costPricePerUnitUgx * conv)));
    } else {
      setBuyPackPrice("");
    }
    setMoneyPresets((product.quickPresetsMoneyUgx ?? []).join(","));
    setQtyPresets((product.quickPresetsQty ?? []).join(","));
    setExpiryDate(product.expiryDate ?? "");
    setMedicineStrength(product.medicineStrength ?? "");
    setMedicineForm(product.medicineForm ?? "");
    const ps = packagingStateFromProduct(product.pharmacyPackaging);
    ps.sellStrip = product.pharmacyPackaging?.sell.strip ?? ps.sellStrip;
    ps.sellBox = product.pharmacyPackaging?.sell.box ?? ps.sellBox;
    setPackagingState(ps);
    setMasterState(masterStateFromProduct(product));
    setAuditReason("");
    setSubmitError(null);
    setDirty(false);
  }, [open, product]);

  const piecesN = Math.max(1, Math.floor(Number(piecesPerPack.replace(/[^\d.]/g, "")) || 0));
  const packsN = Math.max(0, Number(packCount.replace(/[^\d.]/g, "")) || 0);
  const looseN = Math.max(0, Number(looseCount.replace(/[^\d.]/g, "")) || 0);
  const totalStock = useMemo(() => {
    if (!hasPack) return Math.max(0, Number(pieceOnlyStock.replace(/[^\d.]/g, "")) || 0);
    return packsN * piecesN + looseN;
  }, [hasPack, pieceOnlyStock, packsN, piecesN, looseN]);

  const unitLabel = sellUnitLabel(sellUnit, lang, sellUnitCustom);
  const packLabel = packKindLabel(packKind, packCustom, lang);

  const packagingEdit =
    pharmacyMode && product != null && (packagingState.enabled || isPharmacyPackagingActive(product));
  const priceUgx = Math.max(0, Math.floor(Number(price.replace(/\D/g, "")) || 0));
  const buyPerUnit = Math.max(0, Math.floor(Number(buyPricePerUnit.replace(/\D/g, "")) || 0));
  const stripSell = Math.max(0, Math.floor(Number(packagingState.stripPrice.replace(/\D/g, "")) || 0));
  const boxSell = Math.max(0, Math.floor(Number(packagingState.boxPrice.replace(/\D/g, "")) || 0));

  const previewPackaging =
    product && packagingEdit && packagingState.enabled
      ? buildPackagingFromState(packagingState, priceUgx, product.pharmacyPackaging)
      : product?.pharmacyPackaging;
  const previewStock = packagingEdit
    ? Math.max(0, Number(pieceOnlyStock.replace(/\D/g, "")) || 0)
    : totalStock;
  const previewProduct: Product | null = product
    ? {
    ...product,
    stockOnHand: previewStock,
        baseUnit:
          packagingEdit && previewPackaging?.enabled
            ? previewPackaging.baseUnit
            : resolveSellBaseUnit(sellUnit, sellUnitCustom),
    buyingUnit: hasPack && piecesN > 1 && !packagingEdit ? packLabel.toLowerCase() : product.buyingUnit,
    conversionRate: hasPack && piecesN > 1 && !packagingEdit ? piecesN : product.conversionRate,
    pharmacyPackaging: previewPackaging,
        sellingPricePerUnitUgx: priceUgx,
        costPricePerUnitUgx: buyPerUnit,
      }
    : null;

  const extraUnitPrices = useMemo(() => {
    if (!packagingEdit || !packagingState.enabled) return [];
    const rows: { label: string; sellPriceUgx: number }[] = [];
    if (packagingState.level1Enabled && stripSell > 0) {
      rows.push({ label: t(lang, "pharmacyPackStripPriceOptional"), sellPriceUgx: stripSell });
    }
    if (packagingState.level2Enabled && boxSell > 0) {
      rows.push({ label: t(lang, "pharmacyPackBoxPriceOptional"), sellPriceUgx: boxSell });
    }
    return rows;
  }, [packagingEdit, packagingState, stripSell, boxSell, lang]);

  const batchCount = product?.pharmacyPackaging?.batches?.length ?? 0;
  const batchSummary =
    batchCount > 0
      ? `${t(lang, "pharmacyBatches")}: ${batchCount}${expiryDate.trim() ? ` · ${t(lang, "pharmacyExpiryDateLabel")}: ${expiryDate}` : ""}`
      : undefined;

  const nextStock = packagingEdit ? Math.max(0, Number(pieceOnlyStock.replace(/\D/g, "")) || 0) : totalStock;
  const needsAuditReason =
    product != null &&
    (priceUgx !== product.sellingPricePerUnitUgx || Math.abs(nextStock - product.stockOnHand) > 1e-6);

  const lowStockLabel =
    packagingEdit && packagingState.enabled
      ? t(lang, "pharmacyPackLowStockLabel")
      : tTemplate(lang, "stockEditLowStockLabel", { unit: unitLabel });

  if (!open || !product || !previewProduct) return null;

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (priceUgx <= 0 || !name.trim()) return;
    if (pharmacyMode && buyPerUnit <= 0) return;
    if (sellUnit === "custom" && !sellUnitCustom.trim()) return;
    if (hasPack && packKind === "custom" && !packCustom.trim()) return;

    const packPrice = Math.floor(Number(buyPackPrice.replace(/\D/g, "")) || 0);
    const hasTrack = hasPack && piecesN > 1;
    const buyingUnit = hasTrack ? packLabel.toLowerCase() : null;
    const conversionRate = hasTrack ? piecesN : null;
    const costPricePerUnitUgx = pharmacyMode
      ? buyPerUnit
      : hasTrack && packPrice > 0
        ? unitCostFromPackTotal(packPrice, piecesN)
        : product.costPricePerUnitUgx;
    const buyingPackCostUgx = hasTrack && packPrice > 0 ? packPrice : null;

    let pharmacyPackaging = product.pharmacyPackaging ?? null;
    let baseUnit = resolveSellBaseUnit(sellUnit, sellUnitCustom);
    let patchBuyingUnit = buyingUnit;
    let patchConversion = conversionRate;

    if (packagingEdit && packagingState.enabled) {
      pharmacyPackaging = buildPackagingFromState(packagingState, priceUgx, product.pharmacyPackaging);
      if (pharmacyPackaging) {
        baseUnit = pharmacyPackaging.baseUnit;
        const bu = buyingUnitFromPackaging(pharmacyPackaging);
        patchBuyingUnit = bu.buyingUnit;
        patchConversion = bu.conversionRate;
        pharmacyPackaging.lowStockAlertUnit = packagingState.lowStockUnit;
      }
    }

    const priceChanging = priceUgx !== product.sellingPricePerUnitUgx;
    const stockChanging = Math.abs(nextStock - product.stockOnHand) > 1e-6;
    if ((priceChanging || stockChanging) && !validateAuditReason(auditReason)) {
      setSubmitError(t(lang, "auditReasonRequired"));
      return;
    }
    setSubmitError(null);

    const patch: Parameters<typeof updateProduct>[1] = {
      name: name.trim(),
      baseUnit,
      buyingUnit: patchBuyingUnit,
      conversionRate: patchConversion,
      sellingPricePerUnitUgx: priceUgx,
      costPricePerUnitUgx,
      buyingPackCostUgx,
      stockOnHand: nextStock,
      minimumStockAlert: Math.max(0, Math.floor(Number(minAlert.replace(/\D/g, "")) || 0)),
      category: category.trim(),
      sku:
        pharmacyMode && masterState.primaryBarcode.trim()
          ? masterState.primaryBarcode.trim()
          : sku.trim() || product.sku,
      expiryDate: pharmacyMode ? normalizeExpiryDate(expiryDate || null) : product.expiryDate ?? null,
      medicineStrength: pharmacyMode ? normalizeMedicineStrength(medicineStrength || null) : product.medicineStrength ?? null,
      medicineForm: pharmacyMode ? normalizeMedicineForm(medicineForm || null) : product.medicineForm ?? null,
      pharmacyPackaging: packagingEdit ? pharmacyPackaging : product.pharmacyPackaging ?? null,
      pharmacyMaster: pharmacyMode
        ? buildPharmacyMasterFromState({
            ...masterState,
            brandName: name.trim(),
            strength: medicineStrength,
            medicineForm,
            medicineCategory: category.trim(),
          })
        : product.pharmacyMaster ?? null,
    };

    if (canPresets) {
      patch.quickPresetsMoneyUgx = moneyPresets
        .split(",")
        .map((x) => Math.floor(Number(x.trim()) || 0))
        .filter((x) => x > 0);
      patch.quickPresetsQty = qtyPresets
        .split(",")
        .map((x) => Number(x.trim()) || 0)
        .filter((x) => x > 0);
    }

    const r = updateProduct(product.id, patch, { auditReason: auditReason || undefined });
    if (!r.ok) {
      setSubmitError(t(lang, r.errorKey === "auditReasonRequired" ? "auditReasonRequired" : (r.errorKey ?? "invalid")));
      return;
    }
    onClose();
  };

  const packagingStockPreview =
    packagingEdit && packagingState.enabled ? (
      <div className="rounded-xl border border-border/60 bg-card px-3 py-2 text-sm font-black text-primary">
        <p>
          {t(lang, "pharmacyPackStockPrimary")}: {formatPharmacyStockPrimary(previewProduct)}
        </p>
        {formatPharmacyStockEquivalent(previewProduct) ? (
          <p className="mt-1 whitespace-pre-line text-xs font-bold text-muted-foreground">
            {t(lang, "pharmacyPackStockEquivalent")}:{"\n"}
            {formatPharmacyStockEquivalent(previewProduct)}
          </p>
        ) : null}
      </div>
    ) : null;

  return (
    <ProductEditorShell
      lang={lang}
      open={open}
      title={pt("stockEditProduct")}
      subtitle={t(lang, "productEditorSubtitle")}
      dirty={dirty}
      saveError={submitError}
      onRequestClose={onClose}
      onSubmit={onSubmit}
      footer={
        <EditorFooter
          lang={lang}
          showAuditReason={needsAuditReason}
          auditReason={auditReason}
          onAuditReasonChange={(v) => {
            markDirty();
            setAuditReason(v);
          }}
        />
      }
    >
      <EditorIdentitySection
        lang={lang}
        nameLabel={pt("stockEditName")}
        shelfLabel={pt("stockEditShelf")}
        name={name}
        category={category}
        categoryPlaceholder={uiPlaceholder(
                lang,
                preferences.businessType,
                "simpleAddShelfPlaceholder",
                preferences.pharmacyModeEnabled,
              )}
        categorySuggestions={categorySuggestions}
        onNameChange={(v) => {
          markDirty();
          setName(v);
        }}
        onCategoryChange={(v) => {
          markDirty();
          setCategory(v);
        }}
        pharmacyMode={pharmacyMode}
        genericName={masterState.genericName}
        onGenericNameChange={(v) => {
          markDirty();
          setMasterState((s) => ({ ...s, genericName: v }));
        }}
        strength={medicineStrength}
        onStrengthChange={(v) => {
          markDirty();
          setMedicineStrength(v);
          setMasterState((s) => ({ ...s, strength: v }));
        }}
        medicineForm={medicineForm}
        onMedicineFormChange={(v) => {
          markDirty();
          setMedicineForm(v);
          setMasterState((s) => ({ ...s, medicineForm: v }));
        }}
        strengthLabel={pt("strength")}
        formLabel={pt("form")}
      />

          {packagingEdit ? (
        <EditorSection title={t(lang, "productEditorSectionPackaging")}>
              <PharmacyPackagingFields
                lang={lang}
                state={packagingState}
            onChange={(patch) => {
              markDirty();
              setPackagingState((s) => ({ ...s, ...patch }));
            }}
                hideTabletPrice
                showEnableToggle={!isPharmacyPackagingActive(product)}
            inputClass={clsx(WIZARD_INPUT_TEXT, "mt-2")}
            labelClass="block text-sm font-bold text-foreground"
          />
        </EditorSection>
      ) : (
        <EditorSection title={t(lang, "productEditorSectionInventory")}>
          <RetailUnitSection
            lang={lang}
            sellUnit={sellUnit}
            sellUnitCustom={sellUnitCustom}
            onSellUnitChange={(u) => {
              markDirty();
              setSellUnit(u);
            }}
            onSellUnitCustomChange={(v) => {
              markDirty();
              setSellUnitCustom(v);
            }}
          />
          <RetailPackSection
            lang={lang}
            hasPack={hasPack}
            packKind={packKind}
            packCustom={packCustom}
            piecesPerPack={piecesPerPack}
            unitLabel={unitLabel}
            onHasPackChange={(v) => {
              markDirty();
              setHasPack(v);
            }}
            onPackKindChange={(k) => {
              markDirty();
              setPackKind(k);
            }}
            onPackCustomChange={(v) => {
              markDirty();
              setPackCustom(v);
            }}
            onPiecesPerPackChange={(v) => {
              markDirty();
              setPiecesPerPack(v);
            }}
          />
          <RetailStockEntry
            lang={lang}
            hasPack={hasPack}
            piecesPerPack={piecesN}
            packCount={packCount}
            looseCount={looseCount}
            pieceOnlyStock={pieceOnlyStock}
            unitLabel={unitLabel}
            packLabel={packLabel}
            stockPreview={formatStockLabel(previewProduct)}
            onPackCountChange={(v) => {
              markDirty();
              setPackCount(v);
            }}
            onLooseCountChange={(v) => {
              markDirty();
              setLooseCount(v);
            }}
            onPieceOnlyStockChange={(v) => {
              markDirty();
              setPieceOnlyStock(v);
            }}
          />
        </EditorSection>
      )}

      <EditorPricingSection
        lang={lang}
        pharmacyMode={pharmacyMode}
        unitLabel={previewProduct.baseUnit}
        buyPrice={buyPricePerUnit}
        sellPrice={price}
        onBuyPriceChange={(v) => {
          markDirty();
          setBuyPricePerUnit(v);
        }}
        onSellPriceChange={(v) => {
          markDirty();
          setPrice(v);
        }}
        unitCostUgx={pharmacyMode ? buyPerUnit : previewProduct.costPricePerUnitUgx}
        sellPriceUgx={priceUgx}
        extraUnitPrices={extraUnitPrices}
        batchSummary={batchSummary}
        controlledIndicator={masterState.controlledDrug}
      />

      <EditorInventorySection
              lang={lang}
        pharmacyMode={pharmacyMode}
        product={previewProduct}
        minAlert={minAlert}
        onMinAlertChange={(v) => {
          markDirty();
          setMinAlert(v);
        }}
        lowStockLabel={lowStockLabel}
        expiryDate={expiryDate}
        onExpiryDateChange={(v) => {
          markDirty();
          setExpiryDate(v);
        }}
        packagingEdit={packagingEdit}
        packagingState={packagingState}
        onLowStockUnitChange={(unit) => {
          markDirty();
          setPackagingState((s) => ({ ...s, lowStockUnit: unit }));
        }}
        stockSummary={packagingStockPreview}
      >
        {packagingEdit ? (
          <label className="block text-sm font-bold text-foreground">
            {t(lang, "pharmacyPackStockOnHand")}
            <input
              value={pieceOnlyStock || String(product.stockOnHand)}
              onChange={(e) => {
                markDirty();
                setPieceOnlyStock(e.target.value.replace(/\D/g, "").slice(0, 10));
              }}
              inputMode="numeric"
              className={clsx(WIZARD_INPUT_TEXT, "mt-2")}
            />
          </label>
        ) : null}
      </EditorInventorySection>

      {pharmacyMode ? (
        <EditorSection title={t(lang, "productEditorSectionCompliance")}>
          <PharmacyMedicineMasterFields
            lang={lang}
            state={{ ...masterState, strength: medicineStrength, medicineForm, brandName: name }}
            onChange={(patch) => {
              markDirty();
              if (patch.brandName !== undefined) setName(patch.brandName);
              if (patch.strength !== undefined) setMedicineStrength(patch.strength);
              if (patch.medicineForm !== undefined) setMedicineForm(patch.medicineForm);
              setMasterState((prev) => ({ ...prev, ...patch }));
            }}
            showStrengthForm={false}
            hideBrandName
            hideGeneric
            compact
          />
        </EditorSection>
              ) : null}

      <EditorAdvancedSection
        lang={lang}
        sku={sku}
        onSkuChange={(v) => {
          markDirty();
          setSku(v);
        }}
        canPresets={canPresets}
        moneyPresets={moneyPresets}
        qtyPresets={qtyPresets}
        onMoneyPresetsChange={(v) => {
          markDirty();
          setMoneyPresets(v);
        }}
        onQtyPresetsChange={(v) => {
          markDirty();
          setQtyPresets(v);
        }}
        showBuyPackPrice={hasPack && !packagingEdit}
        buyPackPrice={buyPackPrice}
        onBuyPackPriceChange={(v) => {
          markDirty();
          setBuyPackPrice(v);
        }}
        packLabel={packLabel}
      />
    </ProductEditorShell>
  );
}
