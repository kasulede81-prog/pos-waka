import { useMemo, useState } from "react";
import clsx from "clsx";
import type { BillSplitLine, Language, RestaurantBillSplitMode, SaleLine } from "../../types";
import { t } from "../../lib/i18n";
import { formatUgx } from "../../lib/formatUgx";
import { ModalSheet } from "../layout/ModalSheet";
import {
  splitBillByItem,
  splitBillBySeat,
  splitBillEqual,
  validateCustomSplits,
} from "../../lib/restaurantBilling";

type Props = {
  lang: Language;
  open: boolean;
  totalUgx: number;
  lines?: SaleLine[];
  guestCount?: number;
  onClose: () => void;
  onApply: (mode: RestaurantBillSplitMode, splits: BillSplitLine[]) => void;
};

export function SplitBillSheet({ lang, open, totalUgx, lines = [], guestCount = 2, onClose, onApply }: Props) {
  const [mode, setMode] = useState<RestaurantBillSplitMode>("equal");
  const [people, setPeople] = useState(Math.max(2, guestCount));
  const [rows, setRows] = useState<BillSplitLine[]>([
    { label: "A", amountUgx: 0 },
    { label: "B", amountUgx: 0 },
  ]);
  const [itemBuckets, setItemBuckets] = useState<Record<string, string>>({});
  const [bucketLabels, setBucketLabels] = useState<Record<string, string>>({ A: "Bill A", B: "Bill B" });

  const equalSplits = useMemo(() => splitBillEqual(totalUgx, people), [people, totalUgx]);
  const seatSplits = useMemo(() => splitBillBySeat(lines, people), [lines, people]);
  const itemSplits = useMemo(() => {
    const assignments: Record<string, string> = {};
    for (const line of lines) {
      const lineId = line.id ?? line.productId;
      assignments[lineId] = itemBuckets[lineId] ?? "A";
    }
    return splitBillByItem(lines, assignments, bucketLabels);
  }, [lines, itemBuckets, bucketLabels]);

  const customSum = rows.reduce((a, r) => a + r.amountUgx, 0);
  const customValid = validateCustomSplits(rows, totalUgx);

  const activeSplits =
    mode === "equal" ? equalSplits : mode === "by_seat" ? seatSplits : mode === "by_item" ? itemSplits : rows;

  const canApply =
    mode === "custom" ? customValid : mode === "by_item" ? itemSplits.length > 0 : totalUgx > 0 && activeSplits.length > 0;

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
            <h2 className="text-xl font-black text-foreground">{t(lang, "splitBillTitle")}</h2>
            <p className="text-lg font-black text-waka-700">{formatUgx(totalUgx)}</p>
          </div>
          <button type="button" className="min-h-[44px] px-2 text-sm font-bold text-muted-foreground" onClick={onClose}>
            {t(lang, "cancel")}
          </button>
        </div>
      }
      footer={
        <button
          type="button"
          disabled={!canApply}
          onClick={() => onApply(mode, activeSplits)}
          className="min-h-14 w-full rounded-2xl bg-waka-600 text-lg font-black text-white disabled:opacity-50"
        >
          {t(lang, "splitBillApply")}
        </button>
      }
    >
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {(["equal", "by_seat", "by_item", "custom"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={clsx(
              "min-h-11 rounded-xl border text-xs font-black sm:text-sm",
              mode === m ? "border-waka-500 bg-waka-50" : "border-border",
            )}
          >
            {t(lang, `splitBillMode_${m}`)}
          </button>
        ))}
      </div>

      {mode === "equal" ? (
        <>
          <p className="mb-2 text-sm font-bold text-muted-foreground">{t(lang, "splitBillPeople")}</p>
          <div className="mb-4 flex flex-wrap gap-2">
            {[2, 3, 4, 5, 6].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setPeople(n)}
                className={clsx(
                  "min-h-10 min-w-10 rounded-xl font-black",
                  people === n ? "bg-waka-600 text-white" : "bg-muted",
                )}
              >
                {n}
              </button>
            ))}
          </div>
          <ul className="mb-4 space-y-2">
            {equalSplits.map((s) => (
              <li key={s.id ?? s.label} className="flex justify-between text-sm font-bold text-foreground">
                <span>
                  {t(lang, "splitBillPerson")} {s.label}
                </span>
                <span>{formatUgx(s.amountUgx)}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {mode === "by_seat" ? (
        <ul className="mb-4 space-y-2">
          {seatSplits.map((s) => (
            <li key={s.id ?? s.label} className="flex justify-between text-sm font-bold text-foreground">
              <span>{s.label}</span>
              <span>{formatUgx(s.amountUgx)}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {mode === "by_item" ? (
        <>
          <div className="mb-3 flex gap-2">
            {["A", "B"].map((b) => (
              <input
                key={b}
                value={bucketLabels[b] ?? b}
                onChange={(e) => setBucketLabels({ ...bucketLabels, [b]: e.target.value })}
                className="min-h-[40px] flex-1 rounded-xl border border-border px-2 text-sm font-bold"
                placeholder={`Bill ${b}`}
              />
            ))}
          </div>
          {lines.map((line) => {
            const lineId = line.id ?? line.productId;
            return (
              <div key={lineId} className="mb-2 flex items-center justify-between gap-2 rounded-xl border border-border px-3 py-2">
                <span className="min-w-0 truncate text-sm font-bold text-foreground">{line.name}</span>
                <select
                  value={itemBuckets[lineId] ?? "A"}
                  onChange={(e) => setItemBuckets({ ...itemBuckets, [lineId]: e.target.value })}
                  className="min-h-[40px] rounded-lg border border-border px-2 text-sm font-bold"
                >
                  <option value="A">{bucketLabels.A ?? "A"}</option>
                  <option value="B">{bucketLabels.B ?? "B"}</option>
                </select>
              </div>
            );
          })}
          <ul className="mt-3 space-y-2">
            {itemSplits.map((s) => (
              <li key={s.id ?? s.label} className="flex justify-between text-sm font-bold text-foreground">
                <span>{s.label}</span>
                <span>{formatUgx(s.amountUgx)}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {mode === "custom" ? (
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
                className="min-h-[44px] rounded-xl border border-border px-3 py-2 text-sm font-bold"
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
                className="min-h-[44px] rounded-xl border border-border px-3 py-2 text-sm font-black"
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
      ) : null}
    </ModalSheet>
  );
}
