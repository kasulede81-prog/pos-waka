import type { ReactNode } from "react";
import { EnterpriseEmptyState } from "./EnterpriseEmptyState";
import { EnterpriseErrorState } from "./EnterpriseErrorState";
import { EnterpriseSkeletonKpiGrid } from "./EnterpriseSkeleton";
import type { LucideIcon } from "lucide-react";

export type EnterpriseAsyncShellProps = {
  loading: boolean;
  error?: string | null;
  empty?: boolean;
  loadingFallback?: ReactNode;
  emptyIcon: LucideIcon;
  emptyTitle: string;
  emptyDescription?: string;
  errorTitle: string;
  errorDescription?: string;
  retryLabel?: string;
  onRetry?: () => void;
  children: ReactNode;
};

/**
 * Standard async page states: Loading → Empty → Error → Content (+ Retry).
 */
export function EnterpriseAsyncShell({
  loading,
  error,
  empty = false,
  loadingFallback,
  emptyIcon,
  emptyTitle,
  emptyDescription,
  errorTitle,
  errorDescription,
  retryLabel,
  onRetry,
  children,
}: EnterpriseAsyncShellProps) {
  if (loading) {
    return loadingFallback ?? <EnterpriseSkeletonKpiGrid count={4} />;
  }
  if (error) {
    return (
      <EnterpriseErrorState
        title={errorTitle}
        description={errorDescription ?? error}
        retryLabel={retryLabel}
        onRetry={onRetry}
      />
    );
  }
  if (empty) {
    return <EnterpriseEmptyState icon={emptyIcon} title={emptyTitle} description={emptyDescription} />;
  }
  return <>{children}</>;
}
