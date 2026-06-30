import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AlertTriangle, Check, Download } from "lucide-react";
import type { Language } from "../types";
import { t, tTemplate } from "../lib/i18n";
import { usePosStore } from "../store/usePosStore";
import { PageHeader } from "../components/layout/PageHeader";
import { useSessionActor } from "../context/SessionActorContext";
import {
  buildInventoryCountVarianceReport,
  canInventoryCount,
  inventoryCountLineHasStockDrift,
  sessionHasStockDrift,
} from "../lib/inventoryCount";
import {
  downloadInventoryCountCsv,
  downloadInventoryCountPdf,
} from "../lib/inventoryCountExport";

type Props = { lang: Language };

function statusLabel(lang: Language, status: string): string {
  return t(lang, `inventoryCountStatus_${status}`);
}

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

  const [query, setQuery] = useState("");
  const [qtyDraft, setQtyDraft] = useState<Record<string, string>>({});
  const [reasonDraft, setReasonDraft] = useState<Record<string, string>>({});
  const autoStartedRef = useRef(false);

  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  const report = useMemo(() => (session ? buildInventoryCountVarianceReport(session) : null), [session]);

  const stockDrift = session ? sessionHasStockDrift(session, products) : false;

  const filteredLines = useMemo(() => {
    if (!session) return [];
    const q = query.trim().toLowerCase();
    if (!q) return session.lines;
    return session.lines.filter((l) => (l.productName ?? "").toLowerCase().includes(q));
  }, [session, query]);

  useEffect(() => {
    if (!sessionId || !session || autoStartedRef.current) return;
    if (session.status !== "draft") return;
    if (!canInventoryCount(actor.role, "count")) return;
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

  const canCount = session.status === "counting" && canInventoryCount(actor.role, "count");
  const canSubmit = session.status === "counting" && canInventoryCount(actor.role, "submit");
  const canApprove = session.status === "submitted" && canInventoryCount(actor.role, "approve");
  const canApply = session.status === "approved" && canInventoryCount(actor.role, "apply");
  const canCancel =
    session.status !== "applied" &&
    session.status !== "cancelled" &&
    canInventoryCount(actor.role, "cancel");

  const showReview =
    session.status === "submitted" || session.status === "approved" || session.status === "applied";

  const shopName = preferences.shopDisplayName?.trim() || "Shop";

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

  return (
    <div className="page-content-pad space-y-5 pb-24">
      <PageHeader
        lang={lang}
        title={tTemplate(lang, "inventoryCountSessionNumber", { n: String(session.sessionNumber) })}
        subtitle={statusLabel(lang, session.status)}
        backLabel={t(lang, "stockCountNav")}
        backFallback="/stock/count"
      />

      {session.notes ? (
        <p className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm font-semibold text-stone-700">
          {session.notes}
        </p>
      ) : null}

      {showReview && stockDrift ? (
        <div className="flex gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-950">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
          {t(lang, "inventoryCountStockDriftWarning")}
        </div>
      ) : null}

      {report && showReview ? (
        <section className="rounded-2xl border border-indigo-100 bg-indigo-50/60 p-4">
          <h2 className="text-sm font-black uppercase tracking-wide text-indigo-900">
            {t(lang, "inventoryCountVarianceSummary")}
          </h2>
          <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="font-semibold text-indigo-800">{t(lang, "inventoryCountProductsCounted")}</dt>
              <dd className="text-lg font-black text-indigo-950">{report.productsCounted}</dd>
            </div>
            <div>
              <dt className="font-semibold text-indigo-800">{t(lang, "inventoryCountTotalVariance")}</dt>
              <dd className="text-lg font-black text-indigo-950">{report.totalVarianceQty}</dd>
            </div>
            <div>
              <dt className="font-semibold text-indigo-800">{t(lang, "inventoryCountCostImpact")}</dt>
              <dd className="font-black text-indigo-950">UGX {report.varianceCostUgx.toLocaleString()}</dd>
            </div>
            <div>
              <dt className="font-semibold text-indigo-800">{t(lang, "inventoryCountRetailImpact")}</dt>
              <dd className="font-black text-indigo-950">UGX {report.varianceRetailUgx.toLocaleString()}</dd>
            </div>
          </dl>
          {session.status === "applied" ? (
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-xl border border-indigo-200 bg-white px-3 py-2 text-xs font-black text-indigo-900"
                onClick={() =>
                  downloadInventoryCountCsv(lang, session, `count-${session.sessionNumber}.csv`)
                }
              >
                <Download className="h-4 w-4" aria-hidden />
                {t(lang, "inventoryCountExportCsv")}
              </button>
              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-xl border border-indigo-200 bg-white px-3 py-2 text-xs font-black text-indigo-900"
                onClick={() =>
                  void downloadInventoryCountPdf(
                    lang,
                    session,
                    shopName,
                    `count-${session.sessionNumber}.pdf`,
                  )
                }
              >
                <Download className="h-4 w-4" aria-hidden />
                {t(lang, "inventoryCountExportPdf")}
              </button>
            </div>
          ) : null}
        </section>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {session.status === "draft" && canInventoryCount(actor.role, "count") ? (
          <button
            type="button"
            onClick={() => runAction(() => startSession(sessionId))}
            className="rounded-2xl bg-stone-950 px-4 py-3 text-sm font-black text-white"
          >
            {t(lang, "inventoryCountStart")}
          </button>
        ) : null}
        {canSubmit ? (
          <button
            type="button"
            onClick={() => runAction(() => submitSession(sessionId))}
            className="rounded-2xl bg-indigo-700 px-4 py-3 text-sm font-black text-white"
          >
            {t(lang, "inventoryCountSubmit")}
          </button>
        ) : null}
        {canApprove ? (
          <button
            type="button"
            onClick={() => runAction(() => approveSession(sessionId))}
            className="rounded-2xl bg-emerald-700 px-4 py-3 text-sm font-black text-white"
          >
            {t(lang, "inventoryCountApprove")}
          </button>
        ) : null}
        {canApply ? (
          <button
            type="button"
            onClick={() => {
              const r = applySession(sessionId);
              if (!r.ok) {
                window.alert(t(lang, r.errorKey ?? "invalid"));
                return;
              }
              navigate("/stock/count");
            }}
            className="rounded-2xl bg-stone-950 px-4 py-3 text-sm font-black text-white"
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
            className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-black text-rose-900"
          >
            {t(lang, "inventoryCountCancel")}
          </button>
        ) : null}
      </div>

      {session.status === "draft" ? (
        <p className="rounded-2xl border border-dashed border-stone-200 bg-stone-50 px-4 py-6 text-center text-sm font-semibold text-stone-600">
          {t(lang, "inventoryCountStarting")}
        </p>
      ) : null}

      {canCount ? (
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t(lang, "inventoryCountSearchProduct")}
          className="w-full rounded-2xl border border-stone-200 bg-white px-4 py-3 text-base font-semibold"
        />
      ) : null}

      <ul className="space-y-3">
        {filteredLines.map((line) => {
          const product = productById.get(line.productId);
          const drift = inventoryCountLineHasStockDrift(line, product);
          const currentStock = product ? product.stockOnHand : null;

          return (
            <li key={line.id} className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-2">
                <p className="text-base font-black text-stone-950">{line.productName ?? line.productId}</p>
                {line.countedQty != null ? (
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-100 text-emerald-800">
                    <Check className="h-4 w-4" aria-hidden />
                  </span>
                ) : null}
              </div>

              <dl className="mt-2 grid grid-cols-2 gap-2 text-xs font-semibold text-stone-600">
                <div>
                  <dt>{t(lang, "inventoryCountSnapshotStock")}</dt>
                  <dd className="text-sm font-black text-stone-900">{line.expectedQtySnapshot}</dd>
                </div>
                {showReview && currentStock != null ? (
                  <div>
                    <dt>{t(lang, "inventoryCountCurrentStock")}</dt>
                    <dd className={`text-sm font-black ${drift ? "text-amber-700" : "text-stone-900"}`}>
                      {currentStock}
                    </dd>
                  </div>
                ) : null}
                {line.countedQty != null ? (
                  <>
                    <div>
                      <dt>{t(lang, "inventoryCountCounted")}</dt>
                      <dd className="text-sm font-black text-stone-900">{line.countedQty}</dd>
                    </div>
                    <div>
                      <dt>{t(lang, "inventoryCountVariance")}</dt>
                      <dd
                        className={`text-sm font-black ${line.varianceQty < 0 ? "text-rose-700" : line.varianceQty > 0 ? "text-emerald-700" : "text-stone-900"}`}
                      >
                        {line.varianceQty >= 0 ? "+" : ""}
                        {line.varianceQty}
                      </dd>
                    </div>
                    <div>
                      <dt>{t(lang, "inventoryCountCostImpact")}</dt>
                      <dd className="text-sm font-black text-stone-900">
                        UGX {line.varianceCostUgx.toLocaleString()}
                      </dd>
                    </div>
                    <div>
                      <dt>{t(lang, "inventoryCountRetailImpact")}</dt>
                      <dd className="text-sm font-black text-stone-900">
                        UGX {line.varianceRetailUgx.toLocaleString()}
                      </dd>
                    </div>
                  </>
                ) : null}
              </dl>

              {canCount ? (
                <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                  <input
                    type="text"
                    inputMode="decimal"
                    placeholder={t(lang, "inventoryCountCounted")}
                    value={qtyDraft[line.productId] ?? (line.countedQty != null ? String(line.countedQty) : "")}
                    onChange={(e) => setQtyDraft((d) => ({ ...d, [line.productId]: e.target.value }))}
                    className="min-w-0 flex-1 rounded-xl border border-stone-200 px-3 py-3 text-lg font-black tabular-nums"
                  />
                  <input
                    type="text"
                    placeholder={t(lang, "inventoryCountReason")}
                    value={reasonDraft[line.productId] ?? line.reason}
                    onChange={(e) => setReasonDraft((d) => ({ ...d, [line.productId]: e.target.value }))}
                    className="min-w-0 flex-1 rounded-xl border border-stone-200 px-3 py-2 text-sm font-semibold"
                  />
                  <button
                    type="button"
                    onClick={() => saveLine(line.productId)}
                    className="rounded-xl bg-stone-950 px-4 py-3 text-sm font-black text-white"
                  >
                    {t(lang, "inventoryCountSaveQty")}
                  </button>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
