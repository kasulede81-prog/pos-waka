# WAKA POS — Repository Synchronization Audit & Production Plan

Date: 2026-09-18
Auditor: Kimi
Scope: entire repository — working tree, all local + remote branches, Git history, migrations vs production.

---

## 1. Branch inventory

| Branch | Tip | Relationship to origin/main (3ab578a) | Verdict |
|---|---|---|---|
| `origin/main` | 3ab578a | — | **Target baseline** (local main is ancestor, origin has +2 login commits) |
| `waka/hospitality-business-type` (local) | 6454b18 | +20 commits ahead, merge-base 21cef22 | **MERGE** (hospitality + loyalty + validator fix) |
| `origin/waka/historical-financial-correction` | c443d26 | fully contained in main (0 unique commits) | Nothing to do |
| `origin/waka/android-settings-p0` | cb5ef6a | 4 genuinely unique commits, old base | **CHERRY-PICK the 4 commits** (probe-verified) |
| `origin/cursor/excel-csv-import-finish-b9d3` | 53cd8e9 | 2 commits, but superseded | **EXCLUDE** (see §3) |
| `origin/cursor/setup-dev-environment-901f` | 14d1ae1 | only 1 unique commit (dev-env README) | **EXCLUDE** (Cursor Cloud docs, not product) |
| `backup/local-snapshot-pre-reconstruction` | 2c5452d | local WIP snapshot, pre-reconstruction | **EXCLUDE** (obsolete; marked "not for remote") |

## 2. What main is missing (verified by patch analysis, not assumptions)

### A. `waka/hospitality-business-type` — 20 commits
- **Hospitality consolidation**: `b9866ab` (ONE Hospitality business type — restaurant/bar/restaurant_bar become operating configurations), `f0e6498` (admin panel shows one Hospitality type), migration `20260918003000_hospitality_business_type.sql` (NOT in main — verified), `HOSPITALITY-BUSINESS-TYPE-REPORT.md`
- **Loyalty Phases 01–10**: `0a0d08b`…`2260946` — 12 commits (auditable ledger, spend rule, POS checkout badge, merchant hub, enrollment + QR, Wallet issuance pipeline, NFC, rewards + redemption, hardening, final E2E). 117 loyalty tests green; production Supabase already has all 5 loyalty migrations applied.
- **Validator fix**: `6454b18` — `hospitality` accepted in `is_valid_shop_business_type` (applied to prod, recorded `20260918143000`).

### B. `origin/waka/android-settings-p0` — 4 commits (Sep 1, each with tests, genuinely missing from main)
| Commit | Feature | Files | Probe result |
|---|---|---|---|
| `ec67d84` | Android POS bootstrap unstick from network gate (4s bound, local restore, boot trace) | 9 files + 260-line test | **Conflicts resolved**: merged with main's newer membership-guard boot logic — both preserved (main's 6 boot tests + branch's 9 P0 tests all green) |
| `c79e66a` | Play updates no longer hidden behind prompt_users gate (new updateEngine modules) | 11 files | Applied **clean**; 24 updateEngine tests green |
| `6d4819f` | Settings hub/routes/saves on one entitlement matrix (472-line module + 239-line test) | 8 files | **Conflicts resolved**: App.tsx (capability prop), search catalog (main's newer rows + branch's capability annotations); 12 matrix tests green |
| `cb5ef6a` | Wipe every MB-1 shop namespace on owner account deletion | 4 files + 254-line test | Applied **clean**; 9 wipe tests green |

Probe verification (all on top of current origin/main): 36 boot/settings/wipe tests + 24 updateEngine tests + main's initializeActiveShop suite = **green**, `tsc -b` clean.

## 3. Excluded work (documented, not guessed)

- **cursor/excel-csv-import**: main already contains `parseProductImportExcel.ts` and `excelProductImport.phase1.test.ts` in a *more evolved* form (main's version removed the branch's `workbookFile` helper and reworked the flow). Merging would regress main's newer import code. The Excel/CSV import feature ships with main.
- **cursor/setup-dev-environment**: only unique commit is Cursor Cloud development instructions (README) — not product functionality. The branch's feature commits (day-open float, inventory count sessions) are already in main.
- **backup/local-snapshot-pre-reconstruction**: WIP snapshot of the pre-reconstruction divergent tree (245k-line diff against its own in-main parent). Explicitly labeled "not for remote". Nothing unique to rescue.
- **historical-financial-correction**: 0 unique commits — everything it contains is already in main via 21cef22.
- `_apply_044_045_bundle.sql`: excluded per owner instruction (Sep 18).

## 4. Migration state (production Supabase verified)

- All **213 local timestamped migrations are applied** on production. Zero pending.
- 8 migrations recorded on production but with no local file (`20260913213025` admin reset … `20260915205228` reset-history cleanup) are the historical-financial-correction set applied directly during that phase; already in the DB — left untouched per "do not modify applied migrations".
- No new migration is introduced by this sync (the 4 android-settings commits are client-side; the loyalty/hospitality migrations are already on production).

## 5. Uncommitted work (protected, not committed)

- `src/index.css` — dark-mode fix from a separate task. **Not part of this sync; stays uncommitted and untouched.**
- `docs/waka-loyalty-prompts/**` — the prompt pack (untracked by design; only STATUS.md/DECISIONS.md were committed during loyalty).
- Integration happens in a **separate worktree** so this working tree is never disturbed.

## 6. Execution plan

1. New worktree from `origin/main` (3ab578a) → local `main` fast-forwards to it.
2. Cherry-pick the 4 probe-verified android-settings commits (`ef53072 7652911 fc40b00 001cc97` — identical resolutions to the probe).
3. Merge `waka/hospitality-business-type` (`--no-ff`); resolve any conflicts carefully (expected overlap: login-refresh vs i18n/App surfaces).
4. Full verification on merged main: loyalty suites (117), boot/settings/wipe/updateEngine suites (60), financial regression (83), retail (126), payments (41), cloud (13), platform (167), `tsc -b`, production build.
5. Push `main` normally. Verify remote HEAD. Report exact commits.
6. Delete integration worktree; probe worktree cleaned up. `src/index.css` untouched.

## 7. Risk assessment

- **LOW** for cherry-picks (probe-proven on current main, all suites green).
- **LOW–MEDIUM** for the hospitality/loyalty merge (20 commits on a 21cef22 base; the only main-side changes since are the 2 login-experience commits; conflicts expected to be cosmetic i18n/App-level, resolvable preserving both).
- Financial/inventory core: loyalty/android commits contain no financial-core changes; regression suites re-run before push.
