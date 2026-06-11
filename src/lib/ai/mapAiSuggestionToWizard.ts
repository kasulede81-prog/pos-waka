import type { PackKind, SellUnitKind } from "../simpleProductWizard";
import type { AiProductSuggestion } from "./aiProductSchemas";

export type WizardPrefillFromAi = {
  name: string;
  shelf: string;
  sellUnit: SellUnitKind;
  sellUnitCustom: string;
  hasPack: boolean;
  packKind: PackKind;
  packCustom: string;
  piecesPerPack: string;
};

const PACK_KINDS: PackKind[] = ["crate", "carton", "box", "sack", "pack", "tray", "bale", "custom"];

function unitToSellUnit(unit: string): { kind: SellUnitKind; custom: string } {
  const u = unit.trim().toLowerCase();
  if (u === "bottle") return { kind: "bottle", custom: "" };
  if (u === "packet" || u === "pack") return { kind: "packet", custom: "" };
  if (u === "kg") return { kind: "kg", custom: "" };
  if (u === "litre" || u === "liter") return { kind: "litre", custom: "" };
  if (u === "piece" || u === "ea" || u === "pcs") return { kind: "piece", custom: "" };
  return { kind: "custom", custom: unit.trim() || "piece" };
}

function packToKind(packType: string | null): { kind: PackKind; custom: string } {
  if (!packType) return { kind: "crate", custom: "" };
  const p = packType.trim().toLowerCase();
  if (PACK_KINDS.includes(p as PackKind)) return { kind: p as PackKind, custom: "" };
  return { kind: "custom", custom: packType.trim() };
}

/** Maps an AI suggestion into SimpleAddProductWizard prefill state (steps before stock). */
export function mapAiSuggestionToWizardPrefill(suggestion: AiProductSuggestion): WizardPrefillFromAi {
  const sell = unitToSellUnit(suggestion.unit);
  const hasPack = Boolean(suggestion.packType && suggestion.piecesPerPack && suggestion.piecesPerPack > 1);
  const pack = packToKind(suggestion.packType);

  return {
    name: suggestion.name,
    shelf: suggestion.category,
    sellUnit: sell.kind,
    sellUnitCustom: sell.custom,
    hasPack,
    packKind: hasPack ? pack.kind : "crate",
    packCustom: hasPack && pack.kind === "custom" ? pack.custom : "",
    piecesPerPack: hasPack && suggestion.piecesPerPack ? String(suggestion.piecesPerPack) : "",
  };
}
