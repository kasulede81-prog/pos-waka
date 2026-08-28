# WAKA POS — EFRIS Official URA Contract Intake

**Date:** 2026-08-28 (updated same day)  
**Phase:** 2A — Official URA contract intake  
**Mode:** DOCUMENTATION ONLY — no URA API, no payloads, no endpoints, no production configuration, no schema migration

**Primary official source on file:** `EFRIS HANDBOOK — Vol.1 Issue 2 FY2026–2027` (`EFRIS-HANDBOOK-FY-2026-27.pdf`), register ID `URA-HB-FY2026-27`. See `docs/WAKA_EFRIS_OFFICIAL_SOURCE_REGISTER.md`.

This document is a contract intake worksheet. It is **not** an implementation spec, **not** a claim of EFRIS compliance, and **not** URA accreditation.

Related:

- Source register: `docs/WAKA_EFRIS_OFFICIAL_SOURCE_REGISTER.md`
- Field mapping / gaps: `docs/WAKA_EFRIS_FIELD_MAPPING.md`
- Phase 0: `docs/WAKA_EFRIS_PHASE_0_ARCHITECTURE.md`
- Phase 1: `docs/WAKA_EFRIS_PHASE_1_IMPLEMENTATION.md`

---

## Classification

| Class | Meaning |
|-------|---------|
| **CONFIRMED BY OFFICIAL HANDBOOK** | Stated in `URA-HB-FY2026-27` |
| **REQUIRES OFFICIAL S2S TECHNICAL SPECIFICATION** | Absent from the handbook. Do not implement. Do not invent. |

The handbook confirming that System-to-System **exists** does **not** confirm any API URL, auth scheme, payload, or field name.

Placeholder for unconfirmed technical items:

```text
UNKNOWN — requires URA confirmation
```

For workflow questions the handbook does not answer:

```text
REQUIRES OFFICIAL S2S TECHNICAL/URA CONFIRMATION
```

---

## Intake status

| Item | Status |
|------|--------|
| Official taxpayer handbook FY2026–2027 | **Received and reviewed** (`URA-HB-FY2026-27`) |
| Official S2S API technical specification | **NOT RECEIVED** |
| Official sandbox/test credentials | **NOT RECEIVED** |
| Official production credentials | **NOT RECEIVED** |
| Software-integrator accreditation / approval | **NOT RECEIVED** |
| WAKA API implementation | **NOT STARTED** (forbidden in this phase) |

---

## Provider

### CONFIRMED BY OFFICIAL HANDBOOK (`URA-HB-FY2026-27`)

| Item | Value | Location |
|------|--------|----------|
| Authority / product | Uganda Revenue Authority; Electronic Fiscal Receipting and Invoicing Solution (EFRIS) | Q1 |
| What EFRIS is | Smart business solution to record transactions and share them with URA in real time. Not a tax. | Q1; Fact Checker Q1 |
| Who must use EFRIS | All VAT-registered businesses **and** businesses in the 12 designated economic sectors (whether VAT-registered or not) | Q2; Fact Checker Q2 |
| Who may volunteer | Other non-VAT registered taxpayers and non-designated economic sectors | Q2 |
| Designated sectors | 12 sectors listed below | Q2 |
| S2S option | Trader’s sales system integrated with EFRIS via API to generate e-receipts and e-invoices. Suitable for high-volume computerized accounting (e.g. ERP and POS) | Q7 |
| Other channels (not WAKA S2S) | EFRIS App, EFD, Desktop client, URA web portal, EDC (fuel) | Q7 |
| TIN | Required to register for EFRIS | Q5 |
| Legal basis | Tax Procedures Code Act Cap 343, sections 92 and 93 | Q14 |
| Cost of S2S | The taxpayer bears the cost of EFDs, system-to-system integration, or EDCs | Q20 |
| S2S support | URA IT via `https://touchpoint.ura.go.ug`; support to the taxpayer’s IT team during integration | Q19 |

#### Twelve designated economic sectors (Q2)

| # | Sector | Handbook notes |
|---|--------|----------------|
| 1 | Manufacturing | Physical or chemical transformation of materials into new products |
| 2 | Mining and Quarrying | Extraction of minerals |
| 3 | Water supply; sewerage, waste management and remediation activities | Water supply and waste management |
| 4 | Electricity, Gas, Steam and Air Conditioning Supply | Supply through permanent infrastructure |
| 5 | Construction | Buildings and civil engineering, including temporary works |
| 6 | Transportation and storage | Freight and related activities. **Exclusion:** passenger land transport (taxis, boda-bodas, shuttles, buses, other land passenger transport) is **not** mandated in this rollout phase |
| 7 | Accommodation and Food Service Activities | Short-stay accommodation; meals and drinks for immediate consumption |
| 8 | Information Technology and Communication | ICT and information services. **Exclusion:** non-resident digital service providers required to pay digital service tax are **not** mandated |
| 9 | Real Estate Activities | Lessors, agents, brokers, related services |
| 10 | Professional, Scientific and Technical Activities | Specialized professional/scientific/technical activities |
| 11 | Arts, Entertainment and Recreation | Cultural, entertainment, recreation |
| 12 | Wholesale and Retail of Fuel | Fuel stations supplying kerosene and/or automotive fuels (e.g. diesel, petrol) |

WAKA must **not** auto-enroll a shop because it is a retailer. General wholesale/retail (other than fuel) is **not** one of the 12 designated sectors. Mandate depends on VAT registration and/or designated sector — a business/legal fact for the taxpayer, not a WAKA guess.

### REQUIRES OFFICIAL S2S TECHNICAL SPECIFICATION

| Item | Status |
|------|--------|
| S2S API host, paths, version | UNKNOWN — requires URA confirmation |
| Device / taxpayer / branch identifiers on the wire | UNKNOWN — requires URA confirmation |
| Software-integrator accreditation process | UNKNOWN — requires URA confirmation |

WAKA provider flag (architecture, not URA): `isOfficialEfrisProviderConfigured()` remains **false**. Edge Function never calls URA. Source: WAKA-P1.

WAKA is a POS. The taxpayer (shop) is the EFRIS enrollee.

---

## Environments

### CONFIRMED BY OFFICIAL HANDBOOK

| Item | Value | Location |
|------|--------|----------|
| URA web portal (taxpayer UI, not confirmed as S2S API host) | `http://ura.go.ug` / portal login; EFRIS from drop-down | Q6, Q7 |
| Desktop client download page (not S2S) | `https://ura.go.ug/en/efris/efris-login/` under e-invoicing downloads | Q7 |
| Portal eligibility (not S2S) | No billing system, fewer than 100 daily transactions, annual sales below UGX 2 billion | Q7 |

### REQUIRES OFFICIAL S2S TECHNICAL SPECIFICATION

| Environment | URL / host | Status |
|-------------|------------|--------|
| S2S sandbox / test API URL | UNKNOWN — requires URA confirmation | Missing |
| S2S production API URL | UNKNOWN — requires URA confirmation | Missing |
| VPN / private network | Not stated in `URA-HB-FY2026-27`. Treat as unknown | Missing |

WAKA `shop_efris_config` has no URL columns (Phase 1). Do not add URLs until the official technical pack names them.

---

## Authentication

### CONFIRMED BY OFFICIAL HANDBOOK (portal registration only)

| Topic | Value | Location |
|-------|--------|----------|
| Portal login | TIN and password, then OTP to registered email or SMS | Q6 |
| First-time registration | Select e-invoicing or EFDs, additional places of business; submit for approval (VAT path). Non-VAT path has additional registration-type steps | Q6 |

Portal login is **not** confirmed as the S2S API authentication method.

### REQUIRES OFFICIAL S2S TECHNICAL SPECIFICATION

| Topic | Status |
|-------|--------|
| S2S authentication method | UNKNOWN — requires URA confirmation |
| S2S credentials (device id, certificates, keys, etc.) | UNKNOWN — requires URA confirmation |
| Token / session behavior | UNKNOWN — requires URA confirmation |
| Expiry / renewal | UNKNOWN — requires URA confirmation |
| Required headers | UNKNOWN — requires URA confirmation |
| API version | UNKNOWN — requires URA confirmation |

WAKA will store secrets **server-side only** when an official scheme exists (WAKA-P0 / WAKA-P1). Phase 1 stores zero URA credentials.

---

## Item / product

### CONFIRMED BY OFFICIAL HANDBOOK

Process (Q26–Q27), not an API schema:

1. Configure products from the **EFRIS product list**.
2. Map them to the taxpayer’s **own product codes and names**.
3. Stock-in configured products as imports, manufactured goods, or local purchases (TIN or name of the seller indicated).
4. Stock adjustment, inquiry, or transfer between branches may be used.
5. Items not on the list: use the **“Others”** code; the taxpayer may write to URA to add items.

Future WAKA mapping intent (fields unknown):

```text
WAKA product code/name
    → EFRIS product list mapping
    → EFRIS fiscal transaction
```

Do **not** invent commodity codes, unit codes, or item API fields.

### REQUIRES OFFICIAL S2S TECHNICAL SPECIFICATION

| Topic | Status |
|-------|--------|
| Item registration / lookup API | UNKNOWN — requires URA confirmation |
| Item identifier field names | UNKNOWN — requires URA confirmation |
| Commodity codes | UNKNOWN — requires URA confirmation |
| Unit / package-measure codes | UNKNOWN — requires URA confirmation |
| Tax category / tax codes on items | UNKNOWN — requires URA confirmation |
| Required item fields | UNKNOWN — requires URA confirmation |
| Whether S2S enforces EFRIS stock-in before a sale | UNKNOWN — requires URA confirmation |

WAKA today: `Product` has name, SKU, `baseUnit`, prices, shelf `category`. No URA commodity code. Cloud `products.tax_rate` is unused by the POS client and is not an EFRIS tax category.

---

## Customer

### CONFIRMED BY OFFICIAL HANDBOOK

| Topic | Value | Location |
|-------|--------|----------|
| Seller TIN | Required to register for EFRIS | Q5 |
| Document content | e-invoice and e-receipt show seller and buyer details | Q10, Q11 |

### REQUIRES OFFICIAL S2S TECHNICAL SPECIFICATION

| Topic | Status |
|-------|--------|
| Buyer TIN required vs optional (B2C / B2B) | UNKNOWN — requires URA confirmation |
| Customer identifier field list | UNKNOWN — requires URA confirmation |
| Required / optional buyer fields | UNKNOWN — requires URA confirmation |

WAKA `Customer` has name, phone, location, debt. **No TIN.** Receipt-header `tin` is branding, not enrollment.

Do **not** require customer TIN to complete a WAKA sale when `EFRIS = OFF`.

---

## Transaction

### CONFIRMED BY OFFICIAL HANDBOOK

| Topic | Value | Location |
|-------|--------|----------|
| e-invoice | Issued **only** by a person registered for VAT. Shows seller/buyer, goods/services, tax details, summary | Q10 |
| e-receipt | Issued by a taxpayer **not** registered for VAT. Shows seller/buyer, goods/services, summary | Q11 |
| When generated | Only when a sale has occurred | Part III |
| Foreign currency | Allowed; URA converts at its set rate for tax purposes | Q25 |

### REQUIRES OFFICIAL S2S TECHNICAL SPECIFICATION

| Topic | Status |
|-------|--------|
| Sale / e-invoice / e-receipt request schema | UNKNOWN — requires URA confirmation |
| Required / optional JSON/XML fields | UNKNOWN — requires URA confirmation |
| Amounts (inclusive vs exclusive), rounding | UNKNOWN — requires URA confirmation |
| Tax codes | UNKNOWN — requires URA confirmation |
| Discounts | UNKNOWN — requires URA confirmation |
| Payment codes | UNKNOWN — requires URA confirmation |
| Currency field on the wire | UNKNOWN — requires URA confirmation |

### Receipt / complete vs fiscalize order

The handbook confirms e-invoices/e-receipts and offline operation. It does **not** specify S2S checkout ordering.

Do **not** infer either of:

```text
complete local sale → print → asynchronously fiscalize
```

```text
fiscalize → receive fiscal response → complete/print
```

**REQUIRES OFFICIAL S2S TECHNICAL/URA CONFIRMATION**

Hospitality `taxUgx` / `hospitalityTaxPercent` is WAKA display tax and must not be sent as URA VAT.

---

## Fiscal response

### CONFIRMED BY OFFICIAL HANDBOOK

Common features of e-invoices, e-receipts, e-credit notes, and e-debit notes (Q9):

- Fiscal Document Number (FDN)
- A verification code
- A Quick Response (QR) Code

Validation described for shoppers (Q16): EFRIS app or web portal; fiscal document validation window; input **FDN and the date it was generated**.

### REQUIRES OFFICIAL S2S TECHNICAL SPECIFICATION

| Topic | Status |
|-------|--------|
| Exact FDN response structure / format | UNKNOWN — requires URA confirmation |
| Exact QR response structure / payload | UNKNOWN — requires URA confirmation |
| Verification-code field name / format | UNKNOWN — requires URA confirmation |
| Other response values | UNKNOWN — requires URA confirmation |

WAKA Phase 1 `shop_efris_submissions` has no FDN / QR columns. Do not add them until the official response schema is confirmed.

---

## Credit / debit notes

### CONFIRMED BY OFFICIAL HANDBOOK

| Document | Definition | Location |
|----------|------------|----------|
| e-credit note | Issued by a **seller** to a customer to **cancel or adjust downwards** a previous sale (e.g. goods returned) | Q12 |
| e-debit note | Issued by a **seller** to a buyer to **increase** a previous sale (understated value, quantity, or tax due) | Q13 |
| Returns / mismatches | Changes via cancellation of the original invoice or adjustments to price and/or quantity using the debit and credit note process. Printed vs e-document mismatch: seller should issue e-credit or e-debit note | Part III; Q18 |

This handbook’s debit-note issuer is the **seller**. Do not mix in older public copy that described a buyer-issued debit note.

### REQUIRES OFFICIAL S2S TECHNICAL SPECIFICATION

Request/response fields, linkage to original FDN, timing limits, interface names: UNKNOWN — requires URA confirmation.

WAKA `ReturnRecord` / `sale_returns` are stock+money, **not** URA credit notes. Do not auto-submit returns until the official credit-note API is mapped and approved.

---

## Cancellation / adjustment

### CONFIRMED BY OFFICIAL HANDBOOK

| Topic | Value | Location |
|-------|--------|----------|
| Invoice correction | Cancel the original invoice, or adjust price and/or quantity via debit/credit notes | Part III |
| Manual / unfiscalized documents | A gazetted taxpayer must issue e-receipts or e-invoices for each transaction. Manual/unfiscalized documents only where: EFRIS is unavailable **and** offline transactions cannot occur; the taxpayer’s system is off; the fiscal device is undergoing maintenance; or any other justifiable reason. Must be uploaded onto the system **within 24 hours** | Q22 |

### REQUIRES OFFICIAL S2S TECHNICAL SPECIFICATION

Upload API, cancel API, mapping of WAKA void → cancel vs credit note: UNKNOWN — requires URA confirmation.

WAKA void / line void is local audit + stock restore, not a fiscal cancel (WAKA-P0).

---

## Errors

### CONFIRMED BY OFFICIAL HANDBOOK

No S2S error catalog. Q23 lists **tax-treatment** rejections (purchase deduction / VAT credit without supporting e-documents), not API error codes.

### REQUIRES OFFICIAL S2S TECHNICAL SPECIFICATION

| Topic | Status |
|-------|--------|
| Error codes | UNKNOWN — requires URA confirmation |
| Error messages | UNKNOWN — requires URA confirmation |
| Retryable vs non-retryable | UNKNOWN — requires URA confirmation |
| Retry rules | UNKNOWN — requires URA confirmation |

WAKA-owned codes (not URA): `EFRIS_PROVIDER_NOT_CONFIGURED`, `efris_disabled`, `outbox_not_found` (WAKA-P1).

---

## Offline

### CONFIRMED BY OFFICIAL HANDBOOK

| Rule | Value | Location |
|------|--------|----------|
| Maximum documented offline period | **5 days** | Q8; Fact Checker Q3 |
| Upload duty | Beyond five days you must connect so data is uploaded. Fact Checker: connect within 5 days to upload generated information | Q8; Fact Checker Q3 |
| Which platforms | Q8: “The offline module works for all platforms except the web portal.” Fact Checker Q3 explicitly includes **system to system** with App and Desktop when the network is down | Q8; Fact Checker Q3 |

```text
Maximum documented offline period = 5 days
```

The handbook establishes the **five-day business rule** but does **not** provide the technical S2S offline implementation contract.

### REQUIRES OFFICIAL S2S TECHNICAL SPECIFICATION

| Topic | Status |
|-------|--------|
| Exact S2S offline technical mechanism | UNKNOWN — requires URA confirmation |
| Offline numbering mechanism | UNKNOWN — requires URA confirmation |
| Synchronization protocol | UNKNOWN — requires URA confirmation |
| Duplicate handling | UNKNOWN — requires URA confirmation |
| Whether a local WAKA receipt is valid without FDN | REQUIRES OFFICIAL S2S TECHNICAL/URA CONFIRMATION |

**DO NOT implement offline EFRIS logic yet.**

WAKA technical offline (complete sale locally; outbox `PENDING` if enabled) remains software behavior, not legal clearance (WAKA-P0, WAKA-P1).

---

## Rate limits

**REQUIRES OFFICIAL S2S TECHNICAL SPECIFICATION.** Not in `URA-HB-FY2026-27`.

---

## Validation / testing

### CONFIRMED BY OFFICIAL HANDBOOK

| Topic | Value | Location |
|-------|--------|----------|
| Shopper validation of an e-document | EFRIS app or web portal; FDN + date generated | Q16 |
| S2S integration support | URA IT via Touchpoint during integration | Q19 |

### REQUIRES OFFICIAL S2S TECHNICAL SPECIFICATION

Official test plan, UAT, sandbox registration, interface test order, production certification: UNKNOWN — requires URA confirmation.

---

## Accreditation

### CONFIRMED BY OFFICIAL HANDBOOK

| Topic | Value | Location |
|-------|--------|----------|
| EFD supplier | Rank Consult, accredited to manage issuance of EFDs | Q19 |
| S2S technical assistance | URA IT supports the taxpayer’s IT team | Q19 |
| Cost | Taxpayer bears S2S integration cost | Q20 |

### REQUIRES OFFICIAL S2S TECHNICAL SPECIFICATION

Software-integrator application, client-count requirements, fees, certificate, MOU: UNKNOWN — requires URA confirmation.

WAKA must not claim to be an accredited EFRIS integrator.

---

## WAKA architecture (unchanged)

The handbook supports optional use (volunteer non-VAT / non-designated) and S2S as one channel. It does **not** require WAKA to force EFRIS onto every shop.

```text
WAKA POS
    │
    ├── EFRIS OFF
    │      └── Normal POS
    │
    └── EFRIS ON
           └── S2S integration
```

Unchanged decisions:

- Optional at WAKA architecture level (`shop_efris_config.enabled` default false)
- Shop-scoped (not organization-only)
- Independent of WAKA `Sale.status`
- Behind the existing EFRIS adapter (`efris-submit` fail-closed stub)
- Credentials server-side when they exist
- Separate from `pendingSync`

Do not change these decisions.

---

## URA Production Readiness

Gates stay incomplete unless evidence is filed. Receiving a **taxpayer handbook** does **not** complete gate 1 (official **API** documentation).

| # | Gate | Status | Evidence required | Evidence on file |
|---|------|--------|-------------------|------------------|
| 1 | Official API documentation received | **OPEN** | URA-issued S2S technical specification | Taxpayer handbook only — not an API spec |
| 2 | Sandbox credentials received | **OPEN** | URA test credentials, server-side only | None |
| 3 | Sandbox integration completed | **OPEN** | Successful sandbox calls | WAKA has zero URA calls |
| 4 | URA validation / testing completed | **OPEN** | Official UAT / validation sign-off | None |
| 5 | Required software-integrator application submitted | **OPEN** | Official application + receipt | Form UNKNOWN |
| 6 | Accreditation / approval received | **OPEN** | URA certificate or written approval | None |
| 7 | Production credentials received | **OPEN** | Production secrets in server vault | None |
| 8 | Production integration verified | **OPEN** | Production verification against official checklist | None |

Current WAKA state: `efris-submit` fail-closes with `EFRIS_PROVIDER_NOT_CONFIGURED`; `isOfficialEfrisProviderConfigured()` is false; no URA URLs, headers, or payloads in the repository.

---

## What this update did not do

- No API endpoints, URLs, credentials, or HTTP clients
- No request payloads or response parsers
- No tax-code / FDN / offline EFRIS implementation
- No production configuration
- No WAKA schema migrations
- No change to sale completion, sync, or POS engines

**STOP.** Implement the URA client only after an official S2S technical specification is received and this contract is re-reviewed against it.
