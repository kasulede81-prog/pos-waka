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
import {
  bluetoothDeviceLooksLikePrinter,
  formatBluetoothDeviceId,
  mapNativeBluetoothPrinterError,
  parseBluetoothDeviceId,
  partitionBluetoothDiscovery,
} from "../../lib/bluetoothPrinterHeuristics";
import { formatClassicSppDiagnostic } from "../../lib/nativeBluetoothPrinter";
import {
  isWebBluetoothAvailable,
  requestWebBluetoothPrinter,
  CLASSIC_CHOOSER_HINT,
  CLASSIC_CHROME_CHOOSER_ERROR,
} from "../../lib/webBluetoothPrinter";
import { getPlatform } from "../../platform/detect";

type Props = {
  selectedId: string | null;
  onSelect: (device: NativeBluetoothDeviceRow | null) => void;
  onStatus: (text: string) => void;
};

function DeviceRow({
  device,
  selectedId,
  busyId,
  onUse,
  onUseClassic,
}: {
  device: NativeBluetoothDeviceRow;
  selectedId: string | null;
  busyId: string | null;
  onUse: (device: NativeBluetoothDeviceRow) => void;
  onUseClassic?: (device: NativeBluetoothDeviceRow) => void;
}) {
  const likely = device.likelyPrinter || bluetoothDeviceLooksLikePrinter(device.name, device.majorClass);
  const parsed = parseBluetoothDeviceId(device.id);
  const classicId = parsed ? `classic:${parsed.address}` : null;
  const selected = selectedId === device.id || (classicId != null && selectedId === classicId);
  return (
    <li
      className={`rounded-xl border px-3 py-2 ${
        selected ? "border-sky-700 bg-white" : "border-sky-200 bg-white/80"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-black text-foreground">{device.name}</p>
          <p className="text-[11px] font-semibold text-muted-foreground">
            {device.transport === "ble" ? "Bluetooth LE" : "Bluetooth Classic / SPP"}
            {device.bonded ? " · paired" : ""}
            {likely ? " · Likely printer" : " · Bluetooth device"}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-stretch gap-1">
          <button
            type="button"
            disabled={busyId === device.id}
            onClick={() => onUse(device)}
            className="rounded-lg bg-foreground px-3 py-1.5 text-[11px] font-black text-background disabled:opacity-50"
          >
            {selected && device.transport !== "ble" ? "Selected" : "Use this printer"}
          </button>
          {device.transport === "ble" && onUseClassic ? (
            <button
              type="button"
              disabled={busyId === device.id}
              onClick={() => onUseClassic(device)}
              className="rounded-lg border border-sky-800 px-3 py-1.5 text-[11px] font-black text-sky-900 disabled:opacity-50"
            >
              Use as Classic / SPP
            </button>
          ) : null}
        </div>
      </div>
    </li>
  );
}

export function BluetoothPrinterFinder({ selectedId, onSelect, onStatus }: Props) {
  const native = isNativeBluetoothPrinterPlatform();
  const electron = getPlatform() === "desktop";
  const webBle = !native && !electron && isWebBluetoothAvailable();
  const [scanning, setScanning] = useState(false);
  const [devices, setDevices] = useState<NativeBluetoothDeviceRow[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      void stopBluetoothPrinterScan();
    };
  }, []);

  useEffect(() => {
    if (!native) return;
    void loadPaired();
    // Load bonded printers as soon as Bluetooth is selected — they may not be advertising.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only for native finder
  }, [native]);

  const { paired, nearby } = useMemo(() => partitionBluetoothDiscovery(devices), [devices]);

  const merge = (rows: NativeBluetoothDeviceRow[]) => {
    setDevices((prev) => {
      const map = new Map(prev.map((d) => [d.id, d]));
      for (const d of rows) map.set(d.id, d);
      return [...map.values()];
    });
  };

  const loadPaired = async () => {
    try {
      const perms = await requestNativeBluetoothPermissions();
      if (perms && !perms.enabled) {
        onStatus("Turn on Bluetooth to connect a printer.");
        return;
      }
      if (perms && (!perms.connectPermission || !perms.scanPermission)) {
        onStatus("Bluetooth permission is required to find printers.");
        return;
      }
      const listed = await listPairedBluetoothPrinterDevices();
      merge(listed);
      if (listed.length) {
        onStatus("Select a paired printer, or find nearby devices.");
      }
    } catch (err) {
      onStatus(mapNativeBluetoothPrinterError(undefined, err instanceof Error ? err.message : String(err)));
    }
  };

  const findNative = async () => {
    setScanning(true);
    onStatus("Scanning…");
    try {
      const perms = await requestNativeBluetoothPermissions();
      if (perms && !perms.enabled) {
        onStatus("Turn on Bluetooth to connect a printer.");
        setScanning(false);
        return;
      }
      if (perms && (!perms.connectPermission || !perms.scanPermission)) {
        onStatus("Bluetooth permission is required to find printers.");
        setScanning(false);
        return;
      }
      const bonded = await listPairedBluetoothPrinterDevices();
      merge(bonded);
      const scanned = await scanBluetoothPrinterDevices(12000);
      merge(scanned);
      onStatus(
        bonded.length + scanned.length
          ? "Select a device from Paired or Nearby."
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
    onStatus("Find BLE printer…");
    const result = await requestWebBluetoothPrinter({ acceptAllBle });
    setScanning(false);
    if (!result.ok) {
      onStatus(result.error);
      return;
    }
    onSelect(result.device);
    const writable = result.device.diagnostics?.writableCharacteristic ?? "none";
    onStatus(`BLE printer characteristic found (${writable}). Test print will send ESC/POS.`);
  };

  const useDevice = async (device: NativeBluetoothDeviceRow, asClassic = false) => {
    const parsed = parseBluetoothDeviceId(device.id);
    const classic: NativeBluetoothDeviceRow = asClassic && parsed
      ? {
          ...device,
          id: formatBluetoothDeviceId("classic", parsed.address),
          transport: "classic",
        }
      : device;
    setBusyId(device.id);
    const pairedResult = await pairNativeBluetoothPrinter(classic.id);
    if (!pairedResult.ok && pairedResult.code !== "permission_denied") {
      /* System pairing may still be in progress; try connect anyway. */
    }
    const connected = await connectNativeBluetoothPrinter(
      classic.id,
      classic.transport === "ble" ? "ble" : "classic",
    );
    setBusyId(null);
    onSelect(classic);
    if (!connected.ok) {
      onStatus(
        connected.diagnostic
          ? formatClassicSppDiagnostic(connected.diagnostic)
          : connected.error,
      );
      return;
    }
    onStatus(
      classic.transport === "classic"
        ? `${classic.name} ready as Bluetooth Classic / SPP. Test to send data.`
        : `Connected: ${classic.name}`,
    );
  };

  if (native) {
    return (
      <div className="mt-3 space-y-3 rounded-2xl border-2 border-sky-200 bg-sky-50/70 p-3">
        <div className="flex items-center gap-2">
          <Bluetooth className="h-4 w-4 text-sky-800" aria-hidden />
          <p className="text-sm font-black text-sky-950">Bluetooth</p>
        </div>
        <p className="text-xs font-semibold text-sky-900">Bluetooth Classic + BLE</p>
        <button
          type="button"
          disabled={scanning}
          onClick={() => void findNative()}
          className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-sky-800 px-4 text-xs font-black text-white disabled:opacity-50"
        >
          {scanning ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {scanning ? "Scanning…" : "Find Bluetooth device"}
        </button>
        {paired.length > 0 ? (
          <div className="space-y-2">
            <p className="text-[11px] font-black uppercase tracking-wide text-sky-900">Paired devices</p>
            <ul className="space-y-2">
              {paired.map((d) => (
                <DeviceRow
                  key={d.id}
                  device={d}
                  selectedId={selectedId}
                  busyId={busyId}
                  onUse={(row) => void useDevice(row)}
                  onUseClassic={(row) => void useDevice(row, true)}
                />
              ))}
            </ul>
          </div>
        ) : null}
        {nearby.length > 0 ? (
          <div className="space-y-2">
            <p className="text-[11px] font-black uppercase tracking-wide text-sky-900">Nearby devices</p>
            <ul className="space-y-2">
              {nearby.map((d) => (
                <DeviceRow
                  key={d.id}
                  device={d}
                  selectedId={selectedId}
                  busyId={busyId}
                  onUse={(row) => void useDevice(row)}
                  onUseClassic={(row) => void useDevice(row, true)}
                />
              ))}
            </ul>
          </div>
        ) : null}
        {paired.length === 0 && nearby.length === 0 ? (
          <p className="text-xs font-semibold text-sky-900">
            Tap Find Bluetooth device. Paired printers appear even when they are not advertising.
          </p>
        ) : null}
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
        <p className="text-xs font-semibold text-sky-900">Web Bluetooth available — compatible BLE printers only.</p>
        <p className="text-xs font-semibold text-sky-900">{CLASSIC_CHROME_CHOOSER_ERROR}</p>
        <p className="text-xs font-semibold text-sky-900">{CLASSIC_CHOOSER_HINT}</p>
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
        <p className="text-[11px] font-black uppercase tracking-wide text-sky-900">Bluetooth Classic</p>
        <p className="text-xs font-semibold text-sky-900">Not available from browser</p>
        {selectedId ? (
          <p className="text-xs font-black text-sky-950">
            Selected BLE device is kept for this session. Test print reuses it without opening the chooser again.
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="mt-3 space-y-2 rounded-2xl border-2 border-amber-200 bg-amber-50 p-3">
      <p className="text-sm font-black text-amber-950">Bluetooth</p>
      <p className="text-xs font-semibold text-amber-900">
        Direct Bluetooth thermal printing is not available in this browser. For Bluetooth Classic printers, use WAKA
        Android.
      </p>
    </div>
  );
}
