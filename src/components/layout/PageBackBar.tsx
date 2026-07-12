import type { Language } from "../../types";
import { EnterpriseNavBack } from "../enterprise/EnterpriseNavBack";

type Props = {
  lang: Language;
  fallbackTo?: string;
  label?: string;
  className?: string;
};

/** @deprecated Use EnterpriseNavBack — thin wrapper for existing call sites. */
export function PageBackBar(props: Props) {
  return <EnterpriseNavBack variant="inline" {...props} />;
}
