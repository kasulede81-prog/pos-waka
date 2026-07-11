import { useMemo, useState } from "react";
import { Link2, RotateCcw, Unlink, XCircle } from "lucide-react";
import type { HospitalityFloorState, Language, TableSession } from "../../types";
import { t } from "../../lib/i18n";
import { ModalSheet } from "../layout/ModalSheet";
import { EnterprisePinPad } from "../auth/EnterprisePinPad";
import { verifyManagerApprovalPinSync } from "../../lib/enterpriseSecurity/EnterpriseSecurityService";
import { usePosStore } from "../../store/usePosStore";
import { sessionDisplayLabel } from "../../lib/hospitality";
import { isTableSeatable } from "../../lib/hospitalityFrontOfHouse";
import { formatUgx } from "../../lib/formatUgx";

type Props = {
  lang: Language;
  open: boolean;
  floor: HospitalityFloorState;
  onClose: () => void;
};

type Tab = "combine" | "split" | "reopen" | "void";

function closedSessions(floor: HospitalityFloorState): TableSession[] {
  return floor.sessions
    .filter((s) => s.status === "closed")
    .sort((a, b) => (b.closedAt ?? "").localeCompare(a.closedAt ?? ""));
}

export function HospitalityManagerToolsSheet({ lang, open, floor, onClose }: Props) {
  const combineTables = usePosStore((s) => s.combineTables);
  const splitCombinedTables = usePosStore((s) => s.splitCombinedTables);
  const reopenTableBill = usePosStore((s) => s.reopenTableBill);
  const voidSettledTableBill = usePosStore((s) => s.voidSettledTableBill);
  const sales = usePosStore((s) => s.sales);
  const preferences = usePosStore((s) => s.preferences);

  const [tab, setTab] = useState<Tab>("combine");
  const [selectedTableIds, setSelectedTableIds] = useState<string[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [pinResetSignal, setPinResetSignal] = useState(0);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const availableTables = useMemo(
    () => floor.tables.filter((t) => t.isActive && isTableSeatable(t, floor) && !t.combinedGroupId),
    [floor],
  );

  const combinedGroups = floor.combinedGroups ?? [];
  const closed = useMemo(() => closedSessions(floor).slice(0, 20), [floor]);

  const toggleTable = (id: string) => {
    setSelectedTableIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const runCombine = () => {
    if (selectedTableIds.length < 2) return;
    setBusy(true);
    const res = combineTables(selectedTableIds);
    setBusy(false);
    if (!res.ok) {
      setStatus(t(lang, res.errorKey ?? "saleError"));
      return;
    }
    setSelectedTableIds([]);
    setStatus(t(lang, "hospitalityCombineDone"));
  };

  const runSplit = () => {
    if (!selectedGroupId) return;
    setBusy(true);
    const res = splitCombinedTables(selectedGroupId);
    setBusy(false);
    if (!res.ok) {
      setStatus(t(lang, res.errorKey ?? "saleError"));
      return;
    }
    setSelectedGroupId(null);
    setStatus(t(lang, "hospitalitySplitDone"));
  };

  const runReopen = (managerPin: string) => {
    if (!selectedSessionId || !reason.trim()) return;
    setBusy(true);
    const res = reopenTableBill({ sessionId: selectedSessionId, reason: reason.trim(), managerPin });
    setBusy(false);
    if (!res.ok) {
      setStatus(t(lang, res.errorKey ?? "saleError"));
      setPinResetSignal((n) => n + 1);
      return;
    }
    setStatus(t(lang, "hospitalityReopenDone"));
    onClose();
  };

  const runVoid = (managerPin: string) => {
    if (!selectedSessionId || !reason.trim()) return;
    setBusy(true);
    const res = voidSettledTableBill({ sessionId: selectedSessionId, reason: reason.trim(), managerPin });
    setBusy(false);
    if (!res.ok) {
      setStatus(t(lang, res.errorKey ?? "saleError"));
      setPinResetSignal((n) => n + 1);
      return;
    }
    setStatus(t(lang, "hospitalityVoidDone"));
    onClose();
  };

  const tabs: { id: Tab; label: string; Icon: typeof Link2 }[] = [
    { id: "combine", label: t(lang, "hospitalityManagerCombine"), Icon: Link2 },
    { id: "split", label: t(lang, "hospitalityManagerSplit"), Icon: Unlink },
    { id: "reopen", label: t(lang, "hospitalityManagerReopen"), Icon: RotateCcw },
    { id: "void", label: t(lang, "hospitalityManagerVoid"), Icon: XCircle },
  ];

  return (
    <ModalSheet open={open} onClose={onClose} title={t(lang, "hospitalityManagerTitle")}>
      <div className="flex flex-wrap gap-2">
        {tabs.map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => {
              setTab(id);
              setStatus(null);
            }}
            className={`inline-flex min-h-10 items-center gap-1.5 rounded-xl px-3 text-xs font-black ${
              tab === id ? "bg-foreground text-background" : "bg-muted text-foreground"
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
      </div>

      {tab === "combine" ? (
        <div className="mt-4 space-y-3">
          <p className="text-sm font-medium text-muted-foreground">{t(lang, "hospitalityCombineSub")}</p>
          <ul className="grid max-h-48 grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3">
            {availableTables.map((table) => (
              <li key={table.id}>
                <button
                  type="button"
                  onClick={() => toggleTable(table.id)}
                  className={`min-h-12 w-full rounded-xl border-2 px-2 text-sm font-black ${
                    selectedTableIds.includes(table.id)
                      ? "border-waka-600 bg-waka-50 text-waka-900"
                      : "border-border bg-card"
                  }`}
                >
                  {table.label}
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            disabled={busy || selectedTableIds.length < 2}
            onClick={runCombine}
            className="min-h-12 w-full rounded-2xl bg-waka-600 text-sm font-black text-white disabled:opacity-50"
          >
            {t(lang, "hospitalityCombineAction")} ({selectedTableIds.length})
          </button>
        </div>
      ) : null}

      {tab === "split" ? (
        <div className="mt-4 space-y-3">
          <p className="text-sm font-medium text-muted-foreground">{t(lang, "hospitalitySplitSub")}</p>
          <ul className="space-y-2">
            {combinedGroups.map((g) => (
              <li key={g.id}>
                <button
                  type="button"
                  onClick={() => setSelectedGroupId(g.id)}
                  className={`min-h-12 w-full rounded-xl border-2 px-3 text-left text-sm font-black ${
                    selectedGroupId === g.id ? "border-waka-600 bg-waka-50" : "border-border"
                  }`}
                >
                  {g.displayLabel}
                </button>
              </li>
            ))}
            {!combinedGroups.length ? (
              <p className="text-sm text-muted-foreground">{t(lang, "hospitalityNoCombined")}</p>
            ) : null}
          </ul>
          <button
            type="button"
            disabled={busy || !selectedGroupId}
            onClick={runSplit}
            className="min-h-12 w-full rounded-2xl bg-foreground text-sm font-black text-background disabled:opacity-50"
          >
            {t(lang, "hospitalitySplitAction")}
          </button>
        </div>
      ) : null}

      {(tab === "reopen" || tab === "void") && (
        <div className="mt-4 space-y-3">
          <p className="text-sm font-medium text-muted-foreground">
            {tab === "reopen" ? t(lang, "hospitalityReopenSub") : t(lang, "hospitalityVoidSub")}
          </p>
          <ul className="max-h-40 space-y-2 overflow-y-auto">
            {closed.map((session) => {
              const sale = sales.find((s) => s.id === session.saleId);
              const voided = Boolean(sale?.saleVoidedAt);
              return (
                <li key={session.id}>
                  <button
                    type="button"
                    disabled={tab === "reopen" ? false : voided}
                    onClick={() => setSelectedSessionId(session.id)}
                    className={`min-h-12 w-full rounded-xl border-2 px-3 text-left text-sm font-bold ${
                      selectedSessionId === session.id ? "border-waka-600 bg-waka-50" : "border-border"
                    } ${voided ? "opacity-50" : ""}`}
                  >
                    {sessionDisplayLabel(session, floor)}
                    {sale ? ` · ${formatUgx(sale.totalUgx)}` : ""}
                    {voided ? ` · ${t(lang, "hospitalityVoidedLabel")}` : ""}
                  </button>
                </li>
              );
            })}
            {!closed.length ? <p className="text-sm text-muted-foreground">{t(lang, "hospitalityNoClosed")}</p> : null}
          </ul>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t(lang, "hospitalityManagerReasonPh")}
            className="min-h-20 w-full rounded-xl border-2 border-border px-3 py-2 text-sm font-semibold"
          />
          <EnterprisePinPad
            lang={lang}
            disabled={busy || !selectedSessionId || !reason.trim()}
            resetSignal={`${tab}-${pinResetSignal}`}
            onComplete={(managerPin) => {
              if (!verifyManagerApprovalPinSync(managerPin, preferences)) {
                return false;
              }
              if (tab === "reopen") {
                runReopen(managerPin);
              } else {
                runVoid(managerPin);
              }
              return true;
            }}
          />
        </div>
      )}

      {status ? <p className="mt-3 text-sm font-bold text-muted-foreground">{status}</p> : null}
    </ModalSheet>
  );
}
