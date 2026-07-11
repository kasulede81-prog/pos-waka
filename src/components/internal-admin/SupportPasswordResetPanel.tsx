import { useState } from "react";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { adminShopSetOwnerPasswordDirect, resolveShopIdForAdmin } from "../../lib/wakaInternalAdmin";
import { isWakaShopNumberInput } from "../../lib/shopNumber";
import { EnterprisePasswordField } from "../auth/EnterprisePasswordField";

export type SupportPasswordResetToast = { kind: "ok" | "err"; text: string };

type Props = {
  lang: Language;
  previewMode: boolean;
  onToast: (toast: SupportPasswordResetToast) => void;
  onSuccess?: () => void;
};

export function SupportPasswordResetPanel({ lang, previewMode, onToast, onSuccess }: Props) {
  const [shopId, setShopId] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (previewMode) {
      onToast({ kind: "err", text: t(lang, "internalAdminPreviewBlocked") });
      return;
    }
    const idInput = shopId.trim();
    let id = idInput;
    if (isWakaShopNumberInput(idInput)) {
      const resolved = await resolveShopIdForAdmin(idInput);
      if (!resolved) {
        onToast({ kind: "err", text: t(lang, "internalAdminShopNotFound") });
        return;
      }
      id = resolved;
    } else if (!id) {
      onToast({ kind: "err", text: t(lang, "internalAdminShopIdRequired") });
      return;
    }
    if (password.length < 8) {
      onToast({ kind: "err", text: t(lang, "passwordTooShort") });
      return;
    }
    if (password !== confirm) {
      onToast({ kind: "err", text: t(lang, "passwordMismatch") });
      return;
    }
    if (!window.confirm(t(lang, "internalAdminSetPasswordConfirm"))) return;

    setBusy(true);
    const r = await adminShopSetOwnerPasswordDirect(id, password);
    setBusy(false);
    if (r.ok) {
      setPassword("");
      setConfirm("");
      onSuccess?.();
      onToast({ kind: "ok", text: t(lang, "internalAdminPasswordUpdated") });
    } else {
      onToast({ kind: "err", text: r.message ?? t(lang, "internalAdminPasswordFailed") });
    }
  };

  return (
    <section className="rounded-2xl border-2 border-violet-200 bg-violet-50/80 p-4 shadow-sm">
      <p className="text-[10px] font-black uppercase tracking-wide text-violet-900">{t(lang, "internalAdminSupportTools")}</p>
      <h2 className="mt-0.5 text-base font-black text-foreground">{t(lang, "internalAdminSetPasswordTitle")}</h2>
      <p className="mt-1 text-xs font-medium text-muted-foreground">{t(lang, "internalAdminSetPasswordSub")}</p>
      <label className="mt-3 block text-xs font-bold text-foreground">
        {t(lang, "internalAdminShopIdLabel")}
        <input
          value={shopId}
          onChange={(e) => setShopId(e.target.value)}
          placeholder={t(lang, "internalAdminShopIdPlaceholder")}
          className="mt-1 w-full rounded-xl border border-border bg-card px-3 py-2.5 font-mono text-xs"
        />
      </label>
      <EnterprisePasswordField
        lang={lang}
        label={t(lang, "newPassword")}
        autoComplete="new-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        minLength={8}
        showStrength
        loading={busy}
        wrapperClassName="mt-2"
      />
      <EnterprisePasswordField
        lang={lang}
        label={t(lang, "confirmPassword")}
        autoComplete="new-password"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        minLength={8}
        loading={busy}
        wrapperClassName="mt-2"
      />
      <button
        type="button"
        disabled={busy}
        onClick={() => void submit()}
        className="mt-3 min-h-[48px] w-full rounded-xl bg-violet-700 px-4 text-sm font-black text-white disabled:opacity-50"
      >
        {busy ? t(lang, "loadingAuth") : t(lang, "internalAdminSetPasswordButton")}
      </button>
    </section>
  );
}
