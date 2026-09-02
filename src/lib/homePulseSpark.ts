/** Presentation helpers for the Home 7-day pulse — no new business math. */

export type HomePulseTrendPoint = {
  day: string;
  revenueUgx: number;
  transactionCount: number;
};

export type HomePulseSparkMode = "revenue" | "transactions";

export function homePulseSparkValues(
  points: readonly HomePulseTrendPoint[],
  mode: HomePulseSparkMode,
): number[] {
  return points.map((point) => (mode === "revenue" ? point.revenueUgx : point.transactionCount));
}

export type HomePulseSparkCoord = { x: number; y: number };

/**
 * Map real daily values onto an SVG polyline.
 * Floor is always 0 so empty days stay on the baseline — no invented interpolation.
 */
export function homePulseSparkCoords(
  values: readonly number[],
  width: number,
  height: number,
  pad = 4,
): HomePulseSparkCoord[] {
  if (values.length === 0 || width <= 0 || height <= 0) return [];
  const max = Math.max(0, ...values);
  const span = max > 0 ? max : 1;
  const innerW = Math.max(0, width - pad * 2);
  const innerH = Math.max(0, height - pad * 2);
  return values.map((value, index) => {
    const t = values.length === 1 ? 0.5 : index / (values.length - 1);
    return {
      x: pad + t * innerW,
      y: pad + innerH - (Math.max(0, value) / span) * innerH,
    };
  });
}

export function homePulseSparkPolyline(coords: readonly HomePulseSparkCoord[]): string {
  return coords.map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(" ");
}

export function homePulseSparkArea(
  coords: readonly HomePulseSparkCoord[],
  height: number,
  pad = 4,
): string {
  if (coords.length === 0) return "";
  const first = coords[0];
  const last = coords[coords.length - 1];
  if (!first || !last) return "";
  const baseline = (height - pad).toFixed(2);
  const line = homePulseSparkPolyline(coords);
  return `${first.x.toFixed(2)},${baseline} ${line} ${last.x.toFixed(2)},${baseline}`;
}

export function homePulseSparkHasActivity(values: readonly number[]): boolean {
  return values.some((value) => value > 0);
}

/** Short day tick from an existing Kampala date key (`YYYY-MM-DD`). */
export function homePulseSparkDayLabel(day: string): string {
  const parts = day.split("-");
  const month = parts[1];
  const date = parts[2];
  if (!month || !date) return day;
  return `${Number(month)}/${Number(date)}`;
}
