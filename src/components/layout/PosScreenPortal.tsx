import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** Full-screen POS overlays (checkout, receipt) — portaled so they sit above the bottom nav. */
export function PosScreenPortal({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted || typeof document === "undefined") return null;
  return createPortal(children, document.body);
}
