import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import type { Language } from "../types";
import { t, tTemplate } from "../lib/i18n";
import { actorHasPermission } from "../lib/actorAuthorization";
import { useSessionActor } from "../context/SessionActorContext";
import { resolveShopCtx } from "../offline/cloudSync";
import { PageHeader } from "../components/layout/PageHeader";
import { BackOfficePageLayout } from "../components/office/BackOfficePageLayout";
import { WakaSwitch } from "../components/enterprise/WakaSwitch";
import {
  adjustLoyaltyPoints,
  fetchAccountHistory,
  fetchLoyaltyOverview,
  saveLoyaltyProgram,
  searchLoyaltyAccounts,
  validateProgramInput,
  type LoyaltyAccountListEntry,
  type LoyaltyOverview,
  type ProgramInput,
} from "../lib/loyalty/loyaltyMerchant";
import type { LoyaltyTransactionRow } from "../lib/loyalty/loyaltyMath";
import { DEFAULT_LOYALTY_PROGRAM } from "../lib/loyalty/loyaltyMath";

const KIND_LABEL_KEY: Record<string, string> = {
  earned: "loyaltyKindEarned",
  redeemed: "loyaltyKindRedeemed",
  reversed: "loyaltyKindReversed",
  expired: "loyaltyKindExpired",
  adjusted: "loyaltyKindAdjusted",
  promotional: "loyaltyKindPromotional",
};

function kindLabel(lang: Language, kind: string): string {
  return t(lang, KIND_LABEL_KEY[kind] ?? "loyaltyKindAdjusted");
}

function formatDate(lang: Language, iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(lang === "lg" ? "lg-UG" : lang === "sw" ? "sw-UG" : "en-UG", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatDateTime(lang: Language, iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(lang === "lg" ? "lg-UG" : lang === "sw" ? "sw-UG" : "en-UG", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function StatCard({ label, value, tone }: { label: string; value: string; tone?: "default" | "accent" }) {
  return (
    <div
      className={clsx(
        "rounded-2xl border p-4 shadow-sm",
        tone === "accent" ? "border-waka-300 bg-waka-50" : "border-border bg-card",
      )}
    >
      <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-black text-foreground">{value}</p>
    </div>
  );
}

function HistoryList({ lang, rows }: { lang: Language; rows: LoyaltyTransactionRow[] }) {
  if (rows.length === 0) {
    return <p className="py-3 text-sm font-medium text-muted-foreground">{t(lang, "loyaltyNoHistory")}</p>;
  }
  return (
    <ul className="divide-y divide-border">
      {rows.map((row) => (
        <li key={row.id} className="flex items-center justify-between gap-3 py-2">
          <div className="min-w-0">
            <p className="text-sm font-bold text-foreground">
              {kindLabel(lang, row.kind)}
              {row.note ? <span className="font-medium text-muted-foreground"> — {row.note}</span> : null}
            </p>
            <p className="text-xs font-medium text-muted-foreground">{formatDateTime(lang, row.createdAt)}</p>
          </div>
          <div className="shrink-0 text-right">
            <p
              className={clsx(
                "text-sm font-black",
                row.points > 0 ? "text-success" : "text-destructive",
              )}
            >
              {row.points > 0 ? "+" : ""}
              {row.points} {t(lang, "loyaltyPointsUnit")}
            </p>
            {row.balanceAfter != null ? (
              <p className="text-xs font-medium text-muted-foreground">
                {t(lang, "loyaltyBalanceLabel")}: {row.balanceAfter}
              </p>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}

function CustomerDetail({
  lang,
  shopId,
  entry,
  canManage,
  onAdjusted,
}: {
  lang: Language;
  shopId: string;
  entry: LoyaltyAccountListEntry;
  canManage: boolean;
  onAdjusted: () => void;
}) {
  const [history, setHistory] = useState<LoyaltyTransactionRow[] | null>(null);
  const [adjustPoints, setAdjustPoints] = useState("");
  const [adjustNote, setAdjustNote] = useState("");
  const [adjustState, setAdjustState] = useState<"idle" | "saving" | "done" | "error">("idle");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const rows = await fetchAccountHistory(shopId, entry.accountId);
      if (!cancelled) setHistory(rows);
    })();
    return () => {
      cancelled = true;
    };
  }, [shopId, entry.accountId]);

  const submitAdjust = async () => {
    const points = Number(adjustPoints);
    if (!Number.isInteger(points) || points === 0 || !adjustNote.trim()) return;
    setAdjustState("saving");
    const result = await adjustLoyaltyPoints(entry.accountId, points, adjustNote);
    if (result.ok) {
      setAdjustState("done");
      setAdjustPoints("");
      setAdjustNote("");
      onAdjusted();
    } else {
      setAdjustState("error");
    }
  };

  return (
    <div className="mt-3 space-y-4 rounded-2xl border border-border bg-muted/50 p-4">
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <p className="font-semibold text-muted-foreground">{t(lang, "loyaltyEnrolledOn")}</p>
          <p className="font-bold text-foreground">{formatDate(lang, entry.enrolledAt)}</p>
        </div>
        <div>
          <p className="font-semibold text-muted-foreground">{t(lang, "loyaltyLifetimeEarned")}</p>
          <p className="font-bold text-foreground">
            {entry.lifetimeEarnedPoints} {t(lang, "loyaltyPointsUnit")}
          </p>
        </div>
        <div>
          <p className="font-semibold text-muted-foreground">{t(lang, "loyaltyLifetimeRedeemed")}</p>
          <p className="font-bold text-foreground">
            {entry.lifetimeRedeemedPoints} {t(lang, "loyaltyPointsUnit")}
          </p>
        </div>
      </div>

      <div>
        <p className="text-sm font-black text-foreground">{t(lang, "loyaltyHistoryTitle")}</p>
        {history === null ? (
          <p className="py-3 text-sm font-medium text-muted-foreground">{t(lang, "loyaltyLoading")}</p>
        ) : (
          <HistoryList lang={lang} rows={history} />
        )}
      </div>

      {canManage ? (
        <div className="rounded-2xl border border-border bg-card p-3">
          <p className="text-sm font-black text-foreground">{t(lang, "loyaltyAdjustTitle")}</p>
          <p className="mt-0.5 text-xs font-medium text-muted-foreground">{t(lang, "loyaltyAdjustHint")}</p>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <input
              type="number"
              value={adjustPoints}
              onChange={(e) => setAdjustPoints(e.target.value)}
              placeholder="+10 / -50"
              className="min-h-[44px] w-full rounded-xl border-2 border-border bg-card px-3 py-2 text-base font-semibold"
            />
            <input
              value={adjustNote}
              onChange={(e) => setAdjustNote(e.target.value)}
              placeholder={t(lang, "loyaltyAdjustNotePlaceholder")}
              className="min-h-[44px] w-full rounded-xl border-2 border-border bg-card px-3 py-2 text-base font-semibold"
            />
          </div>
          <div className="mt-3 flex items-center gap-3">
            <button
              type="button"
              onClick={() => void submitAdjust()}
              disabled={adjustState === "saving"}
              className="min-h-[44px] rounded-xl bg-waka-600 px-4 text-sm font-black text-white disabled:opacity-50"
            >
              {t(lang, "loyaltyAdjustApply")}
            </button>
            {adjustState === "done" ? (
              <span className="text-sm font-bold text-success">{t(lang, "loyaltySaved")}</span>
            ) : null}
            {adjustState === "error" ? (
              <span className="text-sm font-bold text-destructive">
                {t(lang, "loyaltyAdjustForbidden")}
              </span>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function LoyaltyHubPage({ lang }: { lang: Language }) {
  const actor = useSessionActor();
  const canManage = actorHasPermission(actor, "settings.shop");
  const [shopId, setShopId] = useState<string | null>(null);
  const [overview, setOverview] = useState<LoyaltyOverview | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [draft, setDraft] = useState<ProgramInput>({ ...DEFAULT_LOYALTY_PROGRAM });
  const [saveState, setSaveState] = useState<"idle" | "saving" | "done" | "error">("idle");
  const [search, setSearch] = useState("");
  const [accounts, setAccounts] = useState<LoyaltyAccountListEntry[]>([]);
  const [searchDone, setSearchDone] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const searchSeq = useRef(0);

  const loadOverview = useCallback(async (id: string) => {
    const next = await fetchLoyaltyOverview(id);
    if (next) {
      setOverview(next);
      setLoadState("ready");
      if (next.program) {
        setDraft({
          enabled: next.program.enabled,
          earnUnitUgx: next.program.earnUnitUgx,
          earnPointsPerUnit: next.program.earnPointsPerUnit,
          minEligibleSpendUgx: next.program.minEligibleSpendUgx,
        });
      }
    } else {
      setLoadState("error");
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const ctx = await resolveShopCtx();
      if (cancelled) return;
      const id = ctx?.shopId ?? null;
      setShopId(id);
      if (id) await loadOverview(id);
      else setLoadState("error");
    })();
    return () => {
      cancelled = true;
    };
  }, [loadOverview]);

  const runSearch = useCallback(async (id: string, query: string) => {
    const seq = ++searchSeq.current;
    const rows = await searchLoyaltyAccounts(id, query);
    if (seq !== searchSeq.current) return;
    setAccounts(rows);
    setSearchDone(true);
  }, []);

  useEffect(() => {
    if (!shopId || loadState !== "ready") return;
    const handle = window.setTimeout(() => void runSearch(shopId, search), 250);
    return () => window.clearTimeout(handle);
  }, [shopId, search, loadState, runSearch]);

  const programEnabled = overview?.program?.enabled ?? false;
  const programConfigured = overview?.program != null;
  const inputError = useMemo(() => validateProgramInput(draft), [draft]);

  const submitSave = async () => {
    if (!shopId || inputError) return;
    setSaveState("saving");
    const result = await saveLoyaltyProgram(shopId, draft);
    if (result.ok) {
      setSaveState("done");
      await loadOverview(shopId);
      void runSearch(shopId, search);
    } else {
      setSaveState("error");
    }
  };

  return (
    <BackOfficePageLayout
      header={
        <PageHeader
          lang={lang}
          title={t(lang, "loyaltyHubTitle")}
          subtitle={t(lang, "loyaltyHubSub")}
          backFallback="/office"
          backLabel={t(lang, "officeHubTitle")}
          compact
        />
      }
    >
      {loadState === "loading" ? (
        <p className="rounded-2xl bg-muted px-4 py-6 text-center text-sm font-bold text-muted-foreground">
          {t(lang, "loyaltyLoading")}
        </p>
      ) : null}

      {loadState === "error" ? (
        <p className="rounded-2xl bg-warning-muted px-4 py-6 text-center text-sm font-bold text-warning-foreground">
          {t(lang, "loyaltyUnavailable")}
        </p>
      ) : null}

      {loadState === "ready" && overview ? (
        <div className="space-y-4">
          <article className="rounded-2xl border border-border bg-card p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <p className="text-base font-black text-foreground">{t(lang, "loyaltyProgramStatusTitle")}</p>
              <span
                className={clsx(
                  "rounded-full px-3 py-1 text-xs font-black",
                  programConfigured && programEnabled
                    ? "bg-success-muted text-success"
                    : programConfigured
                      ? "bg-muted text-muted-foreground"
                      : "bg-warning-muted text-warning-foreground",
                )}
              >
                {programConfigured
                  ? programEnabled
                    ? t(lang, "loyaltyProgramActive")
                    : t(lang, "loyaltyProgramInactive")
                  : t(lang, "loyaltyProgramNotSetup")}
              </span>
            </div>
            {programConfigured && !programEnabled ? (
              <p className="mt-2 text-sm font-medium text-muted-foreground">
                {t(lang, "loyaltyNotEnabledHint")}
              </p>
            ) : null}
            <div className="mt-4 grid grid-cols-3 gap-3">
              <StatCard
                label={t(lang, "loyaltyMembersStat")}
                value={String(overview.membersActive)}
                tone="accent"
              />
              <StatCard label={t(lang, "loyaltyPointsIssuedStat")} value={String(overview.pointsIssued)} />
              <StatCard label={t(lang, "loyaltyPointsRedeemedStat")} value={String(overview.pointsRedeemed)} />
            </div>
          </article>

          {canManage ? (
            <article className="rounded-2xl border border-border bg-card p-4 shadow-sm">
              <p className="text-base font-black text-foreground">{t(lang, "loyaltyEarnRuleTitle")}</p>
              <p className="mt-1 text-sm font-medium text-muted-foreground">{t(lang, "loyaltyEarnRuleSub")}</p>
              <div className="mt-4">
                <WakaSwitch
                  checked={draft.enabled}
                  onCheckedChange={(checked) => setDraft((d) => ({ ...d, enabled: checked }))}
                  label={t(lang, "loyaltyEnabledLabel")}
                />
              </div>
              <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
                <label className="block text-sm font-bold text-foreground">
                  {t(lang, "loyaltyEarnUnitLabel")}
                  <input
                    type="number"
                    min={1}
                    value={draft.earnUnitUgx}
                    onChange={(e) => setDraft((d) => ({ ...d, earnUnitUgx: Number(e.target.value) }))}
                    className="mt-2 min-h-[48px] w-full rounded-xl border-2 border-border bg-card px-3 py-2 text-base font-semibold"
                  />
                </label>
                <label className="block text-sm font-bold text-foreground">
                  {t(lang, "loyaltyPointsPerUnitLabel")}
                  <input
                    type="number"
                    min={1}
                    value={draft.earnPointsPerUnit}
                    onChange={(e) => setDraft((d) => ({ ...d, earnPointsPerUnit: Number(e.target.value) }))}
                    className="mt-2 min-h-[48px] w-full rounded-xl border-2 border-border bg-card px-3 py-2 text-base font-semibold"
                  />
                </label>
                <label className="block text-sm font-bold text-foreground">
                  {t(lang, "loyaltyMinSpendLabel")}
                  <input
                    type="number"
                    min={0}
                    value={draft.minEligibleSpendUgx}
                    onChange={(e) => setDraft((d) => ({ ...d, minEligibleSpendUgx: Number(e.target.value) }))}
                    className="mt-2 min-h-[48px] w-full rounded-xl border-2 border-border bg-card px-3 py-2 text-base font-semibold"
                  />
                </label>
              </div>
              <p className="mt-3 rounded-xl bg-muted px-3 py-2 text-sm font-semibold text-foreground">
                {tTemplate(lang, "loyaltyRuleSummary", {
                  points: draft.earnPointsPerUnit,
                  unit: draft.earnUnitUgx.toLocaleString(),
                  min: draft.minEligibleSpendUgx.toLocaleString(),
                })}
              </p>
              <div className="mt-4 flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => void submitSave()}
                  disabled={saveState === "saving" || inputError != null}
                  className="min-h-[48px] rounded-2xl bg-waka-600 px-5 text-sm font-black text-white disabled:opacity-50"
                >
                  {t(lang, "loyaltySave")}
                </button>
                {saveState === "done" ? (
                  <span className="text-sm font-bold text-success">{t(lang, "loyaltySaved")}</span>
                ) : null}
                {saveState === "error" ? (
                  <span className="text-sm font-bold text-destructive">{t(lang, "loyaltySaveFailed")}</span>
                ) : null}
              </div>
            </article>
          ) : null}

          <article className="rounded-2xl border border-border bg-card p-4 shadow-sm">
            <p className="text-base font-black text-foreground">{t(lang, "loyaltyCustomersTitle")}</p>
            <input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setSearchDone(false);
              }}
              placeholder={t(lang, "loyaltySearchPlaceholder")}
              className="mt-3 min-h-[48px] w-full rounded-xl border-2 border-border bg-card px-3 py-2 text-base font-semibold"
            />
            {searchDone && accounts.length === 0 ? (
              <p className="mt-3 text-sm font-medium text-muted-foreground">
                {search.trim() ? t(lang, "loyaltyNoMembersFound") : t(lang, "loyaltyNoMembers")}
              </p>
            ) : (
              <ul className="mt-3 divide-y divide-border">
                {accounts.map((entry) => (
                  <li key={entry.accountId} className="py-2">
                    <button
                      type="button"
                      onClick={() => setExpandedId((id) => (id === entry.accountId ? null : entry.accountId))}
                      className="flex w-full items-center justify-between gap-3 rounded-xl px-2 py-2 text-left transition hover:bg-muted"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-black text-foreground">{entry.customerName}</p>
                        <p className="text-xs font-medium text-muted-foreground">
                          {entry.customerPhone ?? ""}
                          {entry.status === "disabled" ? ` · ${t(lang, "loyaltyProgramInactive")}` : ""}
                        </p>
                      </div>
                      <p className="shrink-0 text-sm font-black text-foreground">
                        {entry.balancePoints} {t(lang, "loyaltyPointsUnit")}
                      </p>
                    </button>
                    {expandedId === entry.accountId && shopId ? (
                      <CustomerDetail
                        lang={lang}
                        shopId={shopId}
                        entry={entry}
                        canManage={canManage}
                        onAdjusted={() => {
                          void loadOverview(shopId);
                          void runSearch(shopId, search);
                        }}
                      />
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </article>

          {overview.recentActivity.length > 0 ? (
            <article className="rounded-2xl border border-border bg-card p-4 shadow-sm">
              <p className="text-base font-black text-foreground">{t(lang, "loyaltyRecentActivityTitle")}</p>
              <ul className="mt-2 divide-y divide-border">
                {overview.recentActivity.map((row) => (
                  <li key={row.id} className="flex items-center justify-between gap-3 py-2">
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-foreground">
                        {row.customerName} · {kindLabel(lang, row.kind)}
                      </p>
                      <p className="text-xs font-medium text-muted-foreground">
                        {formatDateTime(lang, row.createdAt)}
                      </p>
                    </div>
                    <p className={clsx("shrink-0 text-sm font-black", row.points > 0 ? "text-success" : "text-destructive")}>
                      {row.points > 0 ? "+" : ""}
                      {row.points} {t(lang, "loyaltyPointsUnit")}
                    </p>
                  </li>
                ))}
              </ul>
            </article>
          ) : null}
        </div>
      ) : null}
    </BackOfficePageLayout>
  );
}
