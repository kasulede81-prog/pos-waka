type Props = { cardId: string };

/** Mini SVG storefront variants for business-type cards. */
export function BuilderBusinessTypeArt({ cardId }: Props) {
  return (
    <svg viewBox="0 0 64 48" className="h-12 w-16 shrink-0" aria-hidden>
      <rect x="8" y="28" width="48" height="16" rx="2" fill="#fef3c7" stroke="#d6d3d1" />
      <path d="M6 28 L58 28 L54 18 L10 18 Z" fill="#ef4444" opacity="0.9" />
      {cardId === "retail" || cardId === "boutique" || cardId === "electronics" || cardId === "wholesale" ? (
        <g>
          <rect x="14" y="20" width="8" height="6" rx="1" fill="#f97316" />
          <rect x="26" y="20" width="8" height="6" rx="1" fill="#22c55e" />
          <rect x="38" y="20" width="8" height="6" rx="1" fill="#3b82f6" />
        </g>
      ) : null}
      {cardId === "hospitality" ? (
        <g>
          <rect x="16" y="32" width="14" height="8" rx="1" fill="#78350f" />
          <rect x="34" y="32" width="14" height="8" rx="1" fill="#78350f" />
        </g>
      ) : null}
      {cardId === "pharmacy" ? (
        <g>
          <rect x="28" y="14" width="8" height="20" rx="1" fill="#fff" stroke="#93c5fd" strokeWidth="2" />
          <rect x="24" y="22" width="16" height="4" fill="#3b82f6" />
        </g>
      ) : null}
      {cardId === "hardware" ? (
        <g>
          <rect x="18" y="18" width="28" height="4" rx="1" fill="#6b7280" />
          <rect x="22" y="24" width="8" height="10" rx="1" fill="#f97316" />
        </g>
      ) : null}
    </svg>
  );
}
