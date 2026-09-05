import type { ReactNode } from "react";
import type { Language } from "../../types";
import { EnterprisePageHeader } from "../enterprise/EnterprisePageHeader";

type Props = {
  lang: Language;
  title: string;
  subtitle?: string;
  backFallback?: string;
  backLabel?: string;
  showBack?: boolean;
  compact?: boolean;
  children?: ReactNode;
  className?: string;
};

export function PageHeader(props: Props) {
  return <EnterprisePageHeader {...props} />;
}
