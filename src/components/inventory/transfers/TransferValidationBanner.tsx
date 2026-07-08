import clsx from "clsx";

type Tone = "error" | "success" | "warning";

type Props = {
  message: string;
  tone?: Tone;
};

const toneClass: Record<Tone, string> = {
  error: "border-rose-200 bg-rose-50 text-rose-950",
  success: "border-emerald-200 bg-emerald-50 text-emerald-950",
  warning: "border-amber-200 bg-amber-50 text-amber-950",
};

export function TransferValidationBanner({ message, tone = "error" }: Props) {
  return (
    <p className={clsx("rounded-2xl border px-4 py-3 text-sm font-semibold", toneClass[tone])} role="alert">
      {message}
    </p>
  );
}
