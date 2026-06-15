import type { Language } from "../types";
import { usePosDesktopLayout } from "../hooks/usePosDesktopLayout";
import { DashboardPage } from "./DashboardPage";
import { DesktopHomePage } from "./DesktopHomePage";

type Props = { lang: Language };

/** Desktop terminal launcher at lg+; mobile keeps the existing dashboard home. */
export function HomePage({ lang }: Props) {
  const isDesktop = usePosDesktopLayout();
  if (isDesktop) return <DesktopHomePage lang={lang} />;
  return <DashboardPage lang={lang} />;
}
