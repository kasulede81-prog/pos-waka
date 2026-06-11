import { describe, expect, it } from "vitest";
import { mapAiSuggestionToWizardPrefill } from "./mapAiSuggestionToWizard";
import type { AiProductSuggestion } from "./aiProductSchemas";

describe("mapAiSuggestionToWizardPrefill", () => {
  it("maps soda bottle with crate pack", () => {
    const suggestion: AiProductSuggestion = {
      name: "Coca Cola 500ml",
      category: "Soda",
      unit: "bottle",
      sellingMode: "unit",
      packType: "crate",
      piecesPerPack: 24,
      confidence: 0.9,
    };
    const prefill = mapAiSuggestionToWizardPrefill(suggestion);
    expect(prefill.name).toBe("Coca Cola 500ml");
    expect(prefill.shelf).toBe("Soda");
    expect(prefill.sellUnit).toBe("bottle");
    expect(prefill.hasPack).toBe(true);
    expect(prefill.packKind).toBe("crate");
    expect(prefill.piecesPerPack).toBe("24");
  });

  it("maps single items without pack", () => {
    const prefill = mapAiSuggestionToWizardPrefill({
      name: "Sugar 1kg",
      category: "Groceries",
      unit: "kg",
      sellingMode: "weighted",
      packType: null,
      piecesPerPack: null,
      confidence: 0.8,
    });
    expect(prefill.sellUnit).toBe("kg");
    expect(prefill.hasPack).toBe(false);
    expect(prefill.piecesPerPack).toBe("");
  });
});
