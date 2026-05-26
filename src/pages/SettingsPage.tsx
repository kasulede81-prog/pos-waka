import { Navigate, useSearchParams } from "react-router-dom";
import type { Language } from "../types";
import { SettingsHubPage } from "./SettingsHubPage";

/** Legacy entry; App routes use SettingsHubPage. Handles onboard deep-link. */
export function SettingsPage({ lang }: { lang: Language }) {
  const [searchParams] = useSearchParams();
  if (searchParams.get("onboard") === "1") {
    return <Navigate to="/settings/shop?onboard=1" replace />;
  }
  return <SettingsHubPage lang={lang} />;
}
