import clsx from "clsx";
import type { CSSProperties, ReactNode } from "react";
import { useKeyboardInset } from "../../hooks/useKeyboardInset";
import { combinedBottomInsetStyle } from "../../lib/safeAreaInsets";

type Props = {
  children: ReactNode;
  className?: string;
};

/** Adds extra bottom padding when the keyboard is open so inputs and actions stay visible. */
export function KeyboardSafePage({ children, className }: Props) {
  const keyboardInset = useKeyboardInset();
  const bottomPad = combinedBottomInsetStyle(keyboardInset);
  const style: CSSProperties | undefined = bottomPad ? { paddingBottom: bottomPad } : undefined;

  return (
    <div className={clsx(className)} style={style}>
      {children}
    </div>
  );
}
