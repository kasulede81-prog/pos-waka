const QTY_EPS = 0.02;
const QTY_ROUND = 4;

const UNIT_FRACTIONS = [
  { value: 0.125, char: "⅛" },
  { value: 0.25, char: "¼" },
  { value: 1 / 3, char: "⅓" },
  { value: 0.375, char: "⅜" },
  { value: 0.5, char: "½" },
  { value: 0.625, char: "⅝" },
  { value: 2 / 3, char: "⅔" },
  { value: 0.75, char: "¾" },
  { value: 0.875, char: "⅞" },
] as const;

function near(a: number, b: number, eps = QTY_EPS): boolean {
  return Math.abs(a - b) < eps;
}

export function roundSaleQuantity(qty: number): number {
  return Math.round(qty * 10 ** QTY_ROUND) / 10 ** QTY_ROUND;
}

function normalizeUnit(unit: string): string {
  return unit.trim() || "item";
}

function matchFractionChar(frac: number): string | null {
  for (const f of UNIT_FRACTIONS) {
    if (near(frac, f.value)) return f.char;
  }
  return null;
}

/**
 * Human-readable quantity with Unicode fractions (e.g. 3¼ kg, ½ kg).
 * Falls back to at most 3 decimal places when no common fraction matches.
 */
export function formatQuantityWithFractions(qty: number, unit: string): string {
  const unitShown = normalizeUnit(unit);
  const rounded = roundSaleQuantity(qty);
  if (rounded <= 0) return `0 ${unitShown}`;

  const whole = Math.floor(rounded + 1e-9);
  const frac = roundSaleQuantity(rounded - whole);

  if (frac < QTY_EPS) {
    return whole === 1 ? `1 ${unitShown}` : `${whole} ${unitShown}`;
  }

  const fracChar = matchFractionChar(frac);
  if (fracChar) {
    if (whole > 0) return `${whole}${fracChar} ${unitShown}`;
    return `${fracChar} ${unitShown}`;
  }

  const pureFrac = matchFractionChar(rounded);
  if (pureFrac && whole === 0) return `${pureFrac} ${unitShown}`;

  const shown = Number.isInteger(rounded)
    ? String(rounded)
    : rounded.toFixed(3).replace(/\.?0+$/, "");
  return `${shown} ${unitShown}`;
}

/** @deprecated Use formatQuantityWithFractions */
export function formatFriendlyQuantity(
  qty: number,
  baseUnit: string,
  _style: "short" | "receipt" = "short",
): string {
  return formatQuantityWithFractions(qty, baseUnit);
}
