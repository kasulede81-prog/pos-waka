import clsx from "clsx";
import type { DiningTable, HospitalityFloorState, Language } from "../../types";
import { t } from "../../lib/i18n";
import { activeSessionForTable } from "../../lib/hospitality";

type Props = {
  lang: Language;
  open: boolean;
  mode: "transfer" | "merge";
  floor: HospitalityFloorState;
  fromSessionId: string;
  onClose: () => void;
  onSelectTable: (tableId: string) => void;
};

export function TableActionSheet({ lang, open, mode, floor, fromSessionId, onClose, onSelectTable }: Props) {
  if (!open) return null;
  const fromSession = floor.sessions.find((s) => s.id === fromSessionId);
  const fromTable = fromSession ? floor.tables.find((t) => t.id === fromSession.tableId) : undefined;

  const selectable = floor.tables.filter((table) => {
    if (!table.isActive || table.id === fromTable?.id) return false;
    if (mode === "transfer") {
      return !activeSessionForTable(floor, table.id);
    }
    const session = activeSessionForTable(floor, table.id);
    return session && session.id !== fromSessionId;
  });

  return (
    <div className="fixed inset-0 z-[65] flex items-end justify-center bg-black/45 p-3 sm:items-center">
      <div className="max-h-[80vh] w-full max-w-md overflow-y-auto rounded-3xl bg-white p-5 shadow-xl">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-black text-stone-950">
              {mode === "transfer" ? t(lang, "tableTransferTitle") : t(lang, "tableMergeTitle")}
            </h2>
            <p className="text-sm font-medium text-stone-500">
              {fromTable?.label ?? "—"} → {t(lang, mode === "transfer" ? "tableTransferPick" : "tableMergePick")}
            </p>
          </div>
          <button type="button" className="text-sm font-bold text-slate-500" onClick={onClose}>
            {t(lang, "cancel")}
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {selectable.map((table: DiningTable) => (
            <button
              key={table.id}
              type="button"
              onClick={() => onSelectTable(table.id)}
              className={clsx(
                "min-h-14 rounded-2xl border-2 border-slate-200 bg-slate-50 text-sm font-black text-slate-900 active:bg-waka-50",
              )}
            >
              {table.label}
            </button>
          ))}
        </div>
        {selectable.length === 0 ? (
          <p className="mt-4 text-center text-sm font-medium text-slate-500">{t(lang, "tableActionNone")}</p>
        ) : null}
      </div>
    </div>
  );
}
