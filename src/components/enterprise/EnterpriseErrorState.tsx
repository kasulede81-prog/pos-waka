import clsx from "clsx";
import { AlertTriangle } from "lucide-react";
import type { ReactNode } from "react";
import { WakaButton } from "../ui/wakaPrimitives";
import { errorStateClasses } from "../../lib/statusTokens";

export type EnterpriseErrorStateProps = {
  title: string;
  description?: string;
  retryLabel?: string;
  onRetry?: () => void;
  className?: string;
  children?: ReactNode;
};

export function EnterpriseErrorState({
  title,
  description,
  retryLabel,
  onRetry,
  className,
  children,
}: EnterpriseErrorStateProps) {
  const styles = errorStateClasses();

  return (
    <div className={clsx(styles.shell, className)}>
      <span className={styles.icon}>
        <AlertTriangle className="h-6 w-6" strokeWidth={2} aria-hidden />
      </span>
      <h3 className={styles.title}>{title}</h3>
      {description ? <p className={styles.body}>{description}</p> : null}
      {children}
      {onRetry && retryLabel ? (
        <div className="mt-5">
          <WakaButton type="button" variant="secondary" onClick={onRetry}>
            {retryLabel}
          </WakaButton>
        </div>
      ) : null}
    </div>
  );
}
