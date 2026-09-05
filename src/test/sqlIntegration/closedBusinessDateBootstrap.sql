-- Tables + Kampala day helper for CASH-CONTROL-01 SQL tests.

CREATE OR REPLACE FUNCTION public._sale_kampala_day (p_ts timestamptz)
RETURNS date
LANGUAGE sql
STABLE
AS $$
  SELECT (coalesce(p_ts, now()) AT TIME ZONE 'Africa/Kampala')::date;
$$;

CREATE TABLE IF NOT EXISTS public.shop_day_closes (
  id uuid PRIMARY KEY,
  shop_id uuid NOT NULL REFERENCES public.shops (id) ON DELETE CASCADE,
  date_key text NOT NULL,
  superseded_at timestamptz,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS shop_day_closes_one_active_per_shop_date
  ON public.shop_day_closes (shop_id, date_key)
  WHERE superseded_at IS NULL;

CREATE TABLE IF NOT EXISTS public.sales (
  id uuid PRIMARY KEY,
  shop_id uuid NOT NULL REFERENCES public.shops (id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'draft',
  total_ugx bigint NOT NULL DEFAULT 0,
  cash_amount_ugx bigint NOT NULL DEFAULT 0,
  debt_amount_ugx bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.sale_returns (
  id uuid PRIMARY KEY,
  shop_id uuid NOT NULL REFERENCES public.shops (id) ON DELETE CASCADE,
  sale_id uuid,
  product_id uuid,
  quantity numeric NOT NULL DEFAULT 1,
  refund_amount_ugx bigint NOT NULL DEFAULT 0,
  reason text NOT NULL DEFAULT 'other',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.expenses (
  id uuid PRIMARY KEY,
  shop_id uuid NOT NULL REFERENCES public.shops (id) ON DELETE CASCADE,
  expense_type text NOT NULL DEFAULT 'cash_drawer',
  category text NOT NULL,
  amount_ugx bigint NOT NULL,
  description text,
  paid_on date NOT NULL,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  recorded_by_staff_id text,
  recorded_by_label text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  deleted_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES public.shops (id) ON DELETE CASCADE,
  name text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.customer_debt_payments (
  id uuid PRIMARY KEY,
  shop_id uuid NOT NULL REFERENCES public.shops (id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES public.customers (id) ON DELETE CASCADE,
  amount_ugx bigint NOT NULL CHECK (amount_ugx > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS public.shop_supplier_payments (
  id uuid PRIMARY KEY,
  shop_id uuid NOT NULL REFERENCES public.shops (id) ON DELETE CASCADE,
  supplier_id uuid NOT NULL,
  amount_ugx bigint NOT NULL CHECK (amount_ugx > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS public.shop_cash_drawer_adjustments (
  id uuid PRIMARY KEY,
  shop_id uuid NOT NULL REFERENCES public.shops (id) ON DELETE CASCADE,
  adjustment_type text NOT NULL,
  amount_ugx bigint NOT NULL CHECK (amount_ugx > 0),
  note text NOT NULL DEFAULT '',
  actor_user_id text NOT NULL DEFAULT '',
  actor_label text,
  occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);
