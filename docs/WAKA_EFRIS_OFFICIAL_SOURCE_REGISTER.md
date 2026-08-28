# WAKA EFRIS — Official Source Register

**Date:** 2026-08-28  
**Phase:** 2A (update)  
**Mode:** DOCUMENTATION ONLY

This register lists official URA materials received by WAKA and which requirements may be cited from each. It is not an API specification and is not a claim of EFRIS compliance or accreditation.

Classification used in Phase 2A:

| Class | Meaning |
|-------|---------|
| **CONFIRMED BY OFFICIAL HANDBOOK** | Stated in an official URA taxpayer handbook on file |
| **REQUIRES OFFICIAL S2S TECHNICAL SPECIFICATION** | Not provided by the handbook; do not implement from guesswork |

---

## Primary official source (on file)

| Field | Value |
|-------|--------|
| ID | `URA-HB-FY2026-27` |
| Title | EFRIS HANDBOOK — Vol.1 Issue 2 FY2026–2027 |
| File | `EFRIS-HANDBOOK-FY-2026-27.pdf` |
| Issuer | Uganda Revenue Authority (URA) |
| Type | Official URA taxpayer handbook |
| Received | 2026-08-28 |
| Status | **Accepted** as official business-rule source |
| Not | S2S API technical specification |

The handbook itself states (disclaimer, p. 11): the information is for guidance and is subject to change on amendment of tax legislation and other regulations.

### Requirements confirmed from this handbook

Cited in `docs/WAKA_EFRIS_URA_CONTRACT.md` and `docs/WAKA_EFRIS_FIELD_MAPPING.md`.

| # | Requirement | Handbook location |
|---|-------------|-------------------|
| 1 | EFRIS is mandatory for VAT-registered taxpayers and designated economic sectors | Q2; Fact Checker Q2 |
| 2 | Non-VAT taxpayers and non-designated sectors may voluntarily use EFRIS | Q2 closing paragraph |
| 3 | Twelve designated economic sectors are listed (with two stated exclusions) | Q2 sector table |
| 4 | System-to-System is an option for computerized accounting systems including POS/ERP | Q7 platform table |
| 5 | EFRIS supports e-invoices and e-receipts | Q7, Q9–Q11 |
| 6 | VAT-registered taxpayers issue e-invoices | Q10 |
| 7 | Non-VAT taxpayers issue e-receipts | Q11 |
| 8 | Electronic documents include FDN, verification code, and QR code | Q9 |
| 9 | e-credit notes and e-debit notes are supported | Q9, Q12, Q13; Part III myth/fact on returns |
| 10 | Businesses configure products from the EFRIS product list and map them to their own codes and names | Q26 |
| 11 | Products not on the list may use the “Others” code; taxpayers may write to URA to add items | Q27 |
| 12 | EFRIS supports offline operation | Q8; Fact Checker Q3 |
| 13 | Offline transactions must be uploaded when internet returns, within 5 days | Q8; Fact Checker Q3 |
| 14 | Offline module applies to all listed platforms except the web portal; Fact Checker explicitly includes system-to-system | Q8; Fact Checker Q3 |
| 15 | Manual/unfiscalized documents only in stated exceptions; upload within 24 hours | Q22 |
| 16 | URA IT assists taxpayer IT teams for S2S via the official support process | Q19 (`https://touchpoint.ura.go.ug`) |
| 17 | The taxpayer bears the cost of system-to-system integration | Q20 |

Related handbook facts used as supporting context (same file, not API fields):

| Fact | Handbook location |
|------|-------------------|
| TIN required to register for EFRIS | Q5 |
| Legal basis: Tax Procedures Code Act Cap 343, ss. 92 and 93 | Q14 |
| Credit note: seller cancels or adjusts a previous sale downwards | Q12 |
| Debit note: seller increases a previous sale (understated value, quantity, or tax) | Q13 |
| Stock-in of configured goods (imports, manufactured, local purchases) | Q26 |
| Foreign currency allowed; URA converts at its set rate for tax purposes | Q25 |
| e-invoice / e-receipt generated only when a sale has occurred | Part III |
| Corrections via cancellation or debit/credit notes | Part III |
| Portal registration uses TIN, password, OTP | Q6 |
| EFD support: Rank Consult (accredited for EFD issuance) | Q19 |
| Maximum documented offline period = 5 days | Q8; Fact Checker Q3 |

### Explicitly not confirmed by this handbook

Still **REQUIRES OFFICIAL S2S TECHNICAL SPECIFICATION** (and credentials / URA process documents as applicable):

- S2S API URL, sandbox endpoint, production endpoint
- Authentication, credentials, token lifecycle, headers, API version
- Request schema, response schema
- Item API fields, tax codes, commodity codes, unit codes, payment codes
- Exact FDN response structure, exact QR response structure
- Error codes, retry rules, rate limits
- Exact S2S offline technical mechanism, offline numbering, synchronization protocol, duplicate handling
- Sandbox credentials, UAT process, production certification process
- Software-integrator accreditation process
- Whether WAKA may complete/print locally then fiscalize asynchronously, or must fiscalize before complete/print

---

## Other URA public materials (earlier intake; superseded where they conflict)

These were reviewed in the first Phase 2A pass. Where they conflict with `URA-HB-FY2026-27`, the FY2026–2027 handbook on file wins.

| ID | Source | Role after this update |
|----|--------|------------------------|
| URA-HB | [EFRIS Handbook web page](https://ura.go.ug/en/efris-handbook/) | Older public FAQ. Do not prefer over `URA-HB-FY2026-27` (e.g. legal section numbers, debit-note issuer). |
| URA-HB-PDF | [THE EFRIS HANDBOOK 2024-25 PDF](https://ura.go.ug/storage/2025/01/THE-EFRIS-HANDBOOK-2024-25-2.pdf) | Prior-year public PDF. Same rule. |
| URA-BR | [EFRIS Brochure](https://ura.go.ug/en/efris-brochure-23-24/) | Public brochure. VPN listed there is **not** confirmed by `URA-HB-FY2026-27`. Treat VPN as **REQUIRES OFFICIAL S2S TECHNICAL SPECIFICATION**. |
| URA-HOME | [EFRIS page](https://ura.go.ug/en/efris/) | Public overview. Touchpoint URL is also in `URA-HB-FY2026-27` Q19. |

## Not accepted as source of truth

- Unofficial Scribd / third-party “S2S API” copies
- Integrator blogs or commercial API rewrites
- Invented placeholders in WAKA code

## WAKA architecture sources (not URA law)

| ID | Path | Role |
|----|------|------|
| WAKA-P0 | `docs/WAKA_EFRIS_PHASE_0_ARCHITECTURE.md` | Optional, shop-scoped EFRIS boundary |
| WAKA-P1 | `docs/WAKA_EFRIS_PHASE_1_IMPLEMENTATION.md` | Outbox + fail-closed `efris-submit` |

---

## Blocking next official source

| Item | Status |
|------|--------|
| Official S2S API technical specification | **NOT RECEIVED** |
| Sandbox / production credentials | **NOT RECEIVED** |
| Software-integrator accreditation pack | **NOT RECEIVED** |

Until those arrive, WAKA must not implement the URA API.
