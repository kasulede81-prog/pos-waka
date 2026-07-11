import { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronUp, Loader2, RefreshCw, Store, WalletCards } from "lucide-react";
import clsx from "clsx";
import type { Language } from "../types";
import { t } from "../lib/i18n";
import {
  opsListActivationRequests,
  opsResolveActivationRequest,
  type OpsActivationRow,
} from "../lib/businessActivation";
import { AdminEmpty, AdminSection } from "../components/internal-admin/adminUi";
import { PREVIEW_ACTIVATIONS } from "../lib/internalAdminPreview";

type Props = {
  lang: Language;
  lovableUi?: boolean;
  previewMode?: boolean;
};

export function InternalActivationOpsPage({ lang, lovableUi = false, previewMode = false }: Props) {
  const [rows, setRows] = useState<OpsActivationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [planCode, setPlanCode] = useState("business");
  const [expiresDays, setExpiresDays] = useState(365);
  const [maxDevices, setMaxDevices] = useState(3);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() => {
    try {
      return JSON.parse(sessionStorage.getItem("waka-admin-activation-expanded") ?? "{}") as Record<string, boolean>;
    } catch {
      return {};
    }
  });

  const load = useCallback(async () => {
    setLoading(true);
    if (previewMode) {
      setRows(PREVIEW_ACTIVATIONS);
      setLoading(false);
      return;
    }
    const list = await opsListActivationRequests();
    setRows(list);
    setLoading(false);
  }, [previewMode]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    sessionStorage.setItem("waka-admin-activation-expanded", JSON.stringify(expanded));
  }, [expanded]);

  const toggleExpanded = (id: string) => {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const approve = async (id: string) => {
    if (previewMode) {
      setToast(t(lang, "internalAdminPreviewActionBlocked"));
      return;
    }
    setBusyId(id);
    setToast(null);
    const r = await opsResolveActivationRequest({
      requestId: id,
      approve: true,
      planCode,
      expiresDays,
      maxDevices,
    });
    setBusyId(null);
    if (r.ok) {
      setToast(r.licenseKey ? `Issued ${r.licenseKey}` : "Approved.");
      window.dispatchEvent(new Event("waka:activation-updated"));
    } else setToast(r.message ?? "Approve failed.");
    await load();
  };

  const reject = async (id: string) => {
    if (previewMode) {
      setToast(t(lang, "internalAdminPreviewActionBlocked"));
      return;
    }
    setBusyId(id);
    setToast(null);
    const r = await opsResolveActivationRequest({ requestId: id, approve: false });
    setBusyId(null);
    if (r.ok) {
      setToast("Rejected.");
      window.dispatchEvent(new Event("waka:activation-updated"));
    } else setToast(r.message ?? "Reject failed.");
    await load();
  };

  const card = lovableUi
    ? "rounded-2xl border border-border bg-card shadow-sm"
    : "rounded-xl border border-border bg-card";
  const muted = lovableUi ? "text-muted-foreground" : "text-muted-foreground";
  const fg = lovableUi ? "text-foreground" : "text-card-foreground";

  return (
    <div className={lovableUi ? "space-y-6 pb-6" : "space-y-4 pb-6"}>
      {previewMode ? (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-semibold text-amber-950">
          {t(lang, "internalAdminPreviewActivationsHint")}
        </p>
      ) : null}
      {lovableUi ? (
        <AdminSection title={t(lang, "internalActivationsTitle")} count={rows.length}>
          <p className="mb-3 text-sm font-medium text-muted-foreground">{t(lang, "internalActivationsSub")}</p>
        </AdminSection>
      ) : null}
      <div className={clsx(card, "p-4")}>
        <div className="flex items-start gap-3">
          <div
            className={clsx(
              "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
              lovableUi ? "bg-waka-100 text-waka-700" : "bg-primary/10 text-primary",
            )}
          >
            <WalletCards className="h-4 w-4" />
          </div>
          {!lovableUi ? (
            <div className="min-w-0 flex-1">
              <p className={clsx("text-[10px] font-black uppercase tracking-wider", muted)}>Admin queue</p>
              <h1 className={clsx("text-sm font-semibold", fg)}>{t(lang, "internalActivationsTitle")}</h1>
              <p className={clsx("mt-1 max-w-3xl text-xs font-medium leading-relaxed", muted)}>
                {t(lang, "internalActivationsSub")}
              </p>
            </div>
          ) : (
            <div className="min-w-0 flex-1" />
          )}
        </div>
        <div className="mt-3 flex gap-2 overflow-x-auto">
          <button
            type="button"
            onClick={() => void load()}
            className={clsx(
              "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-lg border px-3 text-xs font-black",
              lovableUi ? "border-border bg-card text-foreground" : "border-border bg-card text-foreground",
            )}
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </button>
        </div>
      </div>

      <div className={clsx("grid gap-3 p-4 sm:grid-cols-3", card)}>
        <label className={clsx("block text-[10px] font-black uppercase tracking-wider", muted)}>
          {t(lang, "internalActivationsPlan")}
          <input
            value={planCode}
            onChange={(e) => setPlanCode(e.target.value)}
            className="mt-2 min-h-[40px] w-full rounded-xl border border-input bg-background px-3 text-sm font-semibold text-foreground outline-none focus:ring-2 focus:ring-primary/25"
          />
        </label>
        <label className={clsx("block text-[10px] font-black uppercase tracking-wider", muted)}>
          {t(lang, "internalActivationsDays")}
          <input
            type="number"
            min={1}
            max={3650}
            value={expiresDays}
            onChange={(e) => setExpiresDays(Number(e.target.value))}
            className="mt-2 min-h-[40px] w-full rounded-xl border border-input bg-background px-3 text-sm font-semibold text-foreground outline-none focus:ring-2 focus:ring-primary/25"
          />
        </label>
        <label className={clsx("block text-[10px] font-black uppercase tracking-wider", muted)}>
          {t(lang, "internalActivationsDevices")}
          <input
            type="number"
            min={1}
            max={999}
            value={maxDevices}
            onChange={(e) => setMaxDevices(Number(e.target.value))}
            className="mt-2 min-h-[40px] w-full rounded-xl border border-input bg-background px-3 text-sm font-semibold text-foreground outline-none focus:ring-2 focus:ring-primary/25"
          />
        </label>
      </div>

      {toast ? (
        <p className="rounded-xl border border-secondary/30 bg-card px-4 py-3 text-xs font-bold text-secondary">{toast}</p>
      ) : null}

      {loading ? (
        <div className="space-y-3 rounded-xl border border-border bg-card p-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-20 animate-pulse rounded-xl bg-muted" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        lovableUi ? (
          <AdminEmpty>
            <WalletCards className="mx-auto mb-2 h-6 w-6 text-muted-foreground" />
            <p>{t(lang, "internalActivationsEmpty")}</p>
          </AdminEmpty>
        ) : (
          <div className="rounded-xl border border-border bg-card px-6 py-12 text-center text-sm font-semibold text-muted-foreground">
            <WalletCards className="mx-auto mb-2 h-6 w-6 text-muted-foreground" />
            <p>{t(lang, "internalActivationsEmpty")}</p>
          </div>
        )
      ) : (
        <div className={clsx("overflow-hidden", card)}>
          <div className={clsx("border-b px-4 py-3", lovableUi ? "border-border" : "border-border")}>
            <p className={clsx("text-[10px] font-black uppercase tracking-wider", muted)}>
              {rows.length} activation requests
            </p>
          </div>
          <div className={clsx("divide-y", lovableUi ? "divide-stone-100" : "divide-border")}>
            {rows.map((r) => {
              const open = expanded[r.id] ?? r.status === "pending";
              return (
                <article key={r.id}>
                  <button
                    type="button"
                    onClick={() => toggleExpanded(r.id)}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left"
                  >
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                      <Store className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-card-foreground">{r.business_display_name}</p>
                      <p className="mt-0.5 truncate font-mono text-[11px] font-bold text-muted-foreground">{r.public_reference_code}</p>
                    </div>
                    <span
                      className={clsx(
                        "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-black uppercase",
                        r.status === "pending"
                          ? "bg-destructive/10 text-destructive"
                          : r.status === "approved"
                            ? "bg-secondary/10 text-secondary"
                            : "border border-destructive/30 text-destructive",
                      )}
                    >
                      {r.status}
                    </span>
                    {open ? <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />}
                  </button>
                  {open ? (
                    <div className="space-y-3 bg-muted/20 px-3 pb-3">
                      <div className="rounded-xl border border-border bg-card p-3">
                        <div className="grid gap-2 text-xs sm:grid-cols-3">
                          <div>
                            <p className="text-[10px] font-black uppercase tracking-wider text-muted-foreground">Business</p>
                            <p className="font-semibold text-foreground">{r.business_display_name}</p>
                          </div>
                          <div>
                            <p className="text-[10px] font-black uppercase tracking-wider text-muted-foreground">Reference</p>
                            <p className="font-mono font-bold text-primary">{r.public_reference_code}</p>
                          </div>
                          <div>
                            <p className="text-[10px] font-black uppercase tracking-wider text-muted-foreground">Status</p>
                            <p className="font-bold capitalize text-foreground">{r.status}</p>
                          </div>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={busyId !== null || r.status !== "pending"}
                        onClick={() => void approve(r.id)}
                        className="inline-flex h-7 items-center gap-1.5 rounded-lg bg-secondary px-3 text-xs font-black text-secondary-foreground disabled:opacity-40"
                      >
                        {busyId === r.id ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                        {t(lang, "internalActivationsApprove")}
                      </button>
                      <button
                        type="button"
                        disabled={busyId !== null || r.status !== "pending"}
                        onClick={() => void reject(r.id)}
                        className="h-7 rounded-lg bg-destructive px-3 text-xs font-black text-destructive-foreground disabled:opacity-40"
                      >
                        {t(lang, "internalActivationsReject")}
                      </button>
                    </div>
                  </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
