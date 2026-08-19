import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import type { Language } from "../../../types";
import { t } from "../../../lib/i18n";
import { DesktopPosButton } from "./DesktopPosButton";
import { mapEventToAlphaKey, mapEventToSymbolKey } from "../../../lib/desktopPosKeyHandlers";

export type DesktopKeyboardLayer = "alpha" | "numeric" | "symbols";

type Props = {
  lang: Language;
  visible: boolean;
  onClose: () => void;
  onKey: (key: string) => void;
  initialLayer?: DesktopKeyboardLayer;
  className?: string;
};

const ALPHA_ROWS = [
  ["Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P"],
  ["A", "S", "D", "F", "G", "H", "J", "K", "L"],
  ["Z", "X", "C", "V", "B", "N", "M"],
] as const;

const NUMERIC_ROW = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"] as const;

const SYMBOL_ROWS = [
  ["!", "@", "#", "$", "%", "^", "&", "*", "(", ")"],
  ["-", "_", "+", "=", "[", "]", "{", "}", "\\", "|"],
  [";", ":", "'", '"', ",", ".", "/", "?", "~"],
] as const;

/** Application-level WAKA on-screen keyboard for Electron desktop touch entry. */
export const DesktopOnScreenKeyboard = memo(function DesktopOnScreenKeyboard({
  lang,
  visible,
  onClose,
  onKey,
  initialLayer = "alpha",
  className,
}: Props) {
  const [layer, setLayer] = useState<DesktopKeyboardLayer>(initialLayer);
  const [shift, setShift] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (visible) setLayer(initialLayer);
  }, [visible, initialLayer]);

  const emit = useCallback(
    (key: string) => {
      onKey(key);
      if (shift && key.length === 1 && /[a-zA-Z]/.test(key)) setShift(false);
    },
    [onKey, shift],
  );

  const displayLetter = useCallback(
    (letter: string) => {
      const upper = letter.toUpperCase();
      const useUpper = shift !== capsLock;
      return useUpper ? upper : upper.toLowerCase();
    },
    [shift, capsLock],
  );

  const rows = useMemo(() => {
    if (layer === "numeric") return [NUMERIC_ROW];
    if (layer === "symbols") return SYMBOL_ROWS;
    return ALPHA_ROWS;
  }, [layer]);

  useEffect(() => {
    if (!visible) return;
    const el = rootRef.current;
    if (!el) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (layer === "alpha") {
        const mapped = mapEventToAlphaKey(e, { shift, capsLock });
        if (!mapped) return;
        e.preventDefault();
        if (mapped === "close") onClose();
        else if (mapped === "enter") emit("enter");
        else emit(mapped);
        return;
      }
      const mapped = mapEventToSymbolKey(e);
      if (!mapped) return;
      e.preventDefault();
      if (mapped === "close") onClose();
      else if (mapped === "enter") emit("enter");
      else emit(mapped);
    };

    el.addEventListener("keydown", onKeyDown);
    return () => el.removeEventListener("keydown", onKeyDown);
  }, [capsLock, emit, layer, onClose, shift, visible]);

  if (!visible) return null;

  return (
    <div
      ref={rootRef}
      className={clsx(
        "desktop-pos-osk shrink-0 border-t border-border bg-muted/95 p-2 shadow-[0_-4px_24px_rgba(0,0,0,0.12)] backdrop-blur-sm",
        className,
      )}
      role="group"
      aria-label="On-screen keyboard"
      tabIndex={0}
    >
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <div className="flex gap-1">
          <DesktopPosButton
            size="sm"
            variant={layer === "alpha" ? "primary" : "default"}
            onClick={() => setLayer("alpha")}
          >
            ABC
          </DesktopPosButton>
          <DesktopPosButton
            size="sm"
            variant={layer === "numeric" ? "primary" : "default"}
            onClick={() => setLayer("numeric")}
          >
            123
          </DesktopPosButton>
          <DesktopPosButton
            size="sm"
            variant={layer === "symbols" ? "primary" : "default"}
            onClick={() => setLayer("symbols")}
          >
            #+=
          </DesktopPosButton>
        </div>
        <DesktopPosButton size="sm" variant="default" onClick={onClose} aria-label={t(lang, "posKeypadHide")}>
          {t(lang, "posKeypadHide")}
        </DesktopPosButton>
      </div>

      <div className="space-y-1">
        {rows.map((row, ri) => (
          <div
            key={`row-${ri}`}
            className={clsx("flex justify-center gap-1", layer === "alpha" && ri === 1 && "px-4", layer === "alpha" && ri === 2 && "px-8")}
          >
            {layer === "alpha" && ri === 2 ? (
              <>
                <DesktopPosButton
                  size="md"
                  variant={shift ? "primary" : "default"}
                  className="min-w-[52px]"
                  onClick={() => setShift((v) => !v)}
                  aria-pressed={shift}
                >
                  ⇧
                </DesktopPosButton>
                {row.map((k) => (
                  <DesktopPosButton
                    key={k}
                    size="md"
                    className="min-h-[44px] min-w-[2.25rem] flex-1 text-base font-bold"
                    onClick={() => emit(displayLetter(k))}
                  >
                    {displayLetter(k)}
                  </DesktopPosButton>
                ))}
                <DesktopPosButton size="md" className="min-w-[52px]" onClick={() => emit("back")} aria-label="Backspace">
                  ←
                </DesktopPosButton>
              </>
            ) : (
              row.map((k) => (
                <DesktopPosButton
                  key={k}
                  size="md"
                  className={clsx(
                    "min-h-[44px] font-bold",
                    layer === "numeric" ? "min-w-[2.5rem] flex-1 text-lg" : "min-w-[2rem] flex-1 text-base",
                  )}
                  onClick={() => emit(layer === "alpha" ? displayLetter(k) : k)}
                >
                  {layer === "alpha" ? displayLetter(k) : k}
                </DesktopPosButton>
              ))
            )}
          </div>
        ))}
      </div>

      <div className="mt-1 flex gap-1">
        {layer === "alpha" ? (
          <DesktopPosButton
            size="md"
            variant={capsLock ? "primary" : "default"}
            className="min-w-[3.5rem]"
            onClick={() => setCapsLock((v) => !v)}
            aria-pressed={capsLock}
          >
            Caps
          </DesktopPosButton>
        ) : null}
        <DesktopPosButton size="md" variant="warning" className="min-w-[3rem]" onClick={() => emit("C")}>
          Clear
        </DesktopPosButton>
        <DesktopPosButton size="md" className="min-w-0 flex-[3]" onClick={() => emit("space")}>
          {t(lang, "posKeypadSpace")}
        </DesktopPosButton>
        <DesktopPosButton size="md" variant="success" className="min-w-[3.5rem]" onClick={() => emit("enter")}>
          ↵
        </DesktopPosButton>
      </div>
    </div>
  );
});
