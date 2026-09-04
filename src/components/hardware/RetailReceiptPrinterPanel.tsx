import { useState } from "react";
import { Bluetooth, Printer } from "lucide-react";
import type { Language, PrinterProfile } from "../../types";
import { t } from "../../lib/i18n";
import { usePosStore } from "../../store/usePosStore";
import { useSessionActor } from "../../context/SessionActorContext";
import { actorHasPermission } from "../../lib/actorAuthorization";
import { bindBluetoothDeviceToReceiptPrinterInput, resolveDefaultReceiptPrinter } from "../../lib/printerRegistry";
import { disconnectNativeBluetoothPrinter } from "../../lib/nativeBluetoothPrinter";
import type { NativeBluetoothDeviceRow, NativeClassicDiagnostic } from "../../lib/nativeBluetoothPrinter";
import { BluetoothPrinterFinder } from "./BluetoothPrinterFinder";
import { ClassicSppDiagnosticPanel } from "./ClassicSppDiagnosticPanel";

function hardwareMutationDeniedStatus(lang: Language, errorKey?: string): string {
  if (errorKey === "forbidden" || errorKey === "noSelection") {
    return t(lang, "hardwareOwnerMustSavePrinter");
  }
  return t(lang, "invalid");
}

export function RetailReceiptPrinterPanel({ lang }: { lang: Language }) {
  const preferences = usePosStore((s) => s.preferences);
  const upsertPrinter = usePosStore((s) => s.upsertPrinter);
  const testConfiguredPrinter = usePosStore((s) => s.testConfiguredPrinter);
  const actor = useSessionActor();
  const canSave = actorHasPermission(actor, "settings.devices");

  const printer = resolveDefaultReceiptPrinter(preferences);
  const configured = Boolean(printer?.pairedDeviceKey && printer.connectionType === "bluetooth");

  const [changing, setChanging] = useState(false);
  const [status, setStatus] = useState("");
  const [classicDiagnostic, setClassicDiagnostic] = useState<NativeClassicDiagnostic | null>(null);

  const persistDevice = (device: NativeBluetoothDeviceRow) => {
    if (!canSave) {
      setStatus(t(lang, "hardwareOwnerMustSavePrinter"));
      return;
    }
    const input = bindBluetoothDeviceToReceiptPrinterInput(printer ?? undefined, device, printer?.paperWidth ?? "58mm");
    const result = upsertPrinter(input);
    if (!result.ok) {
      setStatus(hardwareMutationDeniedStatus(lang, result.errorKey));
      return;
    }
    setChanging(false);
    setStatus(`${device.name} ${t(lang, "hardwarePrinterConfiguredReady")}`);
  };

  const updatePaper = (paperWidth: "58mm" | "80mm") => {
    if (!printer) return;
    const result = upsertPrinter({
      id: printer.id,
      name: printer.name,
      connectionType: printer.connectionType,
      paperWidth,
      stationRoles: printer.stationRoles.includes("receipt") ? printer.stationRoles : ["receipt"],
      isDefaultReceipt: true,
      pairedDeviceKey: printer.pairedDeviceKey,
      bluetoothTransport: printer.bluetoothTransport,
      pairedDeviceName: printer.pairedDeviceName,
      networkHost: printer.networkHost,
      networkPort: printer.networkPort,
    });
    if (!result.ok) setStatus(hardwareMutationDeniedStatus(lang, result.errorKey));
  };

  const disconnect = () => {
    if (!printer) return;
    void disconnectNativeBluetoothPrinter(printer.pairedDeviceKey ?? undefined);
    const result = upsertPrinter({
      id: printer.id,
      name: printer.name,
      connectionType: printer.connectionType,
      paperWidth: printer.paperWidth,
      stationRoles: printer.stationRoles,
      isDefaultReceipt: printer.isDefaultReceipt,
      pairedDeviceKey: null,
      bluetoothTransport: null,
      pairedDeviceName: null,
    });
    if (!result.ok) {
      setStatus(hardwareMutationDeniedStatus(lang, result.errorKey));
      return;
    }
    setChanging(true);
    setClassicDiagnostic(null);
    setStatus(t(lang, "hardwarePrinterNotConfigured"));
  };

  const runTest = (profile: PrinterProfile) => {
    setStatus(t(lang, "hardwareTestConnecting"));
    setClassicDiagnostic(null);
    void testConfiguredPrinter(profile.id).then((result) => {
      if (result.diagnostic) setClassicDiagnostic(result.diagnostic);
      if (result.ok) {
        setStatus(`✓ ${t(lang, "hardwareTestSentTo")} ${profile.pairedDeviceName || profile.name}`);
      } else {
        setStatus(`✕ ${t(lang, "hardwareTestCouldNotPrint")}\n${result.error ?? t(lang, "hardwarePrinterTestFail")}`);
      }
    });
  };

  return (
    <article className="rounded-3xl border-2 border-border bg-card p-5 shadow-waka-sm">
      <div className="flex items-center gap-2">
        <Printer className="h-5 w-5 text-foreground" aria-hidden />
        <p className="text-lg font-black text-foreground">{t(lang, "hardwareReceiptPrinterTitle")}</p>
      </div>
      <p className="mt-2 text-sm font-medium text-muted-foreground">{t(lang, "hardwareReceiptPrinterSub")}</p>

      <div className="mt-4 flex items-center gap-2 text-sm font-black text-foreground">
        <Bluetooth className="h-4 w-4" aria-hidden />
        Bluetooth
      </div>

      {configured && printer ? (
        <div className="mt-3 rounded-2xl border-2 border-emerald-200 bg-emerald-50 px-4 py-3">
          <p className="text-base font-black text-emerald-950">{printer.pairedDeviceName || printer.name}</p>
          {printer.pairedDeviceName && printer.name !== printer.pairedDeviceName ? (
            <p className="text-xs font-semibold text-emerald-900">{printer.name}</p>
          ) : null}
          <p className="mt-1 text-sm font-bold text-emerald-800">{t(lang, "hardwarePrinterConfiguredReady")}</p>
        </div>
      ) : (
        <p className="mt-3 text-sm font-semibold text-muted-foreground">{t(lang, "hardwarePrinterNotConfigured")}</p>
      )}

      {configured && printer && changing === false ? (
        <div className="mt-4 space-y-3">
          <button
            type="button"
            className="min-h-[48px] w-full rounded-2xl bg-waka-600 py-3 text-base font-black text-white"
            onClick={() => runTest(printer)}
          >
            {t(lang, "hardwareTestPrinter")}
          </button>
          <label className="block text-sm font-bold text-foreground">
            {t(lang, "hardwarePrinterPaper")}
            <select
              className="mt-1 w-full rounded-xl border-2 border-border px-3 py-2 font-semibold"
              value={printer.paperWidth}
              onChange={(e) => updatePaper(e.target.value as "58mm" | "80mm")}
            >
              <option value="58mm">58 mm</option>
              <option value="80mm">80 mm</option>
            </select>
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="min-h-[44px] flex-1 rounded-2xl border-2 border-border px-4 py-2 text-sm font-black"
              onClick={() => setChanging(true)}
            >
              {t(lang, "hardwareChangePrinter")}
            </button>
            <button
              type="button"
              className="min-h-[44px] flex-1 rounded-2xl border-2 border-border px-4 py-2 text-sm font-black"
              onClick={disconnect}
            >
              {t(lang, "hardwareDisconnectPrinter")}
            </button>
          </div>
        </div>
      ) : (
        <BluetoothPrinterFinder
          selectedId={printer?.pairedDeviceKey ?? null}
          onSelect={(device) => {
            if (device) persistDevice(device);
          }}
          onStatus={setStatus}
        />
      )}

      {status ? (
        <p className="mt-3 whitespace-pre-line rounded-xl border border-border bg-muted px-3 py-2 text-sm font-bold text-foreground">
          {status}
        </p>
      ) : null}
      {classicDiagnostic ? <ClassicSppDiagnosticPanel diagnostic={classicDiagnostic} /> : null}
    </article>
  );
}
