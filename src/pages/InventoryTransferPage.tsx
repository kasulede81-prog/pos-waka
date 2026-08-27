import { useCallback, useEffect, useMemo, useState } from "react";
import type { Language } from "../types";
import { t } from "../lib/i18n";
import { usePosStore } from "../store/usePosStore";
import { getActiveShopId } from "../offline/shopScope";
import { listUserShops, type UserShopRow } from "../lib/primaryShop";
import { EnterprisePageContainer } from "../components/layout/EnterprisePageContainer";
import { PageHeader } from "../components/layout/PageHeader";
import { PageBackBar } from "../components/layout/PageBackBar";
import { TransferOperationShell } from "../components/inventory/transfers/TransferOperationShell";
import { TransferProductSelector } from "../components/inventory/transfers/TransferProductSelector";
import { filterTransferProducts } from "../lib/transferWorkspace";
import {
  cancelTransferDraftCloud,
  dispatchTransferCloud,
  listTransfersForShopCloud,
  queueTransferDispatch,
  queueTransferReceive,
  receiveTransferCloud,
  upsertTransferDraftCloud,
  type CloudTransfer,
} from "../lib/enterprise/stockTransferSync";
import { getDeviceOnline } from "../lib/deviceOnline";
import { hasSupabaseConfig } from "../lib/supabase";

type DraftLine = {
  sourceProductId: string;
  destinationProductId: string;
  quantity: number;
  sourceName: string;
};

type Props = { lang: Language };

export function InventoryTransferPage({ lang }: Props) {
  const products = usePosStore((s) => s.products);
  const preferences = usePosStore((s) => s.preferences);
  const activeShopId = getActiveShopId();
  const [branches, setBranches] = useState<UserShopRow[]>([]);
  const [destShopId, setDestShopId] = useState("");
  const [search, setSearch] = useState("");
  const [draftLines, setDraftLines] = useState<DraftLine[]>([]);
  const [destProductPick, setDestProductPick] = useState<Record<string, string>>({});
  const [draftTransferId, setDraftTransferId] = useState<string | null>(null);
  const [inTransit, setInTransit] = useState<CloudTransfer[]>([]);
  const [selectedTransferId, setSelectedTransferId] = useState<string | null>(null);
  const [receiveQty, setReceiveQty] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const loadBranches = useCallback(async () => {
    const rows = await listUserShops();
    setBranches(rows.filter((r) => r.shop_id !== activeShopId));
  }, [activeShopId]);

  const loadInTransit = useCallback(async () => {
    if (!activeShopId) return;
    const rows = await listTransfersForShopCloud(activeShopId, "in_transit");
    setInTransit(rows);
  }, [activeShopId]);

  useEffect(() => {
    void loadBranches();
    void loadInTransit();
  }, [loadBranches, loadInTransit]);

  const sourceProducts = useMemo(
    () => filterTransferProducts(products, search),
    [products, search],
  );

  const selectedTransfer = inTransit.find((x) => x.id === selectedTransferId) ?? null;

  const onAddSource = (productId: string) => {
    const p = products.find((x) => x.id === productId);
    if (!p) return;
    setDraftLines((prev) => {
      if (prev.some((l) => l.sourceProductId === productId)) return prev;
      return [
        ...prev,
        {
          sourceProductId: productId,
          destinationProductId: destProductPick[productId] ?? "",
          quantity: 1,
          sourceName: p.name,
        },
      ];
    });
  };

  const saveDraft = async () => {
    if (!activeShopId || !destShopId) {
      setErr(lang === "lg" ? "Londa edduuka erigenda." : "Select destination branch.");
      return;
    }
    if (!draftLines.length) {
      setErr(lang === "lg" ? "Yongerako ebintu." : "Add at least one line.");
      return;
    }
    for (const line of draftLines) {
      if (!line.destinationProductId) {
        setErr(lang === "lg" ? "Londa product ku dduuka erigenda." : "Map each line to a destination product ID.");
        return;
      }
      if (line.quantity <= 0) {
        setErr(lang === "lg" ? "Obungi tebuli bulungi." : "Invalid quantity.");
        return;
      }
    }
    const destIds = draftLines.map((l) => l.destinationProductId);
    if (new Set(destIds).size !== destIds.length) {
      setErr(lang === "lg" ? "Product erigenda esangiddwa." : "Each line must map to a unique destination product.");
      return;
    }
    setBusy(true);
    setErr(null);
    setMsg(null);
    const result = await upsertTransferDraftCloud({
      id: draftTransferId ?? undefined,
      clientId: draftTransferId ? undefined : crypto.randomUUID(),
      fromShopId: activeShopId,
      toShopId: destShopId,
      lines: draftLines.map((l) => ({
        sourceProductId: l.sourceProductId,
        destinationProductId: l.destinationProductId,
        quantity: l.quantity,
      })),
    });
    setBusy(false);
    if (!result.ok || !result.transferId) {
      setErr(result.error ?? "Draft failed");
      return;
    }
    setDraftTransferId(result.transferId);
    setMsg(lang === "lg" ? "Draft eterekeddwa." : "Draft saved.");
  };

  const dispatchDraft = async () => {
    if (!draftTransferId || !activeShopId) return;
    setBusy(true);
    setErr(null);
    setMsg(null);
    if (getDeviceOnline() && hasSupabaseConfig) {
      const result = await dispatchTransferCloud(draftTransferId);
      setBusy(false);
      if (!result.ok) {
        setErr(result.error ?? "Dispatch failed");
        return;
      }
      setMsg(result.idempotent ? "Already dispatched." : lang === "lg" ? "Transfer etumiddwa." : "Dispatched.");
      setDraftTransferId(null);
      setDraftLines([]);
      void loadInTransit();
      return;
    }
    await queueTransferDispatch(draftTransferId, activeShopId);
    setBusy(false);
    setMsg(lang === "lg" ? "Dispatch erindiridde mu queue." : "Dispatch queued for sync.");
  };

  const receiveSelected = async () => {
    if (!selectedTransfer || !activeShopId) return;
    const receiveEventId = crypto.randomUUID();
    const lines = selectedTransfer.lines
      .map((l) => ({
        lineId: l.id,
        quantity: Math.floor(receiveQty[l.id] ?? 0),
      }))
      .filter((l) => l.quantity > 0);
    if (!lines.length) {
      setErr(lang === "lg" ? "Yingiza obungi obw'okufuna." : "Enter receive quantity.");
      return;
    }
    setBusy(true);
    setErr(null);
    setMsg(null);
    if (getDeviceOnline() && hasSupabaseConfig) {
      const result = await receiveTransferCloud(selectedTransfer.id, receiveEventId, lines);
      setBusy(false);
      if (!result.ok) {
        setErr(result.error ?? "Receive failed");
        return;
      }
      setMsg(result.idempotent ? "Already received." : lang === "lg" ? "Transfer efudde." : "Received.");
      setReceiveQty({});
      void loadInTransit();
      return;
    }
    await queueTransferReceive(selectedTransfer.id, receiveEventId, lines, activeShopId);
    setBusy(false);
    setMsg(lang === "lg" ? "Receive erindiridde mu queue." : "Receive queued for sync.");
  };

  const cancelDraft = async () => {
    if (!draftTransferId) return;
    setBusy(true);
    const result = await cancelTransferDraftCloud(draftTransferId);
    setBusy(false);
    if (!result.ok) {
      setErr(result.error ?? "Cancel failed");
      return;
    }
    setDraftTransferId(null);
    setDraftLines([]);
    setMsg(lang === "lg" ? "Draft esaziddwamu." : "Draft cancelled.");
  };

  return (
    <EnterprisePageContainer>
      <PageBackBar lang={lang} fallbackTo="/stock" label={t(lang, "navStock")} />
      <PageHeader lang={lang} title={t(lang, "xferPageTitle")} subtitle={t(lang, "xferPageSub")} />
      <TransferOperationShell
        lang={lang}
        title={preferences.shopDisplayName?.trim() || "Transfer"}
        subtitle={activeShopId ? `Shop ${activeShopId.slice(0, 8)}…` : undefined}
        error={err}
        success={msg}
        footer={
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-primary min-h-[48px] px-4" disabled={busy} onClick={() => void saveDraft()}>
              {lang === "lg" ? "Tereka draft" : "Save draft"}
            </button>
            <button
              type="button"
              className="btn-primary min-h-[48px] px-4"
              disabled={busy || !draftTransferId}
              onClick={() => void dispatchDraft()}
            >
              {lang === "lg" ? "Tuma (dispatch)" : "Dispatch"}
            </button>
            {draftTransferId ? (
              <button type="button" className="btn-secondary min-h-[48px] px-4" disabled={busy} onClick={() => void cancelDraft()}>
                {lang === "lg" ? "Sazaamu draft" : "Cancel draft"}
              </button>
            ) : null}
          </div>
        }
      >
        <section className="space-y-2 rounded-2xl border border-border p-4">
          <p className="text-sm font-black">{lang === "lg" ? "Edduuka erigenda" : "Destination branch"}</p>
          <select
            className="w-full min-h-[48px] rounded-xl border border-border px-3"
            value={destShopId}
            disabled={busy}
            onChange={(e) => setDestShopId(e.target.value)}
          >
            <option value="">{lang === "lg" ? "Londa…" : "Select…"}</option>
            {branches.map((b) => (
              <option key={b.shop_id} value={b.shop_id}>
                {b.shop_name || b.shop_id.slice(0, 8)}
              </option>
            ))}
          </select>
        </section>

        <TransferProductSelector
          lang={lang}
          value={search}
          onChange={setSearch}
          products={sourceProducts}
          onAdd={onAddSource}
          selectedIds={new Set(draftLines.map((l) => l.sourceProductId))}
        />

        {draftLines.length > 0 ? (
          <section className="space-y-3 rounded-2xl border border-border p-4">
            <p className="text-sm font-black">{lang === "lg" ? "Layini za draft" : "Draft lines"}</p>
            {draftLines.map((line) => (
              <div key={line.sourceProductId} className="grid gap-2 rounded-xl bg-muted/30 p-3 md:grid-cols-3">
                <p className="text-sm font-bold">{line.sourceName}</p>
                <input
                  className="min-h-[44px] rounded-lg border border-border px-3"
                  placeholder={lang === "lg" ? "Product ID erigenda" : "Destination product UUID"}
                  value={line.destinationProductId}
                  onChange={(e) => {
                    const v = e.target.value;
                    setDestProductPick((m) => ({ ...m, [line.sourceProductId]: v }));
                    setDraftLines((rows) =>
                      rows.map((r) =>
                        r.sourceProductId === line.sourceProductId ? { ...r, destinationProductId: v } : r,
                      ),
                    );
                  }}
                />
                <input
                  type="number"
                  min={1}
                  className="min-h-[44px] rounded-lg border border-border px-3"
                  value={line.quantity}
                  onChange={(e) => {
                    const q = Math.max(1, Math.floor(Number(e.target.value) || 0));
                    setDraftLines((rows) =>
                      rows.map((r) => (r.sourceProductId === line.sourceProductId ? { ...r, quantity: q } : r)),
                    );
                  }}
                />
              </div>
            ))}
          </section>
        ) : null}

        <section className="space-y-3 rounded-2xl border border-border p-4">
          <p className="text-sm font-black">{lang === "lg" ? "Mu nkola (in transit)" : "In transit"}</p>
          {inTransit.length === 0 ? (
            <p className="text-sm text-muted-foreground">{lang === "lg" ? "Tewali transfer." : "No in-transit transfers."}</p>
          ) : (
            <select
              className="w-full min-h-[48px] rounded-xl border border-border px-3"
              value={selectedTransferId ?? ""}
              onChange={(e) => setSelectedTransferId(e.target.value || null)}
            >
              <option value="">{lang === "lg" ? "Londa transfer…" : "Select transfer…"}</option>
              {inTransit.map((tr) => (
                <option key={tr.id} value={tr.id}>
                  {tr.id.slice(0, 8)} · {tr.lines.length} lines · {tr.status}
                </option>
              ))}
            </select>
          )}
          {selectedTransfer?.lines.map((l) => {
            const remaining = Math.max(0, Number(l.quantity) - Number(l.receivedQuantity));
            return (
              <div key={l.id} className="rounded-xl border border-border/60 p-3">
                <p className="text-sm font-bold">
                  {l.productName} · {lang === "lg" ? "Esigadde" : "Remaining"}: {remaining}
                </p>
                <input
                  type="number"
                  min={0}
                  max={remaining}
                  className="mt-2 min-h-[44px] w-full rounded-lg border border-border px-3"
                  value={receiveQty[l.id] ?? ""}
                  disabled={busy || remaining <= 0}
                  onChange={(e) =>
                    setReceiveQty((m) => ({ ...m, [l.id]: Math.max(0, Math.floor(Number(e.target.value) || 0)) }))
                  }
                />
              </div>
            );
          })}
          {selectedTransfer ? (
            <button type="button" className="btn-primary min-h-[48px] px-4" disabled={busy} onClick={() => void receiveSelected()}>
              {lang === "lg" ? "Funa (receive)" : "Receive"}
            </button>
          ) : null}
        </section>
      </TransferOperationShell>
    </EnterprisePageContainer>
  );
}
