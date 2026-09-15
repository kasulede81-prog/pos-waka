import { Navigate } from "react-router-dom";
import type { Language } from "../types";
import { DesktopHomePage } from "./DesktopHomePage";
import { usePosStore } from "../store/usePosStore";
import { useSessionActor } from "../context/SessionActorContext";
import { resolveTerminalHomePath } from "../lib/terminalHome";

type Props = { lang: Language };

/** Unified terminal launcher on every screen size (responsive grid only). */
export function HomePage({ lang }: Props) {
  const preferences = usePosStore((s) => s.preferences);
  const actor = useSessionActor();
  const home = resolveTerminalHomePath(preferences, actor.role, actor.permissions);
  if (home !== "/") {
    return <Navigate to={home} replace />;
  }
  return <DesktopHomePage lang={lang} />;
}
