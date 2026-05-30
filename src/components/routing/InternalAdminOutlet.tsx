import { Outlet } from "react-router-dom";

/** Pass-through layout for /internal/waka/* — no POS disk bootstrap or sync. */
export function InternalAdminOutlet() {
  return <Outlet />;
}
