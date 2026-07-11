type Props = {
  /** 0–100 for determinate; omit for indeterminate pulse */
  value?: number;
  className?: string;
};

export function StartupProgressBar({ value, className = "" }: Props) {
  const determinate = value != null && Number.isFinite(value);

  return (
    <div className={`w-full ${className}`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={determinate ? value : undefined}>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        {determinate ? (
          <div
            className="h-full rounded-full bg-gradient-to-r from-waka-500 to-waka-600 transition-all duration-500 ease-out"
            style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
          />
        ) : (
          <div className="startup-progress-indeterminate h-full w-2/5 rounded-full bg-gradient-to-r from-waka-400 via-waka-600 to-waka-400" />
        )}
      </div>
    </div>
  );
}
