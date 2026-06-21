import { memo, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { Customer, Language } from "../../types";
import type { CreditActivityIndex } from "../../lib/customerDebtActivity";
import type { DateFilterBounds } from "../../lib/dateFilters";
import { DebtCustomerRow } from "./DebtCustomerRow";

const ROW_ESTIMATE = 72;
const BOTTOM_SCROLL_GUTTER = 16;

type Props = {
  lang: Language;
  customers: Customer[];
  creditIndex: CreditActivityIndex;
  bounds: DateFilterBounds;
  canDebt: boolean;
  onSubmitPay: (customerId: string, amountUgx: number) => void;
};

function VirtualizedCustomerDebtListInner({
  lang,
  customers,
  creditIndex,
  bounds,
  canDebt,
  onSubmitPay,
}: Props) {
  const parentRef = useRef<HTMLDivElement>(null);

  const rowVirtualizer = useVirtualizer({
    count: customers.length,
    getScrollElement: () =>
      parentRef.current?.closest<HTMLElement>(".scroll-main-chrome") ??
      document.querySelector<HTMLElement>(".scroll-main-chrome") ??
      parentRef.current,
    estimateSize: () => ROW_ESTIMATE,
    overscan: 8,
  });

  return (
    <div ref={parentRef} className="w-full">
      <div
        className="relative w-full"
        style={{ height: `${rowVirtualizer.getTotalSize() + BOTTOM_SCROLL_GUTTER}px` }}
      >
        {rowVirtualizer.getVirtualItems().map((virtualRow) => {
          const customer = customers[virtualRow.index];
          if (!customer) return null;
          return (
            <div
              key={customer.id}
              className="absolute left-0 top-0 w-full"
              style={{
                transform: `translateY(${virtualRow.start}px)`,
                height: `${virtualRow.size}px`,
              }}
            >
              <DebtCustomerRow
                lang={lang}
                customer={customer}
                creditIndex={creditIndex}
                bounds={bounds}
                canDebt={canDebt}
                toneIndex={virtualRow.index}
                onSubmitPay={onSubmitPay}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

export const VirtualizedCustomerDebtList = memo(VirtualizedCustomerDebtListInner);
