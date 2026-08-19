import { memo, useEffect, useRef } from "react";
import clsx from "clsx";
import { DesktopPosButton } from "./DesktopPosButton";
import { mapEventToNumericKeypad } from "../../../lib/desktopPosKeyHandlers";

type Props = {
  onDigit: (key: string) => void;
  onClear: () => void;
  onEnter?: () => void;
  onEscape?: () => void;
  allowDecimal?: boolean;
  className?: string;
  /** When true, listen for physical keyboard input while focused in container. */
  listenPhysicalKeyboard?: boolean;
};

const ROWS = [
  ["7", "8", "9"],
  ["4", "5", "6"],
  ["1", "2", "3"],
  ["00", "0", "back"],
] as const;

/** Professional POS numeric keypad — calls existing checkout digit handlers. */
export const DesktopNumericKeypad = memo(function DesktopNumericKeypad({
  onDigit,
  onClear,
  onEnter,
  onEscape,
  allowDecimal = false,
  className,
  listenPhysicalKeyboard = true,
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!listenPhysicalKeyboard) return;
    const el = rootRef.current;
    if (!el) return;

    const onKeyDown = (e: KeyboardEvent) => {
      const mapped = mapEventToNumericKeypad(e, allowDecimal);
      if (!mapped) return;
      e.preventDefault();
      if (mapped === "enter") onEnter?.();
      else if (mapped === "C") onClear();
      else onDigit(mapped);
    };

    el.addEventListener("keydown", onKeyDown);
    return () => el.removeEventListener("keydown", onKeyDown);
  }, [allowDecimal, listenPhysicalKeyboard, onClear, onDigit, onEnter]);

  const handleKey = (key: string) => {
    if (key === "back") onDigit("back");
    else onDigit(key);
  };

  return (
    <div
      ref={rootRef}
      className={clsx("desktop-pos-numeric-keypad select-none", className)}
      role="group"
      aria-label="Numeric keypad"
      tabIndex={listenPhysicalKeyboard ? 0 : undefined}
    >
      <div className="grid grid-cols-3 gap-1.5">
        {ROWS.flat().map((key) => (
          <DesktopPosButton
            key={key}
            size="touch"
            variant="default"
            className="desktop-pos-key min-h-[52px] text-xl font-black tabular-nums"
            onClick={() => handleKey(key === "back" ? "back" : key)}
            aria-label={key === "back" ? "Backspace" : key}
          >
            {key === "back" ? "←" : key}
          </DesktopPosButton>
        ))}
      </div>
      <div className="mt-1.5 grid grid-cols-2 gap-1.5">
        <DesktopPosButton
          size="touch"
          variant="warning"
          className="desktop-pos-key text-lg font-black"
          onClick={onClear}
        >
          C
        </DesktopPosButton>
        {onEnter ? (
          <DesktopPosButton size="touch" variant="success" className="desktop-pos-key text-lg font-black" onClick={onEnter}>
            ↵
          </DesktopPosButton>
        ) : (
          <DesktopPosButton
            size="touch"
            variant="default"
            className="desktop-pos-key text-lg font-black"
            onClick={() => onEscape?.()}
            aria-label="Close"
          >
            Esc
          </DesktopPosButton>
        )}
      </div>
    </div>
  );
});
