import type { LucideIcon } from "lucide-react";
import {
  Briefcase,
  Calculator,
  ChefHat,
  ClipboardList,
  ConciergeBell,
  Package,
  Pill,
  Shield,
  ShoppingCart,
  Stethoscope,
  Truck,
  Users,
  Warehouse,
  Wine,
} from "lucide-react";
import type { UserRole } from "../../types";
import type { RoleIndustry } from "./industry";

/** Stable template id — persisted on staff records for industry-specific labels. */
export type RoleTemplateId = string;

export type StaffCreateRole = Extract<
  UserRole,
  "manager" | "supervisor" | "cashier" | "waiter" | "kitchen" | "bar" | "stock_keeper"
>;

export type EnterpriseRoleTemplate = {
  id: RoleTemplateId;
  industries: RoleIndustry[];
  baseRole: StaffCreateRole;
  labelKey: string;
  descriptionKey: string;
  Icon: LucideIcon;
  accent: "waka" | "violet" | "emerald" | "amber" | "rose" | "sky" | "orange";
  rank: number;
  allowedPermKeys: string[];
  restrictedPermKeys: string[];
};

const RETAIL: EnterpriseRoleTemplate[] = [
  {
    id: "retail_manager",
    industries: ["retail"],
    baseRole: "manager",
    labelKey: "roleTemplate_retail_manager",
    descriptionKey: "staffRoleManagerDesc",
    Icon: Briefcase,
    accent: "violet",
    rank: 80,
    allowedPermKeys: ["staffPermSell", "staffPermViewReports", "staffPermManageInventory", "staffPermCloseDay"],
    restrictedPermKeys: ["staffPermManageStaff", "staffPermAppSettings"],
  },
  {
    id: "retail_supervisor",
    industries: ["retail"],
    baseRole: "supervisor",
    labelKey: "roleTemplate_retail_supervisor",
    descriptionKey: "staffRoleSupervisorDesc",
    Icon: Shield,
    accent: "sky",
    rank: 60,
    allowedPermKeys: ["staffPermSell", "staffPermViewReports", "staffPermApproveExpenses"],
    restrictedPermKeys: ["staffPermManageStaff", "staffPermAppSettings"],
  },
  {
    id: "retail_cashier",
    industries: ["retail"],
    baseRole: "cashier",
    labelKey: "roleTemplate_retail_cashier",
    descriptionKey: "staffRoleCashierDesc",
    Icon: ShoppingCart,
    accent: "waka",
    rank: 40,
    allowedPermKeys: ["staffPermSell", "staffPermAcceptPayments", "staffPermOpenTill"],
    restrictedPermKeys: ["staffPermManageInventory", "staffPermViewReports"],
  },
  {
    id: "retail_sales_assistant",
    industries: ["retail"],
    baseRole: "cashier",
    labelKey: "roleTemplate_retail_sales_assistant",
    descriptionKey: "roleTemplate_retail_sales_assistant_desc",
    Icon: Users,
    accent: "waka",
    rank: 35,
    allowedPermKeys: ["staffPermSell", "staffPermAcceptPayments"],
    restrictedPermKeys: ["staffPermOpenTill", "staffPermViewReports"],
  },
  {
    id: "retail_stock_keeper",
    industries: ["retail"],
    baseRole: "stock_keeper",
    labelKey: "roleTemplate_retail_stock_keeper",
    descriptionKey: "staffRoleStockDesc",
    Icon: Package,
    accent: "emerald",
    rank: 50,
    allowedPermKeys: ["staffPermManageInventory", "staffPermStockCount", "staffPermAddProducts"],
    restrictedPermKeys: ["staffPermSell", "staffPermViewReports"],
  },
  {
    id: "retail_inventory_manager",
    industries: ["retail"],
    baseRole: "stock_keeper",
    labelKey: "roleTemplate_retail_inventory_manager",
    descriptionKey: "roleTemplate_retail_inventory_manager_desc",
    Icon: ClipboardList,
    accent: "emerald",
    rank: 55,
    allowedPermKeys: ["staffPermManageInventory", "staffPermStockCount", "staffPermSuppliers", "staffPermPurchases"],
    restrictedPermKeys: ["staffPermSell"],
  },
  {
    id: "retail_accountant",
    industries: ["retail"],
    baseRole: "supervisor",
    labelKey: "roleTemplate_accountant",
    descriptionKey: "roleTemplate_accountant_desc",
    Icon: Calculator,
    accent: "sky",
    rank: 45,
    allowedPermKeys: ["staffPermViewReports", "staffPermApproveExpenses"],
    restrictedPermKeys: ["staffPermSell", "staffPermManageStaff"],
  },
];

const PHARMACY: EnterpriseRoleTemplate[] = [
  {
    id: "pharmacy_manager",
    industries: ["pharmacy"],
    baseRole: "manager",
    labelKey: "roleTemplate_pharmacy_manager",
    descriptionKey: "roleTemplate_pharmacy_manager_desc",
    Icon: Briefcase,
    accent: "violet",
    rank: 80,
    allowedPermKeys: ["staffPermSell", "staffPermViewReports", "staffPermManageInventory", "staffPermCloseDay"],
    restrictedPermKeys: ["staffPermManageStaff"],
  },
  {
    id: "pharmacist",
    industries: ["pharmacy"],
    baseRole: "manager",
    labelKey: "roleTemplate_pharmacist",
    descriptionKey: "roleTemplate_pharmacist_desc",
    Icon: Stethoscope,
    accent: "violet",
    rank: 75,
    allowedPermKeys: ["staffPermSell", "staffPermManageInventory", "staffPermViewReports"],
    restrictedPermKeys: ["staffPermManageStaff", "staffPermAppSettings"],
  },
  {
    id: "pharmacy_technician",
    industries: ["pharmacy"],
    baseRole: "stock_keeper",
    labelKey: "roleTemplate_pharmacy_technician",
    descriptionKey: "roleTemplate_pharmacy_technician_desc",
    Icon: Pill,
    accent: "emerald",
    rank: 55,
    allowedPermKeys: ["staffPermManageInventory", "staffPermStockCount", "staffPermAddProducts"],
    restrictedPermKeys: ["staffPermSell", "staffPermViewReports"],
  },
  {
    id: "pharmacy_cashier",
    industries: ["pharmacy"],
    baseRole: "cashier",
    labelKey: "roleTemplate_pharmacy_cashier",
    descriptionKey: "staffRoleCashierDesc",
    Icon: ShoppingCart,
    accent: "waka",
    rank: 40,
    allowedPermKeys: ["staffPermSell", "staffPermAcceptPayments", "staffPermOpenTill"],
    restrictedPermKeys: ["staffPermManageInventory", "staffPermViewReports"],
  },
  {
    id: "pharmacy_store_keeper",
    industries: ["pharmacy"],
    baseRole: "stock_keeper",
    labelKey: "roleTemplate_pharmacy_store_keeper",
    descriptionKey: "roleTemplate_pharmacy_store_keeper_desc",
    Icon: Package,
    accent: "emerald",
    rank: 50,
    allowedPermKeys: ["staffPermManageInventory", "staffPermStockCount"],
    restrictedPermKeys: ["staffPermSell"],
  },
  {
    id: "pharmacy_inventory_officer",
    industries: ["pharmacy"],
    baseRole: "stock_keeper",
    labelKey: "roleTemplate_pharmacy_inventory_officer",
    descriptionKey: "roleTemplate_pharmacy_inventory_officer_desc",
    Icon: ClipboardList,
    accent: "emerald",
    rank: 52,
    allowedPermKeys: ["staffPermManageInventory", "staffPermStockCount", "staffPermPurchases"],
    restrictedPermKeys: ["staffPermSell"],
  },
  {
    id: "pharmacy_accountant",
    industries: ["pharmacy"],
    baseRole: "supervisor",
    labelKey: "roleTemplate_accountant",
    descriptionKey: "roleTemplate_accountant_desc",
    Icon: Calculator,
    accent: "sky",
    rank: 45,
    allowedPermKeys: ["staffPermViewReports", "staffPermApproveExpenses"],
    restrictedPermKeys: ["staffPermSell"],
  },
];

const HOSPITALITY: EnterpriseRoleTemplate[] = [
  {
    id: "hospitality_restaurant_manager",
    industries: ["hospitality"],
    baseRole: "manager",
    labelKey: "roleTemplate_restaurant_manager",
    descriptionKey: "staffRoleManagerDesc",
    Icon: Briefcase,
    accent: "violet",
    rank: 80,
    allowedPermKeys: ["staffPermSell", "staffPermViewReports", "staffPermCloseDay"],
    restrictedPermKeys: ["staffPermManageStaff"],
  },
  {
    id: "hospitality_supervisor",
    industries: ["hospitality"],
    baseRole: "supervisor",
    labelKey: "roleTemplate_retail_supervisor",
    descriptionKey: "staffRoleSupervisorDesc",
    Icon: Shield,
    accent: "sky",
    rank: 60,
    allowedPermKeys: ["staffPermSell", "staffPermViewReports", "staffPermApproveExpenses"],
    restrictedPermKeys: ["staffPermManageStaff"],
  },
  {
    id: "hospitality_cashier",
    industries: ["hospitality"],
    baseRole: "cashier",
    labelKey: "roleTemplate_retail_cashier",
    descriptionKey: "staffRoleCashierDesc",
    Icon: ShoppingCart,
    accent: "waka",
    rank: 40,
    allowedPermKeys: ["staffPermSell", "staffPermAcceptPayments", "staffPermOpenTill"],
    restrictedPermKeys: ["staffPermManageInventory"],
  },
  {
    id: "hospitality_waiter",
    industries: ["hospitality"],
    baseRole: "waiter",
    labelKey: "role_waiter",
    descriptionKey: "staffRoleWaiterDesc",
    Icon: Users,
    accent: "amber",
    rank: 35,
    allowedPermKeys: ["staffPermSell", "staffPermAcceptPayments"],
    restrictedPermKeys: ["staffPermManageInventory", "staffPermViewReports"],
  },
  {
    id: "hospitality_kitchen_staff",
    industries: ["hospitality"],
    baseRole: "kitchen",
    labelKey: "roleTemplate_kitchen_staff",
    descriptionKey: "staffRoleKitchenDesc",
    Icon: ChefHat,
    accent: "orange",
    rank: 30,
    allowedPermKeys: ["staffPermKitchenDisplay"],
    restrictedPermKeys: ["staffPermSell", "staffPermViewReports"],
  },
  {
    id: "hospitality_chef",
    industries: ["hospitality"],
    baseRole: "kitchen",
    labelKey: "roleTemplate_chef",
    descriptionKey: "roleTemplate_chef_desc",
    Icon: ChefHat,
    accent: "orange",
    rank: 45,
    allowedPermKeys: ["staffPermKitchenDisplay", "staffPermManageInventory"],
    restrictedPermKeys: ["staffPermSell"],
  },
  {
    id: "hospitality_bartender",
    industries: ["hospitality"],
    baseRole: "bar",
    labelKey: "roleTemplate_bartender",
    descriptionKey: "staffRoleBarDesc",
    Icon: Wine,
    accent: "rose",
    rank: 35,
    allowedPermKeys: ["staffPermSell", "staffPermKitchenDisplay"],
    restrictedPermKeys: ["staffPermManageInventory"],
  },
  {
    id: "hospitality_receptionist",
    industries: ["hospitality"],
    baseRole: "waiter",
    labelKey: "roleTemplate_receptionist",
    descriptionKey: "roleTemplate_receptionist_desc",
    Icon: ConciergeBell,
    accent: "amber",
    rank: 32,
    allowedPermKeys: ["staffPermSell", "staffPermOpenTill"],
    restrictedPermKeys: ["staffPermViewReports"],
  },
  {
    id: "hospitality_housekeeping",
    industries: ["hospitality"],
    baseRole: "stock_keeper",
    labelKey: "roleTemplate_housekeeping",
    descriptionKey: "roleTemplate_housekeeping_desc",
    Icon: Package,
    accent: "emerald",
    rank: 25,
    allowedPermKeys: ["staffPermStockCount"],
    restrictedPermKeys: ["staffPermSell", "staffPermViewReports"],
  },
];

const WHOLESALE: EnterpriseRoleTemplate[] = [
  {
    id: "wholesale_warehouse_manager",
    industries: ["wholesale"],
    baseRole: "manager",
    labelKey: "roleTemplate_warehouse_manager",
    descriptionKey: "roleTemplate_warehouse_manager_desc",
    Icon: Warehouse,
    accent: "violet",
    rank: 80,
    allowedPermKeys: ["staffPermManageInventory", "staffPermViewReports", "staffPermPurchases"],
    restrictedPermKeys: ["staffPermManageStaff"],
  },
  {
    id: "wholesale_sales_rep",
    industries: ["wholesale"],
    baseRole: "cashier",
    labelKey: "roleTemplate_sales_rep",
    descriptionKey: "roleTemplate_sales_rep_desc",
    Icon: Users,
    accent: "waka",
    rank: 40,
    allowedPermKeys: ["staffPermSell", "staffPermAcceptPayments"],
    restrictedPermKeys: ["staffPermManageInventory"],
  },
  {
    id: "wholesale_cashier",
    industries: ["wholesale"],
    baseRole: "cashier",
    labelKey: "roleTemplate_retail_cashier",
    descriptionKey: "staffRoleCashierDesc",
    Icon: ShoppingCart,
    accent: "waka",
    rank: 38,
    allowedPermKeys: ["staffPermSell", "staffPermAcceptPayments", "staffPermOpenTill"],
    restrictedPermKeys: ["staffPermManageInventory"],
  },
  {
    id: "wholesale_stock_controller",
    industries: ["wholesale"],
    baseRole: "stock_keeper",
    labelKey: "roleTemplate_stock_controller",
    descriptionKey: "roleTemplate_stock_controller_desc",
    Icon: Package,
    accent: "emerald",
    rank: 55,
    allowedPermKeys: ["staffPermManageInventory", "staffPermStockCount", "staffPermPurchases"],
    restrictedPermKeys: ["staffPermSell"],
  },
  {
    id: "wholesale_delivery_officer",
    industries: ["wholesale"],
    baseRole: "stock_keeper",
    labelKey: "roleTemplate_delivery_officer",
    descriptionKey: "roleTemplate_delivery_officer_desc",
    Icon: Truck,
    accent: "emerald",
    rank: 30,
    allowedPermKeys: ["staffPermManageInventory"],
    restrictedPermKeys: ["staffPermSell", "staffPermViewReports"],
  },
  {
    id: "wholesale_accountant",
    industries: ["wholesale"],
    baseRole: "supervisor",
    labelKey: "roleTemplate_accountant",
    descriptionKey: "roleTemplate_accountant_desc",
    Icon: Calculator,
    accent: "sky",
    rank: 45,
    allowedPermKeys: ["staffPermViewReports", "staffPermApproveExpenses"],
    restrictedPermKeys: ["staffPermSell"],
  },
];

export const ENTERPRISE_ROLE_TEMPLATES: EnterpriseRoleTemplate[] = [
  ...RETAIL,
  ...PHARMACY,
  ...HOSPITALITY,
  ...WHOLESALE,
];

export function roleTemplatesForIndustry(industry: RoleIndustry): EnterpriseRoleTemplate[] {
  return ENTERPRISE_ROLE_TEMPLATES.filter((t) => t.industries.includes(industry)).sort(
    (a, b) => b.rank - a.rank,
  );
}

export function findRoleTemplate(id: RoleTemplateId | null | undefined): EnterpriseRoleTemplate | null {
  if (!id) return null;
  return ENTERPRISE_ROLE_TEMPLATES.find((t) => t.id === id) ?? null;
}

export function defaultRoleTemplateForIndustry(industry: RoleIndustry): EnterpriseRoleTemplate {
  const list = roleTemplatesForIndustry(industry);
  return list.find((t) => t.baseRole === "cashier") ?? list[0]!;
}

export function roleTemplateLabelKey(staff: {
  role: UserRole;
  roleTemplateId?: string | null;
  customRoleId?: string | null;
}): string {
  if (staff.customRoleId) return "roleTemplate_custom";
  const tpl = findRoleTemplate(staff.roleTemplateId);
  if (tpl) return tpl.labelKey;
  return `role_${staff.role}`;
}
