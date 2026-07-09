import { ConciergeBell, Sparkles } from "lucide-react";
import type { EnterpriseRoleTemplate } from "./enterpriseRoles";

export const STAFF_HOST_ROLE_CARD: EnterpriseRoleTemplate = {
  id: "hospitality_receptionist",
  industries: ["hospitality"],
  baseRole: "waiter",
  labelKey: "staffRoleHostLabel",
  descriptionKey: "staffRoleHostDesc",
  Icon: ConciergeBell,
  accent: "amber",
  rank: 32,
  allowedPermKeys: ["staffPermSell", "staffPermOpenTill"],
  restrictedPermKeys: ["staffPermAcceptPayments", "staffPermViewReports"],
};

export const STAFF_CLEANER_ROLE_CARD: EnterpriseRoleTemplate = {
  id: "hospitality_housekeeping",
  industries: ["hospitality"],
  baseRole: "stock_keeper",
  labelKey: "staffRoleCleanerLabel",
  descriptionKey: "staffRoleCleanerDesc",
  Icon: Sparkles,
  accent: "emerald",
  rank: 20,
  allowedPermKeys: [],
  restrictedPermKeys: [],
};
