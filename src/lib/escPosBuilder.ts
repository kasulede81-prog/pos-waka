/**
 * ESC/POS byte builder — Epson-compatible commands for thermal printers.
 * Character-column model (58 mm = 32 cols, 80 mm = 42). Not a raster page.
 */

import { encodeEscPosCp437Bytes } from "./escPosCp437";

export type EscPosPaperWidth = "58mm" | "80mm";

/** 58 mm tear-off printers must not pretend they have a cutter. */
export type EscPosFinishMode = "feed" | "partial-cut";

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

export function columnsForWidth(width: EscPosPaperWidth): number {
  return width === "80mm" ? 42 : 32;
}

export function defaultFinishForWidth(width: EscPosPaperWidth): EscPosFinishMode {
  return width === "58mm" ? "feed" : "partial-cut";
}

/** Single line, never longer than `cols`. Right (money) is kept; left shrinks if needed. */
export function padColumns(left: string, right: string, cols: number): string {
  const width = Math.max(1, cols);
  const r = right.length > width ? right.slice(0, width) : right;
  const room = width - r.length;
  const l = left.length > room ? left.slice(0, room) : left;
  return l + " ".repeat(width - l.length - r.length) + r;
}

export function wrapText(text: string, cols: number): string[] {
  const width = Math.max(1, cols);
  const out: string[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    if (line.length <= width) {
      out.push(line);
      continue;
    }
    let remaining = line;
    while (remaining.length > width) {
      let breakAt = remaining.lastIndexOf(" ", width);
      if (breakAt <= 0) breakAt = width;
      out.push(remaining.slice(0, breakAt).trimEnd());
      remaining = remaining.slice(breakAt).trimStart();
    }
    if (remaining.length) out.push(remaining);
  }
  return out;
}

/** Left/right pair that wraps instead of clipping when both sides cannot fit. */
export function alignColumns(left: string, right: string, cols: number): string[] {
  const width = Math.max(1, cols);
  if (right.length > width) {
    return [...(left ? wrapText(left, width) : []), ...wrapText(right, width)];
  }
  if (left.length + right.length <= width) {
    return [padColumns(left, right, width)];
  }
  const wrapped = wrapText(left, width);
  const last = wrapped[wrapped.length - 1] ?? "";
  if (last.length + (right.length > 0 ? 1 : 0) + right.length <= width) {
    return [...wrapped.slice(0, -1), padColumns(last, right, width)];
  }
  return [...wrapped, padColumns("", right, width)];
}

export class EscPosBuilder {
  private bytes: number[] = [];
  readonly cols: number;
  readonly finishMode: EscPosFinishMode;

  constructor(width: EscPosPaperWidth = "80mm", opts?: { finish?: EscPosFinishMode }) {
    this.cols = columnsForWidth(width);
    this.finishMode = opts?.finish ?? defaultFinishForWidth(width);
    this.init();
  }

  private push(...vals: number[]) {
    this.bytes.push(...vals);
  }

  init() {
    this.push(ESC, 0x40);
    this.push(ESC, 0x74, 0x00); // PC437
    return this;
  }

  align(mode: "left" | "center" | "right") {
    const code = mode === "center" ? 1 : mode === "right" ? 2 : 0;
    this.push(ESC, 0x61, code);
    return this;
  }

  bold(on = true) {
    this.push(ESC, 0x45, on ? 1 : 0);
    return this;
  }

  doubleSize(on = true) {
    this.push(GS, 0x21, on ? 0x11 : 0x00);
    return this;
  }

  textLine(line = "") {
    for (const byte of encodeEscPosCp437Bytes(line)) this.bytes.push(byte);
    this.push(LF);
    return this;
  }

  textLines(lines: string[]) {
    for (const line of lines) this.textLine(line);
    return this;
  }

  aligned(left: string, right: string) {
    return this.textLines(alignColumns(left, right, this.cols));
  }

  rule(char = "-") {
    return this.textLine(char.repeat(this.cols));
  }

  wrapped(text: string) {
    return this.textLines(wrapText(text, this.cols));
  }

  feed(lines = 4) {
    this.push(ESC, 0x64, Math.min(255, Math.max(0, lines)));
    return this;
  }

  partialCut() {
    this.push(GS, 0x56, 0x42, 0x03);
    return this;
  }

  /** Content-dependent finish: feed, plus partial-cut only when configured. */
  finalize(feedLines = 4) {
    this.feed(feedLines);
    if (this.finishMode === "partial-cut") this.partialCut();
    return this;
  }

  /** Standard ESC/POS drawer kick on pin 2 (most receipt printers). */
  kickDrawer() {
    this.push(ESC, 0x70, 0x00, 0x19, 0xfa);
    return this;
  }

  /** QR placeholder — prints scan hint until native QR command is wired per vendor. */
  qrPlaceholder(label = "Scan to pay") {
    this.align("center");
    this.textLine(`[ ${label} ]`);
    this.textLine("(QR)");
    this.align("left");
    return this;
  }

  build(): Uint8Array {
    return new Uint8Array(this.bytes);
  }
}

export function buildTestEscPos(width: EscPosPaperWidth, lines: string[]): Uint8Array {
  const b = new EscPosBuilder(width);
  b.align("center").doubleSize(true).textLine("WAKA POS").doubleSize(false);
  b.align("left").rule();
  b.textLines(lines);
  b.rule().finalize();
  return b.build();
}
