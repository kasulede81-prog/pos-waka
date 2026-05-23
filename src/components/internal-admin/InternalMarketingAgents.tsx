import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Users, X } from "lucide-react";
import clsx from "clsx";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import {
  internalCreateMarketingAgent,
  internalListMarketingAgents,
  listAgentReferrals,
  type AgentReferralRow,
  type InternalMarketingAgentRow,
} from "../../lib/referralAgents";

type Props = { lang: Language; lovableUi?: boolean; previewMode?: boolean };

const PREVIEW_AGENTS: InternalMarketingAgentRow[] = [
  {
    id: "preview-agent-1",
    referralCode: "WAKA-KLA",
    fullName: "Preview Agent Kampala",
    email: "agent@waka.ug",
    phoneE164: "+256700000001",
    active: true,
    referralCount: 3,
    createdAt: new Date().toISOString(),
  },
];

const PREVIEW_REFERRALS: AgentReferralRow[] = [
  {
    id: "preview-ref-1",
    shopName: "Nakawa Mini Mart",
    ownerEmail: "owner1@example.com",
    createdAt: new Date().toISOString(),
  },
];

function Modal({
  title,
  open,
  onClose,
  children,
}: {
  title: string;
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[200] flex items-end justify-center bg-stone-950/55 p-3 sm:items-center">
      <div className="w-full max-w-md rounded-3xl border border-stone-200 bg-white p-5 shadow-waka">
        <p className="flex items-center justify-between gap-3 text-lg font-black text-stone-900">
          {title}
          <button type="button" className="rounded-xl p-2 text-stone-600 hover:bg-stone-50" onClick={onClose} aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </p>
        <div className="mt-4">{children}</div>
      </div>
    </div>
  );
}

export function InternalMarketingAgents({ lang, lovableUi = false, previewMode = false }: Props) {
  const [loading, setLoading] = useState(true);
  const [agents, setAgents] = useState<InternalMarketingAgentRow[]>([]);
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [createBusy, setCreateBusy] = useState(false);
  const [createCode, setCreateCode] = useState("");
  const [createName, setCreateName] = useState("");
  const [createEmail, setCreateEmail] = useState("");
  const [createPhone, setCreatePhone] = useState("");
  const [createMsg, setCreateMsg] = useState<string | null>(null);
  const [detailAgentId, setDetailAgentId] = useState<string | null>(null);
  const [detailRows, setDetailRows] = useState<AgentReferralRow[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    if (previewMode) {
      setAgents(PREVIEW_AGENTS);
      setLoading(false);
      return;
    }
    const rows = await internalListMarketingAgents();
    setAgents(rows);
    setLoading(false);
  }, [previewMode]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return agents;
    return agents.filter(
      (a) =>
        a.referralCode.toLowerCase().includes(q) ||
        (a.fullName ?? "").toLowerCase().includes(q) ||
        (a.email ?? "").toLowerCase().includes(q),
    );
  }, [agents, search]);

  const openDetail = async (agentId: string) => {
    setDetailAgentId(agentId);
    setDetailLoading(true);
    if (previewMode) {
      setDetailRows(PREVIEW_REFERRALS);
      setDetailLoading(false);
      return;
    }
    const rows = await listAgentReferrals(agentId);
    setDetailRows(rows);
    setDetailLoading(false);
  };

  const submitCreate = async () => {
    if (previewMode) {
      setCreateMsg("Preview mode — no changes saved.");
      return;
    }
    setCreateBusy(true);
    setCreateMsg(null);
    const res = await internalCreateMarketingAgent({
      referralCode: createCode,
      fullName: createName,
      email: createEmail,
      phoneE164: createPhone,
    });
    setCreateBusy(false);
    if (!res.ok) {
      setCreateMsg(res.error === "code_taken" ? t(lang, "internalAgentsCodeTaken") : res.error ?? t(lang, "internalAgentsCreateFail"));
      return;
    }
    setCreateOpen(false);
    setCreateCode("");
    setCreateName("");
    setCreateEmail("");
    setCreatePhone("");
    await load();
  };

  const cardCls = lovableUi
    ? "rounded-2xl border border-stone-200 bg-white shadow-sm"
    : "rounded-xl border border-stone-200 bg-white";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-black text-stone-900">{t(lang, "internalAgentsTitle")}</h2>
          <p className="mt-1 text-sm font-medium text-stone-600">{t(lang, "internalAgentsSub")}</p>
        </div>
        <button
          type="button"
          onClick={() => {
            setCreateMsg(null);
            setCreateOpen(true);
          }}
          className="inline-flex min-h-[44px] items-center gap-2 rounded-2xl bg-orange-600 px-4 py-2 text-sm font-black text-white"
        >
          <Plus className="h-4 w-4" aria-hidden />
          {t(lang, "internalAgentsCreate")}
        </button>
      </div>

      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={t(lang, "internalAgentsSearchPh")}
        className="w-full rounded-2xl border border-stone-200 px-4 py-3 text-sm font-semibold"
      />

      {loading ? (
        <p className="text-sm font-semibold text-stone-500">…</p>
      ) : filtered.length === 0 ? (
        <p className={clsx(cardCls, "px-4 py-8 text-center text-sm font-bold text-stone-500")}>{t(lang, "internalAgentsEmpty")}</p>
      ) : (
        <ul className="space-y-2">
          {filtered.map((a) => (
            <li key={a.id} className={clsx(cardCls, "p-4")}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-mono text-lg font-black text-stone-950">{a.referralCode}</p>
                  <p className="text-sm font-semibold text-stone-700">{a.fullName ?? "—"}</p>
                  <p className="text-xs text-stone-500">{a.email ?? "—"} · {a.phoneE164 ?? "—"}</p>
                </div>
                <div className="text-right">
                  <p className="inline-flex items-center gap-1 rounded-full bg-waka-50 px-3 py-1 text-xs font-black text-waka-800">
                    <Users className="h-3.5 w-3.5" aria-hidden />
                    {a.referralCount}
                  </p>
                  <p className="mt-1 text-[11px] font-bold uppercase text-stone-400">{a.active ? "Active" : "Inactive"}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => void openDetail(a.id)}
                className="mt-3 text-sm font-black text-orange-700 underline"
              >
                {t(lang, "internalAgentsViewReferrals")}
              </button>
            </li>
          ))}
        </ul>
      )}

      <Modal title={t(lang, "internalAgentsCreateTitle")} open={createOpen} onClose={() => setCreateOpen(false)}>
        <div className="space-y-3">
          <label className="block text-sm font-bold">
            {t(lang, "internalAgentsCodeLabel")}
            <input
              value={createCode}
              onChange={(e) => setCreateCode(e.target.value.toUpperCase())}
              className="mt-1 w-full rounded-xl border border-stone-200 px-3 py-2 font-mono"
              placeholder="WAKA-KLA"
            />
          </label>
          <label className="block text-sm font-bold">
            {t(lang, "internalAgentsNameLabel")}
            <input value={createName} onChange={(e) => setCreateName(e.target.value)} className="mt-1 w-full rounded-xl border border-stone-200 px-3 py-2" />
          </label>
          <label className="block text-sm font-bold">
            Email
            <input value={createEmail} onChange={(e) => setCreateEmail(e.target.value)} className="mt-1 w-full rounded-xl border border-stone-200 px-3 py-2" />
          </label>
          <label className="block text-sm font-bold">
            Phone (+256…)
            <input value={createPhone} onChange={(e) => setCreatePhone(e.target.value)} className="mt-1 w-full rounded-xl border border-stone-200 px-3 py-2" />
          </label>
          {createMsg ? <p className="text-sm font-bold text-rose-700">{createMsg}</p> : null}
          <button
            type="button"
            disabled={createBusy}
            onClick={() => void submitCreate()}
            className="w-full rounded-2xl bg-orange-600 py-3 text-sm font-black text-white disabled:opacity-60"
          >
            {createBusy ? "…" : t(lang, "internalAgentsCreateSubmit")}
          </button>
        </div>
      </Modal>

      <Modal
        title={t(lang, "internalAgentsReferralsTitle")}
        open={Boolean(detailAgentId)}
        onClose={() => {
          setDetailAgentId(null);
          setDetailRows([]);
        }}
      >
        {detailLoading ? (
          <p className="text-sm text-stone-500">…</p>
        ) : detailRows.length === 0 ? (
          <p className="text-sm font-semibold text-stone-500">{t(lang, "internalAgentsReferralsEmpty")}</p>
        ) : (
          <ul className="max-h-[50vh] space-y-2 overflow-y-auto">
            {detailRows.map((r) => (
              <li key={r.id} className="rounded-xl border border-stone-100 bg-stone-50 px-3 py-2">
                <p className="font-bold text-stone-900">{r.shopName ?? "—"}</p>
                <p className="text-xs text-stone-500">{r.ownerEmail ?? "—"}</p>
                <p className="text-[11px] text-stone-400">{r.createdAt ? new Date(r.createdAt).toLocaleString() : "—"}</p>
              </li>
            ))}
          </ul>
        )}
      </Modal>
    </div>
  );
}
