import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Users, X } from "lucide-react";
import clsx from "clsx";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import {
  internalSearchAgentUserCandidates,
  internalGrantMarketingAgent,
  internalListMarketingAgents,
  listAgentReferrals,
  type AgentUserCandidate,
  type AgentReferralRow,
  type InternalMarketingAgentRow,
} from "../../lib/referralAgents";

type Props = { lang: Language; lovableUi?: boolean; previewMode?: boolean };
type AgentRole = "trial_agent" | "vip_agent" | "field_agent";
const AGENT_ROLE_KEY = "waka:internal-agent-roles";

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

function readAgentRoles(): Record<string, AgentRole> {
  try {
    const raw = localStorage.getItem(AGENT_ROLE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, AgentRole>;
  } catch {
    return {};
  }
}

function writeAgentRoles(next: Record<string, AgentRole>): void {
  try {
    localStorage.setItem(AGENT_ROLE_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
}

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
  const [grantEmail, setGrantEmail] = useState("");
  const [grantRole, setGrantRole] = useState<AgentRole>("trial_agent");
  const [candidateQuery, setCandidateQuery] = useState("");
  const [candidateLoading, setCandidateLoading] = useState(false);
  const [candidates, setCandidates] = useState<AgentUserCandidate[]>([]);
  const [agentRoles, setAgentRoles] = useState<Record<string, AgentRole>>(() => readAgentRoles());
  const [createMsg, setCreateMsg] = useState<string | null>(null);
  const [detailAgentId, setDetailAgentId] = useState<string | null>(null);
  const [detailRows, setDetailRows] = useState<AgentReferralRow[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [roleBusyKey, setRoleBusyKey] = useState<string | null>(null);

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

  const submitGrant = async () => {
    if (previewMode) {
      setCreateMsg("Preview mode — no changes saved.");
      return;
    }
    setCreateBusy(true);
    setCreateMsg(null);
    const res = await internalGrantMarketingAgent(grantEmail);
    setCreateBusy(false);
    if (!res.ok) {
      const key =
        res.error === "user_not_found"
          ? t(lang, "internalAgentsUserNotFound")
          : res.error === "invalid_email"
            ? t(lang, "internalAgentsInvalidEmail")
            : res.error ?? t(lang, "internalAgentsCreateFail");
      setCreateMsg(key);
      return;
    }
    if (grantEmail.trim()) {
      const key = grantEmail.trim().toLowerCase();
      const nextRoles = { ...agentRoles, [key]: grantRole };
      setAgentRoles(nextRoles);
      writeAgentRoles(nextRoles);
    }
    setCreateOpen(false);
    setGrantEmail("");
    setCreateMsg(
      res.alreadyAgent
        ? t(lang, "internalAgentsAlreadyAgent").replace("{{code}}", res.referralCode ?? "")
        : t(lang, "internalAgentsGranted").replace("{{code}}", res.referralCode ?? ""),
    );
    await load();
  };

  const updateAgentRole = async (email: string | null, role: AgentRole) => {
    if (!email) return;
    const key = email.trim().toLowerCase();
    setRoleBusyKey(key);
    const nextRoles = { ...agentRoles, [key]: role };
    setAgentRoles(nextRoles);
    writeAgentRoles(nextRoles);
    setRoleBusyKey(null);
    setCreateMsg(`Role updated: ${email} → ${role}`);
  };

  const loadCandidates = useCallback(async () => {
    setCandidateLoading(true);
    if (previewMode) {
      setCandidates([
        {
          key: "agent@waka.ug",
          email: "agent@waka.ug",
          fullName: "Preview Agent Kampala",
          phoneE164: "+256700000001",
          shopName: "Nakawa Mini Mart",
          district: "Kampala",
        },
      ]);
      setCandidateLoading(false);
      return;
    }
    const rows = await internalSearchAgentUserCandidates(candidateQuery);
    setCandidates(rows);
    setCandidateLoading(false);
  }, [candidateQuery, previewMode]);

  useEffect(() => {
    if (!createOpen) return;
    void loadCandidates();
  }, [createOpen, loadCandidates]);

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
          {t(lang, "internalAgentsGrant")}
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
                  <p className="text-[11px] font-bold uppercase text-stone-400">
                    {(a.email && agentRoles[a.email.toLowerCase()]) || "trial_agent"}
                  </p>
                </div>
                <div className="text-right">
                  <p className="inline-flex items-center gap-1 rounded-full bg-waka-50 px-3 py-1 text-xs font-black text-waka-800">
                    <Users className="h-3.5 w-3.5" aria-hidden />
                    {a.referralCount}
                  </p>
                  <p className="mt-1 text-[11px] font-bold uppercase text-stone-400">{a.active ? "Active" : "Inactive"}</p>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <label className="text-xs font-bold text-stone-600">
                  Role
                  <select
                    value={(a.email && agentRoles[a.email.toLowerCase()]) || "trial_agent"}
                    onChange={(e) => {
                      if (!a.email) return;
                      const key = a.email.toLowerCase();
                      setAgentRoles((prev) => ({ ...prev, [key]: e.target.value as AgentRole }));
                    }}
                    className="ml-2 rounded-lg border border-stone-200 bg-white px-2 py-1 text-xs"
                  >
                    <option value="trial_agent">trial_agent</option>
                    <option value="vip_agent">vip_agent</option>
                    <option value="field_agent">field_agent</option>
                  </select>
                </label>
                <button
                  type="button"
                  disabled={!a.email || roleBusyKey === a.email?.toLowerCase()}
                  onClick={() => {
                    if (!a.email) return;
                    const role = agentRoles[a.email.toLowerCase()] ?? "trial_agent";
                    void updateAgentRole(a.email, role);
                  }}
                  className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-xs font-black text-stone-800 disabled:opacity-50"
                >
                  Save role
                </button>
                <button
                  type="button"
                  disabled={!a.email || roleBusyKey === a.email?.toLowerCase()}
                  onClick={() => void updateAgentRole(a.email, "trial_agent")}
                  className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-black text-amber-900 disabled:opacity-50"
                >
                  Downgrade to trial
                </button>
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

      <Modal title={t(lang, "internalAgentsGrantTitle")} open={createOpen} onClose={() => setCreateOpen(false)}>
        <div className="space-y-3">
          <p className="text-sm font-medium text-stone-600">{t(lang, "internalAgentsGrantHint")}</p>
          <div className="space-y-2 rounded-xl border border-stone-200 bg-stone-50 p-3">
            <div className="flex gap-2">
              <input
                value={candidateQuery}
                onChange={(e) => setCandidateQuery(e.target.value)}
                className="w-full rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm font-semibold"
                placeholder="Search existing users: email, name, phone, shop"
              />
              <button
                type="button"
                onClick={() => void loadCandidates()}
                className="rounded-xl border border-stone-300 bg-white px-3 py-2 text-xs font-black"
              >
                Search
              </button>
            </div>
            {candidateLoading ? (
              <p className="text-xs font-semibold text-stone-500">Loading users…</p>
            ) : candidates.length === 0 ? (
              <p className="text-xs font-semibold text-stone-500">No users found. You can still type email below.</p>
            ) : (
              <ul className="max-h-40 space-y-1 overflow-y-auto">
                {candidates.map((c) => (
                  <li key={c.key}>
                    <button
                      type="button"
                      onClick={() => setGrantEmail(c.email)}
                      className="w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-left text-xs hover:border-orange-300"
                    >
                      <p className="font-black text-stone-900">{c.fullName ?? c.email}</p>
                      <p className="font-semibold text-stone-500">
                        {c.email} · {c.phoneE164 ?? "—"} · {c.shopName ?? "—"} {c.district ? `(${c.district})` : ""}
                      </p>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <label className="block text-sm font-bold">
            {t(lang, "internalAgentsGrantEmailLabel")}
            <input
              type="email"
              value={grantEmail}
              onChange={(e) => setGrantEmail(e.target.value)}
              className="mt-1 w-full rounded-xl border border-stone-200 px-3 py-2"
              placeholder="owner@example.com"
            />
          </label>
          <label className="block text-sm font-bold">
            Agent role
            <select
              value={grantRole}
              onChange={(e) => setGrantRole(e.target.value as AgentRole)}
              className="mt-1 w-full rounded-xl border border-stone-200 px-3 py-2"
            >
              <option value="trial_agent">Trial activations</option>
              <option value="vip_agent">VIP/Business plan activations</option>
              <option value="field_agent">Field tracking agent</option>
            </select>
          </label>
          <p className="text-xs font-medium text-stone-500">
            Role controls what this agent should handle in operations (trial activations, VIP upgrades, field tracking).
          </p>
          {createMsg ? <p className="text-sm font-bold text-rose-700">{createMsg}</p> : null}
          <button
            type="button"
            disabled={createBusy}
            onClick={() => void submitGrant()}
            className="w-full rounded-2xl bg-orange-600 py-3 text-sm font-black text-white disabled:opacity-60"
          >
            {createBusy ? "…" : t(lang, "internalAgentsGrantSubmit")}
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
