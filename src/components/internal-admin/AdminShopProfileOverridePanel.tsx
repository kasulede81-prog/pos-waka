import { useEffect, useState } from "react";
import type { ShopOpsDetail } from "../../lib/wakaInternalAdmin";
import { adminShopUpdateProfile } from "../../lib/wakaInternalAdmin";
import { fetchDistricts, type DistrictRow } from "../../lib/shopDistricts";
import { BUSINESS_TYPE_IDS } from "../../config/businessTypes";
import type { BusinessType } from "../../types";

type Props = {
  detail: ShopOpsDetail;
  busy: boolean;
  previewMode: boolean;
  onBusy: (busy: boolean) => void;
  onToast: (toast: { kind: "ok" | "err"; text: string }) => void;
  onSaved?: () => void;
};

export function AdminShopProfileOverridePanel({
  detail,
  busy,
  previewMode,
  onBusy,
  onToast,
  onSaved,
}: Props) {
  const shop = detail.shop;
  const [shopName, setShopName] = useState(shop.name);
  const [phone, setPhone] = useState(shop.phone_e164 ?? "");
  const [ownerEmail, setOwnerEmail] = useState(detail.owner_email ?? "");
  const [address, setAddress] = useState(shop.address_line ?? "");
  const [city, setCity] = useState(shop.city ?? "");
  const [area, setArea] = useState(shop.area ?? "");
  const [districtId, setDistrictId] = useState(shop.district_id ?? "");
  const [businessType, setBusinessType] = useState<BusinessType>(
    (shop.business_type as BusinessType) ?? "kiosk_duka",
  );
  const [note, setNote] = useState("");
  const [districts, setDistricts] = useState<DistrictRow[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setShopName(shop.name);
    setPhone(shop.phone_e164 ?? "");
    setOwnerEmail(detail.owner_email ?? "");
    setAddress(shop.address_line ?? "");
    setCity(shop.city ?? "");
    setArea(shop.area ?? "");
    setDistrictId(shop.district_id ?? "");
    setBusinessType((shop.business_type as BusinessType) ?? "kiosk_duka");
  }, [shop.id, shop.name, shop.phone_e164, shop.address_line, shop.city, shop.area, shop.district_id, shop.business_type, detail.owner_email]);

  useEffect(() => {
    void fetchDistricts().then((r) => setDistricts(r.districts));
  }, []);

  const save = async () => {
    if (previewMode) {
      onToast({ kind: "err", text: "Preview mode — action blocked." });
      return;
    }
    if (!shopName.trim()) {
      onToast({ kind: "err", text: "Shop name is required." });
      return;
    }
    if (!window.confirm("Save shop profile changes for this owner? This bypasses their in-app lock.")) return;

    onBusy(true);
    const r = await adminShopUpdateProfile({
      shopId: shop.id,
      shopName: shopName.trim(),
      phoneE164: phone.trim() || null,
      ownerEmail: ownerEmail.trim() || null,
      districtId: districtId || null,
      addressLine: address.trim() || null,
      city: city.trim() || null,
      area: area.trim() || null,
      businessType,
      note: note.trim() || "Support profile override",
    });
    onBusy(false);

    if (r.ok) {
      onToast({ kind: "ok", text: "Shop profile updated." });
      setOpen(false);
      onSaved?.();
    } else {
      onToast({ kind: "err", text: r.message ?? "Update failed." });
    }
  };

  return (
    <section className="rounded-2xl border-2 border-sky-200 bg-sky-50/90 p-4 shadow-sm">
      <p className="text-[10px] font-black uppercase tracking-wide text-sky-900">Support override</p>
      <h2 className="mt-0.5 text-base font-black text-stone-900">Edit shop profile (locked for owner)</h2>
      <p className="mt-1 text-xs font-medium text-stone-700">
        Owners cannot change shop details after registration. Use this when they call support with a verified request.
      </p>

      {!open ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => setOpen(true)}
          className="mt-3 min-h-[44px] w-full rounded-xl border-2 border-sky-400 bg-white px-4 text-sm font-black text-sky-950 disabled:opacity-40"
        >
          Open profile editor
        </button>
      ) : (
        <div className="mt-3 space-y-2">
          <label className="block text-xs font-bold text-stone-800">
            Shop name
            <input
              value={shopName}
              onChange={(e) => setShopName(e.target.value)}
              className="mt-1 w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm"
            />
          </label>
          <label className="block text-xs font-bold text-stone-800">
            Owner email (recovery)
            <input
              type="email"
              value={ownerEmail}
              onChange={(e) => setOwnerEmail(e.target.value)}
              className="mt-1 w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm"
            />
          </label>
          <label className="block text-xs font-bold text-stone-800">
            Shop phone (+256…)
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="mt-1 w-full rounded-lg border border-stone-200 bg-white px-3 py-2 font-mono text-sm"
            />
          </label>
          <label className="block text-xs font-bold text-stone-800">
            District
            <select
              value={districtId}
              onChange={(e) => setDistrictId(e.target.value)}
              className="mt-1 w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm"
            >
              <option value="">—</option>
              {districts.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs font-bold text-stone-800">
            Business type
            <select
              value={businessType}
              onChange={(e) => setBusinessType(e.target.value as BusinessType)}
              className="mt-1 w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm"
            >
              {BUSINESS_TYPE_IDS.map((id) => (
                <option key={id} value={id}>
                  {id.replace(/_/g, " ")}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs font-bold text-stone-800">
            Address
            <input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className="mt-1 w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm"
            />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block text-xs font-bold text-stone-800">
              City
              <input
                value={city}
                onChange={(e) => setCity(e.target.value)}
                className="mt-1 w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm"
              />
            </label>
            <label className="block text-xs font-bold text-stone-800">
              Area
              <input
                value={area}
                onChange={(e) => setArea(e.target.value)}
                className="mt-1 w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm"
              />
            </label>
          </div>
          <label className="block text-xs font-bold text-stone-800">
            Internal note (audit log)
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Owner called — wrong shop name"
              className="mt-1 w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm"
            />
          </label>
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              disabled={busy}
              onClick={() => void save()}
              className="min-h-[44px] flex-1 rounded-xl bg-sky-700 px-4 text-sm font-black text-white disabled:opacity-40"
            >
              Save changes
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setOpen(false)}
              className="min-h-[44px] rounded-xl border border-stone-300 bg-white px-4 text-sm font-bold text-stone-800"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
