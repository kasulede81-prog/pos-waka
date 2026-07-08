import type { Language } from "../types";
import { PharmacyDispenseWorkspaceWithGateway } from "../components/pharmacy/dispense/PharmacyDispenseWorkspace";

export function PharmacyPrescriptionWorkspacePage({ lang }: { lang: Language }) {
  return <PharmacyDispenseWorkspaceWithGateway lang={lang} />;
}
