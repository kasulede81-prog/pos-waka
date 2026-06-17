import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MoreHorizontal, Phone, User } from "lucide-react";
import clsx from "clsx";
import type { Customer, Language } from "../../types";
import type { CreditActivityEntry } from "../../lib/customerDebtActivity";
import { t } from "../../lib/i18n";

const ICON_TONES = [
  "bg-amber-100 text-amber-800",
  "bg-waka-100 text-waka-700",
  "bg-emerald-100 text-emerald-700",
  "bg-sky-100 text-sky-700",
  "bg-violet-100 text-violet-700",
] as const;

const MENU_WIDTH_PX = 300;

type MenuPlacement = {
  left: number;
  width: number;
  maxHeight: number;
  top?: number;
  bottom?: number;
};

function computeMenuPlacement(anchor: DOMRect): MenuPlacement {
  const width = Math.min(MENU_WIDTH_PX, window.innerWidth - 16);
  let left = anchor.right - width;
  left = Math.max(8, Math.min(left, window.innerWidth - width - 8));

  const spaceBelow = window.innerHeight - anchor.bottom - 12;
  const spaceAbove = anchor.top - 12;
  const openBelow = spaceBelow >= 200 || spaceBelow >= spaceAbove;
  const maxHeight = Math.max(180, Math.min(openBelow ? spaceBelow : spaceAbove, window.innerHeight * 0.75));

  if (openBelow) {
    return { left, width, maxHeight, top: anchor.bottom + 6 };
  }
  return { left, width, maxHeight, bottom: window.innerHeight - anchor.top + 6 };
}

function formatActivityWhen(iso: string, lang: Language): string {
  const locale = lang === "sw" ? "sw-UG" : "en-UG";
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "Africa/Kampala",
  }).format(new Date(iso));
}

type MenuPanelProps = {
  lang: Language;
  customer: Customer;
  timeline: CreditActivityEntry[];
  canDebt: boolean;
  payAmount: string;
  showPayForm: boolean;
  placement: MenuPlacement;
  onClose: () => void;
  onTogglePay: () => void;
  onPayAmountChange: (value: string) => void;
  onSubmitPay: () => void;
};

function DebtCustomerMenuPanel({
  lang,
  customer,
  timeline,
  canDebt,
  payAmount,
  showPayForm,
  placement,
  onClose,
  onTogglePay,
  onPayAmountChange,
  onSubmitPay,
}: MenuPanelProps) {
  return (
    <>
      <button type="button" className="fixed inset-0 z-[58] bg-black/20" aria-label={t(lang, "cancel")} onClick={onClose} />
      <div
        className="fixed z-[60] flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl"
        style={{
          left: placement.left,
          width: placement.width,
          maxHeight: placement.maxHeight,
          top: placement.top,
          bottom: placement.bottom,
        }}
        role="menu"
      >
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain py-2">
          <div className="border-b border-stone-100 px-3 pb-2">
            <p className="text-sm font-black text-slate-900">{customer.name}</p>
            <p className="mt-0.5 text-xs font-semibold text-slate-500">
              {customer.phone || t(lang, "debtNoPhone")}
            </p>
            <p className="mt-2 text-xs font-bold uppercase text-amber-800">{t(lang, "debtBalanceLabel")}</p>
            <p className="text-lg font-black text-amber-900">UGX {customer.debtBalanceUgx.toLocaleString()}</p>
          </div>

          <div className="border-b border-stone-100 px-3 py-2">
            <p className="text-[10px] font-black uppercase tracking-wide text-slate-500">
              {t(lang, "creditActivityTitle")}
            </p>
            {timeline.length === 0 ? (
              <p className="mt-1.5 text-xs text-slate-500">{t(lang, "creditActivityEmpty")}</p>
            ) : (
              <ul className="mt-1.5 space-y-1.5">
                {timeline.map((entry) => (
                  <li
                    key={`${entry.kind}-${entry.id}`}
                    className="flex items-start justify-between gap-2 rounded-lg bg-stone-50 px-2 py-1.5 text-xs"
                  >
                    <div className="min-w-0">
                      <p className="font-bold text-slate-800">
                        {entry.kind === "credit_sale"
                          ? t(lang, "creditSaleActivity")
                          : t(lang, "debtPaymentActivity")}
                        {entry.receiptSeq != null ? ` #${String(entry.receiptSeq).padStart(3, "0")}` : ""}
                      </p>
                      <p className="text-slate-500">{formatActivityWhen(entry.at, lang)}</p>
                    </div>
                    <span
                      className={clsx(
                        "shrink-0 font-black",
                        entry.deltaUgx >= 0 ? "text-amber-900" : "text-waka-800",
                      )}
                    >
                      {entry.deltaUgx >= 0 ? "+" : "−"}UGX {entry.amountUgx.toLocaleString()}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {canDebt ? (
            <div className="px-3 py-2">
              {!showPayForm ? (
                <button
                  type="button"
                  role="menuitem"
                  className="w-full rounded-xl bg-waka-600 py-2.5 text-sm font-black text-white active:bg-waka-700"
                  onClick={onTogglePay}
                >
                  {t(lang, "repayDebt")}
                </button>
              ) : (
                <div className="rounded-xl border border-waka-200 bg-waka-50 p-3">
                  <label className="block text-xs font-bold text-waka-950">{t(lang, "payDown")}</label>
                  <input
                    value={payAmount}
                    onChange={(e) => onPayAmountChange(e.target.value.replace(/\D/g, "").slice(0, 10))}
                    inputMode="numeric"
                    autoFocus
                    className="mt-2 w-full rounded-lg border-2 border-waka-300 px-3 py-2 text-xl font-black"
                  />
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      className="flex-1 rounded-lg border border-stone-200 py-2 text-sm font-bold text-stone-700"
                      onClick={onTogglePay}
                    >
                      {t(lang, "cancel")}
                    </button>
                    <button
                      type="button"
                      className="flex-1 rounded-lg bg-waka-700 py-2 text-sm font-black text-white"
                      onClick={onSubmitPay}
                    >
                      {t(lang, "saveSale")}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
}

type Props = {
  lang: Language;
  customer: Customer;
  timeline: CreditActivityEntry[];
  canDebt: boolean;
  toneIndex: number;
  onSubmitPay: (customerId: string, amountUgx: number) => void;
};

export function DebtCustomerRow({ lang, customer, timeline, canDebt, toneIndex, onSubmitPay }: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPlacement, setMenuPlacement] = useState<MenuPlacement | null>(null);
  const [payAmount, setPayAmount] = useState("");
  const [showPayForm, setShowPayForm] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  const closeMenu = () => {
    setMenuOpen(false);
    setShowPayForm(false);
    setPayAmount("");
  };

  const updatePlacement = () => {
    const anchor = menuButtonRef.current?.getBoundingClientRect();
    if (!anchor) return;
    setMenuPlacement(computeMenuPlacement(anchor));
  };

  useLayoutEffect(() => {
    if (!menuOpen) {
      setMenuPlacement(null);
      return;
    }
    updatePlacement();
    const onReflow = () => updatePlacement();
    window.addEventListener("resize", onReflow);
    window.addEventListener("scroll", onReflow, true);
    return () => {
      window.removeEventListener("resize", onReflow);
      window.removeEventListener("scroll", onReflow, true);
    };
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeMenu();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  const hasBalance = customer.debtBalanceUgx > 0;

  return (
    <div className="border-b border-stone-100 last:border-b-0">
      <div className="flex items-center gap-3 px-3 py-3 sm:px-4">
        <div
          className={clsx(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
            ICON_TONES[toneIndex % ICON_TONES.length],
          )}
        >
          <User className="h-5 w-5" aria-hidden />
        </div>

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-black text-slate-950">{customer.name}</p>
          <p className="flex items-center gap-1 truncate text-xs font-semibold text-slate-500">
            {customer.phone ? (
              <>
                <Phone className="h-3 w-3 shrink-0" aria-hidden />
                {customer.phone}
              </>
            ) : (
              t(lang, "debtNoPhone")
            )}
          </p>
        </div>

        {hasBalance ? (
          <span className="hidden shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-black uppercase text-amber-900 sm:inline">
            {t(lang, "debtBalanceShort")}
          </span>
        ) : null}

        <p className={clsx("shrink-0 text-sm font-black", hasBalance ? "text-amber-900" : "text-slate-500")}>
          UGX {customer.debtBalanceUgx.toLocaleString()}
        </p>

        <div className="relative shrink-0">
          <button
            ref={menuButtonRef}
            type="button"
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            onClick={() => setMenuOpen((v) => !v)}
            className="flex min-h-[40px] min-w-[40px] items-center justify-center rounded-xl border border-stone-200 bg-white text-slate-700"
          >
            <MoreHorizontal className="h-5 w-5" />
            <span className="sr-only">{t(lang, "salesHistoryMoreActions")}</span>
          </button>
        </div>
      </div>

      {menuOpen && menuPlacement
        ? createPortal(
            <DebtCustomerMenuPanel
              lang={lang}
              customer={customer}
              timeline={timeline}
              canDebt={canDebt}
              payAmount={payAmount}
              showPayForm={showPayForm}
              placement={menuPlacement}
              onClose={closeMenu}
              onTogglePay={() => setShowPayForm((v) => !v)}
              onPayAmountChange={setPayAmount}
              onSubmitPay={() => {
                const n = Math.floor(Number(payAmount.replace(/\D/g, "")) || 0);
                if (n <= 0) return;
                onSubmitPay(customer.id, n);
                closeMenu();
              }}
            />,
            document.body,
          )
        : null}
    </div>
  );
}
