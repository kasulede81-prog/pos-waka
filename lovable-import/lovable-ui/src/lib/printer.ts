// Thermal printer (ESC/POS over Web Bluetooth) + browser print fallback.
// Works on Chrome/Edge Android & desktop. On iOS Safari (no Web Bluetooth),
// falls back to a print-friendly window the user can print to any printer.

import { formatUGX, type Sale, type ShopProfile } from "./pos-store";

export type PaperWidth = 58 | 80;

export interface PrinterSettings {
  width: PaperWidth;
  header?: string;
  footer?: string;
  deviceName?: string;
  autoPrint: boolean;
}

const KEY = "waka.printer.settings";

export function loadPrinterSettings(): PrinterSettings {
  if (typeof window === "undefined") return { width: 58, autoPrint: false };
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) return { width: 58, autoPrint: false, ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  return { width: 58, autoPrint: false };
}

export function savePrinterSettings(s: PrinterSettings) {
  window.localStorage.setItem(KEY, JSON.stringify(s));
}

export function isBluetoothSupported(): boolean {
  return typeof navigator !== "undefined" && !!(navigator as any).bluetooth;
}

// ---------- ESC/POS builder ----------
const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

function pad(left: string, right: string, cols: number): string {
  const l = left.slice(0, cols);
  const r = right.slice(0, cols);
  const spaces = Math.max(1, cols - l.length - r.length);
  return l + " ".repeat(spaces) + r;
}

function wrap(text: string, cols: number): string[] {
  const out: string[] = [];
  for (const line of text.split("\n")) {
    if (line.length <= cols) {
      out.push(line);
    } else {
      for (let i = 0; i < line.length; i += cols) out.push(line.slice(i, i + cols));
    }
  }
  return out;
}

export function buildEscPos(sale: Sale, profile: ShopProfile, settings: PrinterSettings): Uint8Array {
  const cols = settings.width === 80 ? 42 : 32;
  const bytes: number[] = [];
  const enc = new TextEncoder();
  const push = (b: number | number[]) => {
    if (Array.isArray(b)) bytes.push(...b);
    else bytes.push(b);
  };
  const text = (s: string) => {
    for (const byte of enc.encode(s)) bytes.push(byte);
  };
  const line = (s = "") => {
    text(s);
    push(LF);
  };

  // init
  push([ESC, 0x40]);
  // codepage CP437
  push([ESC, 0x74, 0x00]);

  // Header centered, double size
  push([ESC, 0x61, 0x01]); // center
  push([GS, 0x21, 0x11]); // double w+h
  if (profile.shopName) line(profile.shopName);
  push([GS, 0x21, 0x00]); // normal
  if (profile.phone) line(profile.phone);
  if (settings.header) for (const l of wrap(settings.header, cols)) line(l);
  push([ESC, 0x61, 0x00]); // left
  line("-".repeat(cols));

  // Meta
  const d = new Date(sale.createdAt);
  line(`Receipt: ${sale.id.slice(0, 8)}`);
  line(`Date:    ${d.toLocaleString("en-UG", { dateStyle: "short", timeStyle: "short" })}`);
  if (sale.customerName) line(`Cust:    ${sale.customerName}`);
  line(`Method:  ${sale.method.toUpperCase()}`);
  line("-".repeat(cols));

  // Items
  for (const it of sale.items) {
    const nameLines = wrap(it.name, cols);
    line(nameLines[0]);
    for (let i = 1; i < nameLines.length; i++) line(nameLines[i]);
    line(pad(`  ${it.qty} x ${formatUGX(it.price)}`, formatUGX(it.price * it.qty), cols));
  }
  line("-".repeat(cols));

  // Total
  push([GS, 0x21, 0x01]); // double height
  line(pad("TOTAL", formatUGX(sale.total), cols));
  push([GS, 0x21, 0x00]);

  // Footer
  if (settings.footer) {
    line("");
    push([ESC, 0x61, 0x01]);
    for (const l of wrap(settings.footer, cols)) line(l);
    push([ESC, 0x61, 0x00]);
  } else {
    line("");
    push([ESC, 0x61, 0x01]);
    line("Asante! Webale!");
    push([ESC, 0x61, 0x00]);
  }

  // Feed + cut
  push([LF, LF, LF, LF]);
  push([GS, 0x56, 0x00]); // full cut

  return new Uint8Array(bytes);
}

// ---------- Bluetooth printing ----------
// Common ESC/POS BT printer services (Nyrius, Goojprt, Xprinter, MTP, etc.)
const SERVICE_UUIDS = [
  0x1101, // SPP-like
  0x18f0, // common ESC/POS
  "000018f0-0000-1000-8000-00805f9b34fb",
  "49535343-fe7d-4ae5-8fa9-9fafd205e455",
  "e7810a71-73ae-499d-8c15-faa9aef0c3f2",
];

interface BTConn {
  device: any;
  char: any;
}

let cached: BTConn | null = null;

async function findWritableChar(server: any): Promise<any | null> {
  let services: any[] = [];
  try {
    services = await server.getPrimaryServices();
  } catch {
    services = [];
  }
  for (const svc of services) {
    try {
      const chars = await svc.getCharacteristics();
      for (const c of chars) {
        if (c.properties.write || c.properties.writeWithoutResponse) return c;
      }
    } catch {
      /* skip */
    }
  }
  return null;
}

export async function connectBluetoothPrinter(): Promise<{ name?: string }> {
  if (!isBluetoothSupported()) throw new Error("Bluetooth not supported on this device.");
  const bt = (navigator as any).bluetooth;
  const device = await bt.requestDevice({
    acceptAllDevices: true,
    optionalServices: SERVICE_UUIDS,
  });
  const server = await device.gatt.connect();
  const char = await findWritableChar(server);
  if (!char) {
    try {
      device.gatt.disconnect();
    } catch {
      /* ignore */
    }
    throw new Error("No printable characteristic found on this device.");
  }
  cached = { device, char };
  device.addEventListener?.("gattserverdisconnected", () => {
    cached = null;
  });
  return { name: device.name ?? "Printer" };
}

export function disconnectBluetoothPrinter() {
  try {
    cached?.device?.gatt?.disconnect();
  } catch {
    /* ignore */
  }
  cached = null;
}

export function isPrinterConnected(): boolean {
  return !!cached?.device?.gatt?.connected;
}

async function ensureConnected(): Promise<BTConn> {
  if (cached?.device?.gatt?.connected && cached.char) return cached;
  if (cached?.device) {
    const server = await cached.device.gatt.connect();
    const char = await findWritableChar(server);
    if (char) {
      cached = { device: cached.device, char };
      return cached;
    }
  }
  throw new Error("Printer not connected. Connect it in Settings first.");
}

export async function printViaBluetooth(payload: Uint8Array): Promise<void> {
  const { char } = await ensureConnected();
  // Many BLE stacks cap writes around 100-180 bytes. Use 100 to be safe.
  const CHUNK = 100;
  for (let i = 0; i < payload.length; i += CHUNK) {
    const slice = payload.slice(i, i + CHUNK);
    if (char.writeValueWithoutResponse) {
      await char.writeValueWithoutResponse(slice);
    } else {
      await char.writeValue(slice);
    }
    // small breather for cheaper modules
    await new Promise((r) => setTimeout(r, 20));
  }
}

// ---------- Browser print fallback ----------
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!),
  );
}

export function printViaBrowser(sale: Sale, profile: ShopProfile, settings: PrinterSettings) {
  const widthMm = settings.width === 80 ? 80 : 58;
  const d = new Date(sale.createdAt);
  const itemsHtml = sale.items
    .map(
      (i) => `
        <tr>
          <td>${escapeHtml(i.name)}<br/><small>${i.qty} × ${escapeHtml(formatUGX(i.price))}</small></td>
          <td class="r">${escapeHtml(formatUGX(i.price * i.qty))}</td>
        </tr>`,
    )
    .join("");

  const html = `<!doctype html><html><head><meta charset="utf-8"/>
<title>Receipt ${sale.id.slice(0, 8)}</title>
<style>
  @page { size: ${widthMm}mm auto; margin: 2mm; }
  * { box-sizing: border-box; }
  body { font-family: ui-monospace, "Menlo", monospace; font-size: 11px; width: ${widthMm}mm; margin: 0; padding: 2mm; color: #000; }
  h1 { font-size: 14px; text-align: center; margin: 0 0 2px; }
  .meta, .head { text-align: center; margin-bottom: 4px; }
  table { width: 100%; border-collapse: collapse; }
  td { vertical-align: top; padding: 2px 0; }
  .r { text-align: right; }
  .sep { border-top: 1px dashed #000; margin: 4px 0; }
  .total { font-size: 14px; font-weight: 800; }
  .foot { text-align: center; margin-top: 6px; }
  small { color: #555; }
</style></head><body>
  ${profile.shopName ? `<h1>${escapeHtml(profile.shopName)}</h1>` : ""}
  ${profile.phone ? `<div class="head">${escapeHtml(profile.phone)}</div>` : ""}
  ${settings.header ? `<div class="head">${escapeHtml(settings.header)}</div>` : ""}
  <div class="sep"></div>
  <div class="meta">
    Receipt ${sale.id.slice(0, 8)}<br/>
    ${escapeHtml(d.toLocaleString("en-UG", { dateStyle: "short", timeStyle: "short" }))}<br/>
    ${sale.customerName ? escapeHtml(sale.customerName) + "<br/>" : ""}
    ${sale.method.toUpperCase()}
  </div>
  <div class="sep"></div>
  <table>${itemsHtml}</table>
  <div class="sep"></div>
  <table><tr><td class="total">TOTAL</td><td class="r total">${escapeHtml(formatUGX(sale.total))}</td></tr></table>
  <div class="foot">${escapeHtml(settings.footer || "Asante! Webale!")}</div>
  <script>window.onload = () => { window.print(); setTimeout(() => window.close(), 500); };</script>
</body></html>`;

  const w = window.open("", "_blank", "width=380,height=640");
  if (!w) {
    alert("Pop-up blocked. Allow pop-ups to print receipts.");
    return;
  }
  w.document.open();
  w.document.write(html);
  w.document.close();
}

// ---------- Unified entry ----------
export async function printReceipt(
  sale: Sale,
  profile: ShopProfile,
  settings: PrinterSettings = loadPrinterSettings(),
): Promise<"bluetooth" | "browser"> {
  if (isPrinterConnected()) {
    try {
      const bytes = buildEscPos(sale, profile, settings);
      await printViaBluetooth(bytes);
      return "bluetooth";
    } catch (err) {
      console.warn("[printer] bluetooth print failed, falling back to browser", err);
    }
  }
  printViaBrowser(sale, profile, settings);
  return "browser";
}
