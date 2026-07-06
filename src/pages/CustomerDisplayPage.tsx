import { useEffect, useState } from "react";
import type { Language } from "../types";
import { t } from "../lib/i18n";
import { subscribeCustomerDisplay, type CustomerDisplayPayload } from "../lib/customerDisplayChannel";

export function CustomerDisplayPage({ lang }: { lang: Language }) {
  const [payload, setPayload] = useState<CustomerDisplayPayload | null>(null);

  useEffect(() => {
    return subscribeCustomerDisplay((next) => setPayload(next));
  }, []);

  const shopName = payload?.shopName ?? t(lang, "customerDisplayWaiting");
  const state = payload?.state ?? "ordering";

  return (
    <div className="flex min-h-screen flex-col bg-stone-950 text-white">
      <header className="border-b border-stone-800 px-8 py-6">
        <p className="text-sm font-bold uppercase tracking-widest text-emerald-400">{t(lang, "customerDisplayTitle")}</p>
        <h1 className="mt-1 text-4xl font-black">{shopName}</h1>
        {payload?.tableLabel ? (
          <p className="mt-2 text-xl font-semibold text-stone-300">
            {t(lang, "customerDisplayTable")}: {payload.tableLabel}
          </p>
        ) : null}
      </header>

      <main className="flex flex-1 flex-col px-8 py-6">
        {state === "thanks" ? (
          <div className="flex flex-1 flex-col items-center justify-center text-center">
            <p className="text-5xl font-black text-emerald-400">{t(lang, "customerDisplayThanks")}</p>
            <p className="mt-4 text-2xl font-semibold text-stone-300">{t(lang, "customerDisplayThanksSub")}</p>
          </div>
        ) : (
          <>
            <ul className="flex-1 space-y-3 overflow-y-auto">
              {(payload?.lines ?? []).map((line, idx) => (
                <li key={`${line.name}-${idx}`} className="flex items-baseline justify-between gap-4 border-b border-stone-800 pb-3">
                  <span className="text-2xl font-bold">
                    {line.quantity}× {line.name}
                  </span>
                  <span className="text-xl font-semibold text-stone-400">UGX {line.lineTotalUgx.toLocaleString()}</span>
                </li>
              ))}
              {!payload?.lines?.length ? (
                <li className="text-2xl font-semibold text-stone-500">{t(lang, "customerDisplayEmpty")}</li>
              ) : null}
            </ul>
            <footer className="mt-6 border-t border-stone-700 pt-6">
              <div className="flex items-end justify-between">
                <span className="text-2xl font-bold text-stone-400">{t(lang, "customerDisplayTotal")}</span>
                <span className="text-5xl font-black text-emerald-400">
                  UGX {(payload?.totalUgx ?? 0).toLocaleString()}
                </span>
              </div>
            </footer>
          </>
        )}
      </main>
    </div>
  );
}
