-- =====================================================================
-- Textiles Move ERP — 01 SCHEMA
-- Tables, security (row level security) and realtime.
-- Safe to re-run: it DROPS and recreates every business table
-- (profiles/logins are kept). Run 02_logic.sql and 03_seed.sql after it.
-- =====================================================================
create extension if not exists pgcrypto;

drop table if exists ledger, inv_moves, wo_issues, wo_components, work_orders,
  supplier_payments, po_receipts, po_lines, purchase_orders,
  return_lines, returns, sales_lines, sales, stock, bom, items,
  customers, suppliers, locations, settings, doc_counters, team_config cascade;

-- ---------- Master data ----------
create table settings (
  key text primary key,
  value numeric,
  text_value text,
  label text not null,
  unit text,
  description text
);

-- Secret team code that turns a new sign-up into a staff login.
-- No policies = no one can read it through the API.
create table team_config (
  id int primary key default 1 check (id = 1),
  team_code text not null
);

create table doc_counters (prefix text primary key, n int not null default 0);

create table locations (
  id text primary key,
  name text not null,
  type text,
  address text,
  district text,
  city text,
  is_quality_hold boolean not null default false,
  sort int default 0
);

create table suppliers (
  id text primary key,
  name text not null,
  supplier_type text,
  contact_name text,
  email text,
  phone text,
  city text,
  country text,
  lead_time_days int not null check (lead_time_days >= 0),
  payment_terms text not null default 'Net 30',
  items_supplied text,
  active boolean not null default true
);

create table items (
  id text primary key,
  ean text not null unique,            -- the barcode value printed on the label
  sku text,                            -- Cód. Interno from the company sheet
  variant_sku text,
  name text not null,
  item_type text not null check (item_type in ('Finished Good','Kit','Component')),
  style text,
  gender text,
  color text,
  size text,
  uom text not null default 'unit',
  std_cost numeric not null default 0,  -- standard (BOM roll-up) cost from the workbook
  avg_cost numeric not null default 0,  -- weighted average cost, updated by receipts/production
  labor_cost numeric not null default 0,-- cut & sew labour per unit (made items)
  sale_price numeric,                   -- retail shelf price, IGV included
  wholesale_price numeric,              -- B2B price, before IGV
  make_or_buy text not null default 'Buy',
  supplier_id text references suppliers(id),
  lead_time_days int not null default 0,
  lot_rule text not null default 'L4L' check (lot_rule in ('L4L','FOQ')),
  lot_qty numeric,                      -- used when lot_rule = FOQ
  active boolean not null default true,
  source text
);

create table bom (
  parent_id text references items(id) on delete cascade,
  component_id text references items(id),
  qty_per numeric not null check (qty_per > 0),
  scrap_pct numeric not null default 0,
  primary key (parent_id, component_id)
);

create table stock (
  item_id text references items(id) on delete cascade,
  location_id text references locations(id),
  qty numeric not null default 0 check (qty >= 0),
  primary key (item_id, location_id)
);

create table customers (
  id text primary key,
  name text not null,
  type text,
  channel text,
  email text,
  phone text,
  city text,
  country text,
  igv_exempt boolean not null default false,
  price_list text not null default 'retail' check (price_list in ('retail','wholesale'))
);

-- One row per login. Kept across re-runs.
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  role text not null default 'customer' check (role in ('staff','customer')),
  customer_id text,
  created_at timestamptz not null default now()
);

-- ---------- Sales ----------
create table sales (
  id text primary key,
  kind text not null check (kind in ('POS','SO')),
  customer_id text references customers(id),
  location_id text references locations(id),
  status text not null check (status in ('completed','placed','fulfilled','closed','cancelled')),
  channel text,                        -- store / wholesale / portal
  order_date timestamptz not null default now(),
  requested_date date,
  fulfilled_at timestamptz,
  closed_at timestamptz,
  cancel_reason text,
  order_discount_pct numeric not null default 0,
  notes text,
  is_history boolean not null default false,
  created_by uuid
);

create table sales_lines (
  id bigserial primary key,
  sale_id text references sales(id) on delete cascade,
  item_id text references items(id),
  qty numeric not null check (qty > 0),
  qty_shipped numeric not null default 0,
  qty_returned numeric not null default 0,
  unit_price numeric not null,           -- before IGV
  discount_pct numeric not null default 0,
  tax_rate numeric not null default 0,
  unit_cost numeric                       -- cost at shipment (for COGS)
);

create table returns (
  id text primary key,
  sale_id text references sales(id),
  kind text not null check (kind in ('return','exchange')),
  at timestamptz not null default now(),
  refund_total numeric not null default 0,   -- money back to customer incl. IGV
  exchange_sale_id text references sales(id),
  net_due numeric not null default 0,        -- + customer pays, - store refunds
  notes text,
  created_by uuid
);

create table return_lines (
  id bigserial primary key,
  return_id text references returns(id) on delete cascade,
  sale_line_id bigint references sales_lines(id),
  item_id text references items(id),
  qty numeric not null check (qty > 0),
  condition text not null check (condition in ('resellable','defective')),
  reason text not null,
  to_location_id text references locations(id),
  unit_price numeric not null,
  tax_rate numeric not null,
  unit_cost numeric not null
);

-- ---------- Purchasing ----------
create table purchase_orders (
  id text primary key,
  supplier_id text references suppliers(id),
  status text not null check (status in ('draft','sent','partial','received','closed','cancelled')),
  ship_to_location_id text references locations(id),
  created_at timestamptz not null default now(),
  sent_date date,
  expected_date date,          -- sent_date + supplier quoted lead time
  closed_at timestamptz,
  payment_terms text,
  notes text,
  is_history boolean not null default false
);

create table po_lines (
  id bigserial primary key,
  po_id text references purchase_orders(id) on delete cascade,
  item_id text references items(id),
  qty_ordered numeric not null check (qty_ordered > 0),
  qty_received numeric not null default 0,
  unit_cost numeric not null
);

create table po_receipts (
  id bigserial primary key,
  po_id text references purchase_orders(id) on delete cascade,
  po_line_id bigint references po_lines(id) on delete cascade,
  item_id text references items(id),
  qty numeric not null check (qty > 0),
  location_id text references locations(id),
  received_date date not null,
  unit_cost numeric not null
);

create table supplier_payments (
  id bigserial primary key,
  po_id text references purchase_orders(id) on delete cascade,
  amount numeric not null check (amount > 0),
  paid_date date not null
);

-- ---------- Production ----------
create table work_orders (
  id text primary key,
  item_id text references items(id),
  qty_planned numeric not null check (qty_planned > 0),
  location_id text references locations(id),          -- where it is made; components consumed here
  output_location_id text references locations(id),   -- where good units are received
  status text not null check (status in ('planned','in_progress','completed','cancelled')),
  created_at timestamptz not null default now(),
  due_date date,
  started_at timestamptz,
  finished_at timestamptz,
  clock_started timestamptz,
  clock_finished timestamptz,
  qty_good numeric,
  qty_scrap numeric,
  qty_rework numeric,
  material_cost numeric,
  labor_cost numeric,
  unit_cost numeric,
  cancel_reason text,
  notes text,
  is_history boolean not null default false
);

create table wo_components (
  id bigserial primary key,
  wo_id text references work_orders(id) on delete cascade,
  item_id text references items(id),
  qty_required numeric not null,
  qty_issued numeric not null default 0,
  unit_cost numeric
);

create table wo_issues (
  id bigserial primary key,
  wo_id text references work_orders(id) on delete cascade,
  kind text not null check (kind in ('scrap','rework')),
  qty numeric not null check (qty > 0),
  reason text not null
);

-- ---------- Transaction history ----------
-- Every change to stock writes a move. Stock = opening + sum of moves.
create table inv_moves (
  id bigserial primary key,
  at timestamptz not null default now(),
  item_id text references items(id) on delete cascade,
  location_id text references locations(id),
  qty numeric not null,          -- + into the location, - out of it
  unit_cost numeric not null default 0,
  kind text not null,            -- opening, sale, return, transfer, adjust, receipt, wo_issue, wo_receipt, wo_cancel
  doc_type text,
  doc_id text,
  reason text,
  user_id uuid
);

-- Double-entry accounting journal. Every money effect writes balanced lines.
create table ledger (
  id bigserial primary key,
  at timestamptz not null default now(),
  account text not null,
  debit numeric not null default 0,
  credit numeric not null default 0,
  doc_type text,
  doc_id text,
  memo text
);

create index on sales (order_date);
create index on sales (status);
create index on sales_lines (sale_id);
create index on sales_lines (item_id);
create index on inv_moves (doc_id);
create index on inv_moves (at);
create index on ledger (doc_id);
create index on ledger (at);
create index on ledger (account);
create index on po_lines (po_id);
create index on po_receipts (po_id);
create index on wo_components (wo_id);

-- =====================================================================
-- Security: who can read what. All WRITES go through the functions in
-- 02_logic.sql, which check the user's role and keep every module in sync.
-- =====================================================================
create or replace function is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'staff')
$$;

create or replace function my_customer_id() returns text
language sql stable security definer set search_path = public as $$
  select customer_id from profiles where id = auth.uid()
$$;

do $$
declare t text;
begin
  foreach t in array array['settings','team_config','doc_counters','locations','suppliers','items','bom','stock',
    'customers','profiles','sales','sales_lines','returns','return_lines','purchase_orders','po_lines',
    'po_receipts','supplier_payments','work_orders','wo_components','wo_issues','inv_moves','ledger']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists staff_read on %I', t);
    if t <> 'team_config' then
      execute format('create policy staff_read on %I for select to authenticated using (is_staff())', t);
    end if;
  end loop;
end $$;

-- What customers (portal logins) may see
create policy customer_read on settings  for select to authenticated using (true);
create policy customer_read on locations for select to authenticated using (true);
create policy customer_read on items     for select to authenticated using (active);
create policy customer_read on stock     for select to authenticated using (true);
create policy customer_read on bom       for select to authenticated using (true);
create policy customer_read on customers for select to authenticated using (id = my_customer_id());
create policy customer_read on sales     for select to authenticated using (customer_id = my_customer_id());
create policy customer_read on sales_lines for select to authenticated
  using (exists (select 1 from sales s where s.id = sale_id and s.customer_id = my_customer_id()));
drop policy if exists own_profile on profiles;
create policy own_profile on profiles for select to authenticated using (id = auth.uid());

-- =====================================================================
-- Realtime: every logged-in screen refreshes when these tables change.
-- =====================================================================
do $$
declare t text;
begin
  foreach t in array array['settings','locations','suppliers','items','bom','stock','customers','profiles',
    'sales','sales_lines','returns','return_lines','purchase_orders','po_lines','po_receipts',
    'supplier_payments','work_orders','wo_components','wo_issues','inv_moves','ledger']
  loop
    begin
      execute format('alter publication supabase_realtime add table %I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;
