import { memo, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { Customer, Language } from "../../types";
import type { CreditActivityIndex } from "../../lib/customerDebtActivity";
import { DebtCustomerCard } from "./DebtCustomerCard";

const ROW_ESTIMATE = 132;
const BOTTOM_SCROLL_GUTTER = 24;

type Props = {
  lang: Language;
  customers: Customer[];
  creditIndex: CreditActivityIndex;
  canDebt: boolean;
  onOpenDetail: (customer: Customer) => void;
  onReceive: (customer: Customer) => void;
};

function VirtualizedCustomerDebtListInner({
  lang,
  customers,
  creditIndex,
  canDebt,
  onOpenDetail,
  onReceive,
}: Props) {
  const parentRef = useRef<HTMLDivElement>(null);

  const rowVirtualizer = useVirtualizer({
    count: customers.length,
    getScrollElement: () =>
      parentRef.current?.closest<HTMLElement>(".scroll-main-chrome") ??
      document.querySelector<HTMLElement>(".scroll-main-chrome") ??
      parentRef.current,
    estimateSize: () => ROW_ESTIMATE,
    overscan: 6,
  });

  if (customers.length <= 12) {
    return (
      <div className="space-y-2">
        {customers.map((customer) => (
          <DebtCustomerCard
            key={customer.id}
            lang={lang}
            customer={customer}
            creditIndex={creditIndex}
            canDebt={canDebt}
            onOpenDetail={() => onOpenDetail(customer)}
            onReceive={() => onReceive(customer)}
          />
        ))}
      </div>
    );
  }

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
              className="absolute left-0 top-0 w-full pb-2"
              style={{
                transform: `translateY(${virtualRow.start}px)`,
                height: `${virtualRow.size}px`,
              }}
            >
              <DebtCustomerCard
                lang={lang}
                customer={customer}
                creditIndex={creditIndex}
                canDebt={canDebt}
                onOpenDetail={() => onOpenDetail(customer)}
                onReceive={() => onReceive(customer)}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

export const VirtualizedCustomerDebtList = memo(VirtualizedCustomerDebtListInner);
