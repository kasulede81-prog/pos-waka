import type { ReactNode } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { PageHeader } from "../layout/PageHeader";
import { BackOfficePageLayout } from "../office/BackOfficePageLayout";
import { HorizontalTabBar, type HorizontalTab } from "../shared/HorizontalTabBar";
import {
  loyaltySectionLabelKey,
  loyaltySectionPath,
  loyaltySectionSubKey,
  loyaltySectionsForActor,
  resolveLoyaltySection,
  type LoyaltySectionId,
} from "../../lib/loyalty/loyaltyNav";

type Props = {
  lang: Language;
  canManage: boolean;
  /** Fired when the user picks a tab (not on deep-link resolve) — lets the hub clear local UI state. */
  onSectionChange?: (section: LoyaltySectionId) => void;
  children: ReactNode;
};

/**
 * Shared Loyalty merchant shell: sticky header + section tabs + content.
 * Section is URL-backed (`/office/loyalty/:section`) so refresh and back/forward work.
 */
export function LoyaltyShell({ lang, canManage, onSectionChange, children }: Props) {
  const navigate = useNavigate();
  const params = useParams<{ section?: string }>();
  const section = resolveLoyaltySection(params.section);

  const tabs: HorizontalTab[] = loyaltySectionsForActor({ canManage }).map((id) => ({
    id,
    label: t(lang, loyaltySectionLabelKey(id)),
  }));

  return (
    <BackOfficePageLayout
      header={
        <PageHeader
          lang={lang}
          title={t(lang, "loyaltyHubTitle")}
          subtitle={t(lang, loyaltySectionSubKey(section))}
          backFallback="/office"
          backLabel={t(lang, "officeHubTitle")}
          compact
        />
      }
    >
      <HorizontalTabBar
        tabs={tabs}
        activeId={section}
        onChange={(id) => {
          const next = id as LoyaltySectionId;
          onSectionChange?.(next);
          navigate(loyaltySectionPath(next));
        }}
        ariaLabel={t(lang, "loyaltyHubTitle")}
      />
      {children}
    </BackOfficePageLayout>
  );
}
