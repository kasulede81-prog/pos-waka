import { useEffect, useMemo, useState } from "react";
import { Bluetooth, Loader2 } from "lucide-react";
import {
  connectNativeBluetoothPrinter,
  isNativeBluetoothPrinterPlatform,
  listPairedBluetoothPrinterDevices,
  pairNativeBluetoothPrinter,
  requestNativeBluetoothPermissions,
  scanBluetoothPrinterDevices,
  stopBluetoothPrinterScan,
  type NativeBluetoothDeviceRow,
} from "../../lib/nativeBluetoothPrinter";
import { bluetoothDeviceLooksLikePrinter } from "../../lib/bluetoothPrinterHeuristics";
import { mapNativeBluetoothPrinterError } from "../../lib/bluetoothPrinterHeuristics";
import { isWebBluetoothAvailable, requestWebBluetoothPrinter, CLASSIC_CHOOSER_HINT, CLASSIC_CHROME_CHOOSER_ERROR } from "../../lib/webBluetoothPrinter";

type FilterMode = "likely" | "all";

type Props = {
  selectedId: string | null;
  onSelect: (device: NativeBluetoothDeviceRow | null) => void;
  onStatus: (text: string) => void;
};

export function BluetoothPrinterFinder({ selectedId, onSelect, onStatus }: Props) {
  const native = isNativeBluetoothPrinterPlatform();
  const webBle = !native && isWebBluetoothAvailable();
  const [filter, setFilter] = useState<FilterMode>("likely");
  const [scanning, setScanning] = useState(false);
  const [devices, setDevices] = useState<NativeBluetoothDeviceRow[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      void stopBluetoothPrinterScan();
    };
  }, []);

  const visible = useMemo(() => {
    const rows = devices.map((d) => ({
      ...d,
      likelyPrinter: d.likelyPrinter || bluetoothDeviceLooksLikePrinter(d.name, d.majorClass),
    }));
    if (filter === "all") return rows;
    const likely = rows.filter((d) => d.likelyPrinter);
    return likely.length ? likely : rows;
  }, [devices, filter]);

  const merge = (rows: NativeBluetoothDeviceRow[]) => {
    setDevices((prev) => {
      const map = new Map(prev.map((d) => [d.id, d]));
      for (const d of rows) map.set(d.id, d);
      return [...map.values()];
    });
  };

  const findNative = async () => {
    setScanning(true);
    onStatus("Scanning…");
    try {
      const perms = await requestNativeBluetoothPermissions();
      if (perms && !perms.enabled) {
        onStatus("Bluetooth is disabled.");
        setScanning(false);
        return;
      }
      if (perms && (!perms.connectPermission || !perms.scanPermission)) {
        onStatus("Bluetooth permission is required.");
        setScanning(false);
        return;
      }
      const paired = await listPairedBluetoothPrinterDevices();
      merge(paired);
      const scanned = await scanBluetoothPrinterDevices(12000);
      merge(scanned);
      onStatus(
        paired.length + scanned.length
          ? "Select a printer-compatible device from the list."
          : "No Bluetooth devices found. Pair the printer in Android Bluetooth settings, then scan again.",
      );
    } catch (err) {
      onStatus(mapNativeBluetoothPrinterError(undefined, err instanceof Error ? err.message : String(err)));
    } finally {
      setScanning(false);
    }
  };

  const findWebBle = async (acceptAllBle = false) => {
    setScanning(true);
    onStatus("Find BLE device…");
    const result = await requestWebBluetoothPrinter({ acceptAllBle });
    setScanning(false);
    if (!result.ok) {
      onStatus(result.error);
      return;
    }
    merge([
      {
        id: result.device.id,
        name: result.device.name,
        transport: "ble",
        bonded: true,
        likelyPrinter: result.device.likelyPrinter,
      },
    ]);
    onSelect(result.device);
    const writable = result.device.diagnostics?.writableCharacteristic ?? "none";
    onStatus(`BLE printer characteristic found (${writable}). Test print will send ESC/POS.`);
  };

  const useDevice = async (device: NativeBluetoothDeviceRow) => {
    setBusyId(device.id);
    const paired = await pairNativeBluetoothPrinter(device.id);
    if (!paired.ok && paired.code !== "permission_denied") {
      /* System pairing may still be in progress; try connect anyway. */
    }
    const connected = await connectNativeBluetoothPrinter(
      device.id,
      device.transport === "ble" ? "ble" : "classic",
    );
    setBusyId(null);
    if (!connected.ok) {
      onStatus(connected.error);
      return;
    }
    onSelect(device);
    onStatus(`Connected: ${device.name}`);
  };

  if (!native && !webBle) {
    return (
      <div className="mt-3 space-y-2 rounded-2xl border-2 border-amber-200 bg-amber-50 p-3">
        <p className="text-sm font-black text-amber-950">Bluetooth printing is not available in this browser.</p>
        <p className="text-xs font-semibold text-amber-900">
          Bluetooth Classic printers require the WAKA Android app. On iPhone/iPad, use a network printer with the WAKA
          desktop app, or another supported local bridge.
        </p>
      </div>
    );
  }

  if (webBle) {
    return (
      <div className="mt-3 space-y-3 rounded-2xl border-2 border-sky-200 bg-sky-50/70 p-3">
        <div className="flex items-center gap-2">
          <Bluetooth className="h-4 w-4 text-sky-800" aria-hidden />
          <p className="text-sm font-black text-sky-950">Bluetooth LE</p>
        </div>
        <p className="text-xs font-semibold text-sky-900">
          {CLASSIC_CHROME_CHOOSER_ERROR} {CLASSIC_CHOOSER_HINT}
        </p>
        <p className="text-xs font-semibold text-sky-900">
          Find BLE printer only if this unit is Bluetooth LE. Chrome cannot see Classic/SPP printers.
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={scanning}
            onClick={() => void findWebBle(false)}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-sky-800 px-4 text-xs font-black text-white disabled:opacity-50"
          >
            {scanning ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Find BLE printer
          </button>
          <button
            type="button"
            disabled={scanning}
            onClick={() => void findWebBle(true)}
            className="inline-flex min-h-[44px] items-center rounded-xl border-2 border-sky-800 px-4 text-xs font-black text-sky-900 disabled:opacity-50"
          >
            Show all BLE devices
          </button>
        </div>
        {selectedId ? (
          <p className="text-xs font-black text-sky-950">Selected BLE device saved on this profile. Test print sends ESC/POS only if a writable printer characteristic was found.</p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="mt-3 space-y-3 rounded-2xl border-2 border-sky-200 bg-sky-50/70 p-3">
      <div className="flex items-center gap-2">
        <Bluetooth className="h-4 w-4 text-sky-800" aria-hidden />
        <p className="text-sm font-black text-sky-950">Bluetooth Classic + BLE</p>
      </div>
      <p className="text-xs font-semibold text-sky-900">
        Choose how this printer is connected, then find a device. Printer-compatible devices are hinted; you can still
        open All devices.
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={scanning}
          onClick={() => void findNative()}
          className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-sky-800 px-4 text-xs font-black text-white disabled:opacity-50"
        >
          {scanning ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {scanning ? "Scanning…" : "Find Bluetooth device"}
        </button>
        <button
          type="button"
          onClick={() => setFilter("likely")}
          className={`rounded-xl px-3 py-2 text-[11px] font-black uppercase ${
            filter === "likely" ? "bg-sky-800 text-white" : "bg-card text-muted-foreground"
          }`}
        >
          Printer-compatible devices
        </button>
        <button
          type="button"
          onClick={() => setFilter("all")}
          className={`rounded-xl px-3 py-2 text-[11px] font-black uppercase ${
            filter === "all" ? "bg-sky-800 text-white" : "bg-card text-muted-foreground"
          }`}
        >
          Bluetooth devices
        </button>
      </div>
      {visible.length === 0 ? (
        <p className="text-xs font-semibold text-sky-900">
          Tap Find Bluetooth device. Phones and speakers may appear under Bluetooth devices — they are not receipt
          printers.
        </p>
      ) : (
        <ul className="space-y-2">
          {visible.map((d) => (
            <li
              key={d.id}
              className={`rounded-xl border px-3 py-2 ${
                selectedId === d.id ? "border-sky-700 bg-white" : "border-sky-200 bg-white/80"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-black text-foreground">{d.name}</p>
                  <p className="text-[11px] font-semibold text-muted-foreground">
                    {d.transport === "ble" ? "BLE" : "Classic / SPP"}
                    {d.bonded ? " · paired" : " · not paired"}
                    {d.likelyPrinter ? " · printer-compatible" : ""}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={busyId === d.id}
                  onClick={() => void useDevice(d)}
                  className="shrink-0 rounded-lg bg-foreground px-3 py-1.5 text-[11px] font-black text-background disabled:opacity-50"
                >
                  {selectedId === d.id ? "Selected" : "Use this printer"}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
