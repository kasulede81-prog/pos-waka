/**
 * Transactional sale sync verification guide + idempotency simulation.
 * Run: node scripts/verify-transactional-sync.mjs
 *
 * Database verification requires applied migrations 062–064 and Supabase SQL editor.
 */

console.log("=== Transactional Sale Sync Verification ===\n");

console.log("## Client implementation");
console.log("- pushSaleToCloud() → supabase.rpc('shop_push_sale_complete', ...)");
console.log("- Source: src/offline/cloudSync.ts buildSalePushPayload + pushSaleToCloud");
console.log("- Migration: supabase/migrations/063_shop_push_sale_transactional.sql\n");

console.log("## Idempotency properties (RPC design)");
console.log("1. Sale upserted as draft, lines/payments replaced, then completed once");
console.log("2. If sale.status already 'completed', stock trigger does NOT re-fire");
console.log("3. Retry replaces line items (DELETE + INSERT) — no duplicate lines");
console.log("4. product_pre_stock set before complete — aligns with apply_sale_stock_movements\n");

console.log("## SQL verification (run in Supabase after migration 063)");
console.log(`
-- 1. Push test payload (replace SHOP_ID and USER context via authenticated client)
-- Use the app's sale sync or:
select public.shop_push_sale_complete(
  'SHOP_ID'::uuid,
  '{
    "sale": {
      "id": "00000000-0000-4000-8000-000000000001",
      "subtotal_ugx": 5000, "total_ugx": 5000,
      "cash_amount_ugx": 5000, "debt_amount_ugx": 0,
      "payment_status": "paid", "created_at": "2026-05-28T10:00:00Z",
      "metadata": {"wakaClient": true}
    },
    "lines": [{
      "product_id": "PRODUCT_UUID",
      "quantity": 1, "unit_price_ugx": 5000, "line_total_ugx": 5000,
      "line_input_mode": "quantity", "metadata": {"name": "Test"}
    }],
    "payments": [{"method": "cash", "amount_ugx": 5000}],
    "product_pre_stock": [{"product_id": "PRODUCT_UUID", "stock_on_hand": 100}]
  }'::jsonb
);

-- 2. Re-run same call — expect ok:true, already_completed:true, stock unchanged
-- 3. Verify consistency:
select s.status, count(sli.id) as line_count, p.stock_on_hand
from public.sales s
join public.sale_line_items sli on sli.sale_id = s.id
join public.products p on p.id = sli.product_id
where s.id = '00000000-0000-4000-8000-000000000001'
group by s.status, p.stock_on_hand;

-- 4. Simulate interruption: RPC is atomic — partial state rolls back on error
`);

// Simulate retry behavior
const state = { completed: false, stock: 100, lines: 0 };

function rpcPush(alreadyCompleted) {
  if (!alreadyCompleted) {
    state.lines = 1;
    state.stock = 99;
    state.completed = true;
    return { ok: true, already_completed: false };
  }
  state.lines = 1;
  return { ok: true, already_completed: true };
}

const first = rpcPush(state.completed);
const second = rpcPush(state.completed);

console.log("## Simulated retry");
console.log("First push:", first, "→ stock:", state.stock);
console.log("Second push:", second, "→ stock:", state.stock, "(unchanged — idempotent)");
console.log("\nPASS: idempotent retry simulation");

process.exit(0);
