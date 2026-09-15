import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Store } from "lucide-react";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import type { CachedShop, RememberedStaffDevice, StaffLoginInput, StaffCredentialRecoveryRequiredError } from "../../lib/staffOfflineAuth";
import { StaffRecoveryCredentialSetup } from "./StaffRecoveryCredentialSetup";
import { EnterprisePinPad } from "./EnterprisePinPad";
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
  const [rememberDevice, setRememberDevice] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pinResetSignal, setPinResetSignal] = useState(0);
  const [recoverySetup, setRecoverySetup] = useState<{
    shopId: string;
    staffId: string;
    staffName: string;
  } | null>(null);

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

  const submitWithPin = useCallback(
    async (pin: string) => {
      if (busy) return false;
      if (!businessName.trim() || !identifier.trim()) {
        setError(t(lang, "staffLoginMissingFields"));
        setPinResetSignal((n) => n + 1);
        return false;
      }
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
        return true;
      } catch (err) {
        if (
          err &&
          typeof err === "object" &&
          "code" in err &&
          (err as StaffCredentialRecoveryRequiredError).code === "staff_credential_recovery_required"
        ) {
          const recovery = err as StaffCredentialRecoveryRequiredError;
          if (recovery.shopId) {
            setRecoverySetup({
              shopId: recovery.shopId,
              staffId: recovery.staffId,
              staffName: recovery.staffName,
            });
            setError(null);
            return false;
          }
        }
        setError(err instanceof Error ? err.message : t(lang, "saleError"));
        setPinResetSignal((n) => n + 1);
        return false;
      } finally {
        setBusy(false);
      }
    },
    [busy, businessName, identifier, rememberDevice, onSubmit, lang],
  );

  return (
    <div className="space-y-5">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex min-h-[44px] items-center gap-2 text-sm font-bold text-muted-foreground dark:text-muted-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        {t(lang, "staffLoginBack")}
      </button>

      <div className="flex flex-col items-center text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-waka-50 ring-1 ring-waka-100 dark:bg-waka-950/40 dark:ring-waka-900/50">
          <WakaSymbolIcon size="md" className="!h-10 !w-10" />
        </div>
        <h2 className="mt-4 text-2xl font-black text-foreground dark:text-background">{t(lang, "staffLoginTitle")}</h2>
        <p className="mt-1 text-sm font-medium text-muted-foreground dark:text-muted-foreground">{t(lang, "staffLoginSub")}</p>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
        }}
        className="space-y-4"
      >
        <label className="block text-sm font-bold text-foreground dark:text-muted-foreground">
          {t(lang, "staffLoginBusinessName")}
          <div className="relative mt-1.5">
            <Store className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              list="staff-shop-suggestions"
              value={businessName}
              onChange={(e) => setBusinessName(e.target.value)}
              required
              placeholder={t(lang, "staffLoginBusinessName")}
              className="w-full min-h-[48px] rounded-xl border border-border bg-card py-3 pl-10 pr-4 text-base dark:bg-foreground"
            />
            <datalist id="staff-shop-suggestions">
              {shopSuggestions.map((s) => (
                <option key={s.accountKey} value={s.businessName} />
              ))}
            </datalist>
          </div>
          <p className="mt-1 text-xs font-medium text-muted-foreground">
            {loadingShops ? t(lang, "staffLoginLoadingShops") : t(lang, "staffLoginBusinessHint")}
          </p>
        </label>

        <label className="block text-sm font-bold text-foreground dark:text-muted-foreground">
          {t(lang, "staffLoginName")}
          <input
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            required
            placeholder={t(lang, "staffLoginNamePh")}
            className="mt-1.5 w-full min-h-[48px] rounded-xl border border-border bg-card px-4 py-3 text-base dark:bg-foreground"
          />
        </label>

        <div>
          <p className="text-sm font-bold text-foreground dark:text-muted-foreground">{t(lang, "staffLoginPin")}</p>
          <EnterprisePinPad
            lang={lang}
            disabled={busy}
            verifying={busy}
            errorMessage={error}
            resetSignal={pinResetSignal}
            onComplete={(pin) => submitWithPin(pin)}
            className="mt-3"
          />
        </div>

        <WakaSwitch
          checked={rememberDevice}
          onCheckedChange={setRememberDevice}
          label={t(lang, "staffLoginRememberDevice")}
          className="text-sm font-semibold text-muted-foreground dark:text-muted-foreground"
        />

        {rememberedStaffDevice ? (
          <button
            type="button"
            onClick={onClearRemembered}
            className="text-xs font-bold text-muted-foreground underline"
          >
            {t(lang, "staffLoginClearRemembered")}
          </button>
        ) : null}
      </form>

      {recoverySetup ? (
        <StaffRecoveryCredentialSetup
          lang={lang}
          open
          shopId={recoverySetup.shopId}
          staffId={recoverySetup.staffId}
          staffName={recoverySetup.staffName}
          onClose={() => setRecoverySetup(null)}
          onComplete={(newPin) => {
            setRecoverySetup(null);
            void submitWithPin(newPin);
          }}
        />
      ) : null}
    </div>
  );
}
