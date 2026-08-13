-- CLOSE-DAY-1.1: one authoritative active close per shop + business date.
-- Does not delete financial history. Extra active rows are superseded.

-- Keep the newest created_at (id DESC tie-break) as the active close.
with ranked as (
  select
    id,
    row_number() over (
      partition by shop_id, date_key
      order by created_at desc, id desc
    ) as rn
  from public.shop_day_closes
  where superseded_at is null
)
update public.shop_day_closes d
set
  superseded_at = coalesce(d.superseded_at, now()),
  updated_at = now(),
  payload = case
    when jsonb_typeof(d.payload) = 'object'
    then d.payload || jsonb_build_object('supersededAt', to_jsonb(now()::text))
    else d.payload
  end
from ranked r
where d.id = r.id
  and r.rn > 1
  and d.superseded_at is null;

create unique index if not exists shop_day_closes_one_active_per_shop_date
  on public.shop_day_closes (shop_id, date_key)
  where superseded_at is null;

create or replace function public.shop_push_day_close (
  p_shop_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid ();
  v_id uuid;
  v_date_key text;
  v_superseded timestamptz;
  v_existing_id uuid;
  v_replaces text;
begin
  if v_uid is null then
    return jsonb_build_object ('ok', false, 'error', 'not_authenticated');
  end if;
  if not public.user_can_manage_shop (p_shop_id) then
    return jsonb_build_object ('ok', false, 'error', 'forbidden');
  end if;

  v_id := nullif (p_payload ->> 'id', '')::uuid;
  v_date_key := nullif (trim (p_payload ->> 'date_key'), '');
  v_superseded := nullif (p_payload ->> 'superseded_at', '')::timestamptz;
  v_replaces := nullif (trim (coalesce (
    p_payload #>> '{close,replacesCloseId}',
    p_payload ->> 'replacesCloseId'
  )), '');

  if v_id is null or v_date_key is null then
    return jsonb_build_object ('ok', false, 'error', 'invalid_payload');
  end if;

  perform pg_advisory_xact_lock (hashtext (p_shop_id::text), hashtext (v_date_key));

  if v_superseded is null then
    select d.id
    into v_existing_id
    from public.shop_day_closes d
    where d.shop_id = p_shop_id
      and d.date_key = v_date_key
      and d.superseded_at is null
      and d.id <> v_id
    limit 1;

    if v_existing_id is not null then
      if v_replaces is not null and v_replaces = v_existing_id::text then
        update public.shop_day_closes
        set
          superseded_at = now (),
          updated_at = now (),
          payload = case
            when jsonb_typeof (payload) = 'object'
            then payload || jsonb_build_object ('supersededAt', to_jsonb (now ()::text))
            else payload
          end
        where id = v_existing_id
          and superseded_at is null;
      else
        return jsonb_build_object (
          'ok', true,
          'already_closed', true,
          'id', v_existing_id
        );
      end if;
    end if;
  end if;

  insert into public.shop_day_closes (
    id, shop_id, date_key, superseded_at, payload, created_at, updated_at
  )
  values (
    v_id,
    p_shop_id,
    v_date_key,
    v_superseded,
    coalesce (p_payload -> 'close', p_payload),
    coalesce (nullif (p_payload ->> 'created_at', '')::timestamptz, now ()),
    coalesce (nullif (p_payload ->> 'updated_at', '')::timestamptz, now ())
  )
  on conflict (id) do update
  set
    superseded_at = excluded.superseded_at,
    payload = case
      when public.shop_day_closes.superseded_at is null
           and excluded.superseded_at is not null
      then excluded.payload
      when public.shop_day_closes.payload is not null
           and public.shop_day_closes.payload <> '{}'::jsonb
      then public.shop_day_closes.payload
      else excluded.payload
    end,
    updated_at = greatest (public.shop_day_closes.updated_at, excluded.updated_at);

  return jsonb_build_object ('ok', true, 'already_closed', false, 'id', v_id);
exception
  when unique_violation then
    select d.id
    into v_existing_id
    from public.shop_day_closes d
    where d.shop_id = p_shop_id
      and d.date_key = v_date_key
      and d.superseded_at is null
    limit 1;
    return jsonb_build_object (
      'ok', true,
      'already_closed', true,
      'id', coalesce (v_existing_id, v_id)
    );
end;
$$;

revoke all on function public.shop_push_day_close (uuid, jsonb) from public;
grant execute on function public.shop_push_day_close (uuid, jsonb) to authenticated;
