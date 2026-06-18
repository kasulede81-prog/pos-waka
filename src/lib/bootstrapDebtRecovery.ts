/**
 * Bootstrap customer debt recovery — ledger-authoritative merge on fresh-device cloud pull.
 */

import type { Customer, DebtPayment, Sale } from "../types";
import { mergeCustomerFromCloudPull } from "./customerDebtReconciliation";

/** Apply ledger reconciliation to cloud customers after bootstrap sales + debt payments hydrate. */
export function reconcileCustomersForBootstrapRecovery(
  remoteCustomers: Customer[],
  sales: Sale[],
  debtPayments: DebtPayment[],
): Customer[] {
  const ledgerAuthoritative = sales.length > 0 || debtPayments.length > 0;
  if (!ledgerAuthoritative) return remoteCustomers;

  return remoteCustomers.map((remote) =>
    mergeCustomerFromCloudPull({ ...remote }, remote, sales, debtPayments, { ledgerAuthoritative: true }),
  );
}
