import { useState } from "react";
import { Link } from "react-router-dom";
import { Quote } from "lucide-react";
import {
  FOUNDER_BIO_SHORT,
  FOUNDER_JOURNEY_SUMMARY,
  FOUNDER_NAME,
  FOUNDER_PHOTO_ALT,
  FOUNDER_PHOTO_SRC,
  FOUNDER_QUOTE,
  FOUNDER_QUOTE_SECOND,
  FOUNDER_ROLE,
  WAKA_LEGAL_COMPANY_NAME,
} from "../../config/company";

type Props = {
  compact?: boolean;
};

export function FounderSection({ compact = false }: Props) {
  return (
    <section className="overflow-hidden rounded-3xl border border-orange-100 bg-gradient-to-br from-stone-950 via-stone-900 to-orange-950 p-6 text-white shadow-xl sm:p-8">
      <div className={compact ? "space-y-6" : "grid gap-8 lg:grid-cols-[auto_1fr] lg:items-start"}>
        <FounderAvatar large={!compact} />
        <div className="space-y-4">
          <p className="text-xs font-black uppercase tracking-[0.2em] text-orange-300">Message from the founder</p>
          <h2 className="text-2xl font-black sm:text-3xl">{FOUNDER_NAME}</h2>
          <p className="text-sm font-bold text-orange-200">
            {FOUNDER_ROLE} · {WAKA_LEGAL_COMPANY_NAME}
          </p>
          <p className="text-sm font-medium leading-relaxed text-stone-300">{FOUNDER_BIO_SHORT}</p>
          <p className="text-sm font-medium leading-relaxed text-stone-400">{FOUNDER_JOURNEY_SUMMARY}</p>
          <blockquote className="relative rounded-2xl border border-white/10 bg-white/5 p-4">
            <Quote className="absolute -top-2 left-3 h-8 w-8 text-orange-500/40" aria-hidden />
            <p className="text-base font-semibold leading-relaxed text-orange-50">&ldquo;{FOUNDER_QUOTE}&rdquo;</p>
            <p className="mt-3 text-sm font-medium text-stone-400">&ldquo;{FOUNDER_QUOTE_SECOND}&rdquo;</p>
          </blockquote>
          <Link
            to="/founder"
            className="inline-flex min-h-[44px] items-center rounded-2xl bg-orange-600 px-5 py-2 text-sm font-black text-white hover:bg-orange-500"
          >
            Read founder profile →
          </Link>
        </div>
      </div>
    </section>
  );
}

type AvatarProps = {
  large?: boolean;
  className?: string;
};

export function FounderAvatar({ large = false, className = "" }: AvatarProps) {
  const [imgError, setImgError] = useState(false);
  const size = large ? "h-36 w-36 sm:h-44 sm:w-44" : "h-24 w-24 sm:h-28 sm:w-28";
  const textSize = large ? "text-3xl" : "text-xl";

  if (!imgError) {
    return (
      <img
        src={FOUNDER_PHOTO_SRC}
        alt={FOUNDER_PHOTO_ALT}
        width={large ? 176 : 112}
        height={large ? 176 : 112}
        loading={large ? "eager" : "lazy"}
        decoding="async"
        onError={() => setImgError(true)}
        className={`${size} shrink-0 rounded-full border-[3px] border-orange-400/40 object-cover object-center shadow-lg ring-2 ring-white/10 ${className}`}
      />
    );
  }

  return (
    <div
      className={`${size} flex shrink-0 items-center justify-center rounded-full border-2 border-orange-400/30 bg-gradient-to-br from-orange-600 to-orange-900 ${textSize} font-black text-white shadow-lg ${className}`}
      aria-label={FOUNDER_PHOTO_ALT}
      role="img"
    >
      KD
    </div>
  );
}
