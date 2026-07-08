import { AlertCircle } from "lucide-react";

type Props = {
  message: string;
};

export function WizardValidationBanner({ message }: Props) {
  return (
    <div
      className="mb-4 flex items-start gap-3 rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm font-semibold text-destructive dark:text-red-300"
      role="alert"
    >
      <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
      <p>{message}</p>
    </div>
  );
}
