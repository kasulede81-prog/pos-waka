-- Fix the "function_search_path_mutable" advisor warning on four pure helper functions.
--
-- hospitality_status_rank (20260919090000) and _wk_try_uuid, _wk_recipe_credit,
-- _wk_recipe_provenance_struct (20260919110000) were created without a fixed search_path. They are
-- immutable and touch no table, so the exposure is small, but a function that resolves names through the
-- caller's search_path can be made to resolve them somewhere unexpected.
--
-- Audited body by body (see the migration that defines each):
--   hospitality_status_rank        CASE over text literals only - no calls, no schema references.
--   _wk_try_uuid                   a single ::uuid cast.
--   _wk_recipe_credit              round / least / greatest and arithmetic on numeric.
--   _wk_recipe_provenance_struct   jsonb_typeof / jsonb_array_elements / jsonb_agg / jsonb_build_object /
--                                  bool_or / sum / coalesce, plus public._wk_try_uuid, which is already
--                                  schema-qualified.
-- Everything they use lives in pg_catalog, and nothing is resolved through public, so pinning the search
-- path to pg_catalog cannot change what any of them returns.
--
-- Only the function's configuration changes: no body, signature, volatility, grant or data is touched, and
-- re-running it is a no-op.

alter function public.hospitality_status_rank (text) set search_path = pg_catalog;
alter function public._wk_try_uuid (text) set search_path = pg_catalog;
alter function public._wk_recipe_credit (numeric, numeric, numeric, numeric) set search_path = pg_catalog;
alter function public._wk_recipe_provenance_struct (jsonb) set search_path = pg_catalog;
