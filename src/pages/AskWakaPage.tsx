import type { Language } from "../types";
import { t } from "../lib/i18n";
import { EnterprisePageContainer } from "../components/layout/EnterprisePageContainer";
import { PageHeader } from "../components/layout/PageHeader";
import { AskWakaPanel } from "../components/ask-waka/AskWakaPanel";

type Props = { lang: Language };

export function AskWakaPage({ lang }: Props) {
  return (
    <EnterprisePageContainer className="flex min-h-[calc(100dvh-8rem)] flex-col pb-4">
      <PageHeader
        lang={lang}
        title={t(lang, "askWakaTitle")}
        subtitle={t(lang, "askWakaSubtitle")}
        backFallback="/office/section/insights"
        showBack
      />
      <div className="mt-3 flex min-h-0 flex-1 flex-col">
        <AskWakaPanel lang={lang} embedded />
      </div>
    </EnterprisePageContainer>
  );
}
