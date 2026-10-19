import clsx from "clsx";
import type { Language, Product, ShopPreferences } from "../../types";
import { t } from "../../lib/i18n";
import { formatProductPriceLabel } from "../../store/usePosStore";
import { formatStockLabel, isLowStock } from "../../lib/sellingEngine";
import { normalizedCategoryKey, shelfIconFor } from "../../lib/productCategories";
import { formatMedicineListPrimary, formatMedicineListSecondary } from "../../lib/pharmacyMedicine";
import { isPharmacyMode } from "../../lib/pharmacy";
import { usePharmacyTerms } from "../../lib/pharmacyTerms";
import { isHospitalityMode } from "../../lib/hospitality";
import { hospitalityMenuCostState, isHospitalityMenuItem } from "../../lib/hospitalityMenuCosting";
import { formatUgx } from "../../lib/formatUgx";
import { profitPerSellUnitUgx } from "../../lib/simpleProductWizard";
import { usePosStore } from "../../store/usePosStore";
import { ModalSheet } from "../layout/ModalSheet";
import { ExpiryStatusBadge } from "../pharmacy/ExpiryStatusBadge";
import { WakaButton } from "../ui/wakaPrimitives";
import { Caption, MonoNumber, SectionTitle } from "../enterprise/EnterpriseTypography";
import { statusTokens } from "../../lib/statusTokens";

type Props = {
  lang: Language;
  open: boolean;
  product: Product | null;
  preferences: ShopPreferences;
  locked: boolean;
  canAdd: boolean;
  canEdit?: boolean;
  canSeeCost?: boolean;
  canSell: boolean;
  onClose: () => void;
  onSell: () => void;
  onEdit: () => void;
  onMore: () => void;
};

type DetailRow = {
  label: string;
  value: string;
  warn?: boolean;
  positive?: boolean;
  negative?: boolean;
};

function formatUpdated(iso: string, lang: Language): string {
  const locale = lang === "sw" ? "sw-UG" : "en-UG";
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Africa/Kampala",
  }).format(new Date(iso));
}

export function StockProductDetailSheet({
  lang,
  open,
  product,
  preferences,
  locked,
  canAdd,
  canEdit,
  canSeeCost = true,
  canSell,
  onClose,
  onSell,
  onEdit,
  onMore,
}: Props) {
  const pharmacyMode = isPharmacyMode(preferences.businessType, preferences.pharmacyModeEnabled);
  const pt = usePharmacyTerms(lang, preferences.businessType, preferences.pharmacyModeEnabled);
  const products = usePosStore((s) => s.products);
  const hospitalityMode = isHospitalityMode(
    preferences.businessType,
    preferences.hospitalityModeEnabled,
  );

  if (!product) return null;

  const shelf = normalizedCategoryKey(product) ? product.category!.trim() : t(lang, "uncategorized");
  const shelfIcon = shelfIconFor(shelf) ?? "📦";
  const low = isLowStock(product);
  const profit = profitPerSellUnitUgx(product.sellingPricePerUnitUgx, product.costPricePerUnitUgx);
  const marginPct =
    product.sellingPricePerUnitUgx > 0 && profit != null
      ? Math.round((profit / product.sellingPricePerUnitUgx) * 1000) / 10
      : null;
  const menuCost =
    hospitalityMode && isHospitalityMenuItem(product)
      ? hospitalityMenuCostState(product, products)
      : null;

  // Retail keeps its existing product-cost rows. Hospitality menu items use the
  // recipe estimate, and show a clear not-set/incomplete state instead of a
  // quick-add default margin.
  const costRow: DetailRow | null = !canSeeCost
    ? null
    : menuCost?.status === "not_set"
      ? { label: t(lang, "stockDetailCost"), value: t(lang, "menuCostRecipeNotSet") }
      : menuCost?.status === "estimated" && menuCost.incomplete
        ? { label: t(lang, "stockDetailCost"), value: t(lang, "menuCostIncomplete") }
        : menuCost?.status === "estimated"
          ? {
              label: t(lang, "menuCostFoodCostEstimated"),
              value: formatUgx(menuCost.foodCostUgx),
            }
          : menuCost?.status === "verified_product_cost"
            ? {
                label: t(lang, "menuCostProductCostLabel"),
                value: formatUgx(menuCost.foodCostUgx),
              }
            : menuCost?.status === "unverified_product_cost"
              ? {
                  label: t(lang, "stockDetailCost"),
                  value: t(lang, "menuCostCostNotConfirmed"),
                }
              : {
                  label: t(lang, "stockDetailCost"),
                  value:
                    product.costPricePerUnitUgx > 0
                      ? `UGX ${Math.round(product.costPricePerUnitUgx).toLocaleString()}`
                      : "—",
                };

  const performanceRows: DetailRow[] = !canSeeCost
    ? []
    : (menuCost?.status === "estimated" && !menuCost.incomplete) ||
        menuCost?.status === "verified_product_cost"
      ? [
          {
            label: t(lang, "stockDetailProfit"),
            value: formatUgx(menuCost.profitUgx),
            positive: menuCost.profitUgx >= 0,
            negative: menuCost.profitUgx < 0,
          },
          {
            label: t(lang, "profitStatMargin"),
            value: `${menuCost.marginPct.toFixed(1)}%`,
            positive: menuCost.marginPct >= 0,
            negative: menuCost.marginPct < 0,
          },
        ]
      : menuCost
        ? []
        : [
            {
              label: t(lang, "stockDetailProfit"),
              value: profit != null ? `UGX ${profit.toLocaleString()}` : "—",
              positive: profit != null && profit >= 0,
              negative: profit != null && profit < 0,
            },
            ...(marginPct != null
              ? [{
                  label: t(lang, "profitStatMargin"),
                  value: `${marginPct.toFixed(1)}%`,
                  positive: marginPct >= 0,
                  negative: marginPct < 0,
                }]
              : []),
          ];

  const rows: DetailRow[] = [
    { label: t(lang, "stockDetailCategory"), value: shelf },
    { label: t(lang, "stockDetailShelf"), value: shelf },
    { label: t(lang, "stockDetailBarcode"), value: product.sku?.trim() || "—" },
    {
      label: t(lang, "stockLabel"),
      value: formatStockLabel(product),
      warn: low,
    },
    ...(costRow ? [costRow] : []),
    { label: t(lang, "stockDetailSellPrice"), value: formatProductPriceLabel(product) },
    ...performanceRows,
    { label: t(lang, "stockDetailLastUpdated"), value: formatUpdated(product.updatedAt, lang) },
  ];

  const closeAnd = (fn: () => void) => {
    onClose();
    fn();
  };

  return (
    <ModalSheet
      open={open}
      onClose={onClose}
      clearNav={false}
      zIndexClass="z-[54]"
      maxHeightClass="max-h-[min(88dvh,42rem)]"
      title={
        <div className="flex items-start gap-3">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-muted text-2xl leading-none">
            {shelfIcon}
          </span>
          <div className="min-w-0 flex-1">
            <SectionTitle as="h2" className="!text-base">{formatMedicineListPrimary(product)}</SectionTitle>
            {pharmacyMode && formatMedicineListSecondary(product) ? (
              <Caption className="normal-case">{formatMedicineListSecondary(product)}</Caption>
            ) : null}
            <div className="mt-1 flex flex-wrap gap-1">
              {pharmacyMode ? <ExpiryStatusBadge lang={lang} product={product} compact /> : null}
              {low ? (
                <span className={clsx("rounded-full px-2 py-0.5 text-[10px] font-black uppercase", statusTokens.danger.badge)}>
                  {t(lang, "cardLowStock")}
                </span>
              ) : null}
              {locked ? (
                <span className="rounded-full bg-foreground px-2 py-0.5 text-[10px] font-black uppercase text-background">
                  {t(lang, "productLockedBadge")}
                </span>
              ) : null}
            </div>
          </div>
        </div>
      }
      footer={
        !locked ? (
          <div className="space-y-2">
            <div className="grid grid-cols-[1fr_1fr_auto] gap-2">
              {canSell ? (
                <WakaButton type="button" onClick={() => closeAnd(onSell)}>
                  {pharmacyMode ? pt("stockCardSell") : t(lang, "stockCardSell")}
                </WakaButton>
              ) : (
                <span />
              )}
              {canEdit ?? canAdd ? (
                <WakaButton type="button" variant="secondary" onClick={() => closeAnd(onEdit)}>
                  {t(lang, "stockCardEdit")}
                </WakaButton>
              ) : (
                <span />
              )}
              <WakaButton
                type="button"
                variant="secondary"
                className="!min-w-[44px] !px-3"
                onClick={() => closeAnd(onMore)}
                aria-label={t(lang, "stockMoreActions")}
              >
                ⋮
              </WakaButton>
            </div>
            <WakaButton type="button" variant="ghost" className="w-full" onClick={onClose}>
              {t(lang, "cancel")}
            </WakaButton>
          </div>
        ) : (
          <WakaButton type="button" variant="secondary" className="w-full" onClick={onClose}>
            {t(lang, "cancel")}
          </WakaButton>
        )
      }
    >
      <dl className="space-y-2 rounded-xl bg-muted p-3">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center justify-between gap-2 text-sm">
            <dt className="font-semibold text-muted-foreground">{row.label}</dt>
            <dd>
              <MonoNumber
                className={clsx(
                  row.warn && "text-danger",
                  row.positive && "text-success",
                  row.negative && "text-danger",
                )}
              >
                {row.value}
              </MonoNumber>
            </dd>
          </div>
        ))}
      </dl>
    </ModalSheet>
  );
}
