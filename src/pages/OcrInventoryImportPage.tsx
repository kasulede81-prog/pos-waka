import { useCallback, useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { Capacitor } from "@capacitor/core";
import { Camera, MediaType } from "@capacitor/camera";
import type { Language, OcrCaptureMode, OcrReviewRow } from "../types";
import { t, tTemplate } from "../lib/i18n";
import { WakaMlkitOcr, type OcrTextBlock } from "../plugins/wakaMlkitOcr";
import { applyLocalOcrCleanup, buildOcrReviewRows, selectedRowsToBulkInput } from "../lib/ocrInventoryPipeline";
import { usePosStore } from "../store/usePosStore";
import { useSessionActor } from "../context/SessionActorContext";
import { hasPermission } from "../lib/permissions";
import { canUseAiStockTools, fetchMyFeatureEntitlements } from "../lib/shopRequests";

type Step = "choose" | "review";

const isAndroidNative = () => Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";

export function OcrInventoryImportPage({ lang }: { lang: Language }) {
  const actor = useSessionActor();
  const bulkQuickAddProducts = usePosStore((s) => s.bulkQuickAddProducts);
  const [aiGate, setAiGate] = useState<"check" | "ok" | "no">("check");

  const canAdd = hasPermission(actor.role, "products.add");

  useEffect(() => {
    void fetchMyFeatureEntitlements().then((ent) => {
      setAiGate(canUseAiStockTools(ent) ? "ok" : "no");
    });
  }, []);
  const [step, setStep] = useState<Step>("choose");
  const [mode, setMode] = useState<OcrCaptureMode>("stock_list");
  const [category, setCategory] = useState("General");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [fullText, setFullText] = useState("");
  const [rows, setRows] = useState<OcrReviewRow[]>([]);
  const [pasteSim, setPasteSim] = useState("");
  const [doneMsg, setDoneMsg] = useState<string | null>(null);

  const runParse = useCallback(
    (text: string, bl: OcrTextBlock[]) => {
      const next = buildOcrReviewRows(text, bl, mode, category.trim() || "General");
      setRows(next);
      setStep("review");
    },
    [category, mode],
  );

  const takePhoto = useCallback(async () => {
    setErr(null);
    setBusy(true);
    try {
      const perm = await Camera.requestPermissions({ permissions: ["camera"] });
      if (perm.camera === "denied") {
        setErr(t(lang, "ocrCameraDenied"));
        setBusy(false);
        return;
      }
      const media = await Camera.takePhoto({
        quality: 82,
        saveToGallery: false,
        editable: "no",
        correctOrientation: true,
      });
      if (media.type !== MediaType.Photo) {
        setErr(t(lang, "ocrNoImagePath"));
        setBusy(false);
        return;
      }
      const path = media.uri ?? media.webPath ?? "";
      if (!path) {
        setErr(t(lang, "ocrNoImagePath"));
        setBusy(false);
        return;
      }
      const ocr = await WakaMlkitOcr.recognizeText({ imagePath: path });
      setFullText(ocr.fullText);
      runParse(ocr.fullText, ocr.blocks ?? []);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErr(msg);
    } finally {
      setBusy(false);
    }
  }, [lang, runParse]);

  const parsePasted = useCallback(() => {
    setErr(null);
    const raw = pasteSim.trim();
    if (!raw) {
      setErr(t(lang, "ocrPasteEmpty"));
      return;
    }
    const cleaned = applyLocalOcrCleanup(raw, mode);
    const synthetic: OcrTextBlock[] = [{ text: cleaned, lines: cleaned.split("\n").map((l) => l.trim()).filter(Boolean) }];
    setFullText(cleaned);
    runParse(cleaned, synthetic);
  }, [mode, pasteSim, runParse, lang]);

  const onCleanup = useCallback(() => {
    const cleaned = applyLocalOcrCleanup(fullText, mode);
    setFullText(cleaned);
    const synthetic: OcrTextBlock[] = [{ text: cleaned, lines: cleaned.split("\n").map((l) => l.trim()).filter(Boolean) }];
    runParse(cleaned, synthetic);
  }, [fullText, mode, runParse]);

  const confirmImport = useCallback(() => {
    const payload = selectedRowsToBulkInput(rows);
    if (!payload.length) {
      setErr(t(lang, "ocrNoneSelected"));
      return;
    }
    const r = bulkQuickAddProducts(payload);
    setErr(null);
    setDoneMsg(tTemplate(lang, "ocrImportSummary", { added: r.added, skipped: r.skipped }));
    setStep("choose");
    setRows([]);
    setFullText("");
  }, [bulkQuickAddProducts, lang, rows]);

  if (!canAdd) {
    return <Navigate to="/stock" replace />;
  }

  if (aiGate === "check") {
    return <div className="flex min-h-[40vh] items-center justify-center text-sm font-semibold text-slate-600">Loading…</div>;
  }
  if (aiGate === "no") {
    return <Navigate to="/office" replace />;
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 pb-24 pt-4">
      {doneMsg ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-950">
          {doneMsg}{" "}
          <button type="button" className="ml-2 underline" onClick={() => setDoneMsg(null)}>
            OK
          </button>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase tracking-wide text-orange-700">{t(lang, "ocrBadge")}</p>
          <h1 className="text-2xl font-black text-stone-900">{t(lang, "ocrImportTitle")}</h1>
          <p className="mt-1 text-sm font-semibold text-stone-600">{t(lang, "ocrImportSubtitle")}</p>
        </div>
        <Link to="/stock" className="rounded-2xl border-2 border-stone-300 px-4 py-2 text-sm font-bold text-stone-800">
          {t(lang, "ocrBackStock")}
        </Link>
      </div>

      {step === "choose" ? (
        <div className="space-y-6">
          <div className="grid gap-3 sm:grid-cols-3">
            {(
              [
                ["stock_list", "ocrModeStockList"],
                ["product_label", "ocrModeLabel"],
                ["receipt", "ocrModeReceipt"],
              ] as const
            ).map(([m, key]) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={`rounded-2xl border-2 px-4 py-4 text-left text-sm font-black transition ${
                  mode === m ? "border-orange-500 bg-orange-50 text-orange-950" : "border-stone-200 bg-white text-stone-800"
                }`}
              >
                {t(lang, key)}
              </button>
            ))}
          </div>

          <label className="block text-sm font-bold text-stone-800">
            {t(lang, "ocrCategoryLabel")}
            <input
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="mt-1 w-full rounded-2xl border-2 border-stone-200 px-4 py-3 text-base font-semibold"
            />
          </label>

          {!isAndroidNative() ? (
            <div className="rounded-3xl border border-amber-200 bg-amber-50 p-4">
              <p className="text-sm font-bold text-amber-950">{t(lang, "ocrAndroidOnly")}</p>
              <p className="mt-2 text-sm font-semibold text-amber-900">{t(lang, "ocrPasteHint")}</p>
              <textarea
                value={pasteSim}
                onChange={(e) => setPasteSim(e.target.value)}
                rows={8}
                className="mt-3 w-full rounded-2xl border-2 border-amber-200 bg-white px-3 py-2 font-mono text-sm"
                placeholder={t(lang, "ocrPastePlaceholder")}
              />
              <button
                type="button"
                disabled={busy}
                onClick={() => parsePasted()}
                className="mt-3 min-h-[48px] w-full rounded-2xl bg-stone-900 py-3 text-base font-black text-white disabled:opacity-40"
              >
                {t(lang, "ocrApplyPaste")}
              </button>
            </div>
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={() => void takePhoto()}
              className="min-h-[52px] w-full rounded-2xl bg-orange-600 py-3 text-lg font-black text-white shadow-lg disabled:opacity-40"
            >
              {busy ? "…" : t(lang, "ocrTakePhoto")}
            </button>
          )}
        </div>
      ) : null}

      {step === "review" ? (
        <div className="space-y-4">
          <p className="text-sm font-bold text-stone-700">{t(lang, "ocrReviewTitle")}</p>
          {err ? <p className="text-sm font-bold text-rose-700">{err}</p> : null}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onCleanup}
              className="rounded-xl border-2 border-stone-300 bg-white px-4 py-2 text-sm font-black text-stone-900"
            >
              {t(lang, "ocrCleanup")}
            </button>
            <button
              type="button"
              onClick={() => {
                setStep("choose");
                setRows([]);
              }}
              className="rounded-xl border-2 border-stone-300 bg-white px-4 py-2 text-sm font-black text-stone-900"
            >
              {isAndroidNative() ? t(lang, "ocrRetake") : t(lang, "ocrBackEdit")}
            </button>
            <button
              type="button"
              onClick={() => setRows((r) => r.map((x) => ({ ...x, selected: true })))}
              className="rounded-xl bg-stone-100 px-4 py-2 text-sm font-bold text-stone-800"
            >
              {t(lang, "ocrSelectAll")}
            </button>
            <button
              type="button"
              onClick={() => setRows((r) => r.map((x) => ({ ...x, selected: false })))}
              className="rounded-xl bg-stone-100 px-4 py-2 text-sm font-bold text-stone-800"
            >
              {t(lang, "ocrSelectNone")}
            </button>
          </div>

          <div className="overflow-x-auto rounded-2xl border border-stone-200 bg-white shadow-sm">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-stone-100 text-xs font-black uppercase text-stone-600">
                <tr>
                  <th className="px-3 py-2">✓</th>
                  <th className="px-3 py-2">{t(lang, "ocrColName")}</th>
                  <th className="px-3 py-2">{t(lang, "ocrColPrice")}</th>
                  <th className="px-3 py-2">{t(lang, "ocrColQty")}</th>
                  <th className="px-3 py-2">{t(lang, "ocrConfidenceCol")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-t border-stone-100">
                    <td className="px-3 py-2 align-top">
                      <input
                        type="checkbox"
                        checked={row.selected}
                        onChange={(e) =>
                          setRows((rs) => rs.map((x) => (x.id === row.id ? { ...x, selected: e.target.checked } : x)))
                        }
                        className="h-5 w-5"
                      />
                    </td>
                    <td className="px-2 py-2 align-top">
                      <input
                        value={row.name}
                        onChange={(e) =>
                          setRows((rs) => rs.map((x) => (x.id === row.id ? { ...x, name: e.target.value } : x)))
                        }
                        className="w-full min-w-[8rem] rounded-xl border border-stone-200 px-2 py-1 font-semibold"
                      />
                    </td>
                    <td className="px-2 py-2 align-top">
                      <input
                        inputMode="numeric"
                        value={row.priceUgx || ""}
                        onChange={(e) =>
                          setRows((rs) =>
                            rs.map((x) =>
                              x.id === row.id ? { ...x, priceUgx: Math.max(0, parseInt(e.target.value || "0", 10) || 0) } : x,
                            ),
                          )
                        }
                        className="w-24 rounded-xl border border-stone-200 px-2 py-1 font-mono"
                      />
                    </td>
                    <td className="px-2 py-2 align-top">
                      <input
                        inputMode="numeric"
                        value={row.stockQty || ""}
                        onChange={(e) =>
                          setRows((rs) =>
                            rs.map((x) =>
                              x.id === row.id ? { ...x, stockQty: Math.max(0, parseInt(e.target.value || "0", 10) || 0) } : x,
                            ),
                          )
                        }
                        className="w-20 rounded-xl border border-stone-200 px-2 py-1 font-mono"
                      />
                    </td>
                    <td className="px-3 py-2 align-top font-mono text-xs font-bold text-stone-600">
                      {(row.confidence * 100).toFixed(0)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="text-xs font-semibold text-stone-500">{t(lang, "ocrNoAutoSave")}</p>

          <details className="rounded-2xl border border-stone-200 bg-stone-50 px-3 py-2 text-sm">
            <summary className="cursor-pointer font-bold text-stone-800">{t(lang, "ocrRawToggle")}</summary>
            <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-xs text-stone-700">
              {fullText || "—"}
            </pre>
          </details>

          <button
            type="button"
            onClick={confirmImport}
            className="min-h-[52px] w-full rounded-2xl bg-waka-600 py-3 text-lg font-black text-white shadow-md"
          >
            {t(lang, "ocrImportSelected")}
          </button>
        </div>
      ) : null}
    </div>
  );
}
