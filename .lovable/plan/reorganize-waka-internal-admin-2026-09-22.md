# Reorganize WAKA Internal Admin

## Goal
Turn the existing Internal Admin into a focused WAKA Operations Console with four primary destinations: Command Center, Customers, Support, and Platform. Reuse the current Admin screens, data sources, actions, permissions, and Shop Console; do not touch Home or customer POS systems.

## Implementation

1. **Restore the existing Admin UI dependency closure**
   - Bring the current repository’s Internal Admin components and pages into this migrated app.
   - Adapt their navigation boundary to TanStack Router without changing existing URLs, data calls, security checks, RPCs, or action behavior.
   - Keep the existing internal-admin gate and preview protections.

2. **Create the four-part Operations Console shell**
   - Replace the long flat navigation with Command Center, Customers, Support, and Platform.
   - Keep existing specialist URLs working, but group them inside Platform rather than exposing them as peer destinations.
   - Make the existing search prominent and label its current capped/local-search limitation honestly; do not preload any additional fleet data or simulate universal search.

3. **Reframe existing screens**
   - Keep `/internal/waka` as Command Center and reorganize its existing real operational queues and exception data.
   - Reframe `/internal/waka/shops` as Customers: search-first, then open the existing shop workspace.
   - Keep `/internal/waka/support` as the shared ticket queue and remove duplicated account-recovery forms from that global page.
   - Add a Platform landing view that groups existing Revenue, Configuration, People, and Advanced routes while preserving those routes.

4. **Evolve the existing Shop Console**
   - Collapse eleven visible tabs into Summary, Support, Devices, Account, History, Platform, and Advanced.
   - Re-home existing panels rather than replacing them: Overview → Summary; Support notes/tickets → Support; device actions → Devices; recovery/profile/subscription interventions → Account; Activity/Audit → History; AI/Vision → Platform; diagnostics/integrity/delete → Advanced.
   - Remove duplicate UI entry points while keeping all underlying RPCs and authorization intact.

5. **Operational visual system**
   - Apply a compact professional dark WAKA operations style with orange emphasis, restrained statuses, accessible focus states, clear loading/empty/error states, and dense lists/tables.
   - Avoid cinematic Home styling, oversized decorative cards, fake metrics, and marketing presentation.

6. **Validation**
   - Verify Command Center, Customers, Customer Workspace, Support, Platform groups, legacy routes, navigation, search behavior, preview restrictions, and representative authorized actions.
   - Check desktop and mobile layouts, TypeScript/build output, runtime errors, and broken links.
   - Confirm no Home, financial, inventory, customer Settings, or unrelated domain files changed.

## Technical constraints
- No schema, migration, RPC, financial, inventory, sales, profit, debt, payment, EFRIS, auth, RLS, offline-sync, or customer Settings changes.
- No fake records or simulated functionality.
- Existing route URLs remain valid; new TanStack route files will match their generated route IDs exactly.
- The current search remains a bounded real-data search until a future indexed server-side universal-search API exists.
