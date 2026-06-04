-- Allow pre-auth / registration flows to read enabled business types (read-only RPC).

grant execute on function public.get_platform_business_type_settings () to anon;
