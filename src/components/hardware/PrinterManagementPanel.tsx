import { useEffect, useMemo, useState } from "react";
import { Plus, Printer, Trash2, Wifi } from "lucide-react";
import type { Language, PrinterConnectionType, PrinterStationRole } from "../../types";
import { t } from "../../lib/i18n";
import { usePosStore } from "../../store/usePosStore";
import { resolveHospitalityHardware } from "../../lib/hospitalityHardware";
import { stationLabel } from "../../lib/printerRegistry";
import { detectPrinterCapabilities, testNetworkPrinterConnection } from "../../services/hardware/printerAdapter";
import {
  addPrinterConnectionTypes,
  defaultPrinterConnectionType,
} from "../../services/hardware/hardwareTransport";
import { disconnectNativeBluetoothPrinter } from "../../lib/nativeBluetoothPrinter";
import type { NativeBluetoothDeviceRow, NativeClassicDiagnostic } from "../../lib/nativeBluetoothPrinter";
import { WakaSwitch } from "../enterprise/WakaSwitch";
import { BluetoothPrinterFinder } from "./BluetoothPrinterFinder";
import { ClassicSppDiagnosticPanel } from "./ClassicSppDiagnosticPanel";

const ROLE_OPTIONS: PrinterStationRole[] = [
  "kitchen",
  "bar",
  "coffee",
  "dessert",
  "grill",
  "pizza",
  "fryer",
  "receipt",
  "other",
];

function hardwareMutationDeniedStatus(lang: Language, errorKey?: string): string {
  return t(lang, errorKey === "forbidden" || errorKey === "noSelection" ? "forbidden" : "invalid");
}

export function PrinterManagementPanel({ lang }: { lang: Language }) {
  const preferences = usePosStore((s) => s.preferences);
  const hw = useMemo(() => resolveHospitalityHardware(preferences), [preferences]);
  const floor = preferences.hospitalityFloor;
  const upsertPrinter = usePosStore((s) => s.upsertPrinter);
  const removePrinter = usePosStore((s) => s.removePrinter);
  const assignStationPrinter = usePosStore((s) => s.assignStationPrinter);
  const testConfiguredPrinter = usePosStore((s) => s.testConfiguredPrinter);
  const setHospitalityHardwarePrefs = usePosStore((s) => s.setHospitalityHardwarePrefs);
  const retryFailedPrintJobs = usePosStore((s) => s.retryFailedPrintJobs);
  const cancelQueuedPrintJob = usePosStore((s) => s.cancelQueuedPrintJob);
  const processPendingPrintQueue = usePosStore((s) => s.processPendingPrintQueue);
  const openCashDrawerManual = usePosStore((s) => s.openCashDrawerManual);

  const [name, setName] = useState("Kitchen printer");
  const [connectionType, setConnectionType] = useState<PrinterConnectionType>("bluetooth");
  const [connectionOptions, setConnectionOptions] = useState<PrinterConnectionType[]>(["bluetooth", "network"]);
  const [paperWidth, setPaperWidth] = useState<"58mm" | "80mm">("80mm");
  const [roles, setRoles] = useState<PrinterStationRole[]>(["kitchen"]);
  const [networkHost, setNetworkHost] = useState("");
  const [networkPort, setNetworkPort] = useState("9100");
  const [status, setStatus] = useState("");
  const [isDefaultReceipt, setIsDefaultReceipt] = useState(false);
  const [pendingBt, setPendingBt] = useState<NativeBluetoothDeviceRow | null>(null);
  const [bindForId, setBindForId] = useState<string | null>(null);
  const [classicDiagnostic, setClassicDiagnostic] = useState<NativeClassicDiagnostic | null>(null);

  useEffect(() => {
    void detectPrinterCapabilities().then((caps) => {
      setConnectionOptions(addPrinterConnectionTypes(caps.transports));
      setConnectionType(defaultPrinterConnectionType(caps.transports));
    });
  }, []);

  const toggleRole = (role: PrinterStationRole) => {
    setRoles((prev) => (prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role]));
  };

  const addPrinter = () => {
    if (!name.trim()) return;
    if (connectionType === "usb" || connectionType === "builtin") {
      setStatus("USB thermal printing is not supported in this browser yet.");
      return;
    }
    if (connectionType === "bluetooth" && !pendingBt) {
      setStatus("Select a Bluetooth printer first.");
      return;
    }
    if (connectionType === "network" && !networkHost.trim()) {
      setStatus("Enter a private LAN address (for example 192.168.x.x).");
      return;
    }
    const result = upsertPrinter({
      name,
      connectionType,
      paperWidth,
      stationRoles: roles.length ? roles : ["kitchen"],
      isDefaultReceipt,
      networkHost: connectionType === "network" ? networkHost.trim() || null : null,
      networkPort: connectionType === "network" ? Number(networkPort) || 9100 : null,
      pairedDeviceKey: connectionType === "bluetooth" ? pendingBt?.id ?? null : null,
      bluetoothTransport: connectionType === "bluetooth" ? pendingBt?.transport ?? null : null,
      pairedDeviceName: connectionType === "bluetooth" ? pendingBt?.name ?? null : null,
    });
    if (!result.ok) {
      setStatus(hardwareMutationDeniedStatus(lang, result.errorKey));
      return;
    }
    setStatus(t(lang, "hardwarePrinterAdded"));
  };

  return (
    <div className="space-y-5">
      <article className="rounded-3xl border-2 border-border bg-card p-5 shadow-waka-sm">
        <div className="flex items-center gap-2">
          <Printer className="h-5 w-5 text-foreground" aria-hidden />
          <p className="text-lg font-black text-foreground">{t(lang, "hardwarePrintersTitle")}</p>
        </div>
        <p className="mt-2 text-sm font-medium text-muted-foreground">{t(lang, "hardwarePrintersSub")}</p>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="block text-sm font-bold text-foreground">
            {t(lang, "hardwarePrinterName")}
            <input
              className="mt-1 w-full rounded-xl border-2 border-border px-3 py-2 font-semibold"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label className="block text-sm font-bold text-foreground">
            {t(lang, "hardwarePrinterConnection")}
            <select
              className="mt-1 w-full rounded-xl border-2 border-border px-3 py-2 font-semibold"
              value={connectionType}
              onChange={(e) => setConnectionType(e.target.value as PrinterConnectionType)}
            >
              {connectionOptions.map((c) => (
                <option key={c} value={c}>
                  {c === "bluetooth" ? "Bluetooth" : "Network"}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm font-bold text-foreground">
            {t(lang, "hardwarePrinterPaper")}
            <select
              className="mt-1 w-full rounded-xl border-2 border-border px-3 py-2 font-semibold"
              value={paperWidth}
              onChange={(e) => setPaperWidth(e.target.value as "58mm" | "80mm")}
            >
              <option value="58mm">58mm</option>
              <option value="80mm">80mm</option>
            </select>
          </label>
          {connectionType === "network" ? (
            <>
              <label className="block text-sm font-bold text-foreground">
                {t(lang, "hardwarePrinterHost")}
                <input
                  className="mt-1 w-full rounded-xl border-2 border-border px-3 py-2 font-semibold"
                  value={networkHost}
                  onChange={(e) => setNetworkHost(e.target.value)}
                  placeholder="192.168.1.50"
                />
              </label>
              <label className="block text-sm font-bold text-foreground">
                {t(lang, "hardwarePrinterPort")}
                <input
                  className="mt-1 w-full rounded-xl border-2 border-border px-3 py-2 font-semibold"
                  value={networkPort}
                  onChange={(e) => setNetworkPort(e.target.value)}
                />
              </label>
              <p className="sm:col-span-2 text-xs font-semibold text-muted-foreground">
                Use a private LAN address (for example 192.168.x.x) and port 9100. Browsers cannot open that port
                directly — printing uses the WAKA desktop app or the WAKA Android app.
              </p>
            </>
          ) : null}
        </div>

        {connectionType === "bluetooth" ? (
          <BluetoothPrinterFinder
            selectedId={pendingBt?.id ?? null}
            onSelect={setPendingBt}
            onStatus={setStatus}
          />
        ) : null}

        <p className="mt-3 text-xs font-black uppercase tracking-wide text-muted-foreground">{t(lang, "hardwarePrinterRoles")}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {ROLE_OPTIONS.map((role) => (
            <button
              key={role}
              type="button"
              onClick={() => toggleRole(role)}
              className={`rounded-full px-3 py-1 text-xs font-black uppercase ${
                roles.includes(role) ? "bg-emerald-600 text-white" : "bg-muted text-muted-foreground"
              }`}
            >
              {role}
            </button>
          ))}
        </div>

        <WakaSwitch
          checked={isDefaultReceipt}
          onCheckedChange={setIsDefaultReceipt}
          label={t(lang, "hardwarePrinterDefaultReceipt")}
          className="mt-3 text-sm font-bold text-foreground"
        />

        <button
          type="button"
          onClick={addPrinter}
          className="mt-4 inline-flex items-center gap-2 rounded-2xl bg-foreground px-4 py-2.5 text-sm font-black text-background"
        >
          <Plus className="h-4 w-4" aria-hidden />
          {t(lang, "hardwarePrinterAdd")}
        </button>
      </article>

      {hw.printers.length > 0 ? (
        <ul className="space-y-3">
          {hw.printers.map((p) => (
            <li key={p.id} className="rounded-2xl border-2 border-border bg-muted p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-black text-foreground">{p.name}</p>
                  <p className="text-xs font-semibold text-muted-foreground">
                    {p.connectionType} · {p.paperWidth} · {p.stationRoles.join(", ")}
                    {p.connectionType === "bluetooth" && p.pairedDeviceName
                      ? ` · ${p.pairedDeviceName}`
                      : p.connectionType === "bluetooth" && p.pairedDeviceKey
                        ? " · Bluetooth saved"
                        : p.connectionType === "bluetooth"
                          ? " · no device selected"
                          : ""}
                  </p>
                  {p.lastError ? <p className="mt-1 text-xs font-bold text-red-700">{p.lastError}</p> : null}
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="rounded-xl border-2 border-border px-3 py-1 text-xs font-black"
                    onClick={() => {
                      void (async () => {
                        if (p.connectionType === "network") {
                          setStatus("Connecting...");
                          const probe = await testNetworkPrinterConnection(p);
                          if (!probe.ok) {
                            setStatus(probe.error ?? "Could not connect to printer");
                            return;
                          }
                        }
                        setStatus(t(lang, "hardwarePrinterTesting"));
                        setClassicDiagnostic(null);
                        const r = await testConfiguredPrinter(p.id);
                        if (r.diagnostic) setClassicDiagnostic(r.diagnostic);
                        setStatus(
                          r.ok
                            ? "Data sent to printer"
                            : (r.error ?? t(lang, "hardwarePrinterTestFail") ?? "Could not connect to printer"),
                        );
                      })();
                    }}
                  >
                    {t(lang, "hardwarePrinterTest")}
                  </button>
                  <button
                    type="button"
                    className="rounded-xl border-2 border-red-200 px-2 py-1 text-red-800"
                    onClick={() => {
                      const result = removePrinter(p.id);
                      if (!result.ok) {
                        setStatus(hardwareMutationDeniedStatus(lang, result.errorKey));
                      }
                    }}
                    aria-label={t(lang, "hardwarePrinterRemove")}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
              {p.connectionType === "bluetooth" ? (
                <div className="mt-3 space-y-2">
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="rounded-xl border-2 border-border px-3 py-1 text-xs font-black"
                      onClick={() => setBindForId(bindForId === p.id ? null : p.id)}
                    >
                      Find device
                    </button>
                    {p.pairedDeviceKey ? (
                      <button
                        type="button"
                        className="rounded-xl border-2 border-border px-3 py-1 text-xs font-black"
                        onClick={() => {
                          void disconnectNativeBluetoothPrinter(p.pairedDeviceKey ?? undefined);
                          const result = upsertPrinter({
                            id: p.id,
                            name: p.name,
                            connectionType: p.connectionType,
                            paperWidth: p.paperWidth,
                            stationRoles: p.stationRoles,
                            isDefaultReceipt: p.isDefaultReceipt,
                            pairedDeviceKey: null,
                            bluetoothTransport: null,
                            pairedDeviceName: null,
                          });
                          if (!result.ok) {
                            setStatus(hardwareMutationDeniedStatus(lang, result.errorKey));
                            return;
                          }
                          setStatus("Bluetooth device forgotten on this printer profile.");
                        }}
                      >
                        Forget device
                      </button>
                    ) : null}
                  </div>
                  {bindForId === p.id ? (
                    <BluetoothPrinterFinder
                      selectedId={p.pairedDeviceKey ?? null}
                      onSelect={(device) => {
                        if (!device) return;
                        const result = upsertPrinter({
                          id: p.id,
                          name: p.name,
                          connectionType: "bluetooth",
                          paperWidth: p.paperWidth,
                          stationRoles: p.stationRoles,
                          isDefaultReceipt: p.isDefaultReceipt,
                          pairedDeviceKey: device.id,
                          bluetoothTransport: device.transport,
                          pairedDeviceName: device.name,
                        });
                        if (!result.ok) {
                          setStatus(hardwareMutationDeniedStatus(lang, result.errorKey));
                          return;
                        }
                        setBindForId(null);
                        setStatus(`Saved ${device.name}`);
                      }}
                      onStatus={setStatus}
                    />
                  ) : null}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm font-semibold text-muted-foreground">{t(lang, "hardwarePrintersEmpty")}</p>
      )}

      {floor?.stations?.length ? (
        <article className="rounded-3xl border-2 border-amber-200 bg-amber-50/80 p-5">
          <p className="text-lg font-black text-amber-950">{t(lang, "hardwareStationAssignTitle")}</p>
          <p className="mt-1 text-sm font-medium text-amber-900/90">{t(lang, "hardwareStationAssignSub")}</p>
          <ul className="mt-3 space-y-2">
            {floor.stations.filter((s) => s.isActive).map((station) => (
              <li key={station.id} className="flex flex-wrap items-center gap-2">
                <span className="min-w-[10rem] text-sm font-bold text-amber-950">{stationLabel(station)}</span>
                <select
                  className="rounded-xl border-2 border-amber-200 px-2 py-1 text-sm font-semibold"
                  value={station.futureHooks?.printerIds?.[0] ?? ""}
                  onChange={(e) => {
                    const result = assignStationPrinter(station.id, e.target.value || null);
                    if (!result.ok) {
                      setStatus(hardwareMutationDeniedStatus(lang, result.errorKey));
                    }
                  }}
                >
                  <option value="">{t(lang, "hardwareStationAuto")}</option>
                  {hw.printers.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </li>
            ))}
          </ul>
        </article>
      ) : null}

      <article className="rounded-3xl border-2 border-border bg-card p-5">
        <p className="text-lg font-black text-foreground">{t(lang, "hardwarePrintBehaviorTitle")}</p>
        <div className="mt-3 space-y-2 text-sm font-bold text-foreground">
          <WakaSwitch
            checked={hw.autoPrintKitchen}
            onCheckedChange={(checked) => {
              const result = setHospitalityHardwarePrefs({ autoPrintKitchen: checked });
              if (!result.ok) setStatus(t(lang, "forbidden"));
            }}
            label={t(lang, "hardwareAutoKitchen")}
          />
          <WakaSwitch
            checked={hw.autoPrintReceipt}
            onCheckedChange={(checked) => {
              const result = setHospitalityHardwarePrefs({ autoPrintReceipt: checked });
              if (!result.ok) setStatus(t(lang, "forbidden"));
            }}
            label={t(lang, "hardwareAutoReceipt")}
          />
          <WakaSwitch
            checked={hw.openDrawerOnPayment}
            onCheckedChange={(checked) => {
              const result = setHospitalityHardwarePrefs({ openDrawerOnPayment: checked });
              if (!result.ok) setStatus(t(lang, "forbidden"));
            }}
            label={t(lang, "hardwareDrawerOnPayment")}
          />
          <WakaSwitch
            checked={hw.customerDisplayEnabled}
            onCheckedChange={(checked) => {
              const result = setHospitalityHardwarePrefs({ customerDisplayEnabled: checked });
              if (!result.ok) setStatus(t(lang, "forbidden"));
            }}
            label={t(lang, "hardwareCustomerDisplay")}
          />
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded-2xl border-2 border-border px-4 py-2 text-sm font-black"
            onClick={() => {
              retryFailedPrintJobs();
              setStatus(t(lang, "hardwareRetryFailed"));
            }}
          >
            {t(lang, "hardwareRetryFailedBtn")}
          </button>
          <button
            type="button"
            className="rounded-2xl border-2 border-border px-4 py-2 text-sm font-black"
            onClick={() => {
              processPendingPrintQueue();
              setStatus(t(lang, "hardwareQueueProcessing"));
            }}
          >
            {t(lang, "hardwareRetryQueue")} ({hw.printQueue.length})
          </button>
          <button
            type="button"
            className="rounded-2xl border-2 border-border px-4 py-2 text-sm font-black"
            onClick={() => void openCashDrawerManual().then((r) => setStatus(r.ok ? t(lang, "hardwareDrawerOpened") : (r.error ?? "")))}
          >
            {t(lang, "hardwareOpenDrawer")}
          </button>
          <a
            href="/customer-display"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 rounded-2xl bg-emerald-700 px-4 py-2 text-sm font-black text-white"
          >
            <Wifi className="h-4 w-4" />
            {t(lang, "hardwareOpenCustomerDisplay")}
          </a>
        </div>
      </article>

      {hw.printQueue.length > 0 ? (
        <article className="rounded-3xl border-2 border-amber-200 bg-amber-50/80 p-5">
          <p className="text-sm font-black text-amber-950">{t(lang, "hardwarePrintQueuePending")}</p>
          <ul className="mt-2 space-y-1 text-xs font-semibold">
            {hw.printQueue.map((job) => (
              <li key={job.id} className="flex items-center justify-between gap-2">
                <span>
                  {job.status} · {job.payloadSummary}
                </span>
                <button
                  type="button"
                  className="rounded-lg border border-amber-300 px-2 py-0.5 text-[10px] font-black"
                  onClick={() => cancelQueuedPrintJob(job.id)}
                >
                  {t(lang, "cancel")}
                </button>
              </li>
            ))}
          </ul>
        </article>
      ) : null}

      {hw.printHistory.length > 0 ? (
        <article className="rounded-3xl border-2 border-border bg-muted p-5">
          <p className="text-sm font-black uppercase tracking-wide text-muted-foreground">{t(lang, "hardwarePrintHistory")}</p>
          <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto text-xs font-semibold text-muted-foreground">
            {hw.printHistory.slice(0, 20).map((job) => (
              <li key={job.id}>
                {job.status} · {job.payloadSummary} · {new Date(job.createdAt).toLocaleTimeString("en-UG")}
              </li>
            ))}
          </ul>
        </article>
      ) : null}

      {status ? <p className="text-sm font-bold text-muted-foreground">{status}</p> : null}
      {classicDiagnostic ? <ClassicSppDiagnosticPanel diagnostic={classicDiagnostic} /> : null}
    </div>
  );
}
