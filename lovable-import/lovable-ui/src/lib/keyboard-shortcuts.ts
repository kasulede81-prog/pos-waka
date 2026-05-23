import { useEffect } from "react";
import { useRouter } from "@tanstack/react-router";

const MAP: Record<string, string> = {
  F1: "/sell",
  F2: "/products",
  F3: "/customers",
  F4: "/receipts",
  F5: "/dashboard",
};

export function useKeyboardShortcuts() {
  const router = useRouter();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      const isField = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target?.isContentEditable;
      const path = MAP[e.key];
      if (path && !isField) {
        e.preventDefault();
        void router.navigate({ to: path });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router]);
}
