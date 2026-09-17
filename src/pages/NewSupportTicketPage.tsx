import { useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Language } from "../types";
import { t } from "../lib/i18n";
import { useActiveShopId } from "../hooks/useActiveShopId";
import { useCreateSupportTicket } from "../hooks/useMerchantSupport";
import {
  SUPPORT_TICKET_CATEGORIES,
  type SupportTicketCategory,
} from "../lib/merchantSupportApi";
import { SUPPORT_CATEGORY_LABELS } from "../lib/merchantSupportPresentation";
import { BackOfficePageLayout } from "../components/office/BackOfficePageLayout";
import { EnterprisePageHeader } from "../components/enterprise/EnterprisePageHeader";
import { KeyboardSafePage } from "../components/layout/KeyboardSafePage";

/**
 * "Report a problem" — opens a general support ticket. Financial-issue reporting
 * for a specific completed sale intentionally stays in Sales History
 * ("Report Financial Issue"); a hint below points merchants there.
 */
export function NewSupportTicketPage({ lang }: { lang: Language }) {
  const navigate = useNavigate();
  const { shopId, loading: shopLoading } = useActiveShopId();
  const createTicket = useCreateSupportTicket(shopLoading ? null : shopId);

  const [subject, setSubject] = useState("");
  const [category, setCategory] = useState<SupportTicketCategory>("other");
  const [description, setDescription] = useState("");

  const canSubmit =
    shopId != null && !createTicket.isPending && subject.trim().length > 0 && description.trim().length >= 3;

  const submit = () => {
    if (!canSubmit) return;
    createTicket.mutate(
      { subject: subject.trim(), category, description: description.trim() },
      {
        onSuccess: (result) => {
          if (result.ok) {
            navigate(`/support-center/tickets/${result.ticketId}`, { replace: true });
          }
        },
      },
    );
  };

  const inputClass =
    "w-full rounded-xl border border-border bg-muted/60 px-3 py-2.5 text-sm font-medium text-foreground outline-none focus:border-waka-400";

  return (
    <KeyboardSafePage className="px-3 sm:px-4 md:px-6">
      <BackOfficePageLayout
        header={
          <EnterprisePageHeader
            lang={lang}
            title={t(lang, "supportCenterNewTicketTitle")}
            backFallback="/support-center"
            compact
          />
        }
        className="pb-8"
      >
        <form
          className="space-y-4 rounded-2xl border border-border/90 bg-card p-4 shadow-waka-sm"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div>
            <label htmlFor="support-subject" className="mb-1 block text-xs font-black uppercase tracking-wide text-muted-foreground">
              {t(lang, "supportCenterNewTicketSubject")}
            </label>
            <input
              id="support-subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              maxLength={200}
              placeholder={t(lang, "supportCenterNewTicketSubjectPlaceholder")}
              className={inputClass}
            />
          </div>

          <div>
            <label htmlFor="support-category" className="mb-1 block text-xs font-black uppercase tracking-wide text-muted-foreground">
              {t(lang, "supportCenterNewTicketCategory")}
            </label>
            <select
              id="support-category"
              value={category}
              onChange={(e) => setCategory(e.target.value as SupportTicketCategory)}
              className={inputClass}
            >
              {SUPPORT_TICKET_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {SUPPORT_CATEGORY_LABELS[lang]?.[c] ?? SUPPORT_CATEGORY_LABELS.en[c]}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="support-description" className="mb-1 block text-xs font-black uppercase tracking-wide text-muted-foreground">
              {t(lang, "supportCenterNewTicketDescription")}
            </label>
            <textarea
              id="support-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={5}
              placeholder={t(lang, "supportCenterNewTicketDescriptionPlaceholder")}
              className={inputClass}
            />
          </div>

          <p className="rounded-2xl bg-muted px-3 py-2 text-[11px] font-semibold text-muted-foreground">
            {t(lang, "supportCenterFinancialHint")}
          </p>

          {createTicket.isError ? (
            <p className="text-xs font-bold text-rose-600">{t(lang, "supportCenterLoadError")}</p>
          ) : null}

          <button
            type="submit"
            disabled={!canSubmit}
            className="flex min-h-[48px] w-full items-center justify-center rounded-2xl bg-waka-600 px-4 text-sm font-black text-white shadow-md active:scale-[0.99] disabled:opacity-50"
          >
            {t(lang, "supportCenterNewTicketSubmit")}
          </button>
        </form>
      </BackOfficePageLayout>
    </KeyboardSafePage>
  );
}
