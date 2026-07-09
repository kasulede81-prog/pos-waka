import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import clsx from "clsx";
import { ArrowLeft, Store } from "lucide-react";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import type { CachedShop, RememberedStaffDevice, StaffLoginInput } from "../../lib/staffOfflineAuth";
import { EnterprisePinKeypad } from "./EnterprisePinKeypad";
import { WakaSymbolIcon } from "../brand/WakaLogo";
import { WakaSwitch } from "../enterprise/WakaSwitch";

type Props = {
  lang: Language;
  onSubmit: (input: StaffLoginInput) => Promise<void>;
  listStaffShops: () => Promise<CachedShop[]>;
  rememberedStaffDevice: RememberedStaffDevice | null;
  onClearRemembered: () => void;
  onBack: () => void;
};

export function EnterpriseStaffLoginPanel({
  lang,
  onSubmit,
  listStaffShops,
  rememberedStaffDevice,
  onClearRemembered,
  onBack,
}: Props) {
  const [shops, setShops] = useState<CachedShop[]>([]);
  const [loadingShops, setLoadingShops] = useState(true);
  const [businessName, setBusinessName] = useState(rememberedStaffDevice?.businessName ?? "");
  const [identifier, setIdentifier] = useState(rememberedStaffDevice?.identifier ?? "");
  const [pin, setPin] = useState("");
  const [rememberDevice, setRememberDevice] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void listStaffShops().then((rows) => {
      if (cancelled) return;
      setShops(rows);
      setLoadingShops(false);
    });
    return () => {
      cancelled = true;
    };
  }, [listStaffShops]);

  const shopSuggestions = useMemo(() => {
    const probe = businessName.trim().toLowerCase();
    if (!probe) return shops.slice(0, 6);
    return shops.filter((s) => s.businessName.toLowerCase().includes(probe)).slice(0, 6);
  }, [businessName, shops]);

  const submit = useCallback(
    async (e?: FormEvent) => {
      e?.preventDefault();
      if (busy) return;
      setBusy(true);
      setError(null);
      try {
        await onSubmit({
          businessName: businessName.trim(),
          role: "cashier",
          identifier: identifier.trim(),
          pinOrPassword: pin,
          rememberDevice,
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : t(lang, "saleError"));
      } finally {
        setBusy(false);
      }
    },
    [busy, businessName, identifier, pin, rememberDevice, onSubmit, lang],
  );

  return (
    <div className="space-y-5">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex min-h-[44px] items-center gap-2 text-sm font-bold text-stone-600 dark:text-stone-400"
      >
        <ArrowLeft className="h-4 w-4" />
        {t(lang, "staffLoginBack")}
      </button>

      <div className="flex flex-col items-center text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-waka-50 ring-1 ring-waka-100 dark:bg-waka-950/40 dark:ring-waka-900/50">
          <WakaSymbolIcon size="md" className="!h-10 !w-10" />
        </div>
        <h2 className="mt-4 text-2xl font-black text-stone-900 dark:text-stone-50">{t(lang, "staffLoginTitle")}</h2>
        <p className="mt-1 text-sm font-medium text-stone-600 dark:text-stone-400">{t(lang, "staffLoginSub")}</p>
      </div>

      <form onSubmit={(e) => void submit(e)} className="space-y-4">
        <label className="block text-sm font-bold text-stone-800 dark:text-stone-200">
          {t(lang, "staffLoginBusinessName")}
          <div className="relative mt-1.5">
            <Store className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
            <input
              list="staff-shop-suggestions"
              value={businessName}
              onChange={(e) => setBusinessName(e.target.value)}
              required
              placeholder={t(lang, "staffLoginBusinessName")}
              className="w-full min-h-[48px] rounded-xl border border-stone-200 bg-white py-3 pl-10 pr-4 text-base dark:border-stone-700 dark:bg-stone-900"
            />
            <datalist id="staff-shop-suggestions">
              {shopSuggestions.map((s) => (
                <option key={s.accountKey} value={s.businessName} />
              ))}
            </datalist>
          </div>
          <p className="mt-1 text-xs font-medium text-stone-500">
            {loadingShops ? t(lang, "staffLoginLoadingShops") : t(lang, "staffLoginBusinessHint")}
          </p>
        </label>

        <label className="block text-sm font-bold text-stone-800 dark:text-stone-200">
          {t(lang, "staffLoginName")}
          <input
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            required
            placeholder={t(lang, "staffLoginNamePh")}
            className="mt-1.5 w-full min-h-[48px] rounded-xl border border-stone-200 bg-white px-4 py-3 text-base dark:border-stone-700 dark:bg-stone-900"
          />
        </label>

        <div>
          <p className="text-sm font-bold text-stone-800 dark:text-stone-200">{t(lang, "staffLoginPin")}</p>
          <EnterprisePinKeypad
            lang={lang}
            value={pin}
            onChange={setPin}
            onSubmit={() => void submit()}
            disabled={busy}
            className="mt-3"
          />
        </div>

        <WakaSwitch
          checked={rememberDevice}
          onCheckedChange={setRememberDevice}
          label={t(lang, "staffLoginRememberDevice")}
          className="text-sm font-semibold text-stone-700 dark:text-stone-300"
        />

        {rememberedStaffDevice ? (
          <button
            type="button"
            onClick={onClearRemembered}
            className="text-xs font-bold text-stone-500 underline"
          >
            {t(lang, "staffLoginClearRemembered")}
          </button>
        ) : null}

        {error ? (
          <p className="rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-red-700 dark:bg-red-950/40 dark:text-red-300">
            {error}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={busy || pin.length < 4}
          className={clsx(
            "min-h-[52px] w-full rounded-xl bg-waka-600 py-3.5 text-base font-black text-white shadow-md disabled:opacity-50",
          )}
        >
          {busy ? t(lang, "staffLoginOpening") : t(lang, "staffLoginSubmit")}
        </button>
      </form>
    </div>
  );
}
