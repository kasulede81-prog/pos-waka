import { useCallback, useEffect, useState } from "react";
import type { Language } from "../../types";
import { switchActiveShop } from "../../lib/activeShopSwitch";
import { getActiveShopId } from "../../offline/shopScope";
import { listUserShops, type UserShopRow } from "../../lib/primaryShop";

type Props = {
  lang: Language;
  authMode: "supabase" | "local";
};

export function PrimaryShopSelector({ lang, authMode }: Props) {
  const [shops, setShops] = useState<UserShopRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(() => getActiveShopId());

  const load = useCallback(async () => {
    const rows = await listUserShops();
    setShops(rows);
    setActiveId(getActiveShopId() ?? rows.find((s) => s.is_primary)?.shop_id ?? rows[0]?.shop_id ?? null);
  }, []);

  useEffect(() => {
    if (authMode !== "supabase") return;
    void load();
    const onPrimary = () => void load();
    const onActive = (e: Event) => {
      const shopId = (e as CustomEvent<{ shopId?: string }>).detail?.shopId;
      if (shopId) setActiveId(shopId);
      void load();
    };
    window.addEventListener("waka:primary-shop-changed", onPrimary);
    window.addEventListener("waka:active-shop-changed", onActive);
    return () => {
      window.removeEventListener("waka:primary-shop-changed", onPrimary);
      window.removeEventListener("waka:active-shop-changed", onActive);
    };
  }, [authMode, load]);

  if (authMode !== "supabase" || shops.length < 2) return null;

  const onSelect = async (shopId: string) => {
    if (shopId === activeId) return;
    setBusy(true);
    setMsg(null);
    const result = await switchActiveShop(shopId, { updatePrimary: true });
    setBusy(false);
    if (result.ok) {
      setActiveId(shopId);
      await load();
      setMsg(lang === "lg" ? "Amaduuka gakyusiddwa." : "Active shop switched.");
    } else if (result.error === "not_member") {
      setMsg(lang === "lg" ? "Tolina lukusa ku dduuka lino." : "You are not a member of that shop.");
    } else {
      setMsg(lang === "lg" ? "Tekisobose okukyusa." : "Could not switch shop.");
    }
  };

  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <p className="text-sm font-black text-foreground">
        {lang === "lg" ? "Amaduuka go (active branch)" : "Your shops (active branch)"}
      </p>
      <p className="mt-1 text-xs font-medium text-muted-foreground">
        {lang === "lg"
          ? "Londa edduuka erikulembera ku kifaa kino — data ya buli dduuka etawulanyizibwa."
          : "Choose which branch this device operates. Each shop keeps separate local data."}
      </p>
      <select
        className="mt-3 w-full min-h-[48px] rounded-xl border border-border px-3 text-base font-semibold"
        value={activeId ?? ""}
        disabled={busy}
        onChange={(e) => void onSelect(e.target.value)}
      >
        {shops.map((s) => (
          <option key={s.shop_id} value={s.shop_id}>
            {s.shop_name || s.shop_id.slice(0, 8)}
            {s.shop_id === activeId ? " ★" : ""}
          </option>
        ))}
      </select>
      {msg ? <p className="mt-2 text-sm font-semibold text-waka-700">{msg}</p> : null}
    </div>
  );
}
