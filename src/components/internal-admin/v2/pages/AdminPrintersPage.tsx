import { useState } from "react";
import type { WakaInternalAdminRow } from "../../../../lib/wakaInternalAdmin";
import { PrinterInventoryPanel } from "../printer/PrinterInventoryPanel";
import { PrinterFulfilmentPanel } from "../printer/PrinterFulfilmentPanel";
import { PrinterHistoryPanel } from "../printer/PrinterHistoryPanel";

/**
 * Printers — the WAKA-owned stock register and the fulfilment desk.
 *
 * Three tabs rather than three nav entries: register, fulfilment desk and the
 * settled record are views of one domain, and an operator reserving a printer
 * usually needs the register a click away.
 *
 * Visibility is gated at the SHELL, not in this file: AdminShell hides the
 * "Printers" nav entry and route unless `canManagePrinterFulfilment` — which
 * mirrors the server's fulfilment gate — allows it. Each panel then re-checks its
 * own permission, because stock actions are narrower than fulfilment actions. The
 * server is still the boundary; this only keeps a role that would be refused from
 * being shown controls that cannot work.
 */
type Props = {
  adminRow: WakaInternalAdminRow | null;
  previewMode?: boolean;
};

export function AdminPrintersPage({ adminRow, previewMode = false }: Props) {
  const [tab, setTab] = useState<"inventory" | "fulfilment" | "history">("inventory");

  const tabCls = (active: boolean) =>
    `inline-flex min-h-[44px] items-center rounded-xl px-4 text-sm font-black transition ${
      active ? "bg-waka-600 text-white" : "bg-muted text-muted-foreground hover:text-foreground"
    }`;

  return (
    <div className="space-y-4">
      <header>
        {/* `text-xl font-bold`, not `font-black`: the design-system check flags
            `text-xl font-black` as a legacy page-title pattern. */}
        <h1 className="text-xl font-bold text-foreground">Printers</h1>
        <p className="mt-1 text-sm font-semibold text-muted-foreground">
          The register of WAKA-owned WP-58 printers and the record of handing one to a customer. Stock actions and
          fulfilment actions are authorized separately by the server.
        </p>
      </header>

      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Printer views">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "inventory"}
          className={tabCls(tab === "inventory")}
          onClick={() => setTab("inventory")}
        >
          Inventory
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "fulfilment"}
          className={tabCls(tab === "fulfilment")}
          onClick={() => setTab("fulfilment")}
        >
          Fulfilment
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "history"}
          className={tabCls(tab === "history")}
          onClick={() => setTab("history")}
        >
          History
        </button>
      </div>

      {tab === "inventory" ? (
        <PrinterInventoryPanel adminRow={adminRow} previewMode={previewMode} />
      ) : tab === "fulfilment" ? (
        <PrinterFulfilmentPanel adminRow={adminRow} previewMode={previewMode} />
      ) : (
        <PrinterHistoryPanel adminRow={adminRow} previewMode={previewMode} />
      )}
    </div>
  );
}
