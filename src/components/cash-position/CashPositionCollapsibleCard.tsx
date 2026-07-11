import { useEffect, useState, type ReactNode } from "react";
import clsx from "clsx";
import { ChevronDown } from "lucide-react";

const STORAGE_KEY = "waka-cash-position-sections";

function readSectionState(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

type Props = {
  id: string;
  title: string;
  icon?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
  badge?: ReactNode;
};

export function CashPositionCollapsibleCard({ id, title, icon, defaultOpen = true, children, badge }: Props) {
  const [open, setOpen] = useState(() => readSectionState()[id] ?? defaultOpen);

  useEffect(() => {
    const all = readSectionState();
    all[id] = open;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
    } catch {
      /* quota */
    }
  }, [id, open]);

  return (
    <section className="overflow-hidden rounded-3xl border border-border bg-card shadow-waka-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 px-4 py-4 text-left transition-colors active:bg-muted sm:px-5"
        aria-expanded={open}
      >
        {icon ? <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-waka-50 text-lg">{icon}</span> : null}
        <span className="min-w-0 flex-1 text-base font-black text-foreground">{title}</span>
        {badge}
        <ChevronDown
          className={clsx("h-5 w-5 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")}
          aria-hidden
        />
      </button>
      {open ? <div className="border-t border-border px-4 pb-5 pt-4 sm:px-5">{children}</div> : null}
    </section>
  );
}
