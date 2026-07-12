import type { Language } from "../../types";
import { EnterpriseNavBack } from "../enterprise/EnterpriseNavBack";

type Props = { lang: Language };

/** App header back — visible from tablet (768px+) per Phase 22.2 breakpoint fix. */
export function HeaderBackButton({ lang }: Props) {
  return <EnterpriseNavBack lang={lang} variant="header" />;
}
