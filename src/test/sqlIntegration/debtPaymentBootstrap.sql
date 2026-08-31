-- Bootstrap for DEBT-PAYMENT-CONCURRENCY-1.0 SQL tests (after transferEngineBootstrap + r3 cashier helper).

CREATE TABLE IF NOT EXISTS public.customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES public.shops (id) ON DELETE CASCADE,
  name text NOT NULL,
  phone_e164 text,
  email text,
  notes text,
  loyalty_points numeric(18, 4) NOT NULL DEFAULT 0,
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

CREATE INDEX IF NOT EXISTS customer_debt_payments_shop_customer_idx
  ON public.customer_debt_payments (shop_id, customer_id, created_at DESC);
