import { useCallback, useEffect, useState } from "react";
import type { Language } from "../../types";
import { listUserShops, setUserPrimaryShop, type UserShopRow } from "../../lib/primaryShop";
type Props = {
  lang: Language;
  authMode: "supabase" | "local";
};

export function PrimaryShopSelector({ lang, authMode }: Props) {
  const [shops, setShops] = useState<UserShopRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const rows = await listUserShops();
    setShops(rows);
  }, []);

  useEffect(() => {
    if (authMode !== "supabase") return;
    void load();
    const onChange = () => void load();
    window.addEventListener("waka:primary-shop-changed", onChange);
    return () => window.removeEventListener("waka:primary-shop-changed", onChange);
  }, [authMode, load]);

  if (authMode !== "supabase" || shops.length < 2) return null;

  const primaryId = shops.find((s) => s.is_primary)?.shop_id ?? shops[0]?.shop_id;

  const onSelect = async (shopId: string) => {
    if (shopId === primaryId) return;
    setBusy(true);
    setMsg(null);
    const ok = await setUserPrimaryShop(shopId);
    setBusy(false);
    if (ok) {
      await load();
      setMsg(lang === "lg" ? "Ennaku y'omukutu ekyusiddwa." : "Primary shop updated.");
    } else {
      setMsg(lang === "lg" ? "Tekisobose okukyusa." : "Could not update primary shop.");
    }
  };

  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
      <p className="text-sm font-black text-stone-900">
        {lang === "lg" ? "Amaduuka go (primary)" : "Your shops (primary)"}
      </p>
      <p className="mt-1 text-xs font-medium text-stone-600">
        {lang === "lg"
          ? "Londa edduuka erikulembera okusinkana n'omukutu."
          : "Choose which shop sync and billing use on this account."}
      </p>
      <select
        className="mt-3 w-full min-h-[48px] rounded-xl border border-stone-200 px-3 text-base font-semibold"
        value={primaryId ?? ""}
        disabled={busy}
        onChange={(e) => void onSelect(e.target.value)}
      >
        {shops.map((s) => (
          <option key={s.shop_id} value={s.shop_id}>
            {s.shop_name || s.shop_id.slice(0, 8)}
            {s.is_primary ? " ★" : ""}
          </option>
        ))}
      </select>
      {msg ? <p className="mt-2 text-sm font-semibold text-waka-700">{msg}</p> : null}
    </div>
  );
}
