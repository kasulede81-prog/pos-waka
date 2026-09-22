/**
 * Compatibility shim for Lovable-imported modules that use `@/lib/routerCompat`.
 * Canonical WAKA uses react-router-dom; this re-exports the same surface.
 */
export {
  Link,
  Navigate,
  Outlet,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
