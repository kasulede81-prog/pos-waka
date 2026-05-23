import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Settings as Cog, Check, Crown, Printer, Bluetooth, BluetoothOff } from "lucide-react";
import { seoHead } from "@/components/seo-head";
import { usePOS, PLAN_LIMITS, type PlanId } from "@/lib/pos-store";
import { useI18n } from "@/lib/i18n";
import { useProfile } from "@/lib/use-profile";
import { supabase } from "@/integrations/supabase/client";
import {
  loadPrinterSettings,
  savePrinterSettings,
  connectBluetoothPrinter,
  disconnectBluetoothPrinter,
  isBluetoothSupported,
  isPrinterConnected,
  printReceipt,
  type PrinterSettings,
} from "@/lib/printer";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => seoHead({ title: "Settings — Waka POS", description: "Shop profile, language and plan.", path: "/settings" }),
  component: SettingsPage,
});

function SettingsPage() {
  const profile = usePOS((s) => s.profile);
  const updateProfile = usePOS((s) => s.updateProfile);
  const productCount = usePOS((s) => s.products.length);
  const { lang, setLang } = useI18n();
  const { profile: cloudProfile, reload } = useProfile();

  const [shopName, setShopName] = useState(profile.shopName ?? "");
  const [ownerName, setOwnerName] = useState(profile.ownerName ?? "");
  const [phone, setPhone] = useState(profile.phone ?? "");
  const [saved, setSaved] = useState(false);
  const [syncing, setSyncing] = useState(false);

  // Hydrate from cloud profile once it loads
  useEffect(() => {
    if (cloudProfile) {
      if (cloudProfile.shop_name && !shopName) setShopName(cloudProfile.shop_name);
      if (cloudProfile.owner_name && !ownerName) setOwnerName(cloudProfile.owner_name);
      if (cloudProfile.phone && !phone) setPhone(cloudProfile.phone);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cloudProfile?.id]);

  const plans: PlanId[] = ["free", "starter", "business", "waka_plus"];

  // Printer
  const [printer, setPrinter] = useState<PrinterSettings>(() => loadPrinterSettings());
  const [btConnected, setBtConnected] = useState(false);
  const [btBusy, setBtBusy] = useState(false);
  const [btError, setBtError] = useState<string | null>(null);
  const btSupported = isBluetoothSupported();
  useEffect(() => {
    setBtConnected(isPrinterConnected());
  }, []);
  const updatePrinter = (patch: Partial<PrinterSettings>) => {
    const next = { ...printer, ...patch };
    setPrinter(next);
    savePrinterSettings(next);
  };
  const connectPrinter = async () => {
    setBtError(null);
    setBtBusy(true);
    try {
      const { name } = await connectBluetoothPrinter();
      updatePrinter({ deviceName: name });
      setBtConnected(true);
    } catch (e) {
      setBtError((e as Error).message);
    }
    setBtBusy(false);
  };
  const testPrint = async () => {
    setBtBusy(true);
    try {
      await printReceipt(
        {
          id: "test-" + Date.now(),
          items: [
            { productId: "p1", name: "Test item", price: 1500, qty: 2 },
            { productId: "p2", name: "Another product", price: 500, qty: 1 },
          ],
          total: 3500,
          method: "cash",
          createdAt: Date.now(),
        },
        profile,
        printer,
      );
    } catch (e) {
      setBtError((e as Error).message);
    }
    setBtBusy(false);
  };

  return (
    <div>
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-waka-100 text-waka-700">
          <Cog className="h-5 w-5" />
        </span>
        <h1 className="text-2xl font-black">Settings</h1>
      </div>

      <section className="mt-6 rounded-2xl border border-border/60 bg-card p-5">
        <h2 className="text-sm font-black uppercase tracking-wider">Shop profile</h2>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const sn = shopName.trim();
            const on = ownerName.trim();
            const ph = phone.trim();
            updateProfile({ shopName: sn, ownerName: on, phone: ph });
            setSyncing(true);
            if (cloudProfile) {
              await supabase
                .from("profiles")
                .update({ shop_name: sn || null, owner_name: on || null, phone: ph || null })
                .eq("id", cloudProfile.id);
              await reload();
            }
            setSyncing(false);
            setSaved(true);
            setTimeout(() => setSaved(false), 2000);
          }}
          className="mt-4 grid gap-2 sm:grid-cols-2"
        >
          <input value={shopName} onChange={(e) => setShopName(e.target.value)} placeholder="Shop name" className="rounded-xl border border-border bg-background px-3 py-2.5 text-sm sm:col-span-2" />
          <input value={ownerName} onChange={(e) => setOwnerName(e.target.value)} placeholder="Owner full name" className="rounded-xl border border-border bg-background px-3 py-2.5 text-sm" />
          <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Mobile (07… or +256…)" className="rounded-xl border border-border bg-background px-3 py-2.5 text-sm" />
          <button disabled={syncing} className="rounded-full bg-waka-600 px-5 py-2.5 text-sm font-bold text-primary-foreground disabled:opacity-60 sm:col-span-2">
            {syncing ? "Saving…" : saved ? "Saved ✓" : "Save profile"}
          </button>
        </form>
      </section>

      <section className="mt-6 rounded-2xl border border-border/60 bg-card p-5">
        <h2 className="text-sm font-black uppercase tracking-wider">Language</h2>
        <div className="mt-3 inline-flex rounded-full border border-border p-1">
          {(["en", "lg"] as const).map((l) => (
            <button
              key={l}
              onClick={() => setLang(l)}
              className={`rounded-full px-4 py-1.5 text-xs font-bold ${
                lang === l ? "bg-waka-600 text-primary-foreground" : "text-foreground/70"
              }`}
            >
              {l === "en" ? "English" : "Luganda"}
            </button>
          ))}
        </div>
      </section>

      <section className="mt-6 rounded-2xl border border-border/60 bg-card p-5">
        <div className="flex items-center gap-2">
          <Printer className="h-4 w-4 text-waka-700" />
          <h2 className="text-sm font-black uppercase tracking-wider">Receipt printer</h2>
        </div>

        <div className="mt-4 space-y-4">
          <div>
            <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Paper width</label>
            <div className="mt-2 inline-flex rounded-full border border-border p-1">
              {([58, 80] as const).map((w) => (
                <button
                  key={w}
                  onClick={() => updatePrinter({ width: w })}
                  className={`rounded-full px-4 py-1.5 text-xs font-bold ${
                    printer.width === w ? "bg-waka-600 text-primary-foreground" : "text-foreground/70"
                  }`}
                >
                  {w} mm
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <div>
              <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Header line</label>
              <input
                value={printer.header ?? ""}
                onChange={(e) => updatePrinter({ header: e.target.value })}
                placeholder="e.g. Kampala Rd, Plot 12"
                className="mt-2 w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm"
              />
            </div>
            <div>
              <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Footer line</label>
              <input
                value={printer.footer ?? ""}
                onChange={(e) => updatePrinter({ footer: e.target.value })}
                placeholder="e.g. Thank you! Webale!"
                className="mt-2 w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm"
              />
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={printer.autoPrint}
              onChange={(e) => updatePrinter({ autoPrint: e.target.checked })}
              className="h-4 w-4 accent-waka-600"
            />
            Auto-print after each sale
          </label>

          <div className="rounded-xl border border-border/60 bg-background p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-bold">
                  {btSupported
                    ? btConnected
                      ? `Connected${printer.deviceName ? ` · ${printer.deviceName}` : ""}`
                      : "Bluetooth printer not connected"
                    : "Bluetooth not available"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {btSupported
                    ? "ESC/POS 58/80mm printers (Goojprt, Xprinter, etc.)"
                    : "Use the Print button — your browser will print to any printer."}
                </p>
              </div>
              {btSupported && (
                btConnected ? (
                  <button
                    onClick={() => { disconnectBluetoothPrinter(); setBtConnected(false); }}
                    className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-bold"
                  >
                    <BluetoothOff className="h-3.5 w-3.5" /> Disconnect
                  </button>
                ) : (
                  <button
                    onClick={connectPrinter}
                    disabled={btBusy}
                    className="inline-flex items-center gap-1.5 rounded-full bg-waka-600 px-3 py-1.5 text-xs font-bold text-primary-foreground disabled:opacity-60"
                  >
                    <Bluetooth className="h-3.5 w-3.5" /> {btBusy ? "Connecting…" : "Connect"}
                  </button>
                )
              )}
            </div>
            {btError && <p className="mt-2 text-xs text-destructive">{btError}</p>}
            <button
              onClick={testPrint}
              disabled={btBusy}
              className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-bold hover:bg-muted disabled:opacity-60"
            >
              <Printer className="h-3.5 w-3.5" /> Test print
            </button>
          </div>
        </div>
      </section>



      <section className="mt-6">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-black uppercase tracking-wider">Plan</h2>
          <span className="text-xs text-muted-foreground">
            {productCount} / {PLAN_LIMITS[profile.plan].products ?? "∞"} products
          </span>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {plans.map((id) => {
            const p = PLAN_LIMITS[id];
            const active = profile.plan === id;
            return (
              <button
                key={id}
                onClick={() => updateProfile({ plan: id })}
                className={`rounded-2xl border-2 p-5 text-left transition ${
                  active ? "border-waka-600 bg-waka-50" : "border-border bg-card hover:border-waka-500"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2 text-sm font-black">
                    {id === "waka_plus" && <Crown className="h-4 w-4 text-amber-500" />}
                    {p.label}
                  </span>
                  {active && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-waka-600 px-2 py-0.5 text-[10px] font-bold text-primary-foreground">
                      <Check className="h-3 w-3" /> Active
                    </span>
                  )}
                </div>
                <p className="mt-1 text-lg font-black text-waka-700">{p.price}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {p.products ? `Up to ${p.products} products` : "Unlimited products"}
                </p>
              </button>
            );
          })}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Plans are local for now. Activation approval and billing are coming soon.
        </p>
      </section>
    </div>
  );
}
