# Cinematic WAKA Living Home

## Goal
Make the existing WAKA Home feel like an already-running business environment through layered translucency, atmospheric depth, richer SVG motion, and coordinated real-state reactions—without changing layout, navigation, data, permissions, calculations, or workflows.

## Implementation phases

1. **Atmosphere and depth**
   - Add slow shell light drift, soft depth planes, and restrained sweeps using existing pseudo-elements and compositor-friendly opacity/transforms.
   - Apply the selected multi-layered translucency treatment to current regions and cards without changing their structure or WAKA color identities.

2. **Living Business Pulse**
   - Enrich the current pulse glow, KPI illumination, shop-scene depth, health transitions, and seven-day sparkline response.
   - Reuse existing intensity attributes and value-remount reactions; never synthesize activity.

3. **Existing tile worlds**
   - Keep every SVG scene and add small semantic layers/classes only where needed.
   - Enhance Inventory, Cash Drawer, Cash Position, Reports, Debts, Sales History, Back Office, Profit, and Command Center with asynchronous depth, light, stroke, and state-driven motion.

4. **Spotlight and interaction**
   - Preserve the two-second spotlight store and pointer parallax.
   - Improve outgoing settle, incoming depth/illumination, pointer-following light, layered hover depth, and smooth return using existing card state and CSS.

5. **Real-state reactions**
   - Drive event emphasis only from existing live-value keys, intensity values, health state, and drawer audit choreography.
   - Keep `useHomeDashboardMetrics` and all business calculations untouched.

6. **Mobile and accessibility**
   - Keep the mobile cockpit and reduced animation budget; retain only pulse, primary-world, status, and event motion.
   - Route all new animation through the canonical pause/off-screen/reduced-motion mechanism.

7. **Verification**
   - Verify desktop card/scene counts, pulse, breathing, spotlight, parallax, live-value and drawer behavior.
   - Verify mobile cockpit/counts/touch budget, reduced-motion zero continuous animation, off-screen pausing, no layout reads or duplicate timers, no broken images, and clean runtime/build output.

## Technical guardrails
- CSS/SVG and existing React state only; no WebGL, canvas, new animation engine, per-card timers, or layout polling.
- Prefer transform, opacity, and SVG stroke animation; avoid continuous filters.
- Do not alter Supabase, RPCs, migrations, APIs, financial/inventory/sales/profit/debt/stock logic, permissions, authentication, routing, offline synchronization, drawer audit logic, EFRIS, or payments.
- Do not migrate additional pages.
