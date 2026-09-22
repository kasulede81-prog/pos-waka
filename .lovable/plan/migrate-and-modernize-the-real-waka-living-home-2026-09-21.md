# Migrate and modernize the real WAKA Living Home

## Goal
Replace the temporary mock dashboard in this Lovable project with the existing WAKA Home implementation, preserving its real data architecture, permissions, domain-specific behavior, navigation contracts, offline behavior, and living visual identity. Modernization will be limited to presentation and motion polish.

## Implementation
1. **Port the original Home dependency closure**
   - Bring in the existing Home page shell, desktop command-center composition, purpose-built mobile cockpit, ordered regions, live business floor, status surfaces, and license bar.
   - Bring in the existing miniature SVG worlds, cash-drawer scene, live-value transitions, pulse visualization, spotlight/parallax hooks, Lottie boundary/cache, and animation-pause system.
   - Preserve component boundaries rather than rebuilding the experience as a new dashboard.

2. **Preserve the source-of-truth data path**
   - Port the stores, contexts, types, selectors, and read-only helpers required by `useHomeDashboardMetrics`, tile resolution, business health, and session/subscription visibility.
   - Keep calculations and permission decisions byte-equivalent where practical; adaptation will only address framework boundaries and imports.
   - Do not add mock values, new financial models, database tables, migrations, RPCs, or replacement APIs.

3. **Adapt framework boundaries only**
   - Convert Home navigation from React Router calls to TanStack Router while retaining the same public path contracts.
   - Add route stubs only where needed so every existing Home destination remains valid during the larger migration.
   - Keep the existing mobile/desktop breakpoint behavior and Home-specific composition rules.

4. **Apply premium UI-only refinement**
   - Refine Home CSS tokens, typography, spacing, proportions, layered surfaces, lighting, borders, and shadows.
   - Improve parallax settling, focus/hover/touch feedback, spotlight depth, pulse timing, and ambient motion without adding continuous high-cost animation.
   - Preserve each module’s distinct visual world and data-driven intensity states.

5. **Protect accessibility and performance**
   - Preserve reduced-motion, hidden-tab, data-saver, low-battery, and explicit Home pause behavior.
   - Preserve single-tile spotlight cycling, touch exclusion from parallax, idle-deferred Lottie loading, and per-animation error isolation.
   - Keep animations primarily transform/opacity based and avoid blanket `will-change` usage.

6. **Validate**
   - Check build health and browser behavior at desktop, tablet, and mobile sizes.
   - Verify navigation, permission-filtered rendering, pharmacy labels/routes, live availability states, keyboard focus, reduced motion, and absence of mock business values.
   - Report the exact changed files, reused components, preserved systems, data-binding impact, dependencies, performance concerns, and remaining UI issues.

## Scope boundary
This milestone migrates and modernizes the real Home experience and its required read-only dependency closure. It does not migrate the full functionality of every destination screen, change financial/database/business logic, or configure the existing external backend.
