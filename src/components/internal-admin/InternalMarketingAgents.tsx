import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Users, X } from "lucide-react";
import clsx from "clsx";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import {
  buildAgentReferralRegisterUrl,
  buildAgentVerificationUrl,
  formatOwnerContactLabel,
  internalSearchAgentUserCandidates,
  internalGrantMarketingAgentByShopWithRoles,
  internalListMarketingAgents,
  internalSetMarketingAgentRoles,
  internalDeleteMarketingAgent,
  listAgentReferrals,
  MARKETING_AGENT_ROLES,
  type AgentUserCandidate,
  type AgentReferralRow,
  type InternalMarketingAgentRow,
  type MarketingAgentRole,
} from "../../lib/referralAgents";

type Props = { lang: Language; lovableUi?: boolean; previewMode?: boolean };

const PREVIEW_AGENTS: InternalMarketingAgentRow[] = [
  {
    id: "preview-agent-1",
    referralCode: "WAKA-KLA",
    fullName: "Preview Agent Kampala",
    email: null,
    phoneE164: "+256700000001",
    shopId: "preview-shop-1",
    shopName: "Nakawa Mini Mart",
    active: true,
    roles: ["trial_agent", "field_agent"],
    referralCount: 3,
    createdAt: new Date().toISOString(),
  },
];

const PREVIEW_REFERRALS: AgentReferralRow[] = [
  {
    id: "preview-ref-1",
    shopName: "Nakawa Mini Mart",
    ownerEmail: "owner1@example.com",
    ownerPhone: "+256700000002",
    createdAt: new Date().toISOString(),
  },
];

function roleLabel(role: MarketingAgentRole): string {
  if (role === "vip_agent") return "VIP upgrades";
  if (role === "trial_agent") return "Trial activations";
  return "Field tracking";
}

function toggleRole(list: MarketingAgentRole[], role: MarketingAgentRole): MarketingAgentRole[] {
  return list.includes(role) ? list.filter((r) => r !== role) : [...list, role];
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
  const [grantShopId, setGrantShopId] = useState("");
  const [grantShopName, setGrantShopName] = useState("");
  const [grantRoles, setGrantRoles] = useState<MarketingAgentRole[]>(["trial_agent", "field_agent"]);
  const [roleEdits, setRoleEdits] = useState<Record<string, MarketingAgentRole[]>>({});
  const [candidateQuery, setCandidateQuery] = useState("");
  const [candidateLoading, setCandidateLoading] = useState(false);
  const [candidates, setCandidates] = useState<AgentUserCandidate[]>([]);
  const [createMsg, setCreateMsg] = useState<string | null>(null);
  const [detailAgentId, setDetailAgentId] = useState<string | null>(null);
  const [detailRows, setDetailRows] = useState<AgentReferralRow[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [roleBusyKey, setRoleBusyKey] = useState<string | null>(null);
  const [removeBusyKey, setRemoveBusyKey] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    if (previewMode) {
      setAgents(PREVIEW_AGENTS);
      setLoading(false);
      return;
    }
    try {
      const { rows, error } = await internalListMarketingAgents();
      if (error) {
        setLoadError(error);
        setAgents([]);
        setRoleEdits({});
        setLoading(false);
        return;
      }
      setAgents(rows);
      setRoleEdits(Object.fromEntries(rows.map((a) => [a.id, [...(a.roles ?? [])]])));
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load agents");
      setAgents([]);
      setRoleEdits({});
    } finally {
      setLoading(false);
    }
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
        (a.shopName ?? "").toLowerCase().includes(q) ||
        (a.phoneE164 ?? "").toLowerCase().includes(q),
    );
  }, [agents, search]);

  const openDetail = async (agentId: string) => {
    setDetailAgentId(agentId);
    setDetailLoading(true);
    setDetailError(null);
    if (previewMode) {
      setDetailRows(PREVIEW_REFERRALS);
      setDetailLoading(false);
      return;
    }
    const { rows, error } = await listAgentReferrals(agentId);
    setDetailRows(rows);
    if (error) setDetailError(error);
    setDetailLoading(false);
  };

  const copyAgentLink = async (code: string) => {
    const url = buildAgentReferralRegisterUrl(code);
    try {
      await navigator.clipboard.writeText(url);
      setCreateMsg(t(lang, "agentLinkCopied"));
    } catch {
      setCreateMsg(url);
    }
    window.setTimeout(() => setCreateMsg(null), 3000);
  };

  const copyVerifyLink = async (code: string) => {
    const url = buildAgentVerificationUrl(code);
    try {
      await navigator.clipboard.writeText(url);
      setCreateMsg(t(lang, "internalAgentIdVerifyLinkCopied"));
    } catch {
      setCreateMsg(url);
    }
    window.setTimeout(() => setCreateMsg(null), 3000);
  };

  const submitGrant = async () => {
    if (previewMode) {
      setCreateMsg("Preview mode — no changes saved.");
      return;
    }
    setCreateBusy(true);
    setCreateMsg(null);
    if (!grantShopId.trim()) {
      setCreateBusy(false);
      setCreateMsg(t(lang, "internalAgentsShopRequired"));
      return;
    }
    const res = await internalGrantMarketingAgentByShopWithRoles(grantShopId, grantRoles);
    setCreateBusy(false);
    if (!res.ok) {
      const key =
        res.error === "shop_not_found" || res.error === "no_owner"
          ? t(lang, "internalAgentsShopNotFound")
          : res.error === "shop_required"
            ? t(lang, "internalAgentsShopRequired")
            : res.error ?? t(lang, "internalAgentsCreateFail");
      setCreateMsg(key);
      return;
    }
    setCreateOpen(false);
    setGrantShopId("");
    setGrantShopName("");
    setCreateMsg(
      res.alreadyAgent
        ? t(lang, "internalAgentsAlreadyAgent").replace("{{code}}", res.referralCode ?? "")
        : t(lang, "internalAgentsGranted").replace("{{code}}", res.referralCode ?? ""),
    );
    await load();
  };

  const saveAgentRoles = async (agentId: string, label: string) => {
    const roles = roleEdits[agentId] ?? ["field_agent"];
    if (roles.length === 0) {
      setCreateMsg(t(lang, "internalAgentsRoleRequired"));
      return;
    }
    setRoleBusyKey(agentId);
    const res = await internalSetMarketingAgentRoles(agentId, roles);
    setRoleBusyKey(null);
    if (!res.ok) {
      setCreateMsg(res.error ?? t(lang, "internalAgentsCreateFail"));
      return;
    }
    setCreateMsg(t(lang, "internalAgentsRolesSaved").replace("{{name}}", label));
    await load();
  };

  const removeAgent = async (agent: InternalMarketingAgentRow, deleteLogin: boolean) => {
    if (previewMode) {
      setCreateMsg("Preview mode — no changes saved.");
      return;
    }
    const label = agent.shopName ?? agent.referralCode;
    const msg = deleteLogin
      ? `Remove agent "${label}" and delete their login?\n\nThey can register again with the same email/phone. Their shop (if any) is not deleted.`
      : `Remove agent "${label}" from the panel?\n\nTheir login stays; only agent access is removed.`;
    if (!window.confirm(msg)) return;

    setRemoveBusyKey(agent.id);
    setCreateMsg(null);
    const res = await internalDeleteMarketingAgent(agent.id, deleteLogin);
    setRemoveBusyKey(null);
    if (res.ok || res.partial) {
      setCreateMsg(res.message ?? t(lang, "internalAgentsRemoved"));
      await load();
      return;
    }
    setCreateMsg(res.message ?? t(lang, "internalAgentsRemoveFail"));
  };

  const loadCandidates = useCallback(async () => {
    setCandidateLoading(true);
    if (previewMode) {
      setCandidates([
        {
          key: "preview-shop-1",
          shopId: "preview-shop-1",
          shopName: "Nakawa Mini Mart",
          fullName: "Preview Agent Kampala",
          phoneE164: "+256700000001",
          email: null,
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

      {loadError ? (
        <p className={clsx(cardCls, "border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-900")}>{loadError}</p>
      ) : null}

      {loading ? (
        <p className="text-sm font-semibold text-stone-500">…</p>
      ) : filtered.length === 0 && !loadError ? (
        <p className={clsx(cardCls, "px-4 py-8 text-center text-sm font-bold text-stone-500")}>{t(lang, "internalAgentsEmpty")}</p>
      ) : (
        <ul className="space-y-2">
          {filtered.map((a) => (
            <li key={a.id} className={clsx(cardCls, "p-4")}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-mono text-lg font-black uppercase tracking-wide text-stone-950">{a.referralCode}</p>
                  <p className="text-sm font-semibold text-stone-700">{a.shopName ?? a.fullName ?? "—"}</p>
                  {!a.active ? (
                    <p className="mt-1 inline-block rounded-lg bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-900">
                      Inactive
                    </p>
                  ) : null}
                  <p className="text-xs text-stone-500">
                    {formatOwnerContactLabel(a.email, a.phoneE164)}
                    {a.fullName && a.shopName ? ` · ${a.fullName}` : ""}
                  </p>
                  <p className="text-[11px] font-bold uppercase text-stone-400">
                    {(roleEdits[a.id] ?? a.roles ?? []).join(" · ")}
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
              <div className="mt-3 space-y-2 border-t border-stone-100 pt-3">
                <p className="text-[10px] font-black uppercase tracking-wide text-stone-500">
                  {t(lang, "internalAgentIdVerifyTitle")}
                </p>
                <p className="text-xs font-medium text-stone-600">{t(lang, "internalAgentIdVerifySub")}</p>
                <p className="break-all font-mono text-xs font-semibold text-stone-600">
                  {buildAgentVerificationUrl(a.referralCode)}
                </p>
                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={() => void copyVerifyLink(a.referralCode)}
                    className="text-sm font-black text-waka-800 underline"
                  >
                    {t(lang, "internalAgentIdVerifyCopy")}
                  </button>
                  <button
                    type="button"
                    onClick={() => void copyAgentLink(a.referralCode)}
                    className="text-sm font-black text-stone-700 underline"
                  >
                    {t(lang, "agentCopyLink")}
                  </button>
                </div>
              </div>
              <div className="mt-3 space-y-2">
                <p className="text-xs font-bold text-stone-600">{t(lang, "internalAgentsRolesLabel")}</p>
                <div className="flex flex-wrap gap-2">
                  {MARKETING_AGENT_ROLES.map((role) => {
                    const checked = (roleEdits[a.id] ?? a.roles).includes(role);
                    return (
                      <label
                        key={role}
                        className={clsx(
                          "inline-flex min-h-[36px] cursor-pointer items-center gap-2 rounded-xl border px-3 py-1.5 text-xs font-bold",
                          checked ? "border-orange-400 bg-orange-50 text-orange-950" : "border-stone-200 bg-white",
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          className="h-4 w-4"
                          onChange={() =>
                            setRoleEdits((prev) => ({
                              ...prev,
                              [a.id]: toggleRole(prev[a.id] ?? a.roles, role),
                            }))
                          }
                        />
                        {roleLabel(role)}
                      </label>
                    );
                  })}
                </div>
                <button
                  type="button"
                  disabled={roleBusyKey === a.id}
                  onClick={() => void saveAgentRoles(a.id, a.shopName ?? a.referralCode)}
                  className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-xs font-black text-stone-800 disabled:opacity-50"
                >
                  {roleBusyKey === a.id ? "…" : t(lang, "internalAgentsSaveRoles")}
                </button>
              </div>
              <button
                type="button"
                onClick={() => void openDetail(a.id)}
                className="mt-1 text-sm font-black text-orange-700 underline"
              >
                {t(lang, "internalAgentsViewReferrals")}
              </button>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={removeBusyKey === a.id}
                  onClick={() => void removeAgent(a, false)}
                  className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-xs font-black text-stone-800 disabled:opacity-50"
                >
                  {removeBusyKey === a.id ? "…" : t(lang, "internalAgentsRemove")}
                </button>
                <button
                  type="button"
                  disabled={removeBusyKey === a.id}
                  onClick={() => void removeAgent(a, true)}
                  className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-1.5 text-xs font-black text-rose-900 disabled:opacity-50"
                >
                  {removeBusyKey === a.id ? "…" : t(lang, "internalAgentsRemoveAndLogin")}
                </button>
              </div>
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
                placeholder={t(lang, "internalAgentsCandidateSearchPh")}
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
              <p className="text-xs font-semibold text-stone-500">{t(lang, "internalAgentsCandidatesEmpty")}</p>
            ) : (
              <ul className="max-h-40 space-y-1 overflow-y-auto">
                {candidates.map((c) => (
                  <li key={c.key}>
                    <button
                      type="button"
                      onClick={() => {
                        setGrantShopId(c.shopId);
                        setGrantShopName(c.shopName);
                      }}
                      className={clsx(
                        "w-full rounded-lg border px-3 py-2 text-left text-xs",
                        grantShopId === c.shopId
                          ? "border-orange-400 bg-orange-50"
                          : "border-stone-200 bg-white hover:border-orange-300",
                      )}
                    >
                      <p className="font-black text-stone-900">{c.shopName}</p>
                      <p className="font-semibold text-stone-500">
                        {c.fullName ?? "—"} · {formatOwnerContactLabel(c.email, c.phoneE164)}
                        {c.district ? ` · ${c.district}` : ""}
                      </p>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="rounded-xl border border-stone-200 bg-stone-50 px-3 py-3">
            <p className="text-xs font-bold uppercase tracking-wide text-stone-500">{t(lang, "internalAgentsGrantShopLabel")}</p>
            <p className="mt-1 text-base font-black uppercase tracking-wide text-stone-900">
              {grantShopName || t(lang, "internalAgentsShopRequired")}
            </p>
          </div>
          <p className="text-sm font-bold text-stone-800">{t(lang, "internalAgentsRolesLabel")}</p>
          <div className="flex flex-wrap gap-2">
            {MARKETING_AGENT_ROLES.map((role) => {
              const checked = grantRoles.includes(role);
              return (
                <label
                  key={role}
                  className={clsx(
                    "inline-flex min-h-[40px] cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-xs font-bold",
                    checked ? "border-orange-400 bg-orange-50" : "border-stone-200 bg-white",
                  )}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    className="h-4 w-4"
                    onChange={() => setGrantRoles((prev) => toggleRole(prev, role))}
                  />
                  {roleLabel(role)}
                </label>
              );
            })}
          </div>
          <p className="text-xs font-medium text-stone-500">{t(lang, "internalAgentsRolesHint")}</p>
          {createMsg ? <p className="text-sm font-bold text-rose-700">{createMsg}</p> : null}
          <button
            type="button"
            disabled={createBusy || !grantShopId.trim()}
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
        ) : detailError ? (
          <p className="text-sm font-bold text-rose-700">{detailError}</p>
        ) : detailRows.length === 0 ? (
          <p className="text-sm font-semibold text-stone-500">{t(lang, "internalAgentsReferralsEmpty")}</p>
        ) : (
          <ul className="max-h-[50vh] space-y-2 overflow-y-auto">
            {detailRows.map((r) => (
              <li key={r.id} className="rounded-xl border border-stone-100 bg-stone-50 px-3 py-2">
                <p className="font-bold text-stone-900">{r.shopName ?? "—"}</p>
                <p className="text-xs text-stone-500">
                  {formatOwnerContactLabel(r.ownerEmail, r.ownerPhone)}
                  {r.planCode ? ` · ${r.planCode}` : ""}
                </p>
                <p className="text-[11px] text-stone-400">{r.createdAt ? new Date(r.createdAt).toLocaleString() : "—"}</p>
              </li>
            ))}
          </ul>
        )}
      </Modal>
    </div>
  );
}
