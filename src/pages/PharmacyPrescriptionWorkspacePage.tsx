import type { Language } from "../types";
import { EnterprisePageContainer } from "../components/layout/EnterprisePageContainer";
import { PharmacyDispenseWorkspaceWithGateway } from "../components/pharmacy/dispense/PharmacyDispenseWorkspace";

export function PharmacyPrescriptionWorkspacePage({ lang }: { lang: Language }) {
  return (
    <EnterprisePageContainer variant="viewport" className="bg-muted">
      <PharmacyDispenseWorkspaceWithGateway lang={lang} />
    </EnterprisePageContainer>
  );
}
