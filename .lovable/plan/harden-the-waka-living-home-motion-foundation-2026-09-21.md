# Harden the WAKA Living Home motion foundation

## Scope
Implement only the audited correctness, architecture, accessibility, and performance fixes. Preserve the current Home design, SVG scenes, data pipeline, permissions, routing, drawer behavior, and animation character.

## Implementation
1. **Separate transform ownership**
   - Add a dedicated parallax wrapper around each existing tile scene.
   - Keep ambient breathing and interaction transforms on the existing inner scene layer.
   - Preserve the current 4px pointer range and spotlight coordinates.

2. **Centralize animation activity**
   - Refactor the Home pause hook into one shared external-store controller used by every Home consumer.
   - Combine reduced motion, tab visibility, Data Saver, low battery, and manual pause into one authoritative state and one root attribute.
   - Replace duplicated CSS pause selector lists with a scoped animation-play-state rule, while retaining explicit static reset rules where visual state requires them.
   - Remove redundant reduced-motion checks from spotlight hooks so they consume the canonical state only.

3. **Correct known defects and timing drift**
   - Define the missing handshake keyframe.
   - merge the duplicate Business Pulse rule without changing its effective appearance.
   - Make the existing motion constants authoritative through Home CSS custom properties; remove conflicting hardcoded active durations.

4. **Reduce unnecessary rendering and layout work**
   - Memoize tile cards with a focused comparison and provide stable click/ref callbacks.
   - Localize spotlight changes to card-level subscriptions so the two-second cycle does not reconcile the full Home composition.
   - Cache pointer geometry, refresh it on entry/resize/layout changes, and retain frame-coalesced updates with no layout reads during pointer movement.

5. **Use safer animation budgets**
   - Replace continuous shop-sign brightness filtering with a matching opacity-based glow layer.
   - Add mobile-only rules that retain Business Pulse, key tile breathing, status activity, and interaction feedback while pausing lower-value ambient loops.
   - Add IntersectionObserver-based off-screen suspension on tile cards, without unmounting content or affecting focus, navigation, spotlight state, or live data.

6. **Verification**
   - Check build/runtime logs.
   - Exercise desktop, mobile, and reduced-motion views with Playwright.
   - Verify card/scene counts, cockpit layout, spotlight rotation, pointer movement, breathing/live-value behavior, touch exclusion, off-screen pausing, no broken images, and no errors.
   - Instrument render/layout-read behavior to confirm spotlight updates stay local and pointer movement performs no repeated geometry reads.

## Protected boundaries
- No changes to `useHomeDashboardMetrics`, calculations, persistence, APIs, permissions, authentication, routing, offline synchronization, drawer audit logic, EFRIS, payments, or other pages.
- No new animations, timers, visual redesign, replacement scenes, or animation engines.
