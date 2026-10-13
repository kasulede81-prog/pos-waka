-- ============================================================================
-- Printer inventory: shop-reset classification
-- ============================================================================
-- Split out from 20261013100000 on purpose. Both printer tables reference
-- `shops` / `organizations`, so the reset drift guard
-- (src/lib/shopResetFkOrder.sql.integration.test.ts) requires them to be
-- classified or the migration tree reports an unclassified shop-scoped table.
--
-- This file carries nothing but the classification re-declaration, so the
-- shop-reset harness — which builds its schema from a topology snapshot and
-- never applies the printer DDL — can apply exactly this and no more. Same
-- shape as 20260926092000_loyalty_enrollment_requests_reset_plan.sql, a later
-- migration that re-registers a table into the plan.
--
-- They are RETAINED, not reset: a shop's business-data reset must not erase the
-- record that WAKA handed a physical printer to that account, exactly as
-- `org_billing_offers` is retained as 'billing'.
--
-- Reproduced in full because the function is a literal list.

-- ----------------------------------------------------------------------------
-- 12. Shop-reset classification
-- ----------------------------------------------------------------------------
-- Both tables reference shops/organizations, so the reset drift guard requires
-- them to be classified. They are RETAINED, not reset: a shop's business-data
-- reset must not erase the record that WAKA handed a physical printer to that
-- account, exactly as `org_billing_offers` is retained as 'billing'.
--
-- Reproduced in full because the function is a literal list — the same reason
-- 20260926092000 re-declared shop_reset_business_plan() rather than patching it.
create or replace function public.shop_reset_table_classification ()
returns table (tbl text, disposition text, reason text)
language sql
immutable
set search_path to 'public'
as $function$
  select p.tbl, 'reset'::text, 'business data deleted by the reset plan'::text
  from public.shop_reset_business_plan() p
  union all
  select r.tbl, 'retained'::text, r.reason
  from (
    values
      ('activation_requests',                  'platform onboarding history'),
      ('admin_assignments',                    'internal-admin authorization structure'),
      ('agent_referrals',                      'marketing attribution'),
      ('ai_admin_audit_log',                   'internal admin audit trail'),
      ('app_crash_events',                     'device diagnostics'),
      ('business_licenses',                    'licensing / billing identity'),
      ('business_status',                      'licensing / billing identity'),
      ('device_logs',                          'device diagnostics'),
      ('dining_areas',                         'hospitality floor configuration'),
      ('dining_tables',                        'hospitality floor configuration'),
      ('enterprise_purchase_order_branches',   'organization-level purchasing structure'),
      ('enterprise_stock_transfer_receive_events', 'belongs to an enterprise transfer (reset refuses while any exists)'),
      ('enterprise_stock_transfers',           'cross-shop; reset refuses while the shop takes part in one'),
      ('field_visits',                         'internal ops record'),
      ('hardware_pairings',                    'device configuration'),
      ('internal_ops_admin_audit',             'platform admin audit trail (shop reference is nulled on shop delete)'),
      ('internal_shop_notes',                  'internal ops record'),
      ('kitchen_stations',                     'hospitality station configuration'),
      ('loyalty_programs',                     'shop configuration (kept, like shop settings)'),
      ('loyalty_rewards',                      'shop configuration (kept, like shop settings)'),
      ('merchant_notifications',               'merchant inbox (a notification tied to a deleted correction request cascades with it)'),
      ('merchant_support_attachments',         'support communication, not business data'),
      ('merchant_support_messages',            'support communication, not business data'),
      ('merchant_support_session_events',      'support communication, not business data'),
      ('merchant_support_sessions',            'support communication, not business data'),
      ('merchant_support_tickets',             'support communication, not business data'),
      ('org_billing_offers',                   'billing'),
      ('product_categories',                   'catalog structure (configuration)'),
      ('promotional_grants',                   'billing / growth'),
      ('remote_support_requests',              'support communication'),
      ('remote_support_session_events',        'support communication'),
      ('remote_support_sessions',              'support communication'),
      ('shop_ai_settings',                     'shop configuration'),
      ('shop_ai_setup_templates',              'shop configuration'),
      ('shop_catalog_meta',                    'catalog structure (configuration)'),
      ('shop_catalog_nodes',                   'catalog structure (configuration)'),
      ('shop_catalog_shelf_layout',            'catalog structure (configuration)'),
      ('shop_counters',                        'sequence counters'),
      ('shop_devices',                         'device registry / authorization'),
      ('shop_efris_config',                    'tax configuration'),
      ('shop_efris_submissions',               'regulatory tax submissions (never deleted by a business reset)'),
      ('shop_hardware',                        'device configuration'),
      ('shop_locations',                       'shop configuration'),
      ('shop_members',                         'authorization structure'),
      ('shop_policy_settings',                 'shop configuration'),
      ('shop_pos_staff',                       'staff / authorization structure'),
      ('shop_pos_staff_revisions',             'staff / authorization structure'),
      ('shop_recovery_signals',                'reset marker (rewritten by the reset, never deleted)'),
      ('shop_security_credentials',            'authorization structure'),
      ('shop_staff_invitations',               'authorization structure'),
      ('shop_staff_security_events',           'security audit trail'),
      ('shop_vision_settings',                 'shop configuration'),
      ('subscription_history',                 'billing'),
      ('subscription_requests',                'billing'),
      ('subscriptions',                        'billing'),
      ('support_requests',                     'support communication'),
      ('sync_health',                          'reset marker (rewritten by the reset, never deleted)'),
      ('waka_printer_assignments',                'WAKA-owned physical asset handover; not merchant business data'),
      ('waka_printer_units',                      'WAKA-owned physical asset registry; not merchant business data')
  ) as r(tbl, reason);
$function$;

notify pgrst, 'reload schema';
