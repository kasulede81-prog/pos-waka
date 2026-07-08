import { useState } from "react";
import type { ShopOpsDetail } from "../../lib/wakaInternalAdmin";
import {
  adminShopResetBackOfficePin,
  adminShopSendOwnerPasswordReset,
  adminShopSetOwnerPasswordDirect,
} from "../../lib/wakaInternalAdmin";
import { sendOwnerPasswordResetEmail } from "../../lib/shopRecoverySignals";

type Props = {
  shopId: string;
  detail: ShopOpsDetail | null;
  busy: boolean;
  previewMode: boolean;
  onBusy: (busy: boolean) => void;
  onToast: (toast: { kind: "ok" | "err"; text: string }) => void;
  onDone?: () => void;
};

export function AccountRecoveryPanel({
  shopId,
  detail,
  busy,
  previewMode,
  onBusy,
  onToast,
  onDone,
}: Props) {
  const ownerEmail =
    detail?.owner_email?.trim().toLowerCase() ||
    (detail?.owner_label?.includes("@") ? detail.owner_label.trim().toLowerCase() : "");

  const [directPassword, setDirectPassword] = useState("");
  const [directConfirm, setDirectConfirm] = useState("");

  const run = async (fn: () => Promise<{ ok: boolean; message?: string }>, okText: string) => {
    if (previewMode) {
      onToast({ kind: "err", text: "Preview mode — action blocked." });
      return;
    }
    if (!window.confirm("Continue with this recovery action?")) return;
    onBusy(true);
    const r = await fn();
    onBusy(false);
    if (r.ok) {
      onToast({ kind: "ok", text: okText });
      onDone?.();
    } else {
      onToast({ kind: "err", text: r.message ?? "Action failed." });
    }
  };

  return (
    <section className="rounded-2xl border-2 border-amber-200 bg-amber-50/90 p-4 shadow-sm">
      <p className="text-[10px] font-black uppercase tracking-wide text-amber-900">Account recovery</p>
      <h2 className="mt-0.5 text-base font-black text-stone-900">Reset login &amp; back office PIN</h2>
      <p className="mt-1 text-xs font-medium text-stone-700">
        Use when the shop owner forgot their sign-in password or back office / lock PIN.
      </p>
      {ownerEmail ? (
        <p className="mt-2 font-mono text-xs text-stone-800">
          Owner: <span className="font-bold">{ownerEmail}</span>
        </p>
      ) : (
        <p className="mt-2 text-xs font-semibold text-rose-800">No owner email on file for this shop.</p>
      )}
      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <button
          type="button"
          disabled={busy || !ownerEmail}
          className="min-h-[48px] flex-1 rounded-xl border-2 border-stone-300 bg-white px-4 text-sm font-black text-stone-900 disabled:opacity-40"
          onClick={() =>
            void run(async () => {
              const audit = await adminShopSendOwnerPasswordReset(shopId);
              if (!audit.ok) return audit;
              const target = audit.ownerEmail ?? ownerEmail;
              if (!target) return { ok: false, message: "No owner email on file." };
              const sent = await sendOwnerPasswordResetEmail(target);
              if (!sent.ok) return sent;
              return { ok: true, message: `Password reset email sent to ${target}.` };
            }, `Password reset email sent to ${ownerEmail}.`)
          }
        >
          Send login password reset
        </button>
        <button
          type="button"
          disabled={busy}
          className="min-h-[48px] flex-1 rounded-xl bg-rose-600 px-4 text-sm font-black text-white disabled:opacity-40"
          onClick={() =>
            void run(
              () => adminShopResetBackOfficePin(shopId),
              "Back office PIN cleared on the server. It applies automatically when the owner opens Waka POS online.",
            )
          }
        >
          Clear back office PIN
        </button>
      </div>
      <div className="mt-4 rounded-xl border border-violet-200 bg-white/90 p-3">
        <p className="text-xs font-black text-violet-950">Set password now (no email link)</p>
        <p className="mt-1 text-[11px] font-medium text-stone-600">
          Owner signs in with this password immediately. Share it by phone or WhatsApp only.
        </p>
        <input
          type="password"
          autoComplete="new-password"
          value={directPassword}
          onChange={(e) => setDirectPassword(e.target.value)}
          placeholder="New password (8+ characters)"
          className="mt-2 w-full rounded-lg border border-stone-200 px-3 py-2 text-sm"
        />
        <input
          type="password"
          autoComplete="new-password"
          value={directConfirm}
          onChange={(e) => setDirectConfirm(e.target.value)}
          placeholder="Confirm password"
          className="mt-2 w-full rounded-lg border border-stone-200 px-3 py-2 text-sm"
        />
        <button
          type="button"
          disabled={busy || !detail?.shop.id}
          className="mt-2 min-h-[44px] w-full rounded-xl bg-violet-700 px-4 text-sm font-black text-white disabled:opacity-40"
          onClick={() =>
            void run(async () => {
              if (directPassword.length < 8) return { ok: false, message: "Password must be at least 8 characters." };
              if (directPassword !== directConfirm) return { ok: false, message: "Passwords do not match." };
              const r = await adminShopSetOwnerPasswordDirect(detail!.shop.id, directPassword);
              if (r.ok) {
                setDirectPassword("");
                setDirectConfirm("");
              }
              return r;
            }, "Owner login password updated.")
          }
        >
          Set login password now
        </button>
      </div>

      <ul className="mt-3 list-disc space-y-1 pl-4 text-[11px] font-medium text-stone-600">
        <li>Email reset sends a link only if the owner has a real email on file (not a phone-only login).</li>
        <li>Back office PIN is cleared on the server; the owner must open Waka POS while online.</li>
        <li>Staff switch-user PINs are reset in Settings → Staff on the owner device.</li>
      </ul>
    </section>
  );
}
