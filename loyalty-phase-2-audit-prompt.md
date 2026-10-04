# DKASU Loyalty — Phase 2 Audit Prompt

## Role

You are auditing the **next implementation phase** of the DKASU POS Loyalty redesign.

This is a **READ-ONLY audit**.

Do NOT modify, create, delete, rename, or commit any files.

---

## Context

The Loyalty redesign has already completed **Phase 1**.

Phase 1 established the new Loyalty information architecture and navigation:

- `/office/loyalty/overview`
- `/office/loyalty/members`
- `/office/loyalty/rewards`
- `/office/loyalty/activity`
- `/office/loyalty/cards`
- `/office/loyalty/settings`

It also introduced the shared Loyalty shell/navigation structure.

Phase 1 is the foundation for this work.

**Do not redo Phase 1.**
**Do not redesign the navigation again.**
**Do not perform a broad duplicate Loyalty audit.**

Your job is to determine exactly what **Phase 2** should implement based on the existing Loyalty redesign audit/plan and the current repository state.

---

# 1. Inspect the Existing Phase 1 Implementation

First inspect the current repository enough to understand what Phase 1 actually delivered.

Check:

- Loyalty routes
- `LoyaltyShell`
- Loyalty navigation configuration
- `LoyaltyHubPage`
- Office → Loyalty entry
- section routing
- permission gates
- existing Loyalty panels/components
- responsive behavior
- dark mode behavior
- tests related to Phase 1
- any existing audit/plan documents in the repository

Confirm that Phase 1 is already the baseline.

Do not modify anything.

---

# 2. Find the Existing Loyalty Audit / Phase Plan

Search the repository for the existing Loyalty audit and implementation planning material.

Look for:

- Loyalty audit documents
- Phase definitions
- P0/P1/P2 findings
- UX findings
- information architecture recommendations
- component recommendations
- usability issues
- mobile/responsive findings
- accessibility findings
- permissions findings
- member/customer workflow findings
- rewards workflow findings
- activity/history findings
- cards/wallet findings
- settings findings

Use the existing audit as the primary source.

Do NOT invent a completely new roadmap.

If the repository contains enough information to determine Phase 2, use that information directly.

If Phase 2 is ambiguous, clearly identify the ambiguity instead of silently inventing requirements.

---

# 3. Audit the Current Code Against Phase 2

Determine what Phase 2 actually needs to change.

Inspect the relevant:

- pages
- components
- hooks
- state
- queries
- RPC calls
- types
- permission checks
- loading states
- empty states
- error states
- responsive layouts
- dark mode styling
- translations
- accessibility behavior

For every Phase 2 requirement, determine:

1. What already exists
2. What is partially implemented
3. What is missing
4. Which exact files are involved
5. Whether the existing backend already supports it
6. Whether the UI is incorrectly duplicating backend functionality
7. Whether there are permission or role inconsistencies
8. Whether the current implementation can safely be improved without touching the Loyalty accounting engine

---

# 4. Protect Loyalty Backend Integrity

This audit must treat the existing Loyalty backend/accounting system as protected.

Do NOT recommend changing these unless the existing Phase 2 audit explicitly proves that a change is required:

- `loyalty_accounts`
- `loyalty_transactions`
- `loyalty_point_lot_allocations`
- loyalty balance calculations
- lifetime earned/redeemed calculations
- ledger immutability
- point allocation logic
- FIFO allocation
- point expiration
- sale awarding
- sale reversal
- return reversal
- pending reversal processing
- balance invariant enforcement
- redemption accounting
- enrollment RPCs
- QR token generation/security
- Google Wallet backend functions
- RLS policies
- checkout loyalty accounting

In particular, do not introduce client-side point-crediting logic.

If a Phase 2 UI requirement depends on an existing backend capability, identify and reuse it.

If a backend capability is genuinely missing, report it separately as a dependency rather than modifying it.

---

# 5. Protect Other Unrelated Systems

Do not expand this phase into:

- authentication redesign
- staff architecture redesign
- merchant registration redesign
- invitation architecture redesign
- cashier architecture redesign
- subscription/billing redesign
- checkout redesign
- POS sales architecture redesign

Only identify interactions if they directly affect the Loyalty Phase 2 UI.

---

# 6. Audit Each Phase 2 Area

For each area identified by the existing Phase 2 plan, evaluate:

### A. User Experience

- Is the workflow understandable?
- Is the primary action obvious?
- Is information hierarchy correct?
- Are important actions too deeply buried?
- Are there unnecessary steps?
- Are terminology and labels consistent?
- Does it feel like a professional business Loyalty system?

### B. Data

- What data is displayed?
- Where does it come from?
- Is the data already available?
- Is the UI using the correct existing query/RPC?
- Are loading, empty and error states handled?

### C. Permissions

Check existing permission behavior carefully.

Identify:

- owner behavior
- manager behavior
- cashier behavior
- customer/member behavior where relevant
- `settings.shop`
- `customers.view`
- other Loyalty-specific permissions

Do not silently change permissions.

Flag mismatches between frontend permission checks and backend/RLS permissions.

### D. Responsive Design

Check:

- desktop
- tablet
- mobile
- narrow mobile
- horizontal navigation
- tables
- cards
- dialogs
- drawers
- forms
- action buttons

Identify anything that will break or become difficult to use on small screens.

### E. Accessibility

Check:

- keyboard navigation
- focus states
- semantic controls
- labels
- dialogs
- buttons
- tab navigation
- contrast
- screen-reader meaningfulness

### F. Dark Mode

Check that the Phase 2 UI works correctly in:

- light mode
- dark mode

Look specifically for:

- hard-coded white backgrounds
- black text on dark surfaces
- missing dark borders
- poor contrast
- incorrect hover states
- incorrect active states
- skeleton/loading colors

---

# 7. Identify Exact Files

Produce a precise file map.

For each proposed Phase 2 change, list:

```text
File:
Current responsibility:
Problem:
Required change:
Risk:
```

Separate files into:

### Must change

Files that Phase 2 definitely needs.

### Probably change

Files that may need changes depending on implementation.

### Do not touch

Existing systems that should remain untouched.

---

# 8. Check for Existing Reusable Components

Before recommending new components, search the repository for reusable existing components.

Prefer existing:

- PageHeader
- BackOfficePageLayout
- HorizontalTabBar
- cards
- tables
- dialogs
- drawers
- badges
- filters
- empty states
- loading states
- toast/notification components
- form components
- responsive primitives

Do not recommend creating duplicate UI primitives if equivalent components already exist.

---

# 9. Check Tests

Identify the tests relevant to Phase 2.

Check:

- existing Loyalty tests
- route tests
- component tests
- permission tests
- integration tests
- responsive-related tests where available
- TypeScript coverage
- build validation

Recommend exactly what should be tested after implementation.

Do not modify tests during this audit.

---

# 10. Phase 2 Scope

After inspecting the repository and existing audit, determine the **smallest coherent implementation scope for Phase 2**.

The result must be a focused phase.

Do NOT combine unrelated Phase 3/4 work into Phase 2 just because it is nearby.

Explicitly state:

### Phase 2 IN SCOPE

List the exact features/workflows to implement.

### Phase 2 OUT OF SCOPE

List things that must wait for later phases.

### Dependencies

List any existing backend or infrastructure dependencies.

---

# 11. Implementation Sequence

Provide a recommended implementation sequence such as:

1. Component/layout foundation
2. Page/workflow implementation
3. Data integration
4. Permission integration
5. Responsive behavior
6. Accessibility/dark mode
7. Tests
8. Typecheck/build

Adjust this sequence to the actual repository.

---

# 12. Acceptance Criteria

Write concrete acceptance criteria for Phase 2.

They should be testable.

Example format:

```text
[ ] Requirement
[ ] Requirement
[ ] Requirement
```

Include:

- desktop behavior
- mobile behavior
- permissions
- loading states
- empty states
- error states
- dark mode
- accessibility
- existing functionality preservation
- tests
- typecheck
- production build

---

# 13. Risk Assessment

Identify any risks before implementation.

Classify them:

- HIGH
- MEDIUM
- LOW

Pay particular attention to risks involving:

- loyalty balances
- ledger integrity
- redemption accounting
- permissions
- customer/member identity
- QR security
- existing checkout behavior
- existing Google Wallet behavior

---

# 14. Final Report

Finish with a concise implementation-ready report using exactly this structure:

## Phase 2 Audit Result

### 1. Phase 2 Objective

What Phase 2 should accomplish.

### 2. Current State

What already exists after Phase 1.

### 3. Phase 2 Scope

Exact features to implement.

### 4. Files To Change

Exact files and why.

### 5. Files To Protect

Files/systems that should not be changed.

### 6. Backend Dependencies

Existing RPCs/data/backend capabilities that Phase 2 should reuse.

### 7. Permission Requirements

Exact roles/permissions that matter.

### 8. UX Requirements

Important UI/UX requirements.

### 9. Mobile / Responsive Requirements

Important responsive requirements.

### 10. Accessibility / Dark Mode

Required considerations.

### 11. Tests

Exact tests that should be run or added.

### 12. Acceptance Criteria

Concrete completion checklist.

### 13. Risks

Potential regression risks.

### 14. Recommended Implementation Order

Step-by-step implementation sequence.

### 15. Explicitly NOT Phase 2

What must not be implemented yet.

---

# FINAL RULES

This is an **AUDIT ONLY**.

DO NOT:

- modify files
- create files
- delete files
- rename files
- commit
- push
- implement Phase 2
- implement Phase 3
- redo the complete Loyalty audit
- redesign Phase 1 navigation
- change Loyalty accounting
- change ledger behavior
- change balances
- change redemption accounting
- change QR security
- change RLS
- change Google Wallet backend
- change checkout accounting
- redesign authentication
- redesign staff/invitation architecture

Use the existing repository and existing Loyalty audit as the source of truth.

Keep the investigation efficient.

Do not spawn unnecessary broad exploratory agents.

The final report must be detailed enough that a separate implementation session can execute **Phase 2 without having to repeat this audit**.
