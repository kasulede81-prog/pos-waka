import { useRef, useState } from "react";
import { CircleHelp } from "lucide-react";
import clsx from "clsx";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { AppModalOverlay } from "../layout/AppModalOverlay";
import {
  POS_SUPPORT_CATEGORIES,
  POS_SUPPORT_CATEGORY_LABEL_KEYS,
  canSeePosNeedHelp,
  submitPosSupportTicket,
  tryBeginPosHelpSubmit,
  type PosSupportSubmitResult,
} from "../../lib/posSupportRequest";

type Props = {
  lang: Language;
  shopId: string | null;
  role?: string | null;
  authenticated: boolean;
  internalAdminRoute: boolean;
  posLocked: boolean;
  placement: "inline" | "floating";
  inverted?: boolean;
};

function errorCopy(lang: Language, result: Extract<PosSupportSubmitResult, { ok: false }>): string {
  if (result.error === "offline") return t(lang, "posHelpOffline");
  if (result.error === "description_required") return t(lang, "posHelpDescriptionRequired");
  if (result.error === "shop_unavailable") return t(lang, "posHelpShopUnavailable");
  return t(lang, "posHelpFailed");
}

export function PosNeedHelpHost({
  lang,
  shopId,
  role,
  authenticated,
  internalAdminRoute,
  posLocked,
  placement,
  inverted,
}: Props) {
  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submitting = useRef(false);

  if (!canSeePosNeedHelp({ authenticated, internalAdminRoute, posLocked })) return null;

  const reset = () => {
    setDescription("");
    setCategory("");
    setBusy(false);
    setSent(false);
    setError(null);
    submitting.current = false;
  };

  const close = () => {
    if (busy) return;
    setOpen(false);
    reset();
  };

  const submit = async () => {
    if (busy || !tryBeginPosHelpSubmit(submitting)) return;
    setBusy(true);
    setError(null);
    const result = await submitPosSupportTicket({
      shopId,
      description,
      category: category || null,
      role,
    });
    setBusy(false);
    submitting.current = false;
    if (!result.ok) {
      setError(errorCopy(lang, result));
      return;
    }
    setSent(true);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          setSent(false);
          setError(null);
        }}
        className={clsx(
          "flex min-h-[38px] touch-manipulation items-center gap-1 rounded-xl border px-2.5 py-1.5 text-xs font-bold shadow-sm",
          placement === "floating" &&
            "fixed right-[max(0.75rem,env(safe-area-inset-right,0px))] top-[max(0.75rem,env(safe-area-inset-top,0px))] z-[45]",
          inverted
            ? "border-waka-400/50 bg-waka-700/50 text-white active:bg-waka-700"
            : "border-border bg-card text-foreground active:bg-muted",
        )}
        aria-label={t(lang, "posHelpAria")}
      >
        <CircleHelp className="h-4 w-4" strokeWidth={2.25} aria-hidden />
        {t(lang, "posHelpButton")}
      </button>

      {open ? (
        <AppModalOverlay className="z-[80] flex items-center justify-center bg-overlay/55 p-4" role="dialog" aria-modal>
          <div className="w-full max-w-md rounded-3xl border border-border bg-card p-5 shadow-2xl">
            {sent ? (
              <>
                <h2 className="text-lg font-black text-foreground">{t(lang, "posHelpSentTitle")}</h2>
                <p className="mt-2 text-sm font-medium text-muted-foreground">{t(lang, "posHelpSentBody")}</p>
                <button
                  type="button"
                  onClick={close}
                  className="mt-5 min-h-[48px] w-full rounded-2xl bg-waka-600 text-base font-black text-white"
                >
                  {t(lang, "posHelpDone")}
                </button>
              </>
            ) : (
              <>
                <h2 className="text-lg font-black text-foreground">{t(lang, "posHelpTitle")}</h2>
                <p className="mt-1 text-sm font-medium text-muted-foreground">{t(lang, "posHelpLead")}</p>
                <label className="mt-4 block">
                  <span className="text-sm font-black text-foreground">{t(lang, "posHelpCategoryLabel")}</span>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    disabled={busy}
                    className="mt-1 min-h-[44px] w-full rounded-xl border border-border bg-card px-3 text-sm font-semibold text-foreground"
                  >
                    <option value="">{t(lang, "posHelpCategoryOptional")}</option>
                    {POS_SUPPORT_CATEGORIES.map((value) => (
                      <option key={value} value={value}>
                        {t(lang, POS_SUPPORT_CATEGORY_LABEL_KEYS[value])}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="mt-3 block">
                  <span className="text-sm font-black text-foreground">{t(lang, "posHelpDescriptionLabel")}</span>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    disabled={busy}
                    rows={4}
                    className="mt-1 w-full rounded-xl border border-border px-3 py-2 text-sm font-semibold"
                    placeholder={t(lang, "posHelpDescriptionPlaceholder")}
                  />
                </label>
                {error ? <p className="mt-2 text-sm font-semibold text-rose-800">{error}</p> : null}
                <div className="mt-5 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={close}
                    className="min-h-[48px] rounded-2xl border-2 border-border text-sm font-bold disabled:opacity-50"
                  >
                    {t(lang, "cancel")}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void submit()}
                    className="min-h-[48px] rounded-2xl bg-waka-600 text-sm font-black text-white disabled:opacity-50"
                  >
                    {busy ? t(lang, "posHelpSending") : t(lang, "posHelpSend")}
                  </button>
                </div>
              </>
            )}
          </div>
        </AppModalOverlay>
      ) : null}
    </>
  );
}
