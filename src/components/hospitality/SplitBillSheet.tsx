import { useMemo, useState } from "react";
import clsx from "clsx";
import type { BillSplitLine, Language } from "../../types";
import { t } from "../../lib/i18n";
import { formatUgx } from "../../lib/formatUgx";
import { ModalSheet } from "../layout/ModalSheet";

type Props = {
  lang: Language;
  open: boolean;
  totalUgx: number;
  onClose: () => void;
  onApply: (splits: BillSplitLine[]) => void;
};

export function SplitBillSheet({ lang, open, totalUgx, onClose, onApply }: Props) {
  const [mode, setMode] = useState<"equal" | "custom">("equal");
  const [people, setPeople] = useState(2);
  const [rows, setRows] = useState<BillSplitLine[]>([
    { label: "A", amountUgx: 0 },
    { label: "B", amountUgx: 0 },
  ]);

  const equalSplits = useMemo(() => {
    const n = Math.max(2, people);
    const base = Math.floor(totalUgx / n);
    const remainder = totalUgx - base * n;
    return Array.from({ length: n }, (_, i) => ({
      label: String.fromCharCode(65 + i),
      amountUgx: base + (i < remainder ? 1 : 0),
    }));
  }, [people, totalUgx]);

  const customSum = rows.reduce((a, r) => a + r.amountUgx, 0);
  const customValid = customSum === totalUgx;

  if (!open) return null;

  return (
    <ModalSheet
      open
      onClose={onClose}
      zIndexClass="z-[70]"
      clearNav={false}
      title={
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-black text-stone-950">{t(lang, "splitBillTitle")}</h2>
            <p className="text-lg font-black text-waka-700">{formatUgx(totalUgx)}</p>
          </div>
          <button type="button" className="min-h-[44px] px-2 text-sm font-bold text-stone-500" onClick={onClose}>
            {t(lang, "cancel")}
          </button>
        </div>
      }
      footer={
        <button
          type="button"
          disabled={mode === "custom" ? !customValid : totalUgx <= 0}
          onClick={() => onApply(mode === "equal" ? equalSplits : rows)}
          className="min-h-14 w-full rounded-2xl bg-waka-600 text-lg font-black text-white disabled:opacity-50"
        >
          {t(lang, "splitBillApply")}
        </button>
      }
    >
        <div className="mb-4 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setMode("equal")}
            className={clsx(
              "min-h-11 rounded-xl border text-sm font-black",
              mode === "equal" ? "border-waka-500 bg-waka-50" : "border-stone-200",
            )}
          >
            {t(lang, "splitBillEqual")}
          </button>
          <button
            type="button"
            onClick={() => setMode("custom")}
            className={clsx(
              "min-h-11 rounded-xl border text-sm font-black",
              mode === "custom" ? "border-waka-500 bg-waka-50" : "border-stone-200",
            )}
          >
            {t(lang, "splitBillCustom")}
          </button>
        </div>

        {mode === "equal" ? (
          <>
            <p className="mb-2 text-sm font-bold text-stone-600">{t(lang, "splitBillPeople")}</p>
            <div className="mb-4 flex flex-wrap gap-2">
              {[2, 3, 4, 5, 6].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setPeople(n)}
                  className={clsx(
                    "min-h-10 min-w-10 rounded-xl font-black",
                    people === n ? "bg-waka-600 text-white" : "bg-stone-100",
                  )}
                >
                  {n}
                </button>
              ))}
            </div>
            <ul className="mb-4 space-y-2">
              {equalSplits.map((s) => (
                <li key={s.label} className="flex justify-between text-sm font-bold text-stone-800">
                  <span>
                    {t(lang, "splitBillPerson")} {s.label}
                  </span>
                  <span>{formatUgx(s.amountUgx)}</span>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <>
            {rows.map((row, idx) => (
              <div key={idx} className="mb-3 grid grid-cols-[1fr_1.2fr] gap-2">
                <input
                  value={row.label}
                  onChange={(e) => {
                    const next = [...rows];
                    next[idx] = { ...row, label: e.target.value };
                    setRows(next);
                  }}
                  className="min-h-[44px] rounded-xl border border-stone-200 px-3 py-2 text-sm font-bold"
                />
                <input
                  value={row.amountUgx ? String(row.amountUgx) : ""}
                  onChange={(e) => {
                    const next = [...rows];
                    next[idx] = { ...row, amountUgx: Math.max(0, Math.floor(Number(e.target.value.replace(/\D/g, "")) || 0)) };
                    setRows(next);
                  }}
                  inputMode="numeric"
                  placeholder="UGX"
                  className="min-h-[44px] rounded-xl border border-stone-200 px-3 py-2 text-sm font-black"
                />
              </div>
            ))}
            <button
              type="button"
              onClick={() => setRows([...rows, { label: String.fromCharCode(65 + rows.length), amountUgx: 0 }])}
              className="mb-3 min-h-[44px] text-sm font-bold text-waka-700"
            >
              {t(lang, "splitBillAddPerson")}
            </button>
            <p className={clsx("text-sm font-bold", customValid ? "text-emerald-700" : "text-rose-700")}>
              {t(lang, "splitBillSum")}: {formatUgx(customSum)} / {formatUgx(totalUgx)}
            </p>
          </>
        )}
    </ModalSheet>
  );
}
