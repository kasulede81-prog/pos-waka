import type { Language } from "../types";
import { t } from "./i18n";

/**
 * Phase 32.3.1 / 32.4.2 — display-only shelf label formatting.
 * Does not mutate stored category / preference values.
 */
export function formatShelfDisplayLabel(label: string): string {
  const s = label.trim().replace(/\s+/g, " ");
  if (!s) return s;

  // Preserve short brand codes: OMO, HIV, etc.
  if (!/\s/.test(s) && s === s.toUpperCase() && s.length <= 4) return s;

  const words = s.split(" ");
  // Leave intentional mixed-case titles alone (e.g. Soft Drinks, iPhone),
  // but still normalize short ALL-CAPS fragments like "GO" → "Go".
  const looksPreFormatted = words.some(
    (w) => w.length > 1 && /\p{Lu}/u.test(w.slice(1)) && !(w === w.toUpperCase() && w.length <= 3),
  );
  if (looksPreFormatted) {
    return words
      .map((w) => {
        if (w === w.toUpperCase() && w.length <= 3 && words.length > 1) {
          return w.charAt(0) + w.slice(1).toLocaleLowerCase();
        }
        return w;
      })
      .join(" ");
  }

  return words
    .map((w) => {
      if (!w) return w;
      return w.charAt(0).toLocaleUpperCase() + w.slice(1).toLocaleLowerCase();
    })
    .join(" ");
}

/** Singular/plural product count for shelf tiles and drill-down (display only). */
export function formatShelfProductCountLabel(lang: Language, count: number): string {
  const key = count === 1 ? "posShelfProductCountOne" : "posShelfProductCount";
  return t(lang, key).replace("{{count}}", String(count));
}

/**
 * Phase 32.4.2 — keep enterprise title size; do not shrink long names
 * (shrinking caused premature ellipsis / “Analgesi…” on desktop).
 */
export function shelfTitleScaleForLabel(_label: string, titleRem: number): number {
  return titleRem;
}
