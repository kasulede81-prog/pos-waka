-- Unconfirmed auth users with related business data (for orphan classification)
SELECT
  u.id AS user_id,
  u.email,
  u.created_at,
  u.email_confirmed_at,
  EXISTS (
    SELECT 1 FROM public.organization_members om WHERE om.user_id = u.id
  ) AS has_membership,
  EXISTS (
    SELECT 1
    FROM public.organization_members om
    JOIN public.organizations o ON o.id = om.organization_id
    WHERE om.user_id = u.id
  ) AS has_organization,
  EXISTS (
    SELECT 1
    FROM public.shop_members sm
    WHERE sm.user_id = u.id
  ) AS has_shop_membership,
  EXISTS (
    SELECT 1 FROM public.shops s
    JOIN public.organization_members om ON om.organization_id = s.organization_id
    WHERE om.user_id = u.id
  ) AS has_shop,
  EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id = u.id
  ) AS has_profile,
  EXISTS (
    SELECT 1
    FROM public.subscriptions sub
    JOIN public.shops sh ON sh.id = sub.shop_id
    JOIN public.organization_members om ON om.organization_id = sh.organization_id
    WHERE om.user_id = u.id
  ) AS has_subscription
FROM auth.users u
WHERE u.email_confirmed_at IS NULL
ORDER BY u.created_at DESC;
