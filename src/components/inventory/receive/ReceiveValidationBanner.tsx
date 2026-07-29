import clsx from "clsx";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import { WizardValidationBanner } from "../../stock/wizard/WizardValidationBanner";

type Props = {
  message: string;
  tone?: "error" | "success" | "warning";
};

export function ReceiveValidationBanner({ message, tone = "error" }: Props) {
  if (tone === "error") {
    return <WizardValidationBanner message={message} />;
  }

  return (
    <div
      className={clsx(
        "mb-4 flex items-start gap-3 rounded-2xl border px-4 py-3 text-sm font-semibold",
        tone === "success"
          ? "border-success/30 bg-success-muted text-success"
          : "border-warning/30 bg-warning-muted text-warning-foreground",
      )}
      role="alert"
    >
      {tone === "success" ? (
        <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
      ) : (
        <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
      )}
      <p>{message}</p>
    </div>
  );
}
