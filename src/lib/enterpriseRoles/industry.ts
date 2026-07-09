import type { BusinessType } from "../../types";

/** Industry family for role templates — extensible without changing the permission engine. */
export type RoleIndustry = "retail" | "pharmacy" | "hospitality" | "wholesale";

export function resolveRoleIndustry(businessType: BusinessType | null | undefined): RoleIndustry {
  switch (businessType) {
    case "pharmacy":
      return "pharmacy";
    case "wholesale":
      return "wholesale";
    case "restaurant":
    case "bar":
    case "restaurant_bar":
    case "hotel":
      return "hospitality";
    default:
      return "retail";
  }
}
