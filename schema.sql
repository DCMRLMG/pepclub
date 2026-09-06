-- Run this in the Supabase SQL editor.

-- Physical stock on hand, one row per base SKU.
create table if not exists inventory (
  sku text primary key,
  name text not null,
  on_hand integer not null default 0,
  updated_at timestamptz default now()
);

insert into inventory (sku, name, on_hand) values
  ('BEAN-ETH','Ethiopia Roast',100),
  ('BEAN-COL','Colombia Roast',100),
  ('BEAN-SUM','Sumatra Roast',100),
  ('BEAN-KEN','Kenya Roast',100),
  ('BEAN-GTM','Guatemala Roast',100)
on conflict (sku) do nothing;

create table if not exists orders (
  id              bigint generated always as identity primary key,
  created_at      timestamptz default now(),
  invoice_number  text unique not null,
  rep             text not null,             -- dennis | ryan | mike
  customer_name   text not null,
  phone           text not null,
  payment_method  text not null,             -- cash | venmo
  venmo_handle    text,
  notes           text,
  items           jsonb not null,
  units_consumed  jsonb not null,
  total           numeric(10,2) not null,
  status          text default 'pending',    -- pending | paid | fulfilled | closed
  invoice_url     text,
  paid_at         timestamptz,
  fulfilled_at    timestamptz,
  closed_at       timestamptz
);

-- Atomic stock decrement; rejects the whole order if any SKU would go negative.
create or replace function consume_inventory(consumption jsonb)
returns void language plpgsql as $$
declare k text; v integer; cur integer;
begin
  for k, v in select key, value::int from jsonb_each_text(consumption) loop
    select on_hand into cur from inventory where sku = k for update;
    if cur is null then raise exception 'Unknown SKU %', k; end if;
    if cur < v then raise exception 'Insufficient stock for % (have %, need %)', k, cur, v; end if;
    update inventory set on_hand = on_hand - v, updated_at = now() where sku = k;
  end loop;
end $$;

create index if not exists idx_orders_rep on orders(rep);
create index if not exists idx_orders_status on orders(status);
create index if not exists idx_orders_phone on orders(phone);
