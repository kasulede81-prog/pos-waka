import { useEffect, useRef, useState } from "react";
import { PageBackBar } from "../components/layout/PageBackBar";
import { Camera, Keyboard, Printer, ScanLine } from "lucide-react";
import type { Language, ReceiptPaperSize } from "../types";
import { t } from "../lib/i18n";
import { usePosStore } from "../store/usePosStore";
import { printReceiptWithFallback } from "../lib/receiptPrint";
import { printElectronWindow } from "../lib/documentPrint";
import { detectBarcodeCapabilities, startBarcodeSession, stopBarcodeSession } from "../services/hardware/barcodeAdapter";
import { detectPrinterCapabilities } from "../services/hardware/printerAdapter";
import { PrinterManagementPanel } from "../components/hardware/PrinterManagementPanel";

const PAPER_OPTIONS: ReceiptPaperSize[] = ["58mm", "80mm", "a4"];

function paperLabelKey(size: ReceiptPaperSize): string {
  if (size === "58mm") return "receiptPaperSize58";
  if (size === "80mm") return "receiptPaperSize80";
  return "receiptPaperSizeA4";
}

export function HardwareSettingsPage({ lang }: { lang: Language }) {
  const preferences = usePosStore((s) => s.preferences);
  const setPreferences = usePosStore((s) => s.setPreferences);
  const [snap, setSnap] = useState<string>("");
  const [barcodeCaps] = useState(() => detectBarcodeCapabilities());
  const [printerCaps, setPrinterCaps] = useState<Awaited<ReturnType<typeof detectPrinterCapabilities>> | null>(null);
  const [scanMode, setScanMode] = useState<"hid" | "camera">("hid");
  const [scanStatus, setScanStatus] = useState<string>("Scanner idle.");
  const [scanResult, setScanResult] = useState<string>("");
  const [printingStatus, setPrintingStatus] = useState<string>("");
  const cameraRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { getHardwareCapabilitySnapshot } = await import("../services/hardware/hardwareCapabilities");
      const c = await getHardwareCapabilitySnapshot();
      if (!cancelled) setSnap(JSON.stringify(c, null, 2));
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    void detectPrinterCapabilities().then(setPrinterCaps);
  }, []);

  useEffect(() => {
    return () => {
      void stopBarcodeSession();
    };
  }, []);

  const testPrint = () => {
    const sample = [
      preferences.shopDisplayName?.trim() || "Waka POS",
      "",
      t(lang, "receiptPaperTestLine"),
      "",
      "—",
      "Waka POS",
    ].join("\n");
    setPrintingStatus("Testing printer...");
    void printReceiptWithFallback(sample, preferences.receiptPaperSize ?? "80mm").then((result) => {
      if (result.ok) {
        const msg =
          result.mode === "native"
            ? "Printed via native thermal path."
            : "Printed via browser fallback.";
        setPrintingStatus(msg);
      } else {
        setPrintingStatus(result.error ?? t(lang, "receiptPrintBlocked"));
      }
    });
  };

  const startScan = () => {
    setScanStatus("Starting barcode scanner...");
    setScanResult("");
    void startBarcodeSession(scanMode, {
      videoElement: cameraRef.current,
      onScan: (code) => {
        setScanResult(code);
        setScanStatus("Scan received.");
      },
      onError: (message) => setScanStatus(message),
    }).then((result) => {
      if (!result.ok) setScanStatus(result.error ?? "Scanner not available.");
      else if (scanMode === "hid") setScanStatus("Scanner ready. Use USB scanner now.");
      else setScanStatus("Camera scanner ready.");
    });
  };

  const stopScan = () => {
    void stopBarcodeSession().then(() => setScanStatus("Scanner stopped."));
  };

  return (
    <div className="mx-auto max-w-lg space-y-6 px-4 pb-16 pt-2">
      <PageBackBar lang={lang} fallbackTo="/settings" />
      <h1 className="text-2xl font-black text-stone-900 sm:text-3xl">{t(lang, "hardwareSettingsTitle")}</h1>
      <p className="text-sm font-medium text-stone-600">{t(lang, "hardwareSettingsSub")}</p>

      <article className="rounded-3xl border-2 border-emerald-200 bg-emerald-50/80 p-5 shadow-waka-sm">
        <div className="flex items-center gap-2">
          <Keyboard className="h-5 w-5 text-emerald-800" aria-hidden />
          <p className="text-lg font-black text-emerald-950">{t(lang, "hardwareScannerSetupTitle")}</p>
        </div>
        <p className="mt-2 text-sm font-medium text-emerald-900/90">{t(lang, "hardwareScannerSetupBody")}</p>
        <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-sm font-semibold text-emerald-950">
          <li>{t(lang, "hardwareScannerSetupStepPlug")}</li>
          <li>{t(lang, "hardwareScannerSetupStepKeyboard")}</li>
          <li>{t(lang, "hardwareScannerSetupStepAuto")}</li>
        </ol>
        <p className="mt-4 text-xs font-black uppercase tracking-wide text-emerald-800">{t(lang, "hardwareScannerStatusLabel")}</p>
        <p className="mt-1 text-sm font-bold text-emerald-950">
          {barcodeCaps.hidWedge
            ? t(lang, "hardwareScannerStatusReady")
            : barcodeCaps.cameraScan
              ? t(lang, "hardwareScannerStatusCamera")
              : t(lang, "hardwareScannerStatusUnsupported")}
        </p>
      </article>

      <article className="rounded-3xl border-2 border-waka-100 bg-white p-5 shadow-waka-sm">
        <div className="flex items-center gap-2">
          <ScanLine className="h-5 w-5 text-waka-700" aria-hidden />
          <p className="text-lg font-black text-stone-900">Barcode diagnostics</p>
        </div>
        <p className="mt-2 text-sm font-medium text-stone-600">
          Supports keyboard-wedge scanners on desktop/browser and camera scan where supported.
        </p>
        <div className="mt-3 grid grid-cols-2 gap-2 text-xs font-semibold text-stone-700">
          <p className="rounded-xl border border-stone-200 bg-stone-50 px-3 py-2">
            <Keyboard className="mr-1 inline h-3.5 w-3.5" />
            Wedge: {barcodeCaps.hidWedge ? "ready" : "unsupported"}
          </p>
          <p className="rounded-xl border border-stone-200 bg-stone-50 px-3 py-2">
            <Camera className="mr-1 inline h-3.5 w-3.5" />
            Camera: {barcodeCaps.cameraScan ? "ready" : "unsupported"}
          </p>
        </div>
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={() => setScanMode("hid")}
            className={`min-h-[42px] flex-1 rounded-xl border text-sm font-black ${scanMode === "hid" ? "border-waka-400 bg-waka-50 text-waka-900" : "border-stone-200 bg-white text-stone-700"}`}
          >
            USB scanner
          </button>
          <button
            type="button"
            onClick={() => setScanMode("camera")}
            className={`min-h-[42px] flex-1 rounded-xl border text-sm font-black ${scanMode === "camera" ? "border-waka-400 bg-waka-50 text-waka-900" : "border-stone-200 bg-white text-stone-700"}`}
          >
            Camera scanner
          </button>
        </div>
        <div className="mt-3 flex gap-2">
          <button type="button" onClick={startScan} className="min-h-[48px] flex-1 rounded-2xl bg-waka-600 py-3 text-sm font-black text-white">
            Start test scan
          </button>
          <button type="button" onClick={stopScan} className="min-h-[48px] flex-1 rounded-2xl border-2 border-stone-200 bg-white py-3 text-sm font-black text-stone-800">
            Stop
          </button>
        </div>
        {scanMode === "camera" ? (
          <video ref={cameraRef} className="mt-3 h-40 w-full rounded-2xl border border-stone-200 bg-black object-cover" />
        ) : null}
        <p className="mt-3 rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-xs font-semibold text-stone-700">
          Status: {scanStatus}
        </p>
        <p className="mt-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-black text-emerald-900">
          Last scan: {scanResult || "—"}
        </p>
      </article>

      <article className="rounded-3xl border-2 border-waka-100 bg-white p-5 shadow-waka-sm">
        <div className="flex items-center gap-2">
          <Printer className="h-5 w-5 text-waka-700" aria-hidden />
          <p className="text-lg font-black text-stone-900">{t(lang, "receiptPrintSettingsTitle")}</p>
        </div>
        <p className="mt-2 text-sm font-medium text-stone-600">{t(lang, "receiptPrintSettingsSub")}</p>
        <p className="mt-2 text-xs font-semibold text-stone-500">{t(lang, "receiptPrintAirPrintHint")}</p>
        <label className="mt-4 block text-sm font-bold text-stone-800">{t(lang, "receiptPaperSizeLabel")}</label>
        <select
          value={preferences.receiptPaperSize ?? "80mm"}
          onChange={(e) => setPreferences({ receiptPaperSize: e.target.value as ReceiptPaperSize })}
          className="mt-2 w-full rounded-2xl border-2 border-stone-200 bg-white px-4 py-3 text-base font-semibold"
        >
          {PAPER_OPTIONS.map((size) => (
            <option key={size} value={size}>
              {t(lang, paperLabelKey(size))}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={testPrint}
          className="mt-4 min-h-[48px] w-full rounded-2xl bg-waka-600 py-3 text-base font-black text-white"
        >
          {t(lang, "receiptPaperTestPrint")}
        </button>
        {printerCaps ? (
          <p className="mt-3 rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-xs font-semibold text-stone-700">
            {printerCaps.state === "SUPPORTED"
              ? t(lang, "printerStateSupported")
              : printerCaps.state === "PARTIAL"
                ? t(lang, "printerStatePartial")
                : t(lang, "printerStateUnavailable")}
            <br />
            {printerCaps.stateReason}
            <br />
            {t(lang, "printerDiagnostics")}: USB {printerCaps.usbAvailable ? "yes" : "no"} · BT{" "}
            {printerCaps.bluetoothAvailable ? "yes" : "no"} · LAN{" "}
            {printerCaps.networkAvailable ? "yes" : "no"} · {printerCaps.platform}
          </p>
        ) : null}
        {typeof window !== "undefined" && window.wakaDesktop?.print ? (
          <button
            type="button"
            className="mt-3 min-h-[44px] w-full rounded-2xl border-2 border-stone-300 bg-white py-2 text-sm font-black text-stone-800"
            onClick={() => void printElectronWindow().then((ok) => setPrintingStatus(ok ? "Electron print invoked." : "Electron print failed."))}
          >
            {t(lang, "electronPrintTest")}
          </button>
        ) : null}
        {printingStatus ? (
          <p className="mt-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-900">
            {printingStatus}
          </p>
        ) : null}
      </article>

      <PrinterManagementPanel lang={lang} />

      <div className="rounded-2xl border border-stone-200 bg-stone-50 p-4 font-mono text-xs text-stone-800">{snap || "—"}</div>
      <p className="text-xs text-stone-500">{t(lang, "hardwareSettingsStubHint")}</p>
    </div>
  );
}
