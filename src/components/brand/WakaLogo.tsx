import type { ImgHTMLAttributes } from "react";
import clsx from "clsx";

const LOGO_SRC = "/waka-logo.png";

type LogoProps = ImgHTMLAttributes<HTMLImageElement> & {
  /** Tailwind height class, e.g. `h-12` */
  size?: "xs" | "sm" | "md" | "lg" | "xl" | "splash";
};

const SIZE_CLASS: Record<NonNullable<LogoProps["size"]>, string> = {
  xs: "h-8",
  sm: "h-10",
  md: "h-14",
  lg: "h-20",
  xl: "h-28",
  splash: "h-[min(52vh,320px)]",
};

/** Full Waka POS logo (PNG) — use in app shell, auth, and marketing headers */
export function WakaPosLogo({ size = "md", className, alt = "Waka POS", ...rest }: LogoProps) {
  return (
    <img
      src={LOGO_SRC}
      alt={alt}
      width={512}
      height={512}
      decoding="async"
      className={clsx("w-auto max-w-full object-contain object-center", SIZE_CLASS[size], className)}
      {...rest}
    />
  );
}

/** @deprecated Use WakaPosLogo for the official brand mark */
export function WakaMarkIcon({ className }: { className?: string }) {
  return <WakaPosLogo size="sm" className={className} aria-hidden />;
}

/** Marketing header wordmark */
export function WakaBrandWordmark({ className, size = "md" }: { className?: string; size?: LogoProps["size"] }) {
  return <WakaPosLogo size={size} className={className} />;
}
