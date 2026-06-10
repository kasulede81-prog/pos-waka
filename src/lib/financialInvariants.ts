/**
 * Automated financial invariant checks for tests and integrity diagnostics.
 */

import type { CashExpense, Customer, DebtPayment, Product, Purchase, ReturnRecord, Sale, Supplier, SupplierPayment } from "../types";
import { dateKeyKampala, saleReportingDayKey } from "./datesUg";
import { getDrawerCashForDayInput } from "./cashReconciliation";
import { externalReturnRefundsUgx } from "./canonicalRevenue";
import { computeExpectedCustomerDebt } from "./customerDebt";
import { getCompletedFinancials, revenueSales } from "./financialMetrics";
import { isCompletedSale } from "./saleStatus";
import { reconcileSuppliersFromPurchaseHistory } from "./purchaseRecovery";

export type InvariantViolation = {
  code: string;
  message: string;
  expected?: number;
  actual?: number;
};

export type FinancialInvariantReport = {
  ok: boolean;
  violations: InvariantViolation[];
};

export function verifyFinancialInvariants(input: {
  sales: Sale[];
  returns: ReturnRecord[];
  products: Product[];
  debtPayments: DebtPayment[];
  cashExpenses: CashExpense[];
  customers: Customer[];
  suppliers?: Supplier[];
  purchases?: Purchase[];
  supplierPayments?: SupplierPayment[];
  day?: string;
}): FinancialInvariantReport {
  const violations: InvariantViolation[] = [];
  const day = input.day ?? dateKeyKampala(new Date());

  const scoped = revenueSales(input.sales).filter((s) => saleReportingDayKey(s) === day);

  const returnScoped = input.returns.filter((r) => dateKeyKampala(r.createdAt) === day);
  const fin = getCompletedFinancials(input.sales, input.returns, input.products, { day });
  const externalRefunds = externalReturnRefundsUgx(scoped, returnScoped);
  const cashPlusDebt = fin.cashCollectedUgx + fin.debtIssuedUgx;
  const revenueExpected = cashPlusDebt - externalRefunds;

  if (fin.revenueUgx !== revenueExpected) {
    violations.push({
      code: "revenue_cash_debt",
      message: "Revenue must equal cash collected + debt issued − external return refunds",
      expected: revenueExpected,
      actual: fin.revenueUgx,
    });
  }

  for (const s of scoped) {
    const t = Math.max(0, s.totalUgx);
    const parts = Math.max(0, s.cashPaidUgx) + Math.max(0, s.debtUgx);
    if (t !== parts) {
      violations.push({
        code: "sale_total_split",
        message: `Sale ${s.id}: totalUgx must equal cashPaidUgx + debtUgx`,
        expected: parts,
        actual: t,
      });
    }
  }

  for (const c of input.customers) {
    const expected = computeExpectedCustomerDebt(c.id, input.sales, input.debtPayments);
    if (c.debtBalanceUgx !== expected) {
      violations.push({
        code: "customer_debt_balance",
        message: `Customer ${c.id}: balance mismatch`,
        expected,
        actual: c.debtBalanceUgx,
      });
    }
    if (c.debtBalanceUgx < 0) {
      violations.push({
        code: "customer_debt_negative",
        message: `Customer ${c.id}: negative balance`,
        actual: c.debtBalanceUgx,
      });
    }
  }

  const drawer = getDrawerCashForDayInput({
    sales: input.sales,
    returns: input.returns,
    products: input.products,
    debtPayments: input.debtPayments,
    cashExpenses: input.cashExpenses,
    supplierPayments: input.supplierPayments ?? [],
    day,
  });

  const debtPayDay = input.debtPayments
    .filter((p) => dateKeyKampala(p.createdAt) === day)
    .reduce((a, p) => a + Math.max(0, p.amountUgx), 0);
  const refundsDay = returnScoped.reduce((a, r) => a + Math.max(0, r.refundAmountUgx), 0);
  const expensesDay = input.cashExpenses
    .filter((e) => !e.deletedAt && e.paidOn === day)
    .reduce((a, e) => a + Math.max(0, e.amountUgx), 0);
  const supplierPayDay = (input.supplierPayments ?? [])
    .filter((p) => dateKeyKampala(p.createdAt) === day)
    .reduce((a, p) => a + Math.max(0, p.amountUgx), 0);

  const expectedCash = Math.max(
    0,
    fin.cashCollectedUgx + debtPayDay - refundsDay - expensesDay - supplierPayDay,
  );

  if (drawer.expectedDrawerCashUgx !== expectedCash) {
    violations.push({
      code: "expected_cash_formula",
      message: "Expected drawer cash formula mismatch",
      expected: expectedCash,
      actual: drawer.expectedDrawerCashUgx,
    });
  }

  if (input.suppliers && input.purchases && input.supplierPayments) {
    const reconciled = reconcileSuppliersFromPurchaseHistory(
      input.suppliers,
      input.purchases,
      input.supplierPayments,
    );
    for (const s of input.suppliers) {
      const r = reconciled.find((x) => x.id === s.id);
      if (!r) continue;
      if (r.balanceOwedUgx < 0) {
        violations.push({
          code: "supplier_balance_negative",
          message: `Supplier ${s.id}: negative balance after reconcile`,
          actual: r.balanceOwedUgx,
        });
      }
    }
  }

  return { ok: violations.length === 0, violations };
}

/** Completed sales only — pending must not affect invariants. */
export function assertPendingExcludedFromRevenue(sales: Sale[]): InvariantViolation[] {
  const pending = sales.filter((s) => !isCompletedSale(s) && s.totalUgx > 0);
  if (pending.length === 0) return [];
  const finAll = getCompletedFinancials(sales, [], []);
  const finPendingOnly = getCompletedFinancials(pending, [], []);
  if (finPendingOnly.revenueUgx > 0) {
    return [
      {
        code: "pending_in_revenue",
        message: "Pending sales must not count toward revenue",
        actual: finPendingOnly.revenueUgx,
      },
    ];
  }
  if (finAll.revenueUgx < 0) {
    return [{ code: "negative_revenue", message: "Revenue cannot be negative", actual: finAll.revenueUgx }];
  }
  return [];
}
