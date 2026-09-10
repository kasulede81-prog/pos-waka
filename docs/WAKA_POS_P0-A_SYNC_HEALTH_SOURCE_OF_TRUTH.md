# WAKA POS — P0-A Sync Health Implementation Source of Truth

**Status:** Authoritative implementation brief  
**Scope:** P0-A only — Make sync health real  
**Source:** Latest Claude Code Internal Admin / customer-support mega-audit (`turn8file0`) and its P0-A roadmap.  
**Rule:** Cursor must read this document before every P0-A implementation, review, testing, and rollout step.

## 1. Executive requirement

The audit identified a critical support-operations defect: the Internal Admin displays `pending_outbound`, `last_push_ok_at`, and `last_error`, but the audit found that these values are not currently being written by the client/server sync path.

The audit observed 39 live `sync_health` rows with:

- `pending_outbound`: no meaningful pending state
- `last_push_ok_at`: no populated successful-push timestamps
- `last_error`: no populated errors

This means support can see a falsely green sync-health picture.

**P0-A goal:** Make the existing sync-health fields truthful by wiring the existing sync flow to persist the real values already available in the sync runtime.

This is an observability/telemetry fix. It must not change POS business logic, sales logic, inventory logic, debt logic, or the offline-first data model.

## 2. Audit requirement

The audit's minimum fix is:

- Extend the existing `sync_health` upsert in `cloudSync.ts` (reported around line 4225).
- Persist:
  - `pending_outbound`
  - `last_push_ok_at`
  - `last_error`
- Use values already available in memory.
- Do not fabricate health state.
- Keep the change narrowly scoped and low risk.
- No backend migration is expected unless current repository verification proves one is actually required.

## 3. Mandatory repository verification before implementation

Cursor MUST verify the current repository before changing code. Do not assume the audit's line number or implementation shape is unchanged.

Verify:

1. The current `cloudSync.ts` sync-health write/upsert path.
2. Exact `sync_health` columns and types for the three fields.
3. Every current `sync_health` writer and reader.
4. Where the authoritative outbound pending count/state exists.
5. Where the last genuinely successful push is known.
6. Where the latest relevant sync/push error is known.
7. Shop/device identity used by the row.
8. Existing RLS/RPC/write permissions.
9. Existing tests covering cloud sync, sync health, retries, quarantine/dead-letter, and offline behavior.

If the repository differs materially from the audit, stop and report the discrepancy before broadening scope.

## 4. Truthfulness requirements

### `pending_outbound`

Must represent the actual current pending outbound work for the relevant shop/device.

Do not hard-code zero, reset it merely because a heartbeat runs, count only a non-authoritative queue, or report zero while known work remains pending.

### `last_push_ok_at`

Must represent a genuinely successful push/sync.

Do not update it when a push merely starts, partially fails, or merely performs a heartbeat. Do not fabricate it or overwrite a valid success timestamp with empty state without verified semantics.

### `last_error`

Must represent the latest relevant real sync/push error according to the existing state machine.

Do not manufacture errors, hide real errors during heartbeat updates, or clear an error before successful recovery unless the existing verified semantics require it.

## 5. Scope

### In scope

- Existing `sync_health` write/upsert path.
- Minimal state plumbing required to supply truthful values.
- Focused tests.
- Necessary comments/documentation.
- A targeted migration only if repository verification proves it is required.

### Out of scope

Do NOT use P0-A to:

- redesign cloud sync or offline-first architecture
- redesign queue/retry/quarantine/dead-letter behavior
- change sales, inventory, debt, or customer business logic
- add a new sync-health subsystem
- add broad realtime infrastructure
- perform a repo-wide SECURITY DEFINER cleanup
- refactor unrelated admin pages
- implement P0-B sales ledger
- implement P0-C customer/debt ledger
- implement printer telemetry, staff management, inventory ledger, or purchases
- broaden the admin roadmap

Record unrelated discoveries separately rather than expanding P0-A.

## 6. Offline-first and reliability constraints

The POS must remain functional offline.

Telemetry failure must never become a reason for a sale or other business operation to fail, corrupt, or discard data.

Preserve:

- offline behavior
- sync ordering
- retry behavior
- quarantine/dead-letter behavior
- durable queue behavior
- existing idempotency
- existing authorization

Avoid:

- unbounded writes
- per-item telemetry network calls
- N+1 database/network behavior
- high-frequency database writes
- blocking UI work
- duplicated sync loops
- a second source of truth for queue state

Prefer the existing bounded sync-health upsert path.

## 7. Required tests

Tests must prove behavior.

### Pending

- Real non-zero pending work produces truthful `pending_outbound`.
- Empty authoritative queue produces zero.
- Heartbeats/unrelated updates do not falsely zero pending work.

### Successful push

- Genuine successful push updates `last_push_ok_at`.
- Starting a push does not update it.
- Failed or partial push does not advance it.

### Error

- Real sync/push failure is represented in `last_error` according to verified semantics.
- Unrelated health updates do not prematurely erase meaningful errors.
- Recovery clears/reconciles the error only according to verified state-machine semantics.

### Identity/security

- Values go to the correct shop/device row.
- Existing authorization/RLS remains intact.
- Cross-shop attribution is impossible.

### Regression

Run focused sync/cloud-sync tests and relevant TypeScript/type checks. Do not weaken unrelated existing failing tests.

## 8. Acceptance criteria

P0-A is complete only when:

1. The actual repository sync-health architecture has been verified.
2. `pending_outbound` comes from real authoritative pending state.
3. `last_push_ok_at` advances only after genuine successful push/sync.
4. `last_error` reflects genuine relevant failures according to verified semantics.
5. Business data does not depend on telemetry publication succeeding.
6. No unbounded/N+1 behavior is introduced.
7. Offline-first and retry behavior are unchanged.
8. Focused tests prove pending, success, failure, recovery, and identity semantics.
9. Relevant type checks pass.
10. A read-only safety review confirms the change is narrowly scoped and safe.
11. Production is not changed until implementation and safety review are explicitly approved.
12. If production rollout requires a migration, use the established targeted-migration process; never blindly run a full `db push`.

## 9. Production rollout rules

Before production:

- Confirm the final diff is P0-A only.
- Confirm tests pass.
- Perform a read-only safety review.
- Determine whether a DB migration is actually required.

If a migration is required:

- Keep it narrowly scoped.
- Verify exact schema/function/ACL effects.
- Apply only the intended migration to the linked production project.
- Verify live state afterward.
- Do not invoke destructive business operations during verification.

After production:

- Verify real `sync_health` values are being written.
- Verify successful pushes advance `last_push_ok_at`.
- Verify failures appear in `last_error`.
- Verify pending outbound work is represented.
- Verify shop/device isolation.
- Commit and push only the intended P0-A changes.

## 10. Required Cursor workflow

### Step 1 — Inspect

Read this document first. Then inspect the repository and map the exact current implementation.

### Step 2 — Reconcile

Compare the repository with the audit requirements.

Report:

- what matches
- what changed
- what the audit did not establish
- the exact implementation point to modify

Do not implement unrelated findings.

### Step 3 — Implement

Implement the smallest safe P0-A change while preserving the existing architecture.

### Step 4 — Test

Run focused tests first, then relevant type checks/regression checks.

### Step 5 — Safety review

Perform a read-only final review confirming:

- truthful semantics
- no false-green state
- no offline regression
- no unbounded writes
- no authorization regression
- no unrelated changes

### Step 6 — Production

Only after explicit approval:

- apply a required targeted migration, if any
- verify live behavior
- commit
- push

## 11. Broader audit roadmap — NOT P0-A

The same audit identified separate future work:

- P0-B: shop sales ledger + sale detail
- P0-C: customer/debt ledger
- P1-D: staff roster + single-staff disable
- P1-E: print/receipt telemetry
- P1-F: inventory movement ledger
- P2-G: audit pagination + actor
- P2-H: server-side district/plan/status filtering
- P2-I: purchases/suppliers
- P3-J: remaining audit-log/owner-PII security cleanup

These must not be implemented under P0-A.

## 12. Source-of-truth rule

When implementation decisions conflict with assumptions, use this priority:

1. Current repository behavior and schema verification.
2. Requirements and constraints in this document.
3. Claude audit evidence that produced this document.
4. Existing WAKA POS architecture and established patterns.

Never invent missing semantics.

If a required semantic cannot be established from the repository and audit, stop and report the uncertainty rather than guessing.

**P0-A is a narrow observability repair: make the existing sync-health data truthful without changing POS business logic.**
