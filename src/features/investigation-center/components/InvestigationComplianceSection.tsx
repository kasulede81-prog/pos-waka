import type { Language, PharmacyControlledRegisterEntry } from "../../../types";
import { PharmacyComplianceRegisterPanel } from "../../../components/pharmacy/compliance/PharmacyComplianceRegisterPanel";

type Props = {
  lang: Language;
  register: PharmacyControlledRegisterEntry[];
};

export function InvestigationComplianceSection({ lang, register }: Props) {
  return <PharmacyComplianceRegisterPanel lang={lang} register={register} embedded />;
}
