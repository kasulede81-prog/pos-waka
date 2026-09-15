/**
 * ESC/POS byte builder — Epson-compatible commands for thermal printers.
 * Works with WebUSB / Web Bluetooth adapters and future native bridges.
 */

export type EscPosPaperWidth = "58mm" | "80mm";

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

export function columnsForWidth(width: EscPosPaperWidth): number {
  return width === "80mm" ? 42 : 32;
}

export function padColumns(left: string, right: string, cols: number): string {
  const l = left.slice(0, cols);
  const r = right.slice(0, cols);
  const spaces = Math.max(1, cols - l.length - r.length);
  return l + " ".repeat(spaces) + r;
}

export function wrapText(text: string, cols: number): string[] {
  const out: string[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    if (line.length <= cols) {
      out.push(line);
      continue;
    }
    for (let i = 0; i < line.length; i += cols) out.push(line.slice(i, i + cols));
  }
  return out;
}

export class EscPosBuilder {
  private bytes: number[] = [];
  private encoder = new TextEncoder();
  readonly cols: number;

  constructor(width: EscPosPaperWidth = "80mm") {
    this.cols = columnsForWidth(width);
    this.init();
  }

  private push(...vals: number[]) {
    this.bytes.push(...vals);
  }

  init() {
    this.push(ESC, 0x40);
    this.push(ESC, 0x74, 0x00);
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
    for (const byte of this.encoder.encode(line)) this.bytes.push(byte);
    this.push(LF);
    return this;
  }

  textLines(lines: string[]) {
    for (const line of lines) this.textLine(line);
    return this;
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
  b.rule().feed(4).partialCut();
  return b.build();
}
