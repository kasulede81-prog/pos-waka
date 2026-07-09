import { useState } from "react";
import type { ShopOpsDetail } from "../../lib/wakaInternalAdmin";
import { adminPermanentlyDeleteShopAccount } from "../../lib/wakaInternalAdmin";
import { formatWakaShopNumber } from "../../lib/shopNumber";
import { WakaCheckbox } from "../enterprise/WakaCheckbox";

type Props = {
  detail: ShopOpsDetail;
  busy: boolean;
  previewMode: boolean;
  onBusy: (busy: boolean) => void;
  onToast: (toast: { kind: "ok" | "err"; text: string }) => void;
  onDeleted?: () => void;
};

export function AdminPermanentDeletePanel({ detail, busy, previewMode, onBusy, onToast, onDeleted }: Props) {
  const [confirmText, setConfirmText] = useState("");
  const [ack, setAck] = useState(false);
  const shopName = detail.shop.name;

  const runDelete = async () => {
    if (previewMode) {
      onToast({ kind: "err", text: "Preview mode — action blocked." });
      return;
    }
    if (!ack) {
      onToast({ kind: "err", text: "Check the box to confirm you understand this cannot be undone." });
      return;
    }
    const typed = confirmText.trim();
    if (typed !== "DELETE PERMANENTLY" && typed.toUpperCase() !== shopName.toUpperCase()) {
      onToast({
        kind: "err",
        text: `Type DELETE PERMANENTLY or the exact shop name: ${shopName}`,
      });
      return;
    }
    if (
      !window.confirm(
        `FINAL WARNING: Permanently delete "${shopName}"?\n\nAll sales, products, receipts, and the owner's login will be destroyed. This cannot be undone.`,
      )
    ) {
      return;
    }

    onBusy(true);
    const r = await adminPermanentlyDeleteShopAccount(detail.shop.id, typed);
    onBusy(false);

    if (r.ok) {
      onToast({
        kind: "ok",
        text: r.message ?? "Account and shop data permanently deleted.",
      });
      onDeleted?.();
    } else {
      onToast({
        kind: r.partial ? "err" : "err",
        text:
          r.message ??
          (r.partial
            ? "Shop data was removed but login still exists. Delete the user in Supabase Auth → Users, then they can register again."
            : "Permanent delete failed."),
      });
    }
  };

  return (
    <section className="rounded-2xl border-2 border-rose-400 bg-rose-50 p-4 shadow-sm">
      <p className="text-[10px] font-black uppercase tracking-wide text-rose-800">Danger zone</p>
      <h2 className="mt-0.5 text-base font-black text-rose-950">Permanently delete shop account</h2>
      <p className="mt-1 text-xs font-medium text-rose-900">
        Removes the entire organization, all shops, sales history, products, and the owner&apos;s Supabase login.
        Super admin only. Cannot be recovered.
      </p>
      <p className="mt-2 font-mono text-[11px] text-rose-800">
        Shop no. {formatWakaShopNumber(detail.shop.shop_number) ?? "—"} · ID {detail.shop.id}
      </p>

      <WakaCheckbox
        checked={ack}
        onCheckedChange={setAck}
        label="I understand this permanently deletes all business data and the owner login."
        className="mt-3 text-xs font-semibold text-rose-950"
      />

      <label className="mt-2 block text-xs font-bold text-rose-950">
        Type <span className="font-mono">DELETE PERMANENTLY</span> or the exact shop name
        <input
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          className="mt-1 w-full rounded-lg border border-rose-300 bg-white px-3 py-2 text-sm"
          autoComplete="off"
        />
      </label>

      <button
        type="button"
        disabled={busy}
        onClick={() => void runDelete()}
        className="mt-3 min-h-[48px] w-full rounded-xl bg-rose-700 px-4 text-sm font-black text-white disabled:opacity-40"
      >
        {busy ? "Deleting…" : "Permanently delete account"}
      </button>
    </section>
  );
}
