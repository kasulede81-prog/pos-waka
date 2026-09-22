// Compatibility layer: mirrors the app's router API on react-router-dom.
import type { AnchorHTMLAttributes, ReactNode } from "react";
import {
  Link as RouterLink,
  Navigate as RouterNavigate,
  Outlet as RouterOutlet,
  useLocation as useRrLocation,
  useNavigate as useRrNavigate,
  useSearchParams as useRrSearchParams,
} from "react-router-dom";

export { RouterOutlet as Outlet };

export function useNavigate() {
  const navigate = useRrNavigate();
  return (
    to: string | number,
    options?: { replace?: boolean; state?: unknown; preventScrollReset?: boolean },
  ) => {
    if (typeof to === "number") {
      navigate(to);
      return;
    }
    navigate(to, {
      replace: options?.replace,
      state: options?.state,
      preventScrollReset: options?.preventScrollReset,
    });
  };
}

export function useLocation() {
  const location = useRrLocation();
  const state = (location.state ?? {}) as { __TSR_key?: string };
  return {
    pathname: location.pathname,
    search: location.search,
    hash: location.hash,
    state: location.state,
    key: state.__TSR_key ?? location.key,
  };
}

export function useSearchParams(): [
  URLSearchParams,
  (
    next: URLSearchParams | ((prev: URLSearchParams) => URLSearchParams),
    options?: { replace?: boolean },
  ) => void,
] {
  const [params, setParams] = useRrSearchParams();
  return [
    params,
    (next, options) => {
      setParams(next, { replace: options?.replace });
    },
  ];
}

type LinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
  to: string;
  children?: ReactNode;
  replace?: boolean;
};

export function Link({ to, replace, children, ...props }: LinkProps) {
  return (
    <RouterLink to={to} replace={replace} {...props}>
      {children}
    </RouterLink>
  );
}

export function Navigate({ to, replace = false }: { to: string; replace?: boolean }) {
  return <RouterNavigate to={to} replace={replace} />;
}
