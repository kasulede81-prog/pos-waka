import { useState } from "react";
import clsx from "clsx";
import type { KitchenTicket, KitchenTicketStatus, Language } from "../../types";
import { t } from "../../lib/i18n";
import {
  activeTicketItems,
  computeTicketElapsedMinutes,
  computeTicketPrepTargetMinutes,
  computeTicketTimerUrgency,
  formatElapsedMinutes,
  nextKitchenTicketStatus,
} from "../../lib/kitchenProduction";
import { hospitalityCourseLabelKey } from "../../lib/productHospitalityRouting";

const URGENCY_STYLES = {
  on_time: "border-emerald-300 bg-emerald-50",
  approaching: "border-amber-400 bg-amber-50",
  overdue: "border-rose-400 bg-rose-50",
} as const;

const URGENCY_BADGE = {
  on_time: "bg-emerald-600 text-white",
  approaching: "bg-amber-500 text-white",
  overdue: "bg-rose-600 text-white",
} as const;

type Props = {
  lang: Language;
  ticket: KitchenTicket;
  stationName?: string;
  canRecall?: boolean;
  onAdvance: () => void;
  onCancel: () => void;
  onRecall: () => void;
  onCancelItem: (itemId: string) => void;
  onReprint?: () => void;
};

function statusLabelKey(status: KitchenTicketStatus): string {
  return `kitchenStatus_${status}`;
}

export function ProductionTicketCard({
  lang,
  ticket,
  stationName,
  canRecall,
  onAdvance,
  onCancel,
  onRecall,
  onCancelItem,
  onReprint,
}: Props) {
  const urgency = computeTicketTimerUrgency(ticket);
  const elapsed = computeTicketElapsedMinutes(ticket);
  const target = computeTicketPrepTargetMinutes(ticket);
  const next = nextKitchenTicketStatus(ticket.status);
  const items = activeTicketItems(ticket);

  return (
    <li className={clsx("rounded-2xl border-2 p-4", URGENCY_STYLES[urgency])}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-lg font-black text-foreground">
            {ticket.tableLabel}
            {ticket.areaName ? ` · ${ticket.areaName}` : ""}
          </p>
          <p className="text-xs font-bold uppercase text-muted-foreground">
            #{ticket.ticketNumber}
            {stationName ? ` · ${stationName}` : ""}
            {ticket.waiterLabel ? ` · ${ticket.waiterLabel}` : ""}
          </p>
          <p className="mt-1 text-xs font-semibold text-muted-foreground">
            {ticket.guestCount ?? "—"} {t(lang, "tableOrderGuests")}
            {ticket.orderRound ? ` · ${t(lang, "productionOrderRound")} ${ticket.orderRound}` : ""}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <span className="rounded-lg bg-card px-2 py-1 text-xs font-black uppercase text-foreground">
            {t(lang, statusLabelKey(ticket.status) as "kitchenStatus_queued")}
          </span>
          {ticket.priority && ticket.priority !== "normal" ? (
            <span className="rounded-lg bg-violet-700 px-2 py-0.5 text-[10px] font-black uppercase text-white">
              {ticket.priority}
            </span>
          ) : null}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className={clsx("rounded-lg px-2 py-1 text-xs font-black", URGENCY_BADGE[urgency])}>
          {formatElapsedMinutes(elapsed)}
          {target != null ? ` / ${target}m` : ""}
        </span>
        <span className="text-xs font-semibold text-muted-foreground">
          {t(lang, "productionFiredAt")} {new Date(ticket.firedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </span>
      </div>

      <ul className="mt-3 space-y-2 text-sm font-bold text-foreground">
        {items.map((item) => (
          <li key={item.id} className="rounded-lg bg-white/70 px-2 py-1.5">
            <div className="flex items-start justify-between gap-2">
              <span>
                {item.quantity}× {item.productName}
                {item.course ? (
                  <span className="ml-1 text-[10px] font-black uppercase text-muted-foreground">
                    ({t(lang, hospitalityCourseLabelKey(item.course) as "hospitalityCourse_main")})
                  </span>
                ) : null}
              </span>
              <button
                type="button"
                onClick={() => onCancelItem(item.id)}
                className="shrink-0 text-[10px] font-black uppercase text-rose-700"
              >
                {t(lang, "kitchenCancelItem")}
              </button>
            </div>
            {item.variantLabel ? (
              <p className="text-xs font-bold text-muted-foreground">{item.variantLabel}</p>
            ) : null}
            {item.modifierLabels?.length ? (
              <p className="text-xs font-bold text-violet-800">{item.modifierLabels.join(" · ")}</p>
            ) : null}
            {item.notes ? (
              <p className="mt-0.5 text-xs font-semibold text-amber-900">{item.notes}</p>
            ) : null}
          </li>
        ))}
      </ul>

      {ticket.ticketNotes ? (
        <p className="mt-2 text-xs font-semibold text-amber-900">{ticket.ticketNotes}</p>
      ) : null}

      <div className="mt-4 grid grid-cols-2 gap-2">
        {onReprint ? (
          <button
            type="button"
            onClick={onReprint}
            className="col-span-2 min-h-10 rounded-xl border border-border bg-card text-xs font-black uppercase text-muted-foreground"
          >
            {t(lang, "kitchenReprintChit")}
          </button>
        ) : null}
        <button
          type="button"
          onClick={onCancel}
          className="min-h-12 rounded-xl border border-rose-200 bg-rose-50 text-sm font-black text-rose-900"
        >
          {t(lang, "kitchenCancelTicket")}
        </button>
        {canRecall && (ticket.status === "ready" || ticket.status === "cooking" || ticket.status === "picked_up") ? (
          <button
            type="button"
            onClick={onRecall}
            className="min-h-12 rounded-xl border border-orange-300 bg-orange-50 text-sm font-black text-orange-950"
          >
            {t(lang, "kitchenRecallTicket")}
          </button>
        ) : null}
        {next ? (
          <button
            type="button"
            onClick={onAdvance}
            className={clsx(
              "min-h-12 rounded-xl text-sm font-black text-white",
              ticket.status === "ready" ? "bg-emerald-600" : "bg-foreground",
              canRecall && (ticket.status === "ready" || ticket.status === "cooking" || ticket.status === "picked_up")
                ? "col-span-2"
                : "",
            )}
          >
            {ticket.status === "ready"
              ? t(lang, "kitchenMarkPickedUp")
              : ticket.status === "picked_up"
                ? t(lang, "kitchenMarkServed")
                : ticket.status === "served"
                  ? t(lang, "kitchenMarkCompleted")
                  : t(lang, "kitchenMarkNext")}
          </button>
        ) : null}
      </div>
    </li>
  );
}

export function RecallTicketDialog({
  lang,
  open,
  onClose,
  onConfirm,
}: {
  lang: Language;
  open: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-2xl bg-card p-5 shadow-xl">
        <h2 className="text-lg font-black text-foreground">{t(lang, "kitchenRecallTitle")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t(lang, "kitchenRecallSub")}</p>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={t(lang, "kitchenRecallReasonPh")}
          className="mt-4 min-h-24 w-full rounded-xl border border-border px-3 py-2 text-sm"
        />
        <div className="mt-4 flex gap-2">
          <button type="button" onClick={onClose} className="min-h-11 flex-1 rounded-xl border border-border font-bold">
            {t(lang, "cancel")}
          </button>
          <button
            type="button"
            disabled={!reason.trim()}
            onClick={() => {
              onConfirm(reason.trim());
              setReason("");
            }}
            className="min-h-11 flex-1 rounded-xl bg-orange-600 font-black text-white disabled:opacity-50"
          >
            {t(lang, "kitchenRecallConfirm")}
          </button>
        </div>
      </div>
    </div>
  );
}

export function CancelItemDialog({
  lang,
  open,
  onClose,
  onConfirm,
}: {
  lang: Language;
  open: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-2xl bg-card p-5 shadow-xl">
        <h2 className="text-lg font-black text-foreground">{t(lang, "kitchenCancelItemTitle")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t(lang, "kitchenCancelItemSub")}</p>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={t(lang, "kitchenCancelReasonPh")}
          className="mt-4 min-h-24 w-full rounded-xl border border-border px-3 py-2 text-sm"
        />
        <div className="mt-4 flex gap-2">
          <button type="button" onClick={onClose} className="min-h-11 flex-1 rounded-xl border border-border font-bold">
            {t(lang, "cancel")}
          </button>
          <button
            type="button"
            disabled={!reason.trim()}
            onClick={() => {
              onConfirm(reason.trim());
              setReason("");
            }}
            className="min-h-11 flex-1 rounded-xl bg-rose-600 font-black text-white disabled:opacity-50"
          >
            {t(lang, "kitchenCancelItemConfirm")}
          </button>
        </div>
      </div>
    </div>
  );
}
