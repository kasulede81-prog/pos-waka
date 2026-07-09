import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { Language } from "../types";
import { t, tTemplate } from "../lib/i18n";
import { usePosStore } from "../store/usePosStore";
import { PageHeader } from "../components/layout/PageHeader";
import { useSessionActor } from "../context/SessionActorContext";
import {
  buildInventoryCountVarianceReport,
  canInventoryCount,
  sessionHasStockDrift,
} from "../lib/inventoryCount";
import { countProgressStage, filterInventoryCountLines } from "../lib/countWorkspace";
import { InventoryCountShell } from "../components/inventory/count/InventoryCountShell";
import { CountHeader } from "../components/inventory/count/CountHeader";
import { CountProgress } from "../components/inventory/count/CountProgress";
import { CountStatusStrip } from "../components/inventory/count/CountStatusStrip";
import { CountSearchBar } from "../components/inventory/count/CountSearchBar";
import { CountProductCard } from "../components/inventory/count/CountProductCard";
import { CountSummaryPanel } from "../components/inventory/count/CountSummaryPanel";
import { CountApprovalDialog } from "../components/inventory/count/CountApprovalDialog";
import { CountCompletionScreen } from "../components/inventory/count/CountCompletionScreen";
import { WIZARD_BTN_FOOTER_BASE } from "../components/inventory/count/countTokens";
import clsx from "clsx";

type Props = { lang: Language };

export function InventoryCountSessionPage({ lang }: Props) {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const actor = useSessionActor();
  const products = usePosStore((s) => s.products);
  const preferences = usePosStore((s) => s.preferences);
  const session = usePosStore((s) => s.inventoryCountSessions.find((row) => row.id === sessionId));

  const startSession = usePosStore((s) => s.startInventoryCountSession);
  const setLine = usePosStore((s) => s.setInventoryCountLine);
  const submitSession = usePosStore((s) => s.submitInventoryCountSession);
  const approveSession = usePosStore((s) => s.approveInventoryCountSession);
  const applySession = usePosStore((s) => s.applyInventoryCountSession);
  const cancelSession = usePosStore((s) => s.cancelInventoryCountSession);
  const createSession = usePosStore((s) => s.createInventoryCountSession);

  const [query, setQuery] = useState("");
  const [qtyDraft, setQtyDraft] = useState<Record<string, string>>({});
  const [reasonDraft, setReasonDraft] = useState<Record<string, string>>({});
  const [applyConfirmOpen, setApplyConfirmOpen] = useState(false);
  const autoStartedRef = useRef(false);

  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const report = useMemo(() => (session ? buildInventoryCountVarianceReport(session) : null), [session]);
  const stockDrift = session ? sessionHasStockDrift(session, products) : false;
  const progressStage = session ? countProgressStage(session.status) : "choose";

  const filteredLines = useMemo(() => {
    if (!session) return [];
    return filterInventoryCountLines(session.lines, productById, query);
  }, [session, productById, query]);

  useEffect(() => {
    if (!sessionId || !session || autoStartedRef.current) return;
    if (session.status !== "draft") return;
    if (!canInventoryCount(actor.role, "count", actor.permissions)) return;
    autoStartedRef.current = true;
    const r = startSession(sessionId);
    if (!r.ok) autoStartedRef.current = false;
  }, [sessionId, session, actor.role, startSession]);

  if (!sessionId || !session) {
    return (
      <div className="page-content-pad">
        <PageHeader lang={lang} title={t(lang, "inventoryCountTitle")} backLabel={t(lang, "stockCountNav")} backFallback="/stock/count" />
        <p className="text-sm font-semibold text-stone-500">{t(lang, "invalid")}</p>
      </div>
    );
  }

  const canCount = session.status === "counting" && canInventoryCount(actor.role, "count", actor.permissions);
  const canSubmit = session.status === "counting" && canInventoryCount(actor.role, "submit", actor.permissions);
  const canApprove = session.status === "submitted" && canInventoryCount(actor.role, "approve", actor.permissions);
  const canApply = session.status === "approved" && canInventoryCount(actor.role, "apply", actor.permissions);
  const canCancel =
    session.status !== "applied" &&
    session.status !== "cancelled" &&
    canInventoryCount(actor.role, "cancel", actor.permissions);
  const showReview =
    session.status === "submitted" || session.status === "approved" || session.status === "applied";
  const isComplete = session.status === "applied";

  const shopName = preferences.shopDisplayName?.trim() || "Shop";
  const operatorName = session.appliedByName ?? session.approvedByName ?? session.startedByName ?? actor.displayName ?? actor.userId;

  const saveLine = (productId: string) => {
    const raw = qtyDraft[productId] ?? "";
    const qty = Number(raw.replace(/[^\d.-]/g, ""));
    if (!Number.isFinite(qty) || qty < 0) return;
    const r = setLine(sessionId, productId, qty, reasonDraft[productId]);
    if (!r.ok) window.alert(t(lang, r.errorKey ?? "invalid"));
  };

  const runAction = (fn: () => { ok: boolean; errorKey?: string }) => {
    const r = fn();
    if (!r.ok) window.alert(t(lang, r.errorKey ?? "invalid"));
  };

  const onStartNew = () => {
    const r = createSession();
    if (!r.ok || !r.sessionId) {
      window.alert(t(lang, r.errorKey ?? "invalid"));
      return;
    }
    const started = startSession(r.sessionId);
    if (!started.ok) {
      navigate(`/stock/count/${r.sessionId}`);
      return;
    }
    navigate(`/stock/count/${r.sessionId}`);
  };

  return (
    <div className="page-content-pad space-y-4">
      <PageHeader
        lang={lang}
        title={tTemplate(lang, "inventoryCountSessionNumber", { n: String(session.sessionNumber) })}
        subtitle={t(lang, `inventoryCountStatus_${session.status}`)}
        backLabel={t(lang, "stockCountNav")}
        backFallback="/stock/count"
      />

      <InventoryCountShell
        lang={lang}
        variant="page"
        title={t(lang, "inventoryCountTitle")}
        warning={showReview && stockDrift ? t(lang, "inventoryCountStockDriftWarning") : null}
        statusStrip={<CountStatusStrip lang={lang} />}
      >
        <CountProgress lang={lang} stage={progressStage} />
        <CountHeader lang={lang} session={session} />

        {session.notes ? (
          <p className="rounded-2xl border border-border/60 bg-muted/30 px-4 py-3 text-sm font-semibold text-muted-foreground">
            {session.notes}
          </p>
        ) : null}

        {isComplete && report ? (
          <CountCompletionScreen
            lang={lang}
            session={session}
            report={report}
            shopName={shopName}
            onStartNew={canInventoryCount(actor.role, "create", actor.permissions) ? onStartNew : undefined}
          />
        ) : (
          <>
            {report && showReview ? (
              <CountSummaryPanel lang={lang} session={session} report={report} operatorName={operatorName} />
            ) : null}

            <div className="flex flex-wrap gap-2">
              {session.status === "draft" && canInventoryCount(actor.role, "count", actor.permissions) ? (
                <button
                  type="button"
                  onClick={() => runAction(() => startSession(sessionId))}
                  className={clsx(WIZARD_BTN_FOOTER_BASE, "bg-primary px-4 text-primary-foreground hover:bg-primary/90")}
                >
                  {t(lang, "inventoryCountStart")}
                </button>
              ) : null}
              {canSubmit ? (
                <button
                  type="button"
                  onClick={() => runAction(() => submitSession(sessionId))}
                  className={clsx(WIZARD_BTN_FOOTER_BASE, "bg-indigo-700 px-4 text-white hover:bg-indigo-800")}
                >
                  {t(lang, "inventoryCountSubmit")}
                </button>
              ) : null}
              {canApprove ? (
                <button
                  type="button"
                  onClick={() => runAction(() => approveSession(sessionId))}
                  className={clsx(WIZARD_BTN_FOOTER_BASE, "bg-emerald-700 px-4 text-white hover:bg-emerald-800")}
                >
                  {t(lang, "inventoryCountApprove")}
                </button>
              ) : null}
              {canApply ? (
                <button
                  type="button"
                  onClick={() => setApplyConfirmOpen(true)}
                  className={clsx(WIZARD_BTN_FOOTER_BASE, "bg-primary px-4 text-primary-foreground hover:bg-primary/90")}
                >
                  {t(lang, "inventoryCountApply")}
                </button>
              ) : null}
              {canCancel ? (
                <button
                  type="button"
                  onClick={() => {
                    const r = cancelSession(sessionId);
                    if (!r.ok) {
                      window.alert(t(lang, r.errorKey ?? "invalid"));
                      return;
                    }
                    navigate("/stock/count");
                  }}
                  className={clsx(
                    WIZARD_BTN_FOOTER_BASE,
                    "border border-rose-200 bg-rose-50 px-4 text-rose-900 hover:bg-rose-100",
                  )}
                >
                  {t(lang, "inventoryCountCancel")}
                </button>
              ) : null}
            </div>

            {session.status === "draft" ? (
              <p className="rounded-2xl border border-dashed border-border/60 bg-muted/20 px-4 py-6 text-center text-sm font-semibold text-muted-foreground">
                {t(lang, "inventoryCountStarting")}
              </p>
            ) : null}

            {canCount ? <CountSearchBar lang={lang} value={query} onChange={setQuery} /> : null}

            <ul className="space-y-3">
              {filteredLines.map((line) => (
                <CountProductCard
                  key={line.id}
                  lang={lang}
                  line={line}
                  product={productById.get(line.productId)}
                  businessType={preferences.businessType}
                  pharmacyModeEnabled={preferences.pharmacyModeEnabled}
                  showReview={showReview}
                  canCount={canCount}
                  qtyValue={qtyDraft[line.productId] ?? (line.countedQty != null ? String(line.countedQty) : "")}
                  reasonValue={reasonDraft[line.productId] ?? line.reason}
                  onQtyChange={(v) => setQtyDraft((d) => ({ ...d, [line.productId]: v }))}
                  onReasonChange={(v) => setReasonDraft((d) => ({ ...d, [line.productId]: v }))}
                  onSave={() => saveLine(line.productId)}
                />
              ))}
            </ul>
          </>
        )}
      </InventoryCountShell>

      {applyConfirmOpen && report ? (
        <CountApprovalDialog
          lang={lang}
          open
          title={t(lang, "cntApprovalTitle")}
          confirmLabelKey="inventoryCountApply"
          warning={stockDrift ? t(lang, "inventoryCountStockDriftWarning") : null}
          onCancel={() => setApplyConfirmOpen(false)}
          onConfirm={() => {
            const r = applySession(sessionId);
            setApplyConfirmOpen(false);
            if (!r.ok) {
              window.alert(t(lang, r.errorKey ?? "invalid"));
            }
          }}
          body={
            <p>
              {tTemplate(lang, "adjConfirmApplyCountBody", {
                count: String(report.productsCounted),
              })}
            </p>
          }
        >
          <dl className="mt-4 grid grid-cols-2 gap-3 text-xs font-semibold text-muted-foreground">
            <div>
              <dt>{t(lang, "inventoryCountProductsCounted")}</dt>
              <dd className="text-sm font-black text-foreground">{report.productsCounted}</dd>
            </div>
            <div>
              <dt>{t(lang, "inventoryCountTotalVariance")}</dt>
              <dd className="text-sm font-black text-foreground">
                {report.totalVarianceQty >= 0 ? "+" : ""}
                {report.totalVarianceQty}
              </dd>
            </div>
            <div>
              <dt>{t(lang, "inventoryCountCostImpact")}</dt>
              <dd className="text-sm font-black text-foreground">UGX {report.varianceCostUgx.toLocaleString()}</dd>
            </div>
            <div>
              <dt>{t(lang, "inventoryCountRetailImpact")}</dt>
              <dd className="text-sm font-black text-foreground">UGX {report.varianceRetailUgx.toLocaleString()}</dd>
            </div>
          </dl>
        </CountApprovalDialog>
      ) : null}
    </div>
  );
}
