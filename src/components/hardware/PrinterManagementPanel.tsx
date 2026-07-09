import { useMemo, useState } from "react";
import { Plus, Printer, Trash2, Wifi } from "lucide-react";
import type { Language, PrinterConnectionType, PrinterStationRole } from "../../types";
import { t } from "../../lib/i18n";
import { usePosStore } from "../../store/usePosStore";
import { resolveHospitalityHardware } from "../../lib/hospitalityHardware";
import { stationLabel } from "../../lib/printerRegistry";
import { WakaSwitch } from "../enterprise/WakaSwitch";

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

const CONNECTION_OPTIONS: PrinterConnectionType[] = ["usb", "bluetooth", "network", "builtin"];

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
  const [connectionType, setConnectionType] = useState<PrinterConnectionType>("usb");
  const [paperWidth, setPaperWidth] = useState<"58mm" | "80mm">("80mm");
  const [roles, setRoles] = useState<PrinterStationRole[]>(["kitchen"]);
  const [networkHost, setNetworkHost] = useState("");
  const [networkPort, setNetworkPort] = useState("9100");
  const [status, setStatus] = useState("");
  const [isDefaultReceipt, setIsDefaultReceipt] = useState(false);

  const toggleRole = (role: PrinterStationRole) => {
    setRoles((prev) => (prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role]));
  };

  const addPrinter = () => {
    if (!name.trim()) return;
    upsertPrinter({
      name,
      connectionType,
      paperWidth,
      stationRoles: roles.length ? roles : ["kitchen"],
      isDefaultReceipt,
      networkHost: connectionType === "network" ? networkHost.trim() || null : null,
      networkPort: connectionType === "network" ? Number(networkPort) || 9100 : null,
    });
    setStatus(t(lang, "hardwarePrinterAdded"));
  };

  return (
    <div className="space-y-5">
      <article className="rounded-3xl border-2 border-stone-200 bg-white p-5 shadow-waka-sm">
        <div className="flex items-center gap-2">
          <Printer className="h-5 w-5 text-stone-800" aria-hidden />
          <p className="text-lg font-black text-stone-900">{t(lang, "hardwarePrintersTitle")}</p>
        </div>
        <p className="mt-2 text-sm font-medium text-stone-600">{t(lang, "hardwarePrintersSub")}</p>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="block text-sm font-bold text-stone-800">
            {t(lang, "hardwarePrinterName")}
            <input
              className="mt-1 w-full rounded-xl border-2 border-stone-200 px-3 py-2 font-semibold"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label className="block text-sm font-bold text-stone-800">
            {t(lang, "hardwarePrinterConnection")}
            <select
              className="mt-1 w-full rounded-xl border-2 border-stone-200 px-3 py-2 font-semibold"
              value={connectionType}
              onChange={(e) => setConnectionType(e.target.value as PrinterConnectionType)}
            >
              {CONNECTION_OPTIONS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm font-bold text-stone-800">
            {t(lang, "hardwarePrinterPaper")}
            <select
              className="mt-1 w-full rounded-xl border-2 border-stone-200 px-3 py-2 font-semibold"
              value={paperWidth}
              onChange={(e) => setPaperWidth(e.target.value as "58mm" | "80mm")}
            >
              <option value="58mm">58mm</option>
              <option value="80mm">80mm</option>
            </select>
          </label>
          {connectionType === "network" ? (
            <>
              <label className="block text-sm font-bold text-stone-800">
                {t(lang, "hardwarePrinterHost")}
                <input
                  className="mt-1 w-full rounded-xl border-2 border-stone-200 px-3 py-2 font-semibold"
                  value={networkHost}
                  onChange={(e) => setNetworkHost(e.target.value)}
                  placeholder="192.168.1.50"
                />
              </label>
              <label className="block text-sm font-bold text-stone-800">
                {t(lang, "hardwarePrinterPort")}
                <input
                  className="mt-1 w-full rounded-xl border-2 border-stone-200 px-3 py-2 font-semibold"
                  value={networkPort}
                  onChange={(e) => setNetworkPort(e.target.value)}
                />
              </label>
            </>
          ) : null}
        </div>

        <p className="mt-3 text-xs font-black uppercase tracking-wide text-stone-500">{t(lang, "hardwarePrinterRoles")}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {ROLE_OPTIONS.map((role) => (
            <button
              key={role}
              type="button"
              onClick={() => toggleRole(role)}
              className={`rounded-full px-3 py-1 text-xs font-black uppercase ${
                roles.includes(role) ? "bg-emerald-600 text-white" : "bg-stone-100 text-stone-700"
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
          className="mt-3 text-sm font-bold text-stone-800"
        />

        <button
          type="button"
          onClick={addPrinter}
          className="mt-4 inline-flex items-center gap-2 rounded-2xl bg-stone-900 px-4 py-2.5 text-sm font-black text-white"
        >
          <Plus className="h-4 w-4" aria-hidden />
          {t(lang, "hardwarePrinterAdd")}
        </button>
      </article>

      {hw.printers.length > 0 ? (
        <ul className="space-y-3">
          {hw.printers.map((p) => (
            <li key={p.id} className="rounded-2xl border-2 border-stone-200 bg-stone-50 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-black text-stone-900">{p.name}</p>
                  <p className="text-xs font-semibold text-stone-600">
                    {p.connectionType} · {p.paperWidth} · {p.stationRoles.join(", ")}
                  </p>
                  {p.lastError ? <p className="mt-1 text-xs font-bold text-red-700">{p.lastError}</p> : null}
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="rounded-xl border-2 border-stone-300 px-3 py-1 text-xs font-black"
                    onClick={() => {
                      setStatus(t(lang, "hardwarePrinterTesting"));
                      void testConfiguredPrinter(p.id).then((r) =>
                        setStatus(r.ok ? t(lang, "hardwarePrinterTestOk") : (r.error ?? t(lang, "hardwarePrinterTestFail"))),
                      );
                    }}
                  >
                    {t(lang, "hardwarePrinterTest")}
                  </button>
                  <button
                    type="button"
                    className="rounded-xl border-2 border-red-200 px-2 py-1 text-red-800"
                    onClick={() => removePrinter(p.id)}
                    aria-label={t(lang, "hardwarePrinterRemove")}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm font-semibold text-stone-600">{t(lang, "hardwarePrintersEmpty")}</p>
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
                  onChange={(e) => assignStationPrinter(station.id, e.target.value || null)}
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

      <article className="rounded-3xl border-2 border-stone-200 bg-white p-5">
        <p className="text-lg font-black text-stone-900">{t(lang, "hardwarePrintBehaviorTitle")}</p>
        <div className="mt-3 space-y-2 text-sm font-bold text-stone-800">
          <WakaSwitch
            checked={hw.autoPrintKitchen}
            onCheckedChange={(checked) => setHospitalityHardwarePrefs({ autoPrintKitchen: checked })}
            label={t(lang, "hardwareAutoKitchen")}
          />
          <WakaSwitch
            checked={hw.autoPrintReceipt}
            onCheckedChange={(checked) => setHospitalityHardwarePrefs({ autoPrintReceipt: checked })}
            label={t(lang, "hardwareAutoReceipt")}
          />
          <WakaSwitch
            checked={hw.openDrawerOnPayment}
            onCheckedChange={(checked) => setHospitalityHardwarePrefs({ openDrawerOnPayment: checked })}
            label={t(lang, "hardwareDrawerOnPayment")}
          />
          <WakaSwitch
            checked={hw.customerDisplayEnabled}
            onCheckedChange={(checked) => setHospitalityHardwarePrefs({ customerDisplayEnabled: checked })}
            label={t(lang, "hardwareCustomerDisplay")}
          />
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded-2xl border-2 border-stone-300 px-4 py-2 text-sm font-black"
            onClick={() => {
              retryFailedPrintJobs();
              setStatus(t(lang, "hardwareRetryFailed"));
            }}
          >
            {t(lang, "hardwareRetryFailedBtn")}
          </button>
          <button
            type="button"
            className="rounded-2xl border-2 border-stone-300 px-4 py-2 text-sm font-black"
            onClick={() => {
              processPendingPrintQueue();
              setStatus(t(lang, "hardwareQueueProcessing"));
            }}
          >
            {t(lang, "hardwareRetryQueue")} ({hw.printQueue.length})
          </button>
          <button
            type="button"
            className="rounded-2xl border-2 border-stone-300 px-4 py-2 text-sm font-black"
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
        <article className="rounded-3xl border-2 border-stone-200 bg-stone-50 p-5">
          <p className="text-sm font-black uppercase tracking-wide text-stone-600">{t(lang, "hardwarePrintHistory")}</p>
          <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto text-xs font-semibold text-stone-700">
            {hw.printHistory.slice(0, 20).map((job) => (
              <li key={job.id}>
                {job.status} · {job.payloadSummary} · {new Date(job.createdAt).toLocaleTimeString("en-UG")}
              </li>
            ))}
          </ul>
        </article>
      ) : null}

      {status ? <p className="text-sm font-bold text-stone-700">{status}</p> : null}
    </div>
  );
}
