import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { Link } from "react-router-dom";

type Props = { lang: Language };

export function PilotModeBanner({ lang }: Props) {
  return (
    <div className="shrink-0 border-b border-teal-200 bg-teal-50 px-3 py-2 text-center text-xs font-bold text-teal-950">
      {t(lang, "pilotModeBanner")}{" "}
      <Link to="/pilot-support" className="underline underline-offset-2">
        {t(lang, "pilotModeBannerLink")}
      </Link>
    </div>
  );
}
