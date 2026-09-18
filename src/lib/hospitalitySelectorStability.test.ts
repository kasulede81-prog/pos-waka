import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Zustand 5 re-renders forever (React error #185) when a selector returns a new
 * array/object on every call. This guard statically scans the hospitality
 * screens for the patterns that cause it, so the crash that hit shops right after
 * an admin switched them to Bar & Restaurant cannot silently come back.
 */

const FRESH =
  /(\?\?\s*\[\s*\]|\|\|\s*\[\s*\]|\?\?\s*\{\s*\}|\|\|\s*\{\s*\}|\.filter\(|\.map\(|\.slice\(|\.sort\(|\.flatMap\(|\.reduce\(|Object\.(keys|values|entries|fromEntries)\(|new (Map|Set)\(|\[\s*\.\.\.|\{\s*\.\.\.|(?:resolve|compute|build|derive|normalize)[A-Z]\w*\()/;

function balancedEnd(src: string, open: number): number {
  let depth = 0;
  for (let j = open; j < src.length; j++) {
    if (src[j] === "(") depth++;
    else if (src[j] === ")") {
      depth--;
      if (depth === 0) return j;
    }
  }
  return -1;
}

export function findUnstableSelectors(src: string): string[] {
  const found: string[] = [];
  const re = /usePosStore\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const end = balancedEnd(src, m.index + "usePosStore".length);
    if (end < 0) continue;
    const body = src.slice(m.index, end + 1);
    const line = src.slice(0, m.index).split("\n").length;
    if (body.includes("useShallow(")) {
      // Under useShallow only fresh property VALUES matter (top-level values are compared by identity).
      const props = [...body.matchAll(/^\s*\w+:\s*([^\n]*)$/gm)].filter(
        (p) => FRESH.test(p[1]!) || /^[{[]/.test(p[1]!.trim()),
      );
      if (props.length) found.push(`line ${line}: ${props.map((p) => p[0].trim()).join(" | ")}`);
    } else if (FRESH.test(body)) {
      found.push(`line ${line}: ${body.replace(/\s+/g, " ").slice(0, 120)}`);
    }
  }
  return found;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(name) && !/\.test\./.test(name)) out.push(p);
  }
  return out;
}

const SRC = join(process.cwd(), "src");
const HOSPITALITY_SCREENS = new Set([
  "FloorPlanPage",
  "TableOrderPage",
  "KitchenDisplayPage",
  "MenuBuilderPage",
  "ReservationCalendarPage",
  "HospitalityDashboardPage",
  "SettingsHospitalityPage",
  "SettingsFloorPage",
]);

function hospitalityFiles(): string[] {
  return walk(SRC).filter((f) => {
    const rel = relative(SRC, f).split("\\").join("/");
    const base = rel.split("/").pop()!.replace(/\.tsx?$/, "");
    return rel.startsWith("components/hospitality/") || HOSPITALITY_SCREENS.has(base) || /^useHospitality/.test(base);
  });
}

describe("hospitality selector stability (React #185 guard)", () => {
  it("detects the two historical offenders", () => {
    const nested = [
      "usePosStore(useShallow((s) => ({",
      "  a: s.x,",
      "  prefs: {",
      '    shape: s.y ?? "c",',
      "  },",
      "})))",
    ].join("\n");
    const orEmpty = [
      "usePosStore(useShallow((s) => ({",
      "  ids: s.preferences.favoriteProductIds ?? [],",
      "})))",
    ].join("\n");
    const plain = `usePosStore((s) => s.preferences.things ?? [])`;
    // SettingsFloorPage: a resolver call that builds a new object per render.
    const resolverCall = `usePosStore((s) => resolveFloorDisplayPrefs(s.preferences))`;
    expect(findUnstableSelectors(nested)).toHaveLength(1);
    expect(findUnstableSelectors(orEmpty)).toHaveLength(1);
    expect(findUnstableSelectors(plain)).toHaveLength(1);
    expect(findUnstableSelectors(resolverCall)).toHaveLength(1);
  });

  it("does not flag stable selectors", () => {
    expect(findUnstableSelectors(`usePosStore((s) => s.preferences)`)).toEqual([]);
    expect(findUnstableSelectors(`usePosStore(useShallow((s) => ({ a: s.a, b: s.preferences.b })))`)).toEqual([]);
    expect(findUnstableSelectors(`usePosStore(useShallow(selectFloorPlanSlice))`)).toEqual([]);
  });

  it("scans a non-trivial set of hospitality files", () => {
    expect(hospitalityFiles().length).toBeGreaterThan(20);
  });

  it("no hospitality screen or component uses a fresh-reference store selector", () => {
    const offenders: string[] = [];
    for (const file of hospitalityFiles()) {
      for (const hit of findUnstableSelectors(readFileSync(file, "utf8"))) {
        offenders.push(`${relative(SRC, file)} ${hit}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
