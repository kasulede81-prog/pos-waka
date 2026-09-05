import { useMemo, useState, type FormEvent } from "react";
import { actorHasPermission } from "../../../lib/actorAuthorization";
import clsx from "clsx";
import { Building2, Phone, MessageCircle, Trash2, Truck, Users, Wallet } from "lucide-react";
import type { Language, Supplier } from "../../../types";
import { t } from "../../../lib/i18n";
import { useShopAction } from "../../../hooks/useShopAction";
import { usePosStore } from "../../../store/usePosStore";
import { useSessionActor } from "../../../context/SessionActorContext";
import { ModalSheet } from "../../../components/layout/ModalSheet";
import { EnterpriseTextField } from "../../../components/enterprise/EnterpriseTextField";
import { WakaButton } from "../../../components/ui/wakaPrimitives";
import { SectionTitle } from "../../../components/enterprise/EnterpriseTypography";
import { isWalkInSupplierId } from "../../../lib/walkInSupplier";
import { formatShortUgx } from "../lib/overviewStats";
import { InventoryRoomEmpty, InventoryRoomHeader, InventoryRoomMetric } from "./InventoryRoomChrome";
import { InventoryRoomTable } from "./InventoryRoomTable";

type Props = {
  lang: Language;
  onOpenSupplier: (id: string) => void;
};

export function SuppliersTab({ lang, onOpenSupplier }: Props) {
  const { run: runShopAction } = useShopAction();
  const actor = useSessionActor();
  const canManage = actorHasPermission(actor, "suppliers.manage");
  const canDelete = actor?.role === "owner";
  const suppliers = usePosStore((s) => s.suppliers);
  const purchases = usePosStore((s) => s.purchases);
  const addSupplier = usePosStore((s) => s.addSupplier);
  const addSupplierPayment = usePosStore((s) => s.addSupplierPayment);
  const removeSupplier = usePosStore((s) => s.removeSupplier);

  const [searchQ, setSearchQ] = useState("");
  const [outstandingOnly, setOutstandingOnly] = useState(false);
  const [alpha, setAlpha] = useState<string>("all");
  const [addOpen, setAddOpen] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [location, setLocation] = useState("");
  const [notes, setNotes] = useState("");
  const [paySupplier, setPaySupplier] = useState<Supplier | null>(null);
  const [payAmount, setPayAmount] = useState("");
  const [deleteSupplier, setDeleteSupplier] = useState<Supplier | null>(null);

  const realSuppliers = useMemo(() => suppliers.filter((s) => !isWalkInSupplierId(s.id)), [suppliers]);

  const lastPurchaseBySupplier = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of purchases) {
      if (isWalkInSupplierId(p.supplierId)) continue;
      const prev = map.get(p.supplierId);
      if (!prev || p.createdAt > prev) map.set(p.supplierId, p.createdAt);
    }
    return map;
  }, [purchases]);

  const filtered = useMemo(() => {
    let list = [...realSuppliers];
    const q = searchQ.trim().toLowerCase();
    if (q) list = list.filter((s) => [s.name, s.phone, s.location].join(" ").toLowerCase().includes(q));
    if (outstandingOnly) list = list.filter((s) => s.balanceOwedUgx > 0);
    if (alpha !== "all") list = list.filter((s) => s.name.toUpperCase().startsWith(alpha));
    return list.sort((a, b) => a.name.localeCompare(b.name));
  }, [realSuppliers, searchQ, outstandingOnly, alpha]);

  const totalOutstanding = useMemo(
    () => realSuppliers.reduce((sum, s) => sum + Math.max(0, s.balanceOwedUgx), 0),
    [realSuppliers],
  );

  const letters = useMemo(() => {
    const set = new Set<string>();
    for (const s of realSuppliers) {
      const c = s.name.trim()[0]?.toUpperCase();
      if (c) set.add(c);
    }
    return [...set].sort();
  }, [realSuppliers]);

  const submitAdd = (e: FormEvent) => {
    e.preventDefault();
    if (!canManage) return;
    addSupplier({ name, phone, location, notes });
    setName("");
    setPhone("");
    setLocation("");
    setNotes("");
    setAddOpen(false);
  };

  const submitPay = async (e: FormEvent) => {
    e.preventDefault();
    if (!paySupplier) return;
    const n = Math.floor(Number(payAmount) || 0);
    const r = await runShopAction(
      { lang, action: "supplier.payment", permitted: canManage },
      () => addSupplierPayment(paySupplier.id, n),
    );
    if (r.ok) {
      setPaySupplier(null);
      setPayAmount("");
    }
  };

  const confirmDelete = async () => {
    if (!deleteSupplier) return;
    const r = await runShopAction(
      { lang, action: "supplier.remove", permitted: canDelete, successKey: "supplierDeleteOk" },
      () => removeSupplier(deleteSupplier.id),
    );
    if (r.ok) setDeleteSupplier(null);
  };

  const supplierActions = (s: Supplier) => (
    <div className="flex flex-wrap gap-1.5">
      {s.phone ? (
        <>
          <a
            href={`tel:${s.phone}`}
            className="inline-flex min-h-[40px] items-center gap-1 rounded-xl px-2.5 text-sm font-bold text-foreground"
          >
            <Phone className="h-4 w-4" aria-hidden />
            {t(lang, "debtsCall")}
          </a>
          <a
            href={`https://wa.me/${s.phone.replace(/\D/g, "")}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-[40px] items-center gap-1 rounded-xl px-2.5 text-sm font-bold text-teal-800"
          >
            <MessageCircle className="h-4 w-4" aria-hidden />
            WhatsApp
          </a>
        </>
      ) : null}
      <WakaButton type="button" variant="primary" className="hidden !min-h-[40px] !px-2.5 sm:inline-flex" onClick={() => onOpenSupplier(s.id)}>
        {t(lang, "supplierViewDetail")}
      </WakaButton>
      {canManage && s.balanceOwedUgx > 0 ? (
        <WakaButton
          type="button"
          variant="secondary"
          className="!min-h-[40px] !px-2.5"
          onClick={() => {
            setPaySupplier(s);
            setPayAmount(String(Math.min(s.balanceOwedUgx, 50000)));
          }}
        >
          {t(lang, "supplierPayButton")}
        </WakaButton>
      ) : null}
      {canDelete ? (
        <WakaButton type="button" variant="danger" className="!min-h-[40px] !px-2.5" onClick={() => setDeleteSupplier(s)}>
          <Trash2 className="h-4 w-4" aria-hidden />
          {t(lang, "supplierDeleteButton")}
        </WakaButton>
      ) : null}
    </div>
  );

  return (
    <div className="inventory-room inventory-room--suppliers space-y-3">
      <InventoryRoomHeader
        icon={Truck}
        title={t(lang, "ipTabSuppliers")}
        subtitle={t(lang, "ipSuppliersSub")}
        action={
          canManage ? (
            <WakaButton
              type="button"
              variant="primary"
              className="inventory-hub-cta shrink-0"
              iconLeft={<Building2 className="h-4 w-4" aria-hidden />}
              onClick={() => setAddOpen(true)}
            >
              {t(lang, "ipActionAddSupplier")}
            </WakaButton>
          ) : null
        }
      />

      <div className="inventory-room-summary inventory-enter inventory-enter--1">
        <InventoryRoomMetric icon={Users} label={t(lang, "officeCardSuppliers")} value={String(realSuppliers.length)} />
        <InventoryRoomMetric
          icon={Wallet}
          label={t(lang, "ipStatOutstanding")}
          value={formatShortUgx(totalOutstanding)}
          tone={totalOutstanding > 0 ? "warning" : "default"}
        />
      </div>

      <div className="inventory-enter inventory-enter--2 space-y-2.5">
        <div className="flex flex-wrap gap-2">
          <WakaButton
            type="button"
            variant={outstandingOnly ? "primary" : "secondary"}
            onClick={() => setOutstandingOnly((v) => !v)}
          >
            {t(lang, "ipFilterOutstanding")}
          </WakaButton>
        </div>
        <input
          value={searchQ}
          onChange={(e) => setSearchQ(e.target.value)}
          placeholder={t(lang, "ipSuppliersSearchPh")}
          className="inventory-room-search"
        />
        <div className="flex gap-1 overflow-x-auto pb-1">
          <button
            type="button"
            className={clsx("inventory-room-chip shrink-0", alpha === "all" ? "inventory-room-chip--on" : "inventory-room-chip--off")}
            onClick={() => setAlpha("all")}
          >
            {t(lang, "ipFilterAll")}
          </button>
          {letters.map((l) => (
            <button
              key={l}
              type="button"
              className={clsx("inventory-room-chip shrink-0", alpha === l ? "inventory-room-chip--on" : "inventory-room-chip--off")}
              onClick={() => setAlpha(l)}
            >
              {l}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <InventoryRoomEmpty
          icon={Building2}
          title={t(lang, "suppliersEmpty")}
          actionLabel={canManage ? t(lang, "ipActionAddSupplier") : undefined}
          onAction={canManage ? () => setAddOpen(true) : undefined}
        />
      ) : (
        <>
          <InventoryRoomTable
            rows={filtered}
            rowKey={(s) => s.id}
            ariaLabel={t(lang, "ipTabSuppliers")}
            minWidthPx={720}
            onRowActivate={(s) => onOpenSupplier(s.id)}
            columns={[
              {
                id: "name",
                header: t(lang, "officeCardSuppliers"),
                cell: (s) => (
                  <span className="flex items-center gap-2">
                    <span className="inventory-ops-icon">
                      <Building2 className="h-4 w-4" aria-hidden />
                    </span>
                    <span>
                      <span className="inventory-table-product block">{s.name}</span>
                      {s.phone || s.location ? (
                        <span className="inventory-room-row__meta block">
                          {[s.phone, s.location].filter(Boolean).join(" · ")}
                        </span>
                      ) : null}
                    </span>
                  </span>
                ),
              },
              {
                id: "balance",
                header: t(lang, "supplierBalanceLabel"),
                align: "right",
                cell: (s) => (
                  <span className={clsx("font-bold tabular-nums", s.balanceOwedUgx > 0 ? "text-amber-900" : undefined)}>
                    {formatShortUgx(s.balanceOwedUgx)}
                  </span>
                ),
              },
              {
                id: "purchases",
                header: t(lang, "supplierTotalBuy"),
                align: "right",
                hideBelow: "lg",
                cell: (s) => <span className="font-bold tabular-nums">{formatShortUgx(s.totalPurchasesUgx)}</span>,
              },
              {
                id: "last",
                header: t(lang, "ipLastPurchase"),
                hideBelow: "xl",
                cell: (s) => lastPurchaseBySupplier.get(s.id)?.slice(0, 10) ?? "—",
              },
              {
                id: "actions",
                header: t(lang, "ipQuickActions"),
                cell: (s) => (
                  <div onClick={(e) => e.stopPropagation()}>{supplierActions(s)}</div>
                ),
              },
            ]}
          />
          <ul className="sm:hidden">
            {filtered.map((s) => (
              <li key={s.id}>
                <button type="button" onClick={() => onOpenSupplier(s.id)} className="inventory-room-row">
                  <span className="inventory-ops-icon">
                    <Building2 className="h-4 w-4" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="inventory-room-row__name truncate">{s.name}</p>
                    <p className="inventory-room-row__meta truncate">
                      {[s.phone, s.location, lastPurchaseBySupplier.get(s.id)?.slice(0, 10)].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  <span className={clsx("inventory-room-row__amount tabular-nums", s.balanceOwedUgx > 0 ? "text-amber-900" : undefined)}>
                    {formatShortUgx(s.balanceOwedUgx)}
                  </span>
                </button>
                <div className="pb-2">{supplierActions(s)}</div>
              </li>
            ))}
          </ul>
        </>
      )}

      <ModalSheet open={addOpen} onClose={() => setAddOpen(false)} title={t(lang, "supplierAddTitle")}>
        <form onSubmit={submitAdd} className="space-y-3">
          <EnterpriseTextField value={name} onChange={(e) => setName(e.target.value)} placeholder={t(lang, "supplierNamePh")} required />
          <EnterpriseTextField value={phone} onChange={(e) => setPhone(e.target.value)} placeholder={t(lang, "supplierPhonePh")} />
          <EnterpriseTextField value={location} onChange={(e) => setLocation(e.target.value)} placeholder={t(lang, "supplierLocationPh")} />
          <EnterpriseTextField value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t(lang, "supplierNotesPh")} />
          <WakaButton type="submit" variant="primary" className="w-full">
            {t(lang, "supplierSave")}
          </WakaButton>
        </form>
      </ModalSheet>

      {paySupplier ? (
        <ModalSheet open onClose={() => setPaySupplier(null)} title={t(lang, "supplierPayTitle")}>
          <form onSubmit={submitPay} className="space-y-3">
            <SectionTitle as="p" className="!text-sm">{paySupplier.name}</SectionTitle>
            <EnterpriseTextField value={payAmount} onChange={(e) => setPayAmount(e.target.value)} inputMode="numeric" pos />
            <WakaButton type="submit" variant="primary" className="w-full">
              {t(lang, "supplierPaySave")}
            </WakaButton>
          </form>
        </ModalSheet>
      ) : null}

      <ModalSheet
        open={deleteSupplier !== null}
        onClose={() => setDeleteSupplier(null)}
        align="center"
        title={t(lang, "supplierDeleteConfirm")}
        footer={
          <div className="flex gap-3">
            <WakaButton type="button" variant="secondary" className="flex-1" onClick={() => setDeleteSupplier(null)}>
              {t(lang, "cancel")}
            </WakaButton>
            <WakaButton type="button" variant="danger" className="flex-1" onClick={() => void confirmDelete()}>
              {t(lang, "supplierDeleteButton")}
            </WakaButton>
          </div>
        }
      >
        {deleteSupplier ? (
          <>
            <SectionTitle as="p" className="!text-sm">{deleteSupplier.name}</SectionTitle>
            <p className="mt-2 text-sm font-semibold text-muted-foreground">{t(lang, "supplierDeleteConfirmBody")}</p>
          </>
        ) : null}
      </ModalSheet>
    </div>
  );
}
