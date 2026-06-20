import clsx from "clsx";
import { WakaPosLogo } from "./WakaLogo";

type Props = {
  className?: string;
  /** Full wordmark + tagline PNG (default) or compact size for tight layouts */
  compact?: boolean;
};

/** Centered Waka POS brand block for splash, startup, and recovery screens. */
export function WakaStartupBrand({ className, compact = false }: Props) {
  return (
    <div className={clsx("flex flex-col items-center justify-center text-center", className)}>
      <WakaPosLogo
        size={compact ? "lg" : "splash"}
        className={clsx(compact ? "max-w-[220px]" : "max-w-[min(88vw,320px)]")}
        draggable={false}
      />
    </div>
  );
}
