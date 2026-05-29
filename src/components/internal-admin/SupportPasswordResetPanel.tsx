import { useState } from "react";
import { adminShopSetOwnerPasswordDirect, resolveShopIdForAdmin } from "../../lib/wakaInternalAdmin";
import { isWakaShopNumberInput } from "../../lib/shopNumber";

type Props = {
  previewMode: boolean;
  onToast: (toast: { kind: "ok" | "err"; text: string }) => void;
};

export function SupportPasswordResetPanel({ previewMode, onToast }: Props) {
  const [shopId, setShopId] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (previewMode) {
      onToast({ kind: "err", text: "Preview mode — action blocked." });
      return;
    }
    const idInput = shopId.trim();
    let id = idInput;
    if (isWakaShopNumberInput(idInput)) {
      const resolved = await resolveShopIdForAdmin(idInput);
      if (!resolved) {
        onToast({ kind: "err", text: `No shop found for number ${idInput.toUpperCase()}.` });
        return;
      }
      id = resolved;
    } else if (!id) {
      onToast({ kind: "err", text: "Enter shop number (e.g. A001) or shop UUID." });
      return;
    }
    if (password.length < 8) {
      onToast({ kind: "err", text: "Password must be at least 8 characters." });
      return;
    }
    if (password !== confirm) {
      onToast({ kind: "err", text: "Passwords do not match." });
      return;
    }
    if (!window.confirm("Set this login password immediately? The owner can sign in with it right away.")) return;

    setBusy(true);
    const r = await adminShopSetOwnerPasswordDirect(id, password);
    setBusy(false);
    if (r.ok) {
      setPassword("");
      setConfirm("");
      onToast({ kind: "ok", text: "Owner login password updated. Tell them the new password securely." });
    } else {
      onToast({ kind: "err", text: r.message ?? "Could not set password." });
    }
  };

  return (
    <section className="rounded-2xl border-2 border-violet-200 bg-violet-50/80 p-4 shadow-sm">
      <p className="text-[10px] font-black uppercase tracking-wide text-violet-900">Support tools</p>
      <h2 className="mt-0.5 text-base font-black text-stone-900">Set owner login password (no email)</h2>
      <p className="mt-1 text-xs font-medium text-stone-700">
        Use when the owner forgot their password and has no email access. Requires the deployed{" "}
        <span className="font-mono">admin-set-owner-password</span> edge function.
      </p>
      <label className="mt-3 block text-xs font-bold text-stone-800">
        Shop number or UUID
        <input
          value={shopId}
          onChange={(e) => setShopId(e.target.value)}
          placeholder="A001 or xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
          className="mt-1 w-full rounded-xl border border-stone-200 bg-white px-3 py-2.5 font-mono text-xs"
        />
      </label>
      <label className="mt-2 block text-xs font-bold text-stone-800">
        New password
        <input
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mt-1 w-full rounded-xl border border-stone-200 bg-white px-3 py-2.5 text-sm"
        />
      </label>
      <label className="mt-2 block text-xs font-bold text-stone-800">
        Confirm password
        <input
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className="mt-1 w-full rounded-xl border border-stone-200 bg-white px-3 py-2.5 text-sm"
        />
      </label>
      <button
        type="button"
        disabled={busy}
        onClick={() => void submit()}
        className="mt-3 min-h-[48px] w-full rounded-xl bg-violet-700 px-4 text-sm font-black text-white disabled:opacity-50"
      >
        {busy ? "Updating…" : "Set password now"}
      </button>
    </section>
  );
}
