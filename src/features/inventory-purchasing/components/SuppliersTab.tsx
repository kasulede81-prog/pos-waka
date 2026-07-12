import { useMemo, useState, type FormEvent } from "react";
import { actorHasPermission } from "../../../lib/actorAuthorization";
import clsx from "clsx";
import { Building2, Phone, MessageCircle, Users, Wallet } from "lucide-react";
import type { Language, Supplier } from "../../../types";
import { t } from "../../../lib/i18n";
import { useShopAction } from "../../../hooks/useShopAction";
import { usePosStore } from "../../../store/usePosStore";
import { useSessionActor } from "../../../context/SessionActorContext";
import { ModalSheet } from "../../../components/layout/ModalSheet";
import { EnterpriseEmptyState } from "../../../components/enterprise/EnterpriseEmptyState";
import { EnterpriseKpiCard } from "../../../components/enterprise/EnterpriseKpiCard";
import { EnterpriseResponsiveTable } from "../../../components/shared/ResponsiveDataTable";
import { EnterpriseTextField } from "../../../components/enterprise/EnterpriseTextField";
import { WakaButton } from "../../../components/ui/wakaPrimitives";
import { Body, Caption, MonoNumber, SectionTitle } from "../../../components/enterprise/EnterpriseTypography";
import { statusTokens } from "../../../lib/statusTokens";
import { isWalkInSupplierId } from "../../../lib/walkInSupplier";
import { formatShortUgx } from "../lib/overviewStats";

type Props = {
  lang: Language;
  onOpenSupplier: (id: string) => void;
};

export function SuppliersTab({ lang, onOpenSupplier }: Props) {
  const { run: runShopAction } = useShopAction();
  const actor = useSessionActor();
  const canManage = actorHasPermission(actor, "suppliers.manage");
  const suppliers = usePosStore((s) => s.suppliers);
  const purchases = usePosStore((s) => s.purchases);
  const addSupplier = usePosStore((s) => s.addSupplier);
  const addSupplierPayment = usePosStore((s) => s.addSupplierPayment);

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

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <EnterpriseKpiCard icon={Users} label={t(lang, "officeCardSuppliers")} value={String(realSuppliers.length)} />
        <EnterpriseKpiCard
          icon={Wallet}
          label={t(lang, "ipStatOutstanding")}
          value={<MonoNumber className="text-lg text-amber-900">{formatShortUgx(totalOutstanding)}</MonoNumber>}
          tone={totalOutstanding > 0 ? "warning" : "default"}
        />
      </div>

      <div className="flex flex-wrap gap-2">
        {canManage ? (
          <WakaButton type="button" variant="primary" onClick={() => setAddOpen(true)}>
            + {t(lang, "ipActionAddSupplier")}
          </WakaButton>
        ) : null}
        <WakaButton
          type="button"
          variant={outstandingOnly ? "primary" : "secondary"}
          onClick={() => setOutstandingOnly((v) => !v)}
          className={outstandingOnly ? clsx(statusTokens.danger.badge, statusTokens.danger.badgeRing) : undefined}
        >
          {t(lang, "ipFilterOutstanding")}
        </WakaButton>
      </div>

      <EnterpriseTextField
        value={searchQ}
        onChange={(e) => setSearchQ(e.target.value)}
        placeholder={t(lang, "ipSuppliersSearchPh")}
      />

      <div className="flex gap-1 overflow-x-auto pb-1">
        <WakaButton
          type="button"
          size="standard"
          variant={alpha === "all" ? "primary" : "ghost"}
          className="shrink-0 !min-h-[32px] !rounded-full !px-2.5 !py-1 !text-xs"
          onClick={() => setAlpha("all")}
        >
          {t(lang, "ipFilterAll")}
        </WakaButton>
        {letters.map((l) => (
          <WakaButton
            key={l}
            type="button"
            size="standard"
            variant={alpha === l ? "primary" : "ghost"}
            className="shrink-0 !min-h-[32px] !rounded-full !px-2.5 !py-1 !text-xs"
            onClick={() => setAlpha(l)}
          >
            {l}
          </WakaButton>
        ))}
      </div>

      {filtered.length === 0 ? (
        <EnterpriseEmptyState
          icon={Building2}
          title={t(lang, "suppliersEmpty")}
          primaryAction={
            canManage
              ? { label: `+ ${t(lang, "ipActionAddSupplier")}`, onClick: () => setAddOpen(true) }
              : undefined
          }
        />
      ) : (
        <EnterpriseResponsiveTable
          rows={filtered}
          rowKey={(s) => s.id}
          minWidthPx={720}
          columns={[
            {
              id: "name",
              header: t(lang, "officeCardSuppliers"),
              cell: (s) => (
                <button type="button" onClick={() => onOpenSupplier(s.id)} className="min-w-0 text-left">
                  <Body as="span" className="!text-sm !font-black">{s.name}</Body>
                  {s.phone ? <Caption className="mt-0.5 block normal-case">{s.phone}</Caption> : null}
                  {s.location ? <Caption className="normal-case">{s.location}</Caption> : null}
                </button>
              ),
            },
            {
              id: "balance",
              header: t(lang, "supplierBalanceLabel"),
              className: "text-right",
              cell: (s) => (
                <MonoNumber className={s.balanceOwedUgx > 0 ? "text-amber-900" : undefined}>
                  {formatShortUgx(s.balanceOwedUgx)}
                </MonoNumber>
              ),
            },
            {
              id: "purchases",
              header: t(lang, "supplierTotalBuy"),
              hideOnMobile: true,
              className: "text-right",
              cell: (s) => <MonoNumber>{formatShortUgx(s.totalPurchasesUgx)}</MonoNumber>,
            },
            {
              id: "last",
              header: t(lang, "ipLastPurchase"),
              hideOnMobile: true,
              cell: (s) => lastPurchaseBySupplier.get(s.id)?.slice(0, 10) ?? "—",
            },
            {
              id: "actions",
              header: t(lang, "ipQuickActions"),
              cell: (s) => (
                <div className="flex flex-wrap gap-1.5">
                  {s.phone ? (
                    <>
                      <a
                        href={`tel:${s.phone}`}
                        className="inline-flex min-h-[36px] items-center gap-1 rounded-xl border border-border bg-card px-3 text-xs font-black text-foreground"
                      >
                        <Phone className="h-3.5 w-3.5" aria-hidden />
                        {t(lang, "debtsCall")}
                      </a>
                      <a
                        href={`https://wa.me/${s.phone.replace(/\D/g, "")}`}
                        target="_blank"
                        rel="noreferrer"
                        className={clsx(
                          "inline-flex min-h-[36px] items-center gap-1 rounded-xl border px-3 text-xs font-black",
                          statusTokens.success.badgeRing,
                          statusTokens.success.banner,
                        )}
                      >
                        <MessageCircle className="h-3.5 w-3.5" aria-hidden />
                        WhatsApp
                      </a>
                    </>
                  ) : null}
                  <WakaButton type="button" variant="primary" size="standard" className="!min-h-[36px] !px-2 !text-xs" onClick={() => onOpenSupplier(s.id)}>
                    {t(lang, "supplierViewDetail")}
                  </WakaButton>
                  {canManage && s.balanceOwedUgx > 0 ? (
                    <WakaButton
                      type="button"
                      variant="secondary"
                      size="standard"
                      className={clsx("!min-h-[36px] !px-2 !text-xs", statusTokens.warning.badgeRing)}
                      onClick={() => {
                        setPaySupplier(s);
                        setPayAmount(String(Math.min(s.balanceOwedUgx, 50000)));
                      }}
                    >
                      {t(lang, "supplierPayButton")}
                    </WakaButton>
                  ) : null}
                </div>
              ),
            },
          ]}
        />
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
    </div>
  );
}
