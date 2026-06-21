import { useEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { useVisualViewportInset } from "./useVisualViewportInset";

/**
 * Bottom inset when the on-screen keyboard is open — visual viewport (web/PWA) plus
 * Capacitor Keyboard events on native Android/iOS.
 */
export function useKeyboardInset(): number {
  const viewportInset = useVisualViewportInset();
  const [nativeInset, setNativeInset] = useState(0);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    let showHandle: { remove: () => Promise<void> } | undefined;
    let hideHandle: { remove: () => Promise<void> } | undefined;

    void (async () => {
      try {
        const { Keyboard } = await import("@capacitor/keyboard");
        showHandle = await Keyboard.addListener("keyboardWillShow", (info) => {
          setNativeInset(Math.max(0, Math.round(info.keyboardHeight)));
        });
        hideHandle = await Keyboard.addListener("keyboardWillHide", () => {
          setNativeInset(0);
        });
      } catch {
        /* plugin unavailable */
      }
    })();

    return () => {
      void showHandle?.remove();
      void hideHandle?.remove();
    };
  }, []);

  return Math.max(viewportInset, nativeInset);
}
