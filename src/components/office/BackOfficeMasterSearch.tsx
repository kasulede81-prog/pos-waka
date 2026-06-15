import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import clsx from "clsx";
import { Search, X } from "lucide-react";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { useSessionActor } from "../../context/SessionActorContext";
import { useSubscription } from "../../context/SubscriptionContext";
import { usePosStore } from "../../store/usePosStore";
import { canRecordCashExpenses } from "../../lib/cashExpenses";
import { isHospitalityMode } from "../../lib/hospitality";
import { isWholesaleMode } from "../../lib/wholesale";
import { usePharmacyTerms } from "../../lib/pharmacyTerms";
import { useHospitalityTerms } from "../../lib/hospitalityTerms";
import { useWholesaleTerms } from "../../lib/wholesaleTerms";
import {
  buildBackOfficeSearchCatalog,
  filterBackOfficeSearch,
  type ResolvedBackOfficeSearchEntry,
} from "../../lib/backOfficeSearchCatalog";

type Props = { lang: Language; className?: string };

export function BackOfficeMasterSearch({ lang, className }: Props) {
  const navigate = useNavigate();
  const actor = useSessionActor();
  const preferences = usePosStore((s) => s.preferences);
  const { snapshot, authMode } = useSubscription();
  const pt = usePharmacyTerms(lang, preferences.businessType, preferences.pharmacyModeEnabled);
  const ht = useHospitalityTerms(lang, preferences.businessType, preferences.hospitalityModeEnabled);
  const wt = useWholesaleTerms(lang, preferences.businessType);
  const modeTerm = isHospitalityMode(preferences.businessType, preferences.hospitalityModeEnabled)
    ? ht
    : isWholesaleMode(preferences.businessType)
      ? wt
      : pt;

  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const translate = useCallback(
    (key: string) => {
      if (key === "officeCardStock" || key === "officeCardStockSub") return modeTerm(key);
      if (key === "customers") return modeTerm("customers");
      return t(lang, key);
    },
    [lang, modeTerm],
  );

  const catalog = useMemo(
    () =>
      buildBackOfficeSearchCatalog({
        lang,
        role: actor.role,
        preferences,
        snapshot,
        authMode,
        t: translate,
        canRecordExpense: canRecordCashExpenses(actor.role, preferences),
      }),
    [lang, actor.role, preferences, snapshot, authMode, translate],
  );

  const results = useMemo(() => filterBackOfficeSearch(catalog, query), [catalog, query]);

  const pick = useCallback(
    (entry: ResolvedBackOfficeSearchEntry) => {
      setQuery("");
      setOpen(false);
      navigate(entry.path);
    },
    [navigate],
  );

  useEffect(() => {
    if (!open) return;
    const onDocDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocDown);
    return () => document.removeEventListener("mousedown", onDocDown);
  }, [open]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      setQuery("");
      setOpen(false);
      inputRef.current?.blur();
      return;
    }
    if (e.key === "Enter" && results[0]) {
      e.preventDefault();
      pick(results[0]);
    }
  };

  const showDropdown = open && query.trim().length > 0;

  return (
    <div ref={rootRef} className={clsx("relative", className)}>
      <label className="sr-only" htmlFor="back-office-master-search">
        {t(lang, "backOfficeSearchLabel")}
      </label>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" aria-hidden />
        <input
          ref={inputRef}
          id="back-office-master-search"
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={t(lang, "backOfficeSearchPlaceholder")}
          autoComplete="off"
          enterKeyHint="search"
          className="w-full min-h-[44px] rounded-2xl border border-stone-200 bg-stone-50 py-2.5 pl-10 pr-10 text-sm font-semibold text-stone-900 shadow-sm outline-none ring-waka-400 placeholder:font-medium placeholder:text-stone-400 focus:border-waka-400 focus:bg-white focus:ring-2"
        />
        {query ? (
          <button
            type="button"
            onClick={() => {
              setQuery("");
              inputRef.current?.focus();
            }}
            className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-xl text-stone-500 hover:bg-stone-100"
            aria-label={t(lang, "backOfficeSearchClear")}
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        ) : null}
      </div>

      {showDropdown ? (
        <ul
          role="listbox"
          className="absolute z-50 mt-1.5 max-h-[min(22rem,50dvh)] w-full overflow-y-auto rounded-2xl border border-stone-200 bg-white py-1 shadow-lg ring-1 ring-stone-900/5"
        >
          {results.length === 0 ? (
            <li className="px-4 py-3 text-sm font-semibold text-stone-500">{t(lang, "backOfficeSearchEmpty")}</li>
          ) : (
            results.map((entry) => (
              <li key={entry.id} role="option">
                <button
                  type="button"
                  onClick={() => pick(entry)}
                  className="flex w-full flex-col gap-0.5 px-4 py-2.5 text-left hover:bg-waka-50 active:bg-waka-100"
                >
                  <span className="text-sm font-black text-stone-950">{entry.title}</span>
                  {entry.subtitle ? (
                    <span className="line-clamp-1 text-xs font-medium text-stone-500">{entry.subtitle}</span>
                  ) : null}
                  <span className="text-[10px] font-bold uppercase tracking-wide text-stone-400">{entry.section}</span>
                </button>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
