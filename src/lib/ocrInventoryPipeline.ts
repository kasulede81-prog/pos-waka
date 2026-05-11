import type { OcrTextBlock } from "../plugins/wakaMlkitOcr";
import type { OcrCaptureMode, OcrReviewRow } from "../types";

function newId(): string {
  return crypto.randomUUID();
}

/** Light on-device cleanup before parsing (no network). */
export function applyLocalOcrCleanup(raw: string, _mode: OcrCaptureMode): string {
  let t = raw.replace(/\r\n/g, "\n");
  t = t.replace(/[ \t]+\n/g, "\n");
  t = t.replace(/\n{3,}/g, "\n\n");
  t = t.replace(/[|]{2,}/g, "|");
  const lines = t.split("\n").map((ln) => ln.replace(/\s+/g, " ").replace(/^[•·▪▫\-–—]+\s*/, "").trim());
  return lines.join("\n").trim();
}

function avgMlConfidence(blocks: OcrTextBlock[]): number | null {
  const vals = blocks.map((b) => b.mlConfidence).filter((x): x is number => typeof x === "number" && !Number.isNaN(x));
  if (!vals.length) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function parseMoneyToken(s: string): number | null {
  const cleaned = s.replace(/,/g, "").replace(/ugx|sh|\/=/gi, "").trim();
  const m = cleaned.match(/(\d{2,7})/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) ? n : null;
}

function parseQtyToken(s: string): number | null {
  const m = s.match(/(?:^|\s)(\d{1,5})(?:\s*$|\s*x|\s*pcs?|\s*pkts?)/i);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) ? n : null;
}

type ParsedLine = {
  name: string;
  stockQty: number;
  priceUgx: number;
  strength: number;
  raw: string;
};

function parseStockListLine(line: string): ParsedLine {
  const raw = line.trim();
  if (!raw) return { name: "", stockQty: 0, priceUgx: 0, strength: 0, raw };
  let strength = 0.35;
  let name = raw;
  let stockQty = 0;
  let priceUgx = 0;

  const tabOrPipe = raw.split(/\t|\|/).map((x) => x.trim());
  if (tabOrPipe.length >= 2) {
    name = tabOrPipe[0];
    const rest = tabOrPipe.slice(1).join(" ");
    const q = parseQtyToken(rest);
    const p = parseMoneyToken(rest);
    if (q != null) {
      stockQty = q;
      strength += 0.25;
    }
    if (p != null) {
      priceUgx = p;
      strength += 0.25;
    }
    if (q != null && p != null) strength += 0.15;
    return { name, stockQty, priceUgx, strength: Math.min(1, strength), raw };
  }

  const xLead = raw.match(/^(\d{1,5})\s*[x×]\s*(.+)$/i);
  if (xLead) {
    stockQty = parseInt(xLead[1], 10);
    name = xLead[2].trim();
    strength = 0.75;
    const p = parseMoneyToken(name);
    if (p != null) {
      priceUgx = p;
      name = name.replace(/[,.\d]+\s*(ugx|sh|\/=)?/i, "").trim();
      strength = 0.9;
    }
    return { name, stockQty, priceUgx, strength, raw };
  }

  const priceTail = raw.match(/^(.+?)\s+([\d,]{3,})\s*(ugx|sh|\/=)?\s*$/i);
  if (priceTail) {
    name = priceTail[1].trim();
    priceUgx = parseInt(priceTail[2].replace(/,/g, ""), 10);
    strength = 0.82;
    const q = parseQtyToken(name);
    if (q != null) {
      stockQty = q;
      name = name.replace(new RegExp(`\\b${q}\\b`), "").trim();
      strength = 0.95;
    }
    return { name, stockQty, priceUgx, strength, raw };
  }

  const qtyTail = raw.match(/^(.+?)\s+(\d{1,4})\s*$/);
  if (qtyTail) {
    name = qtyTail[1].trim();
    const n = parseInt(qtyTail[2], 10);
    if (n <= 500) {
      stockQty = n;
      strength = 0.55;
    } else {
      priceUgx = n;
      strength = 0.5;
    }
    return { name, stockQty, priceUgx, strength, raw };
  }

  return { name: raw, stockQty: 0, priceUgx: 0, strength: 0.3, raw };
}

function parseLabelText(full: string): ParsedLine {
  const lines = full
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const name = lines.slice(0, 3).join(" ").slice(0, 120);
  let priceUgx = 0;
  let stockQty = 0;
  let strength = 0.45;
  for (const ln of lines) {
    const p = parseMoneyToken(ln);
    if (p != null && p > priceUgx) {
      priceUgx = p;
      strength = 0.78;
    }
    const q = parseQtyToken(ln);
    if (q != null && stockQty === 0) {
      stockQty = q;
      strength += 0.1;
    }
  }
  return { name: name || "Unnamed item", stockQty, priceUgx, strength: Math.min(1, strength), raw: full };
}

function parseReceiptLines(full: string): ParsedLine[] {
  const out: ParsedLine[] = [];
  for (const ln of full.split("\n")) {
    const line = ln.trim();
    if (line.length < 3) continue;
    const p = parseMoneyToken(line);
    if (p == null) continue;
    const name = line.replace(/[,.\d]+\s*(ugx|sh|\/=)?\s*$/i, "").trim() || line;
    out.push({ name, stockQty: 0, priceUgx: p, strength: 0.65, raw: line });
  }
  return out.slice(0, 80);
}

function combineConfidence(mlAvg: number | null, parserStrength: number): number {
  const base = mlAvg ?? 0.72;
  return Math.round(Math.min(0.99, Math.max(0.08, base * (0.55 + 0.45 * parserStrength))) * 100) / 100;
}

/**
 * Turn ML Kit output into editable inventory rows. Does not persist anything.
 */
export function buildOcrReviewRows(fullText: string, blocks: OcrTextBlock[], mode: OcrCaptureMode, category: string): OcrReviewRow[] {
  const cleaned = applyLocalOcrCleanup(fullText, mode);
  const mlAvg = avgMlConfidence(blocks);

  if (mode === "product_label") {
    const p = parseLabelText(cleaned);
    if (!p.name) return [];
    return [
      {
        id: newId(),
        name: p.name,
        priceUgx: p.priceUgx,
        stockQty: p.stockQty || 0,
        category,
        selected: true,
        confidence: combineConfidence(mlAvg, p.strength),
        rawLine: p.raw,
      },
    ];
  }

  if (mode === "receipt") {
    return parseReceiptLines(cleaned).map((p) => ({
      id: newId(),
      name: p.name,
      priceUgx: p.priceUgx,
      stockQty: p.stockQty,
      category,
      selected: p.priceUgx > 0,
      confidence: combineConfidence(mlAvg, p.strength),
      rawLine: p.raw,
    }));
  }

  const rows: OcrReviewRow[] = [];
  for (const ln of cleaned.split("\n")) {
    const p = parseStockListLine(ln);
    if (!p.name.trim()) continue;
    rows.push({
      id: newId(),
      name: p.name.trim(),
      priceUgx: Math.max(0, p.priceUgx),
      stockQty: Math.max(0, p.stockQty),
      category,
      selected: p.name.trim().length >= 2,
      confidence: combineConfidence(mlAvg, p.strength),
      rawLine: p.raw,
    });
  }
  return rows.slice(0, 200);
}

/** Shape expected by `bulkQuickAddProducts` after user confirmation. */
export type BulkQuickRow = {
  name: string;
  priceUgx: number;
  stockQty: number;
  category: string;
  inferName?: string;
};

export function selectedRowsToBulkInput(rows: OcrReviewRow[]): BulkQuickRow[] {
  return rows
    .filter((r) => r.selected && r.name.trim().length > 0)
    .map((r) => ({
      name: r.name.trim(),
      priceUgx: Math.max(0, Math.floor(r.priceUgx)),
      stockQty: Math.max(0, Math.floor(r.stockQty)),
      category: r.category.trim() || "General",
      inferName: r.rawLine,
    }));
}
