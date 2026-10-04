import { Store } from "lucide-react";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import type { StaffShopOption } from "../../lib/staffLogin";
import { EnterpriseSpinner } from "../enterprise/EnterpriseSpinner";

type Props =
  | { state: "resolving"; lang: Language }
  | {
      state: "choose";
      lang: Language;
      shops: StaffShopOption[];
      selectedShopId: string | null;
      busy: boolean;
      error: string | null;
      onSelect: (shopId: string) => void;
      onSignOut: () => void;
    }
  | {
      state: "none";
      lang: Language;
      signedInAs: string | null;
      busy: boolean;
      error: string | null;
      onSignOut: () => void;
    };

/** Shared link/button styling for the gate's actions. */
const actionClass =
  "inline-flex min-h-[48px] w-full items-center justify-center rounded-xl px-5 text-sm font-black transition disabled:cursor-not-allowed disabled:opacity-60";

/**
 * What a staff member sees between Google sign-in and the POS.
 *
 * Three states, all of which must be unambiguous about what is happening and what they can do:
 *   resolving — the server is being asked which shops this account may open
 *   choose    — more than one, so the person picks (never a silent choice)
 *   none      — no shop this account can open; an error, with a way to switch Google account
 *
 * Accessibility: the resolving state is a live region, the shop list is a real button list with
 * `aria-pressed` on the chosen one and a `role="alert"` for failures, so the state change and any
 * error are announced rather than only shown.
 */
export function StaffShopGate(props: Props) {
  const { lang } = props;

  if (props.state === "resolving") {
    return (
      <div className="flex flex-col items-center gap-3 py-12" role="status" aria-live="polite" aria-busy="true">
        <EnterpriseSpinner size="lg" label={t(lang, "loginStaffChecking")} />
        <p className="text-center text-sm font-semibold text-muted-foreground">{t(lang, "loginStaffChecking")}</p>
      </div>
    );
  }

  if (props.state === "none") {
    return (
      <div className="space-y-4" data-testid="staff-login-no-access">
        <h2 className="text-center text-lg font-black text-foreground">{t(lang, "loginStaffNoAccessTitle")}</h2>
        <p role="alert" className="rounded-xl bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900">
          {t(lang, "loginStaffNoAccessBody")}
        </p>
        {props.signedInAs ? (
          <p className="rounded-xl bg-muted px-3 py-2 text-xs font-semibold text-foreground">
            {t(lang, "staffInviteSignedInAs")}: {props.signedInAs}
          </p>
        ) : null}
        {props.error ? (
          <p role="alert" className="text-sm font-semibold text-red-700">
            {props.error}
          </p>
        ) : null}
        {/* NEVER disabled — see the note on the picker's sign-out below. */}
        <button
          type="button"
          onClick={props.onSignOut}
          className={`${actionClass} border border-border bg-card text-foreground`}
          data-testid="staff-gate-signout"
        >
          {t(lang, "loginStaffSignOut")}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="staff-login-shop-picker">
      <div className="text-center">
        <h2 className="text-lg font-black text-foreground">{t(lang, "loginStaffChooseShopTitle")}</h2>
        <p className="mt-1 text-sm font-semibold text-muted-foreground">{t(lang, "loginStaffChooseShopSub")}</p>
      </div>

      <ul className="space-y-2" aria-label={t(lang, "loginStaffChooseShopTitle")}>
        {props.shops.map((shop) => {
          const selected = props.selectedShopId === shop.shopId;
          return (
            <li key={shop.shopId}>
              <button
                type="button"
                disabled={props.busy}
                aria-pressed={selected}
                aria-busy={selected && props.busy}
                onClick={() => props.onSelect(shop.shopId)}
                className={`flex min-h-[56px] w-full items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left transition disabled:cursor-not-allowed disabled:opacity-70 ${
                  selected ? "border-waka-400 bg-waka-50" : "border-border bg-card"
                }`}
                data-testid={`staff-shop-option-${shop.shopId}`}
              >
                <span className="inline-flex min-w-0 items-center gap-3">
                  <Store className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-black text-foreground">{shop.shopName}</span>
                    {shop.role ? (
                      <span className="block truncate text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        {t(lang, `role_${shop.role}`)}
                      </span>
                    ) : null}
                  </span>
                </span>
                {selected && props.busy ? (
                  <span className="shrink-0 text-xs font-bold text-muted-foreground">
                    {t(lang, "loginStaffChooseShopWorking")}
                  </span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>

      {/* An explicit working state, so an in-flight selection is never a silently inert screen. */}
      {props.busy ? (
        <p role="status" aria-live="polite" className="text-center text-xs font-semibold text-muted-foreground">
          {t(lang, "loginStaffChooseShopWorking")}
        </p>
      ) : null}

      {props.error ? (
        <p role="alert" className="text-sm font-semibold text-red-700">
          {props.error}
        </p>
      ) : null}

      {/*
        THE ESCAPE HATCH — deliberately never `disabled`.
        Every other control here may be inert while something is in flight; this one may not, or a
        stuck flag leaves the person on a screen with no way off it. Double-taps are absorbed by the
        callback's own latch, which is independent of `busy` for exactly this reason.
      */}
      <button
        type="button"
        onClick={props.onSignOut}
        className="inline-flex min-h-[44px] w-full items-center justify-center text-xs font-bold text-muted-foreground underline"
        data-testid="staff-gate-signout"
      >
        {t(lang, "loginStaffSignOut")}
      </button>
    </div>
  );
}
