import clsx from "clsx";

type Tone = "error" | "success" | "warning";

type Props = {
  message: string;
  tone?: Tone;
};

const toneClass: Record<Tone, string> = {
  error: "border-danger/30 bg-danger-muted text-danger",
  success: "border-success/30 bg-success-muted text-success",
  warning: "border-warning/30 bg-warning-muted text-warning-foreground",
};

export function CountValidationBanner({ message, tone = "error" }: Props) {
  return (
    <p className={clsx("rounded-2xl border px-4 py-3 text-sm font-semibold", toneClass[tone])} role="alert">
      {message}
    </p>
  );
}
