import clsx from "clsx";
import type { ReactNode } from "react";

type Props = {
  header: ReactNode;
  categoryRail: ReactNode;
  quickActions: ReactNode;
  searchBar: ReactNode;
  catalog: ReactNode;
  cart: ReactNode;
  paymentBar: ReactNode;
  statusBar: ReactNode;
  catalogCheckoutDock?: ReactNode;
  onScreenKeyboard?: ReactNode;
  className?: string;
};

/**
 * Electron-only professional POS terminal layout.
 * Presentation shell — business logic stays in PosPage / usePosStore.
 */
export function DesktopPosShell({
  header,
  categoryRail,
  quickActions,
  searchBar,
  catalog,
  cart,
  paymentBar,
  statusBar,
  catalogCheckoutDock,
  onScreenKeyboard,
  className,
}: Props) {
  return (
    <div
      className={clsx("desktop-pos-terminal flex min-h-0 flex-1 flex-col overflow-hidden", className)}
      data-desktop-pos-terminal
    >
      {header}

      <div className="desktop-pos-terminal__body grid min-h-0 flex-1 overflow-hidden">
        <aside className="desktop-pos-terminal__rail flex min-h-0 flex-col border-r border-border bg-muted/40">
          <div className="min-h-0 flex-1 overflow-hidden">{categoryRail}</div>
          <div className="shrink-0 border-t border-border">{quickActions}</div>
        </aside>

        <main className="desktop-pos-terminal__catalog relative flex min-h-0 min-w-0 flex-col overflow-hidden">
          <div className="shrink-0 border-b border-border/80 bg-card/80 px-2 py-1.5">{searchBar}</div>
          <div className="relative min-h-0 flex-1 overflow-hidden">
            <div className="desktop-pos-terminal__catalog-scroll h-full min-h-0 overflow-y-auto overscroll-y-contain p-2">
              {catalog}
            </div>
            {catalogCheckoutDock}
          </div>
        </main>

        <aside className="desktop-pos-terminal__cart min-h-0 min-w-0 border-l border-border bg-waka-50/50">
          {cart}
        </aside>
      </div>

      {paymentBar}
      {onScreenKeyboard}
      {statusBar}
    </div>
  );
}
