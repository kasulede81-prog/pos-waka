import { memo, useCallback, useMemo } from "react";
import type { Permission } from "../../../types";
import { actorHasEffectivePermission } from "../../../lib/actorAuthorization";
import { useSessionActor } from "../../../context/SessionActorContext";
import { useSubscription } from "../../../context/SubscriptionContext";
import { EnterpriseDashboardShell } from "../../command-center/EnterpriseDashboardShell";
import { buildPharmacyOpsDashboardContext } from "../../command-center/registry/buildPharmacyDashboardContext";
import type { PharmacyOpsDashboardProps } from "./PharmacyOpsDashboardSections";

export type { PharmacyOpsDashboardProps } from "./PharmacyOpsDashboardSections";

export const PharmacyOpsDashboard = memo(function PharmacyOpsDashboard(props: PharmacyOpsDashboardProps) {
  const actor = useSessionActor();
  const { snapshot, authMode } = useSubscription();
  const can = useCallback(
    (perm: Permission) => actorHasEffectivePermission(actor, perm, snapshot, authMode),
    [actor, snapshot, authMode],
  );
  const ctx = useMemo(() => buildPharmacyOpsDashboardContext(props, can), [props, can]);
  return <EnterpriseDashboardShell ctx={ctx} />;
});
