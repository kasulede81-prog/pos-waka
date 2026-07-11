import { useEffect } from "react";

type Handlers = {
  onSelectAll?: () => void;
  onClearSelection?: () => void;
  onArchive?: () => void;
  onFocusSearch?: () => void;
  onExport?: () => void;
  onPrintLabels?: () => void;
  enabled?: boolean;
};

export function useInventoryKeyboardShortcuts(handlers: Handlers) {
  const { enabled = true } = handlers;

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;

    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select" || target?.isContentEditable) {
        if (e.key === "Escape") handlers.onClearSelection?.();
        return;
      }

      const mod = e.ctrlKey || e.metaKey;

      if (mod && e.key.toLowerCase() === "a") {
        e.preventDefault();
        handlers.onSelectAll?.();
        return;
      }
      if (e.key === "Escape") {
        handlers.onClearSelection?.();
        return;
      }
      if (e.key === "Delete") {
        handlers.onArchive?.();
        return;
      }
      if (mod && e.key.toLowerCase() === "f") {
        e.preventDefault();
        handlers.onFocusSearch?.();
        return;
      }
      if (mod && e.shiftKey && e.key.toLowerCase() === "e") {
        e.preventDefault();
        handlers.onExport?.();
        return;
      }
      if (mod && e.key.toLowerCase() === "p") {
        e.preventDefault();
        handlers.onPrintLabels?.();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled, handlers]);
}
