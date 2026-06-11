import { useState } from "react";
import { Loader2 } from "lucide-react";
import { adminResetShopAiSetup, generateBusinessSetupWithAi } from "../../../lib/ai/businessSetupAi";

type Props = {
  shopId: string;
  shopName: string;
  businessType: string;
  canManage: boolean;
  previewMode?: boolean;
};

export function AdminAiSetupPanel({ shopId, shopName, businessType, canManage, previewMode = false }: Props) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const run = async (fn: () => Promise<{ ok: boolean; error?: string }>, okText: string) => {
    if (busy || previewMode || !canManage) return;
    setBusy(true);
    setMessage(null);
    const res = await fn();
    setBusy(false);
    setMessage(res.ok ? okText : `Failed: ${res.error ?? "unknown error"}`);
  };

  return (
    <div className="space-y-3 text-sm">
      <p className="font-semibold text-stone-600">
        Reset onboarding AI setup so the shop can receive fresh shelves and starter products on next onboarding visit.
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy || !canManage || previewMode}
          className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-violet-300 bg-violet-50 px-4 text-xs font-black text-violet-950 disabled:opacity-40"
          onClick={() =>
            void run(async () => {
              const reset = await adminResetShopAiSetup(shopId);
              if (!reset.ok) return reset;
              const gen = await generateBusinessSetupWithAi({
                shopId,
                shopName,
                businessType,
                forceRegenerate: true,
              });
              return gen.ok ? { ok: true } : { ok: false, error: gen.error };
            }, "AI setup reset and regenerated.")
          }
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Regenerate AI setup
        </button>
        <button
          type="button"
          disabled={busy || !canManage || previewMode}
          className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-stone-300 px-4 text-xs font-black text-stone-800 disabled:opacity-40"
          onClick={() => void run(() => adminResetShopAiSetup(shopId), "AI setup cleared — shop can run setup again.")}
        >
          Clear AI setup only
        </button>
      </div>
      {message ? <p className="rounded-xl bg-stone-100 px-3 py-2 text-xs font-semibold text-stone-800">{message}</p> : null}
    </div>
  );
}
