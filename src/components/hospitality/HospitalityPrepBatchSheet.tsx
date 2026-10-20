import { useMemo, useState } from "react";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { useSessionActor } from "../../context/SessionActorContext";
import { useSubscription } from "../../context/SubscriptionContext";
import {
  isBatchPreparableProduct,
  resolveHospitalityPrepAccess,
} from "../../lib/hospitalityPrepAccess";
import { preparedPortionsAvailable } from "../../lib/recipeEngine";
import { usePosStore } from "../../store/usePosStore";
import { ModalSheet } from "../layout/ModalSheet";
import { WakaButton } from "../ui/wakaPrimitives";
import { PrepBatchWorkflow } from "./PrepBatchWorkflow";

type Props = {
  lang: Language;
  open: boolean;
  onClose: () => void;
};

/**
 * Inventory entry point for recorded batch preparation.
 *
 * Gated by `stock.adjust` (the same permission the store actions re-check), not
 * by `settings.shop`. It only lists dishes whose batch mode and recipe were
 * already saved by a settings-authorized user; the sheet cannot change recipes,
 * product kinds, menu sections or prep modes.
 */
export function HospitalityPrepBatchSheet({ lang, open, onClose }: Props) {
  const actor = useSessionActor();
  const { snapshot, authMode } = useSubscription();
  const { canPrepareBatches } = resolveHospitalityPrepAccess(actor, snapshot, authMode);
  const products = usePosStore((s) => s.products);

  const eligibleProducts = useMemo(
    () => products.filter(isBatchPreparableProduct),
    [products],
  );
  const [selectedId, setSelectedId] = useState("");

  // Derive a valid selection instead of writing state from an effect; a dish
  // removed by a sync pull falls back to the first still-eligible dish.
  const effectiveSelectedId =
    selectedId && eligibleProducts.some((p) => p.id === selectedId)
      ? selectedId
      : eligibleProducts[0]?.id ?? "";
  const selected = eligibleProducts.find((p) => p.id === effectiveSelectedId) ?? null;

  return (
    <ModalSheet
      open={open}
      onClose={onClose}
      align="center"
      zIndexClass="z-[70]"
      maxHeightClass="max-h-[min(92dvh,52rem)]"
      panelClassName="sm:max-w-lg"
      title={t(lang, "hospitalityPrepBatchesTitle")}
      footer={
        <WakaButton type="button" variant="secondary" className="w-full" onClick={onClose}>
          {t(lang, "cancel")}
        </WakaButton>
      }
    >
      {!canPrepareBatches ? (
        <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-4 text-sm font-bold text-red-700">
          {t(lang, "forbidden")}
        </p>
      ) : eligibleProducts.length === 0 ? (
        <p className="rounded-xl border border-border bg-muted px-3 py-4 text-sm font-semibold text-muted-foreground">
          {t(lang, "hospitalityPrepNoDishes")}
        </p>
      ) : (
        <div className="space-y-4">
          <p className="text-sm font-medium text-muted-foreground">{t(lang, "hospitalityPrepBatchesSub")}</p>
          <label className="block">
            <span className="text-xs font-black uppercase text-muted-foreground">
              {t(lang, "hospitalityPrepSelectDish")}
            </span>
            <select
              value={effectiveSelectedId}
              onChange={(e) => setSelectedId(e.target.value)}
              className="mt-1 min-h-[44px] w-full rounded-xl border border-border px-3 text-sm font-bold"
            >
              {eligibleProducts.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {preparedPortionsAvailable(p)} {t(lang, "prepAvailableShort")}
                </option>
              ))}
            </select>
          </label>
          {selected ? (
            <PrepBatchWorkflow
              key={selected.id}
              lang={lang}
              product={selected}
              previewProduct={selected}
            />
          ) : null}
        </div>
      )}
    </ModalSheet>
  );
}
