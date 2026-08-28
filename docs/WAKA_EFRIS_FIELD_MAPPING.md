# WAKA POS — EFRIS Field Mapping, Data Gaps, and Phase 1 Boundary

**Date:** 2026-08-28 (updated same day)  
**Phase:** 2A — Official URA contract intake  
**Mode:** DOCUMENTATION ONLY — mappings are **not implemented**

Primary official source: `URA-HB-FY2026-27` (`EFRIS-HANDBOOK-FY-2026-27.pdf`). Register: `docs/WAKA_EFRIS_OFFICIAL_SOURCE_REGISTER.md`. Contract: `docs/WAKA_EFRIS_URA_CONTRACT.md`.

Handbook facts are **CONFIRMED BY OFFICIAL HANDBOOK**. Wire field names remain **REQUIRES OFFICIAL S2S TECHNICAL SPECIFICATION**.

Placeholder:

```text
UNKNOWN — requires URA confirmation
```

Status values:

| Status | Meaning |
|--------|---------|
| `BLOCKED` | Cannot map until official URA API field exists |
| `CLEAN_CANDIDATE` | WAKA field exists and is independently useful; mapping is plausible once URA names the target |
| `GAP` | Handbook needs this class of data; WAKA has no suitable field |
| `DO_NOT_MAP` | WAKA field must not be treated as URA data |
| `WAKA_ONLY` | Internal plumbing; never sent to URA |
| `PROCESS_CONFIRMED` | Handbook confirms the business process; API identifiers still unknown |

---

## WAKA architecture confirmation

The FY2026–2027 handbook supports optional EFRIS (volunteer use for non-VAT / non-designated taxpayers) and lists System-to-System as the POS/ERP channel. It does **not** require every WAKA shop to enable EFRIS.

```text
WAKA POS
    │
    ├── EFRIS OFF
    │      └── Normal POS
    │
    └── EFRIS ON
           └── S2S integration
```

Unchanged (do not alter):

| Decision | Status |
|----------|--------|
| Optional at WAKA architecture level | Confirmed — keep `enabled` default false |
| Shop-scoped | Confirmed — keep `shop_id`, not org-only |
| Independent of WAKA sale status | Confirmed — `Sale.status` is not EFRIS |
| Behind the existing EFRIS adapter | Confirmed — `efris-submit` stub |
| Credentials server-side | Confirmed — no client secrets |
| Separate from `pendingSync` | Confirmed — independent outbox |

---

## Product mapping (future)

### CONFIRMED BY OFFICIAL HANDBOOK (Q26–Q27)

```text
WAKA product code/name
    → EFRIS product list mapping
    → EFRIS fiscal transaction
```

- Select products from the EFRIS product list.
- Map them to the taxpayer’s own product codes and names.
- Items not on the list may use **“Others”**; the taxpayer may write to URA to add items.

Do **not** invent API fields, commodity codes, unit codes, or identifiers required to perform this mapping. Implementation waits for the official S2S technical specification.

WAKA `Product.sku` / `Product.name` are **CLEAN_CANDIDATE** local keys for that mapping. `Product.category` remains WAKA shelf identity (`DO_NOT_MAP`).

---

## Offline architecture

### CONFIRMED BY OFFICIAL HANDBOOK

```text
Maximum documented offline period = 5 days
```

Q8 and Fact Checker Q3: issue e-invoices/e-receipts offline; upload when internet returns within 5 days. Q8: offline module works for all platforms except the web portal. Fact Checker Q3 explicitly includes **system to system**.

The handbook establishes the five-day **business rule** but does **not** provide the technical S2S offline implementation contract.

Therefore: **DO NOT implement offline EFRIS logic yet.**

Still unknown: offline numbering, sync protocol, duplicate handling, local fiscalization mechanism. **REQUIRES OFFICIAL S2S TECHNICAL SPECIFICATION.**

---

## Receipt workflow question

The handbook confirms e-invoices/e-receipts and offline operation. It does **not** state whether S2S may:

```text
complete local sale → print → asynchronously fiscalize
```

or must:

```text
fiscalize → receive fiscal response → complete/print
```

**REQUIRES OFFICIAL S2S TECHNICAL/URA CONFIRMATION**

Do not change `finalizeDraftSale` ordering from this handbook. Keep the Phase 1 sibling outbox until the S2S spec (or URA) answers.

---

## Mapping table

Do **not** implement transformations. `Transformation` is a note, not code.

### Shop / taxpayer

| WAKA Field | URA Field | Required? | Transformation | Source | Status |
|---|---|---|---|---|---|
| `shop_efris_config.enabled` | none — WAKA gate | n/a | If false, no EFRIS work | Phase 1 | `WAKA_ONLY` |
| `shop_efris_config.connection_status` | none — WAKA status | n/a | Do not send to URA | Phase 1 | `WAKA_ONLY` |
| `shops.id` | UNKNOWN — requires URA confirmation | UNKNOWN — requires URA confirmation | Shop is WAKA tenant key | `003_organizations_and_shops.sql` | `BLOCKED` |
| `shops.name` | UNKNOWN — requires URA confirmation (seller details?) | UNKNOWN — requires URA confirmation | None until URA names the field | Q10–Q11; `003_organizations_and_shops.sql` | `BLOCKED` |
| `shops.address_line`, `city`, `district` | UNKNOWN — requires URA confirmation | UNKNOWN — requires URA confirmation | None | `003_organizations_and_shops.sql` | `BLOCKED` |
| `shops.phone_e164` | UNKNOWN — requires URA confirmation | UNKNOWN — requires URA confirmation | None | `003_organizations_and_shops.sql` | `BLOCKED` |
| `organizations.tin` | UNKNOWN — requires URA confirmation | UNKNOWN — requires URA confirmation | **Do not** treat as EFRIS enrollment. Org-scoped. | `003_organizations_and_shops.sql`; Phase 0 | `DO_NOT_MAP` |
| `organizations.legal_name` | UNKNOWN — requires URA confirmation | UNKNOWN — requires URA confirmation | Same caution as org TIN | `003_organizations_and_shops.sql` | `DO_NOT_MAP` |
| `ReceiptHeaderConfig.tin` | none | n/a | Print branding only | `src/types.ts`; Phase 0 | `DO_NOT_MAP` |
| *(missing)* seller EFRIS TIN / device id | UNKNOWN — requires URA confirmation | UNKNOWN — requires URA confirmation | Future config identifier + server secrets. Handbook: TIN required to register (Q5) | Q5; Phase 0 J.1–J.2 | `GAP` |
| *(missing)* VAT-registered vs non-VAT | UNKNOWN — requires URA confirmation | UNKNOWN — requires URA confirmation | Explicit shop setting when EFRIS on; drives e-invoice vs e-receipt (Q10–Q11). Never infer from hospitality tax | Q10–Q11 | `GAP` |
| *(missing)* designated-sector flag | none in API yet | n/a | Legal mandate fact for the taxpayer; WAKA must not auto-enable from NAICS guesses | Q2 | `WAKA_ONLY` (optional notice later) |

### Product / item

| WAKA Field | URA Field | Required? | Transformation | Source | Status |
|---|---|---|---|---|---|
| `Product.id` | UNKNOWN — requires URA confirmation | UNKNOWN — requires URA confirmation | WAKA UUID is not an EFRIS list code | `src/types.ts` | `CLEAN_CANDIDATE` (local key only) |
| `Product.sku` | UNKNOWN — requires URA confirmation (own product code) | UNKNOWN — requires URA confirmation | Handbook: map EFRIS list → own codes. Field name unknown | Q26; `src/types.ts` | `PROCESS_CONFIRMED` / `BLOCKED` |
| `Product.name` | UNKNOWN — requires URA confirmation (own product name) | UNKNOWN — requires URA confirmation | Same mapping process | Q26; `src/types.ts` | `PROCESS_CONFIRMED` / `BLOCKED` |
| `Product.category` | none | n/a | WAKA shelf, not URA list | Phase 0 | `DO_NOT_MAP` |
| `Product.baseUnit` | UNKNOWN — requires URA confirmation | UNKNOWN — requires URA confirmation | WAKA free-text vs unknown official units | `src/types.ts` | `GAP` until dictionary confirmed |
| `Product.sellingPricePerUnitUgx` | UNKNOWN — requires URA confirmation | UNKNOWN — requires URA confirmation | Tax-inclusive vs exclusive unknown | `src/types.ts` | `BLOCKED` |
| `Product.costPricePerUnitUgx` | none expected | n/a | COGS | `saleFinancialEngine` | `DO_NOT_MAP` unless URA confirms |
| `public.products.tax_rate` | none | n/a | Unused cloud column. **Not** URA VAT | `004_product_catalog_inventory.sql` | `DO_NOT_MAP` |
| *(missing)* EFRIS product list code | UNKNOWN — requires URA confirmation | UNKNOWN — requires URA confirmation | Future `shop_efris_item_mappings`. “Others” allowed (Q27) | Q26–Q27 | `GAP` |
| *(missing)* URA tax category | UNKNOWN — requires URA confirmation | UNKNOWN — requires URA confirmation | Must not copy hospitality tax % | Q10 tax details on e-invoice | `GAP` |
| *(missing)* goods vs service + EFRIS stock-in | UNKNOWN — requires URA confirmation | UNKNOWN — requires URA confirmation | Q26 stock-in for configured products. Do not couple to WAKA `stockOnHand` | Q26 | `GAP` |

### Customer

| WAKA Field | URA Field | Required? | Transformation | Source | Status |
|---|---|---|---|---|---|
| `Customer.id` | UNKNOWN — requires URA confirmation | UNKNOWN — requires URA confirmation | Local id only | `src/types.ts` | `CLEAN_CANDIDATE` |
| `Customer.name` | UNKNOWN — requires URA confirmation (buyer name?) | UNKNOWN — requires URA confirmation | Walk-in sales often have no customer | Q10–Q11; `src/types.ts` | `BLOCKED` |
| `Customer.phone` | UNKNOWN — requires URA confirmation | UNKNOWN — requires URA confirmation | None | `src/types.ts` | `BLOCKED` |
| `Sale.receiptCustomerName` / `receiptCustomerPhone` | UNKNOWN — requires URA confirmation | UNKNOWN — requires URA confirmation | Frozen receipt labels, not tax IDs | `src/types.ts` | `BLOCKED` |
| *(missing)* buyer TIN | UNKNOWN — requires URA confirmation | UNKNOWN — requires URA confirmation | Optional when EFRIS on; never block `EFRIS = OFF` | Q10–Q11 buyer details | `GAP` |
| *(missing)* buyer legal name / address if distinct | UNKNOWN — requires URA confirmation | UNKNOWN — requires URA confirmation | — | Q10–Q11 | `GAP` |

### Sale / transaction

| WAKA Field | URA Field | Required? | Transformation | Source | Status |
|---|---|---|---|---|---|
| `Sale.id` | UNKNOWN — requires URA confirmation | n/a on URA until confirmed | WAKA idempotency; unique `(shop_id, sale_id)` | Phase 1 | `CLEAN_CANDIDATE` (WAKA side) |
| `Sale.status` | none | n/a | Never an EFRIS state | Phase 0/1 | `WAKA_ONLY` |
| `Sale.createdAt` | UNKNOWN — requires URA confirmation | UNKNOWN — requires URA confirmation | Validation UI uses FDN **and date generated** (Q16) — not a confirmed S2S datetime field | Q16; `src/types.ts` | `BLOCKED` |
| `Sale.lines[]` | UNKNOWN — requires URA confirmation | UNKNOWN — requires URA confirmation | Line schema unknown | `src/types.ts` | `BLOCKED` |
| `SaleLine.productId` + `name` | UNKNOWN — requires URA confirmation | UNKNOWN — requires URA confirmation | Needs item mapping when EFRIS on | Q26; `src/types.ts` | `BLOCKED` |
| `SaleLine.quantity` | UNKNOWN — requires URA confirmation | UNKNOWN — requires URA confirmation | Base units | `src/types.ts` | `BLOCKED` |
| `SaleLine.unitPriceUgx` | UNKNOWN — requires URA confirmation | UNKNOWN — requires URA confirmation | — | `src/types.ts` | `BLOCKED` |
| `SaleLine.lineTotalUgx` | UNKNOWN — requires URA confirmation | UNKNOWN — requires URA confirmation | After line discount | `src/types.ts` | `BLOCKED` |
| `SaleLine.discountUgx` / `cartDiscountUgx` / `Sale.discountTotalUgx` | UNKNOWN — requires URA confirmation | UNKNOWN — requires URA confirmation | Discount representation unknown | `src/types.ts` | `BLOCKED` |
| `Sale.subtotalUgx` | UNKNOWN — requires URA confirmation | UNKNOWN — requires URA confirmation | — | `src/types.ts` | `BLOCKED` |
| `Sale.totalUgx` | UNKNOWN — requires URA confirmation | UNKNOWN — requires URA confirmation | — | `src/types.ts` | `BLOCKED` |
| `Sale.taxUgx` | none as URA VAT | n/a | Hospitality **display** tax | `src/types.ts` | `DO_NOT_MAP` |
| `public.sales.tax_ugx` | none as URA VAT | n/a | Cloud column; retail typically 0 | `005_customers_and_sales.sql` | `DO_NOT_MAP` |
| `Sale.paymentMethod` | UNKNOWN — requires URA confirmation | UNKNOWN — requires URA confirmation | Enum: cash, atm, mobile_money, mixed, credit, voucher | `src/types.ts` | `BLOCKED` |
| `Sale.billPayments[]` | UNKNOWN — requires URA confirmation | UNKNOWN — requires URA confirmation | Split tender | `src/types.ts` | `BLOCKED` |
| `Sale.cashPaidUgx` / `debtUgx` / `amountPaidUgx` / `changeGivenUgx` | UNKNOWN — requires URA confirmation | UNKNOWN — requires URA confirmation | — | `src/types.ts` | `BLOCKED` |
| `public.sale_payments.method` | UNKNOWN — requires URA confirmation | UNKNOWN — requires URA confirmation | Cloud enum differs from client | `005_customers_and_sales.sql` | `BLOCKED` |
| `Sale.receiptSeq` | UNKNOWN — requires URA confirmation | UNKNOWN — requires URA confirmation | WAKA day sequence; not FDN | `src/types.ts`; Phase 0 | `DO_NOT_MAP` unless URA allows a local reference |
| `Sale.serviceChargeUgx` / `tipUgx` | UNKNOWN — requires URA confirmation | UNKNOWN — requires URA confirmation | Hospitality extras | `src/types.ts` | `BLOCKED` |
| `organizations.default_currency` (`UGX`) | UNKNOWN — requires URA confirmation | UNKNOWN — requires URA confirmation | Foreign currency allowed (Q25) | Q25 | `BLOCKED` |
| `paymentFutureHooks.taxAuthorityRef` | none | n/a | Must not become sale status | `src/types.ts` | `DO_NOT_MAP` |

### Fiscal response (store after official schema exists)

| WAKA Field | URA Field | Required? | Transformation | Source | Status |
|---|---|---|---|---|---|
| *(missing)* FDN | Fiscal Document Number (existence confirmed) | UNKNOWN — requires URA confirmation | Store after ACCEPTED; overlay print only if URA requires. Structure unknown | Q9 | `PROCESS_CONFIRMED` / `GAP` |
| *(missing)* verification code | Verification code (existence confirmed) | UNKNOWN — requires URA confirmation | Same | Q9 | `PROCESS_CONFIRMED` / `GAP` |
| *(missing)* QR payload | QR code (existence confirmed) | UNKNOWN — requires URA confirmation | Same | Q9 | `PROCESS_CONFIRMED` / `GAP` |
| `shop_efris_submissions.efris_state` | none | n/a | WAKA states | Phase 1 | `WAKA_ONLY` |

### Returns / credit-debit / cancel

| WAKA Field | URA Field | Required? | Transformation | Source | Status |
|---|---|---|---|---|---|
| `ReturnRecord` / `sale_returns` | e-credit note (not equivalent) | UNKNOWN — requires URA confirmation | Stock+money ≠ fiscal credit note. Handbook: seller credit note for downward adjustment/return | Q12; `062_sale_returns.sql` | `GAP` |
| `Sale.saleVoidedAt` / line `voided` | cancel / credit / debit | UNKNOWN — requires URA confirmation | Do not auto-map | Part III; `src/types.ts` | `GAP` |
| *(missing)* e-credit note document | UNKNOWN — requires URA confirmation | UNKNOWN — requires URA confirmation | New outbox type later | Q9, Q12 | `GAP` |
| *(missing)* e-debit note document | UNKNOWN — requires URA confirmation | UNKNOWN — requires URA confirmation | Handbook: **seller** increases a previous sale | Q13 | `GAP` |

---

## WAKA data gaps

Do **not** add these columns in this phase.

| Gap | Why the handbook needs it | Where it should live | Level | Only if EFRIS on? |
|-----|---------------------------|----------------------|-------|-------------------|
| Seller TIN / EFRIS enrollee id | TIN required to register (Q5); seller details on e-documents | `shop_efris_config` non-secret identifier (not org TIN, not receipt branding) | Shop | **Yes** |
| S2S credentials | Not in handbook; required to call S2S when spec exists | Server-only secrets | Shop | **Yes** |
| VAT vs non-VAT mode | e-invoice vs e-receipt (Q10–Q11) | Explicit shop EFRIS setting | Shop | **Yes** |
| EFRIS product-list code + mapping | Q26–Q27 | `shop_efris_item_mappings` | Product (per shop) | **Yes.** Unmapped products must not block WAKA sales |
| Official unit codes | Not in handbook | Mapping row, not required catalog for `EFRIS = OFF` | Product mapping | **Yes** |
| Item tax category | e-invoice has tax details (Q10) | Mapping row. Do not reuse `products.tax_rate` or hospitality % | Product mapping | **Yes** by default |
| EFRIS stock-in | Q26 | Separate EFRIS stock adapter if spec requires it — not WAKA `stockOnHand` | Shop/product EFRIS adapter | **Yes** |
| Buyer TIN | Buyer details on documents (Q10–Q11); exact TIN rule unknown | Optional customer/sale field | Customer / sale | **Yes** if URA requires. Never when EFRIS off |
| FDN, verification code, QR | Q9 | `shop_efris_submissions` after ACCEPTED | Sale / submission | **Yes** |
| Credit/debit note documents | Q9, Q12, Q13 | Sibling outbox; keep `sale_returns` as WAKA | Sale (fiscal sibling) | **Yes** |
| Payment codes | Not in handbook | Mapper if spec includes them | Sale | **Yes** if spec includes them |
| Invoice vs receipt type | Q10–Q11 | Derived from shop VAT mode | Shop → sale mapping | **Yes** |

A shop with `EFRIS = OFF` must not be forced to populate EFRIS-only fields unless independently useful to WAKA.

---

## Preserve optional EFRIS

Invariant: `shop_efris_config.enabled` defaults **false**. Missing row = disabled.

| Rule | Implication |
|------|-------------|
| Non-EFRIS shops | No outbox, no Edge URA call, no required TIN, no product-list codes, no FDN on receipts |
| Catalog / checkout | Product create, customer create, and `finalizeDraftSale` stay valid with today’s fields |
| Future columns | Nullable; UI hidden unless EFRIS enabled **or** independently useful |
| Disable after enable | Stop new enqueues; do not rewrite historical sales |
| Signup / auth | No EFRIS credentials to create a WAKA account |

---

## Phase 1 boundary review

Question: can the official API eventually plug into `efris-submit` **without** changing `saleFinancialEngine`, cart math, payment logic, stock logic, receipt sequence, existing WAKA sync, signup, or authentication?

### What already fits

| Boundary | Verdict |
|----------|---------|
| Hook after local complete | Unchanged fire-and-forget enqueue | Fits **unless** URA later requires fiscalize-before-print (see receipt workflow) |
| Unique `(shop_id, sale_id)` | Outbox idempotency | Fits |
| Fail-closed Edge Function | Replace stub later without POS engine changes | Fits |
| Secrets | Server-side when they exist | Fits |
| `Sale.status` vs `efris_state` | Separate | Fits |

### Genuine tensions (document, do not silently refactor)

| # | Tension | Handbook vs WAKA | Action now |
|---|---------|------------------|------------|
| 1 | Complete/print vs fiscalize order | Handbook does not specify S2S ordering | **REQUIRES OFFICIAL S2S TECHNICAL/URA CONFIRMATION.** Keep sibling outbox. Do not put URA inside cart/financial engines |
| 2 | 5-day offline | Business rule now includes S2S (Fact Checker Q3). Technical contract absent | Record 5-day rule. **Do not implement offline EFRIS logic.** Do not add a till lock from the handbook alone |
| 3 | EFRIS stock-in vs WAKA stock | Q26 is EFRIS stock, not POS `stockOnHand` | Keep inventory engines untouched |
| 4 | Credit notes vs `sale_returns` | Q12/Q13 fiscal documents | Keep WAKA returns; fiscal notes later |
| 5 | VPN | Not in `URA-HB-FY2026-27` | **REQUIRES OFFICIAL S2S TECHNICAL SPECIFICATION.** Do not add VPN config |
| 6 | Hospitality tax vs VAT | e-invoice tax details ≠ `taxUgx` | Keep `DO_NOT_MAP` |
| 7 | Dual numbers | `receiptSeq` vs FDN | Do not replace WAKA receipt sequence |
| 8 | Item mapping missing | Q26 mapping required for EFRIS use | Must not block WAKA sale when EFRIS off |

**No silent refactor.**

---

## Proposed schema changes (not applied)

| Proposal | Purpose | EFRIS-only? |
|----------|---------|-------------|
| `shop_efris_config.ura_identifier` | Masked enrollee TIN / device label | Yes |
| `shop_efris_secrets` | Official credentials when spec exists | Yes |
| `shop_efris_item_mappings` | WAKA sku/name → EFRIS product list | Yes |
| Nullable buyer TIN | If URA requires it | Yes unless independently useful |
| FDN / verification / QR on submissions | After ACCEPTED | Yes |
| `shop_efris_submission_attempts` | Audit retries | Yes |
| Separate credit/debit-note outbox | Do not overload `sale_returns` | Yes |

Do **not** migrate in this phase.

---

## Proposed API flow (not implemented)

Conceptual only. Checkout vs fiscalize order is **REQUIRES OFFICIAL S2S TECHNICAL/URA CONFIRMATION**. Until then, keep the Phase 1 sibling:

```text
1. Cashier completes WAKA sale (unchanged).
2. If enabled, enqueue PENDING for (shop_id, sale_id).
3. efris-submit: refuse unless official provider is configured (currently never).
4. Later: mapping DTO + official S2S call; store FDN on ACCEPTED; WAKA sale unchanged.
5. Overlay FDN/QR on print only if URA requires it after ACCEPTED.
```

Do not implement this client yet.

---

## Security requirements

Unchanged: server-side secrets, shop RLS, manager enablement, no secrets in git/snapshots/logs. Official crypto/auth: **REQUIRES OFFICIAL S2S TECHNICAL SPECIFICATION.**

---

## Accreditation requirements

Handbook: URA IT supports S2S (Touchpoint); taxpayer bears cost; Rank Consult is for **EFDs**. Integrator accreditation process: **REQUIRES OFFICIAL S2S TECHNICAL SPECIFICATION** (or a separate URA process document).

All eight production-readiness gates remain **OPEN**. The taxpayer handbook does not close “official API documentation received.”

---

## Exact next coding step

**STOP. Do not implement the URA API. Do not implement offline EFRIS logic.**

1. Obtain the official S2S technical specification and sandbox credentials.
2. Fill every `UNKNOWN — requires URA confirmation` that the spec answers, with citations.
3. Answer the receipt-workflow question in writing.
4. Only then: a later phase may replace the `efris-submit` fail-closed stub — still without changing POS engines unless an approved architecture amendment says otherwise.

`isOfficialEfrisProviderConfigured()` stays `false`.
