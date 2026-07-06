import { useCallback, useEffect, useState } from "react";
import type { Language } from "../../types";
import type { EnterpriseBranch } from "../../types/enterprise";
import { t } from "../../lib/i18n";
import { EnterpriseShell } from "../../components/enterprise/EnterpriseShell";
import {
  fetchEnterpriseBranches,
  setEnterpriseBranchStatus,
  upsertEnterpriseBranch,
} from "../../lib/enterprise/organizationContext";

export function EnterpriseBranchCenterPage({ lang }: { lang: Language }) {
  const [branches, setBranches] = useState<EnterpriseBranch[]>([]);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBranches(await fetchEnterpriseBranches());
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const flash = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2400);
  };

  const createBranch = async () => {
    const name = window.prompt(t(lang, "enterpriseBranchNamePrompt"));
    if (!name?.trim()) return;
    setBusy(true);
    const r = await upsertEnterpriseBranch({ name: name.trim(), businessType: "kiosk_duka", businessTypes: ["kiosk_duka"] });
    setBusy(false);
    if (r.ok) {
      flash(t(lang, "enterpriseBranchSaved"));
      await load();
    } else {
      flash(r.error ?? t(lang, "invalid"));
    }
  };

  const setStatus = async (id: string, status: EnterpriseBranch["status"]) => {
    setBusy(true);
    const r = await setEnterpriseBranchStatus(id, status);
    setBusy(false);
    if (r.ok) {
      await load();
    } else {
      flash(r.error ?? t(lang, "invalid"));
    }
  };

  return (
    <EnterpriseShell lang={lang} title={t(lang, "enterpriseNav_branches")} subtitle={t(lang, "enterpriseBranchesSub")}>
      {toast ? (
        <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-950">
          {toast}
        </p>
      ) : null}

      <button
        type="button"
        disabled={busy}
        onClick={() => void createBranch()}
        className="min-h-[48px] self-start rounded-2xl bg-waka-600 px-5 text-sm font-black text-white disabled:opacity-50"
      >
        {t(lang, "enterpriseBranchCreate")}
      </button>

      <ul className="grid gap-3 lg:grid-cols-2">
        {branches.map((b) => (
          <li key={b.id} className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="text-lg font-black text-stone-950">{b.name}</p>
                <p className="text-xs font-semibold text-stone-500">
                  {b.code ?? b.shopNumber ?? b.id.slice(0, 8)} · {b.status}
                </p>
                <p className="mt-1 text-sm font-medium text-stone-600">
                  {[b.city, b.district].filter(Boolean).join(", ") || "—"}
                </p>
                <p className="text-xs font-medium text-stone-500">
                  {b.businessTypes.join(", ")} · {b.currency}
                </p>
              </div>
              <div className="flex flex-col gap-1">
                {b.status !== "active" ? (
                  <ActionBtn label={t(lang, "enterpriseBranchReactivate")} onClick={() => void setStatus(b.id, "active")} />
                ) : (
                  <>
                    <ActionBtn label={t(lang, "enterpriseBranchDisable")} onClick={() => void setStatus(b.id, "disabled")} />
                    <ActionBtn label={t(lang, "enterpriseBranchArchive")} onClick={() => void setStatus(b.id, "archived")} />
                  </>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </EnterpriseShell>
  );
}

function ActionBtn({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="min-h-[36px] rounded-lg border border-stone-200 px-3 text-xs font-black text-stone-800"
    >
      {label}
    </button>
  );
}
