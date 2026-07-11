import clsx from "clsx";
import { Delete } from "lucide-react";

type Props = {
  value: string;
  onChange: (next: string) => void;
  onConfirm?: () => void;
  confirmLabel?: string;
  className?: string;
};

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "C", "0", "00"] as const;

export function NumericKeypad({ value, onChange, onConfirm, confirmLabel = "OK", className }: Props) {
  const press = (key: string) => {
    if (key === "C") {
      onChange("");
      return;
    }
    if (key === "00") {
      onChange(`${value}00`.slice(0, 8));
      return;
    }
    onChange(`${value}${key}`.slice(0, 8));
  };

  return (
    <div className={clsx("grid grid-cols-4 gap-1.5", className)}>
      {KEYS.map((key) => (
        <button
          key={key}
          type="button"
          onClick={() => press(key)}
          className={clsx(
            "flex min-h-10 items-center justify-center rounded-lg border border-border bg-muted text-base font-black text-foreground active:bg-muted",
            key === "C" && "bg-rose-50 text-rose-800 border-rose-200",
          )}
        >
          {key}
        </button>
      ))}
      <button
        type="button"
        onClick={() => onChange(value.slice(0, -1))}
        className="flex min-h-10 items-center justify-center rounded-lg border border-border bg-muted text-muted-foreground"
        aria-label="Backspace"
      >
        <Delete className="h-4 w-4" />
      </button>
      {onConfirm ? (
        <button
          type="button"
          onClick={onConfirm}
          className="col-span-3 flex min-h-10 items-center justify-center rounded-lg bg-emerald-600 text-sm font-black text-white active:bg-emerald-700"
        >
          {confirmLabel}
        </button>
      ) : null}
    </div>
  );
}
