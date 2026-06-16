import type { Language } from "../types";
import { DesktopHomePage } from "./DesktopHomePage";

type Props = { lang: Language };

/** Unified terminal launcher on every screen size (responsive grid only). */
export function HomePage({ lang }: Props) {
  return <DesktopHomePage lang={lang} />;
}
