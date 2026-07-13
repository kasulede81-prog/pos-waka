import { describe, expect, it } from "vitest";
import type { Language } from "../types";
import { filterAttentionByQuery } from "./commandCenterPageView";
import type { AttentionItem } from "./ownerCommandCenter";

const lang = "en" as Language;

describe("filterAttentionByQuery", () => {
  const items: AttentionItem[] = [
    {
      id: "shift-shortage-1",
      severity: "critical",
      titleKey: "ownerAttentionShiftShortage",
      titleVars: { amount: "10,000" },
      actionTo: "/office/open-shifts",
      actionLabelKey: "ownerAttentionView",
    },
  ];

  it("matches translated attention titles", () => {
    const filtered = filterAttentionByQuery(items, "shift", lang);
    expect(filtered).toHaveLength(1);
  });

  it("does not match raw i18n keys when user searches natural language", () => {
    const filtered = filterAttentionByQuery(items, "ownerAttentionShiftShortage", lang);
    expect(filtered).toHaveLength(0);
  });
});
