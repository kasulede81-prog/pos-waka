import clsx from "clsx";
import { useBusinessBuilder } from "../../context/BusinessBuilderContext";
import { useHomeDashboardAnimationPause } from "../../hooks/useHomeDashboardAnimationPause";
import { useBuilderSpotlight, type BuilderSpotlightZone } from "../../hooks/useBuilderSpotlight";
import { sceneVariantFromBusiness } from "../../lib/businessBuilder/businessSceneState";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";

type Props = { className?: string; lang?: Language };

export function BusinessBuilderScene({ className, lang = "en" }: Props) {
  const { scene } = useBusinessBuilder();
  const paused = useHomeDashboardAnimationPause();
  const spotlight = useBuilderSpotlight(paused);

  const variant = sceneVariantFromBusiness(scene.businessType, scene.businessCardId);
  const signText = scene.shopName.trim() || t(lang, "builderDefaultShopName");
  const lightsOn = scene.isOpen || scene.activationMode === "active";
  const openingSoon = scene.activationMode === "opening_soon";

  return (
    <div className={clsx("builder-scene-root relative aspect-[400/280] w-full", className)}>
      <svg
        viewBox="0 0 400 280"
        className="builder-scene-svg h-full w-full"
        role="img"
        aria-label={t(lang, "builderSceneAria")}
      >
        <defs>
          <linearGradient id="bb-sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#e0f2fe" />
            <stop offset="100%" stopColor="#fef3c7" />
          </linearGradient>
          <linearGradient id="bb-awning" x1="0" y1="0" x2="100%" y2="0">
            <stop offset="0%" stopColor="#ef4444" />
            <stop offset="50%" stopColor="#ffffff" />
            <stop offset="100%" stopColor="#ef4444" />
          </linearGradient>
          <linearGradient id="bb-orange" x1="0" y1="0" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#fb923c" />
            <stop offset="100%" stopColor="#ea580c" />
          </linearGradient>
          <filter id="bb-soft-shadow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="4" stdDeviation="6" floodOpacity="0.15" />
          </filter>
        </defs>

        {/* Sky & ground */}
        <rect width="400" height="280" fill="url(#bb-sky)" />
        <ellipse cx="200" cy="268" rx="190" ry="18" fill="#86efac" opacity="0.35" />
        <rect x="0" y="230" width="400" height="50" fill="#d6d3d1" />

        {/* Map pin */}
        {scene.hasMapPin ? (
          <g className="builder-scene-pin" transform="translate(320, 180)">
            <path d="M0 -28 C14 -28 24 -16 24 0 C24 18 0 40 0 40 C0 40 -24 18 -24 0 C-24 -16 -14 -28 0 -28 Z" fill="#ea580c" />
            <circle cx="0" cy="0" r="8" fill="#fff" />
            {scene.districtName ? (
              <text x="0" y="56" textAnchor="middle" fontSize="9" fontWeight="700" fill="#44403c">
                {scene.districtName.length > 14 ? `${scene.districtName.slice(0, 12)}…` : scene.districtName}
              </text>
            ) : null}
          </g>
        ) : null}

        {/* Building shell */}
        {scene.hasBuilding ? (
          <g filter="url(#bb-soft-shadow)">
            <rect x="72" y="100" width="256" height="130" rx="6" fill="#fef3c7" stroke="#d6d3d1" strokeWidth="2" />
            <rect x="88" y="118" width="224" height="96" rx="4" fill={lightsOn ? "#fffbeb" : "#e7e5e4"} className="builder-scene-interior" />
            {/* Awning */}
            <path d="M60 100 L340 100 L328 128 L72 128 Z" fill="url(#bb-awning)" />
            <rect x="72" y="128" width="256" height="8" fill="#b45309" opacity="0.3" />
          </g>
        ) : (
          <g opacity="0.5">
            <rect x="120" y="160" width="160" height="8" rx="4" fill="#a8a29e" />
            <text x="200" y="150" textAnchor="middle" fontSize="11" fill="#78716c" fontWeight="600">
              {t(lang, "builderEmptyLand")}
            </text>
          </g>
        )}

        {/* Interior variant */}
        {scene.hasBuilding ? <InteriorVariant variant={variant} hasShelves={scene.hasShelves || Boolean(scene.businessType)} hasProducts={scene.hasProducts} productCount={scene.productCount} sellingStyle={scene.sellingStyle} /> : null}

        {/* Counter */}
        {scene.hasBuilding ? (
          <g className={spotlightClass("counter", spotlight)}>
            <rect x="100" y="168" width="200" height="28" rx="4" fill="#92400e" />
            <rect x="108" y="172" width="184" height="6" rx="2" fill="#b45309" opacity="0.5" />
          </g>
        ) : null}

        {/* POS terminal */}
        {scene.hasBuilding ? (
          <g className={spotlightClass("counter", spotlight)}>
            <rect x="248" y="148" width="36" height="28" rx="3" fill="#374151" />
            <rect x="252" y="152" width="28" height="14" rx="1" fill="#4ade80" opacity="0.85" />
          </g>
        ) : null}

        {/* Receipt printer */}
        {scene.hasPrinter || scene.hasProducts ? (
          <g className={clsx("builder-scene-printer", spotlightClass("printer", spotlight))}>
            <rect x="290" y="156" width="22" height="18" rx="2" fill="#6b7280" />
            <rect className="builder-receipt-strip" x="294" y="140" width="14" height="20" rx="1" fill="#fff" />
          </g>
        ) : null}

        {/* Owner */}
        {scene.hasOwner ? (
          <g className={spotlightClass("owner", spotlight)}>
            <circle cx="168" cy="148" r="14" fill="#fcd9b6" />
            <path d="M150 162 h36 c3 0 6 12 6 20 H144 c0-8 3-20 6-20z" fill="url(#bb-orange)" />
            <rect x="158" y="168" width="20" height="4" rx="1" fill="#fff" opacity="0.8" />
          </g>
        ) : null}

        {/* Phone */}
        {scene.hasPhone ? (
          <g transform="translate(210, 158)">
            <rect x="0" y="0" width="18" height="28" rx="3" fill="#1f2937" />
            <rect x="3" y="4" width="12" height="18" rx="1" fill="#38bdf8" opacity="0.7" />
          </g>
        ) : null}

        {/* Mailbox */}
        {scene.hasMailbox ? (
          <g transform="translate(48, 175)" className={scene.mailboxOpen ? "builder-mailbox-open" : ""}>
            <rect x="0" y="12" width="28" height="22" rx="2" fill="#1d4ed8" />
            <path d="M0 12 L14 0 L28 12" fill="#2563eb" />
            {scene.emailPending ? (
              <g className="builder-envelope">
                <rect x="6" y="4" width="16" height="12" rx="1" fill="#fff" stroke="#d1d5db" />
                <path d="M6 4 L14 11 L22 4" fill="none" stroke="#9ca3af" strokeWidth="1" />
              </g>
            ) : null}
          </g>
        ) : null}

        {/* Door + lock */}
        {scene.hasBuilding ? (
          <g transform="translate(300, 130)">
            <rect x="0" y="0" width="28" height="68" rx="2" fill="#a8a29e" stroke="#78716c" />
            <circle cx="22" cy="36" r="3" fill={scene.isLocked ? "#fbbf24" : "#d6d3d1"} />
            {scene.isLocked ? (
              <path d="M18 28 h8 v10 h-8 z M20 28 v-4 a4 4 0 0 1 8 0 v4" fill="none" stroke="#f59e0b" strokeWidth="2" />
            ) : null}
          </g>
        ) : null}

        {/* Store sign */}
        {scene.hasSign ? (
          <g className={spotlightClass("sign", spotlight)} filter="url(#bb-soft-shadow)">
            <rect x="88" y="72" width="224" height="36" rx="8" fill="#1c1917" />
            <text x="200" y="88" textAnchor="middle" fontSize="10" fontWeight="800" fill="#fff">
              {truncate(signText, 22)}
            </text>
            <text x="200" y="100" textAnchor="middle" fontSize="7" fontWeight="600" fill="#fb923c">
              Powered by Waka POS
            </text>
          </g>
        ) : null}

        {/* Referral handshake */}
        {scene.hasReferral ? (
          <g transform="translate(36, 140)" className="builder-handshake">
            <circle cx="12" cy="12" r="10" fill="#fcd9b6" />
            <circle cx="32" cy="12" r="10" fill="#fcd9b6" />
            <path d="M8 22 Q20 16 32 22" fill="none" stroke="#ea580c" strokeWidth="3" strokeLinecap="round" />
          </g>
        ) : null}

        {/* Staff */}
        {scene.hasStaff ? (
          <g transform="translate(130, 152)" opacity="0.85">
            <circle cx="0" cy="0" r="8" fill="#fcd9b6" />
            <circle cx="24" cy="4" r="8" fill="#fcd9b6" />
          </g>
        ) : null}

        {/* Waka badge */}
        {scene.hasWakaBadge ? (
          <g transform="translate(330, 88)">
            <circle cx="0" cy="0" r="16" fill="url(#bb-orange)" />
            <text x="0" y="4" textAnchor="middle" fontSize="10" fontWeight="900" fill="#fff">
              W
            </text>
          </g>
        ) : null}

        {/* Cloud sync */}
        {scene.hasCloudSync ? (
          <g className={spotlightClass("cloud", spotlight)} transform="translate(350, 48)">
            <ellipse cx="0" cy="8" rx="14" ry="10" fill="#fff" stroke="#38bdf8" strokeWidth="2" />
            <ellipse cx="-10" cy="12" rx="10" ry="8" fill="#fff" stroke="#38bdf8" strokeWidth="2" />
            <ellipse cx="10" cy="12" rx="10" ry="8" fill="#fff" stroke="#38bdf8" strokeWidth="2" />
          </g>
        ) : null}

        {/* AI assistant */}
        {scene.hasAiAssistant ? (
          <g transform="translate(118, 128)">
            <circle cx="0" cy="0" r="10" fill="#8b5cf6" opacity="0.9" />
            <text x="0" y="4" textAnchor="middle" fontSize="8" fill="#fff">
              AI
            </text>
          </g>
        ) : null}

        {/* OPEN sign */}
        {scene.isOpen ? (
          <g transform="translate(48, 118)" className="builder-open-sign">
            <rect x="0" y="0" width="52" height="28" rx="4" fill="#15803d" stroke="#14532d" strokeWidth="2" />
            <text x="26" y="18" textAnchor="middle" fontSize="9" fontWeight="900" fill="#fff">
              OPEN
            </text>
          </g>
        ) : null}

        {/* Opening soon banner */}
        {openingSoon && !scene.isOpen ? (
          <g transform="translate(120, 108)">
            <rect x="0" y="0" width="160" height="24" rx="12" fill="#1c1917" opacity="0.85" />
            <text x="80" y="16" textAnchor="middle" fontSize="10" fontWeight="700" fill="#fbbf24">
              {t(lang, "builderOpeningSoon")}
            </text>
          </g>
        ) : null}

        {/* Interior lights glow */}
        {lightsOn ? (
          <rect x="88" y="118" width="224" height="96" rx="4" fill="#fef08a" opacity="0.15" className="builder-lights-glow" />
        ) : null}

        {/* Grand opening customer */}
        {scene.isOpen && scene.grandOpeningPlayed ? (
          <g className="builder-customer-walk" transform="translate(340, 200)">
            <circle cx="0" cy="0" r="10" fill="#fcd9b6" />
            <path d="M-12 14 h24 c2 0 4 10 4 16 H-16 c0-6 2-16 4-16z" fill="#22c55e" />
          </g>
        ) : null}
      </svg>

      {scene.emailPending ? (
        <p className="absolute bottom-2 left-2 right-2 rounded-xl bg-white/90 px-2 py-1.5 text-center text-[10px] font-semibold text-muted-foreground backdrop-blur-sm">
          {t(lang, "builderEmailWaiting")}
        </p>
      ) : null}
    </div>
  );
}

function spotlightClass(zone: BuilderSpotlightZone, active: BuilderSpotlightZone | null): string {
  return active === zone ? "builder-spotlight-active" : "";
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function InteriorVariant({
  variant,
  hasShelves,
  hasProducts,
  productCount,
  sellingStyle,
}: {
  variant: string;
  hasShelves: boolean;
  hasProducts: boolean;
  productCount: number;
  sellingStyle: string | null;
}) {
  if (!hasShelves && !hasProducts) return null;

  const fillLevel = Math.min(productCount || (hasProducts ? 6 : 0), 12);

  if (variant === "hospitality") {
    return (
      <g>
        <rect x="108" y="138" width="40" height="24" rx="2" fill="#78350f" />
        <rect x="156" y="138" width="40" height="24" rx="2" fill="#78350f" />
        <circle cx="200" cy="150" r="8" fill="#fcd9b6" opacity="0.6" />
      </g>
    );
  }

  if (variant === "pharmacy") {
    return (
      <g>
        {[0, 1, 2].map((i) => (
          <rect key={i} x={108 + i * 36} y="128" width="28" height="40" rx="2" fill="#dbeafe" stroke="#93c5fd" />
        ))}
        {hasProducts ? (
          <rect x="200" y="132" width="48" height="32" rx="3" fill="#fff" stroke="#d1d5db" />
        ) : null}
      </g>
    );
  }

  if (variant === "hardware") {
    return (
      <g>
        <rect x="108" y="130" width="60" height="8" rx="2" fill="#9ca3af" />
        <rect x="108" y="144" width="40" height="24" rx="2" fill="#f97316" opacity="0.7" />
        <rect x="156" y="148" width="32" height="20" rx="2" fill="#6b7280" />
      </g>
    );
  }

  if (variant === "wholesale" || sellingStyle === "carton" || sellingStyle === "sack") {
    return (
      <g>
        {[0, 1, 2, 3].map((i) => (
          <rect
            key={i}
            x={108 + (i % 2) * 44}
            y={128 + Math.floor(i / 2) * 28}
            width="36"
            height="24"
            rx="2"
            fill="#c4a574"
            stroke="#a16207"
            strokeWidth="1"
          />
        ))}
      </g>
    );
  }

  return (
    <g className="builder-scene-shelves">
      <rect x="108" y="128" width="80" height="48" rx="3" fill="#d6d3d1" opacity="0.5" />
      <line x1="108" y1="144" x2="188" y2="144" stroke="#a8a29e" />
      <line x1="108" y1="160" x2="188" y2="160" stroke="#a8a29e" />
      {hasProducts
        ? Array.from({ length: Math.min(fillLevel, 8) }, (_, i) => (
            <rect
              key={i}
              x={114 + (i % 4) * 18}
              y={i < 4 ? 132 : 148}
              width="12"
              height="10"
              rx="1"
              fill={["#f97316", "#22c55e", "#3b82f6", "#eab308"][i % 4]}
            />
          ))
        : null}
    </g>
  );
}
