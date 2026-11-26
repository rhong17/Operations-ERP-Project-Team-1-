-- =====================================================================
-- Textiles Move ERP — 02 BUSINESS LOGIC
-- Every business event is ONE database function (called from the app with
-- supabase.rpc). Each function runs as a single transaction, so inventory,
-- the accounting ledger and the documents always change together — or not
-- at all if something is wrong (e.g. not enough stock).
--
-- Safe to re-run at any time (create or replace). Data is not touched.
--
-- Accounts used in the ledger (double entry, debits = credits):
--   Cash, Inventory, WIP, Accounts Payable, IGV Payable, Wages Payable,
--   Opening Balance Equity, Sales Revenue, Sales Discounts, Sales Returns,
--   COGS, Scrap Expense, Inventory Adjustments
-- =====================================================================

-- ---------------------------------------------------------------------
-- Internal helpers (names start with "_" and cannot be called by the app)
-- ---------------------------------------------------------------------
create or replace function _require_staff() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_staff() then raise exception 'Staff login required for this action'; end if;
end $$;

create or replace function _setting(p_key text) returns numeric
language sql stable security definer set search_path = public as $$
  select value from settings where key = p_key
$$;

-- Next document number, e.g. _next_id('PO') -> 'PO-00042', _next_id('SUP','',2) -> 'SUP08'
create or replace function _next_id(p_prefix text, p_sep text default '-', p_width int default 5) returns text
language plpgsql security definer set search_path = public as $$
declare v int;
begin
  insert into doc_counters(prefix, n) values (p_prefix, 1)
  on conflict (prefix) do update set n = doc_counters.n + 1
  returning n into v;
  return p_prefix || p_sep || lpad(v::text, p_width, '0');
end $$;

-- Post one ledger line (skips zero lines)
create or replace function _gl(p_at timestamptz, p_account text, p_debit numeric, p_credit numeric,
  p_doc_type text, p_doc_id text, p_memo text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if round(coalesce(p_debit,0),2) = 0 and round(coalesce(p_credit,0),2) = 0 then return; end if;
  insert into ledger(at, account, debit, credit, doc_type, doc_id, memo)
  values (p_at, p_account, round(coalesce(p_debit,0),2), round(coalesce(p_credit,0),2), p_doc_type, p_doc_id, p_memo);
end $$;

-- Change on-hand stock for one item at one location and record the move.
-- Refuses to go below zero.
create or replace function _move(p_item text, p_loc text, p_qty numeric, p_cost numeric, p_kind text,
  p_doc_type text, p_doc_id text, p_reason text default null, p_at timestamptz default now()) returns void
language plpgsql security definer set search_path = public as $$
declare v_have numeric; v_name text; v_uom text;
begin
  if coalesce(p_qty,0) = 0 then return; end if;
  insert into stock(item_id, location_id, qty) values (p_item, p_loc, 0) on conflict do nothing;
  select qty into v_have from stock where item_id = p_item and location_id = p_loc for update;
  if v_have + p_qty < -0.00001 then
    select coalesce(name_en, name), case when uom = 'unit' then '' else ' ' || uom end into v_name, v_uom from items where id = p_item;
    raise exception 'Not enough "%" at %: on hand %, needed %', v_name,
      (select coalesce(name_en, name) from locations where id = p_loc),
      trim_scale(round(v_have, 3)) || v_uom, trim_scale(round(-p_qty, 3)) || v_uom;
  end if;
  update stock set qty = greatest(0, round(v_have + p_qty, 4))
   where item_id = p_item and location_id = p_loc;
  insert into inv_moves(at, item_id, location_id, qty, unit_cost, kind, doc_type, doc_id, reason, user_id)
  values (p_at, p_item, p_loc, p_qty, round(coalesce(p_cost,0),4), p_kind, p_doc_type, p_doc_id, p_reason, auth.uid());
end $$;

-- Weighted average cost: blend new units into the item's average BEFORE adding them to stock.
create or replace function _wac_receive(p_item text, p_qty numeric, p_cost numeric) returns void
language plpgsql security definer set search_path = public as $$
declare v_on_hand numeric; v_avg numeric;
begin
  select coalesce(sum(qty),0) into v_on_hand from stock where item_id = p_item;
  select avg_cost into v_avg from items where id = p_item;
  if v_on_hand + p_qty > 0 then
    update items set avg_cost = round((v_on_hand * v_avg + p_qty * p_cost) / (v_on_hand + p_qty), 4)
     where id = p_item;
  end if;
end $$;

-- =====================================================================
-- 12. MULTI-USER: ACTIVITY LOG
-- Every transaction writes one plain-English line saying who did what.
-- Feeds the Activity page and the live "a teammate just did X" notices.
-- (Created here, not in 01, so it can be added without erasing data.)
-- =====================================================================
create table if not exists activity (
  id bigserial primary key,
  at timestamptz not null default now(),
  user_id uuid default auth.uid(),
  kind text not null,          -- sale, order, return, inventory, purchasing, production, master, admin
  doc_id text,
  summary text not null        -- e.g. "sold 2× Women's Tee · Black · M at Gamarra Store · S/ 70.80"
);
create index if not exists activity_at on activity (at desc);
alter table activity enable row level security;
drop policy if exists staff_read on activity;
create policy staff_read on activity for select to authenticated using (is_staff());
grant select on activity to authenticated;
do $$ begin
  alter publication supabase_realtime add table activity;
exception when duplicate_object then null;
end $$;

create or replace function _log(p_kind text, p_doc text, p_summary text) returns void
language sql security definer set search_path = public as $$
  insert into activity(kind, doc_id, summary, user_id) values (p_kind, p_doc, p_summary, auth.uid());
$$;
create or replace function _iname(p_item text) returns text language sql stable security definer set search_path = public as $$
  select coalesce(name_en, name) from items where id = p_item $$;
create or replace function _lname(p_loc text) returns text language sql stable security definer set search_path = public as $$
  select coalesce(name_en, name) from locations where id = p_loc $$;
create or replace function _n(p numeric) returns text language sql immutable as $$ select trim_scale(round(p, 2))::text $$;
create or replace function _money(p numeric) returns text language sql immutable as $$ select 'S/ ' || to_char(round(p, 2), 'FM999,999,990.00') $$;
-- "2× Tee · Black · M, 1× Polo · White · L +3 more" for a sale or a PO
create or replace function _lines_text(p_doc text) returns text
language sql stable security definer set search_path = public as $$
  with l as (
    select _n(qty) || '× ' || _iname(item_id) t, row_number() over (order by id) n, count(*) over () c from sales_lines where sale_id = p_doc
    union all
    select _n(qty_ordered) || '× ' || _iname(item_id), row_number() over (order by id), count(*) over () from po_lines where po_id = p_doc)
  select coalesce(string_agg(t, ', ' order by n) filter (where n <= 3), '') || case when max(c) > 3 then ' +' || (max(c) - 3) || ' more' else '' end from l
$$;

create or replace function _tax_rate(p_customer text) returns numeric
language sql stable security definer set search_path = public as $$
  select case when coalesce((select igv_exempt from customers where id = p_customer), false)
              then 0 else coalesce(_setting('igv_rate'), 0.18) end
$$;

-- Default selling price BEFORE IGV for an item and customer
create or replace function _price(p_item text, p_customer text) returns numeric
language plpgsql stable security definer set search_path = public as $$
declare v_list text; i items%rowtype; v_price numeric;
begin
  select coalesce(price_list,'retail') into v_list from customers where id = p_customer;
  select * into i from items where id = p_item;
  if i.id is null then raise exception 'Unknown item %', p_item; end if;
  if v_list = 'wholesale' and i.wholesale_price is not null then
    v_price := i.wholesale_price;
  elsif i.sale_price is not null then
    v_price := round(i.sale_price / (1 + coalesce(_setting('igv_rate'),0.18)), 2);  -- shelf price includes IGV
  end if;
  if v_price is null then raise exception '"%" is not a sellable item (no price)', coalesce(i.name_en, i.name); end if;
  return v_price;
end $$;

-- Ship part of a sales line: take stock out, record cost, return money totals.
create or replace function _ship_line(p_line bigint, p_qty numeric, p_loc text, p_doc text, p_at timestamptz,
  out gross numeric, out disc numeric, out tax numeric, out cost numeric)
language plpgsql security definer set search_path = public as $$
declare l sales_lines%rowtype; v_cost numeric;
begin
  select * into l from sales_lines where id = p_line for update;
  select avg_cost into v_cost from items where id = l.item_id;
  perform _move(l.item_id, p_loc, -p_qty, v_cost, 'sale', 'sale', p_doc, null, p_at);
  update sales_lines
     set unit_cost = round((qty_shipped * coalesce(unit_cost,0) + p_qty * v_cost) / (qty_shipped + p_qty), 4),
         qty_shipped = qty_shipped + p_qty
   where id = p_line;
  gross := p_qty * l.unit_price;
  disc  := gross * l.discount_pct;
  tax   := (gross - disc) * l.tax_rate;
  cost  := p_qty * v_cost;
end $$;

-- Ledger for a shipment (sale or fulfilment)
create or replace function _post_sale_gl(p_at timestamptz, p_doc text, p_gross numeric, p_disc numeric,
  p_tax numeric, p_cost numeric, p_memo text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _gl(p_at, 'Cash',            round(p_gross - p_disc,2) + round(p_tax,2), 0, 'sale', p_doc, p_memo);
  perform _gl(p_at, 'Sales Discounts', p_disc, 0, 'sale', p_doc, p_memo);
  perform _gl(p_at, 'Sales Revenue',   0, round(p_gross,2), 'sale', p_doc, p_memo);
  -- keep the entry balanced to the cent after rounding
  perform _gl(p_at, 'IGV Payable',     0, round(p_gross - p_disc,2) + round(p_tax,2) + round(p_disc,2) - round(p_gross,2), 'sale', p_doc, p_memo);
  perform _gl(p_at, 'COGS',            p_cost, 0, 'sale', p_doc, p_memo);
  perform _gl(p_at, 'Inventory',       0, p_cost, 'sale', p_doc, p_memo);
end $$;

-- =====================================================================
-- 1. POINT OF SALE
-- p = {customer_id, location_id, notes, lines:[{item_id, qty, unit_price?, discount_pct?}]}
-- =====================================================================
create or replace function post_sale(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_id text := _next_id('POS');
  v_cust text := coalesce(nullif(p->>'customer_id',''), 'CUS01');
  v_loc text := coalesce(nullif(p->>'location_id',''), 'LOC04');
  v_rate numeric; r record; v_line bigint; s record;
  g numeric := 0; d numeric := 0; t numeric := 0; c numeric := 0;
begin
  perform _require_staff();
  if jsonb_array_length(coalesce(p->'lines','[]')) = 0 then raise exception 'Add at least one item'; end if;
  v_rate := _tax_rate(v_cust);
  insert into sales(id, kind, customer_id, location_id, status, channel, order_date, fulfilled_at, notes, created_by)
  values (v_id, 'POS', v_cust, v_loc, 'completed', 'store', now(), now(), p->>'notes', auth.uid());
  for r in select * from jsonb_to_recordset(p->'lines') as x(item_id text, qty numeric, unit_price numeric, discount_pct numeric)
  loop
    if coalesce(r.qty,0) <= 0 then raise exception 'Quantity must be positive'; end if;
    if coalesce(r.discount_pct,0) < 0 or coalesce(r.discount_pct,0) > 0.5 then raise exception 'Discount must be between 0%% and 50%%'; end if;
    insert into sales_lines(sale_id, item_id, qty, unit_price, discount_pct, tax_rate)
    values (v_id, r.item_id, r.qty, coalesce(r.unit_price, _price(r.item_id, v_cust)), coalesce(r.discount_pct,0), v_rate)
    returning id into v_line;
    select * into s from _ship_line(v_line, r.qty, v_loc, v_id, now());
    g := g + s.gross; d := d + s.disc; t := t + s.tax; c := c + s.cost;
  end loop;
  perform _post_sale_gl(now(), v_id, g, d, t, c, 'POS sale');
  perform _log('sale', v_id, 'sold ' || _lines_text(v_id) || ' at ' || _lname(v_loc) || ' · ' || _money(round(g-d,2)+round(t,2)));
  return jsonb_build_object('id', v_id, 'subtotal', round(g-d,2), 'discount', round(d,2), 'tax', round(t,2),
                            'total', round(g-d,2)+round(t,2), 'cost', round(c,2));
end $$;

-- =====================================================================
-- 4. SALES ORDERS  (Order Placed -> Fulfilled -> Closed, or Cancelled)
-- p = {customer_id, location_id, requested_date, notes, lines:[{item_id, qty, unit_price?, discount_pct?}]}
-- =====================================================================
create or replace function _create_order(p jsonb, p_customer text, p_channel text) returns text
language plpgsql security definer set search_path = public as $$
declare v_id text := _next_id('SO'); v_rate numeric := _tax_rate(p_customer); r record;
begin
  if p_customer is null then raise exception 'Choose a customer'; end if;
  if jsonb_array_length(coalesce(p->'lines','[]')) = 0 then raise exception 'Add at least one item'; end if;
  insert into sales(id, kind, customer_id, location_id, status, channel, order_date, requested_date, notes, created_by)
  values (v_id, 'SO', p_customer, coalesce(nullif(p->>'location_id',''),'LOC03'), 'placed', p_channel, now(),
          coalesce(nullif(p->>'requested_date','')::date, current_date + 7), p->>'notes', auth.uid());
  for r in select * from jsonb_to_recordset(p->'lines') as x(item_id text, qty numeric, unit_price numeric, discount_pct numeric)
  loop
    if coalesce(r.qty,0) <= 0 then raise exception 'Quantity must be positive'; end if;
    insert into sales_lines(sale_id, item_id, qty, unit_price, discount_pct, tax_rate)
    values (v_id, r.item_id, r.qty, coalesce(r.unit_price, _price(r.item_id, p_customer)), coalesce(r.discount_pct,0), v_rate);
  end loop;
  return v_id;
end $$;

create or replace function create_sales_order(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_id text;
begin
  perform _require_staff();
  v_id := _create_order(p, nullif(p->>'customer_id',''), coalesce(p->>'channel','wholesale'));
  perform _log('order', v_id, 'created a sales order for ' || (select name from customers where id = p->>'customer_id') || ': ' || _lines_text(v_id));
  return jsonb_build_object('id', v_id);
end $$;

-- 11. CUSTOMER PORTAL: a logged-in customer places an order for pickup
-- Stock that is NOT already promised to open sales orders, per item and location
-- (on hand minus the open quantity of "Order Placed" orders shipping from there).
-- Customers can't read other customers' orders, so the portal asks the database for this number.
create or replace function free_stock() returns table(item_id text, location_id text, qty numeric)
language sql stable security definer set search_path = public as $$
  select s.item_id, s.location_id,
         greatest(0, s.qty - coalesce((
           select sum(l.qty - l.qty_shipped) from sales_lines l join sales o on o.id = l.sale_id
            where o.kind = 'SO' and o.status = 'placed' and o.location_id = s.location_id and l.item_id = s.item_id), 0))
    from stock s join locations lo on lo.id = s.location_id
   where not lo.is_quality_hold and auth.uid() is not null
$$;
revoke execute on function free_stock() from public, anon;
grant execute on function free_stock() to authenticated;

create or replace function place_pickup_order(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_cust text := my_customer_id(); r record; v_have numeric; v_id text;
begin
  if v_cust is null then raise exception 'This login is not linked to a customer account'; end if;
  for r in select x.item_id, sum(x.qty) qty from jsonb_to_recordset(p->'lines') as x(item_id text, qty numeric) group by x.item_id
  loop
    -- only stock that isn't already promised to other customers' orders can be picked up
    select coalesce(sum(f.qty),0) into v_have from free_stock() f where f.item_id = r.item_id and f.location_id = p->>'location_id';
    if r.qty > v_have then
      raise exception 'Only % of "%" available at that location (the rest is reserved for other orders)', trim_scale(round(v_have, 3)), (select coalesce(name_en, name) from items where id = r.item_id);
    end if;
  end loop;
  -- customers cannot set their own prices
  v_id := _create_order(
    jsonb_set(p, '{lines}', (select jsonb_agg(jsonb_build_object('item_id', x->>'item_id', 'qty', (x->>'qty')::numeric)) from jsonb_array_elements(p->'lines') x)),
    v_cust, 'portal');
  perform _log('order', v_id, 'placed a pickup order (customer portal): ' || _lines_text(v_id) || ' · pickup at ' || _lname(p->>'location_id'));
  return jsonb_build_object('id', v_id);
end $$;

-- Ship whatever is available; the rest stays backordered on the order.
create or replace function fulfill_sales_order(p_id text, p_location text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare so sales%rowtype; l record; v_loc text; v_avail numeric; v_ship numeric; s record;
  g numeric := 0; d numeric := 0; t numeric := 0; c numeric := 0; v_shipped numeric := 0; v_back numeric := 0;
begin
  perform _require_staff();
  select * into so from sales where id = p_id for update;
  if so.id is null or so.kind <> 'SO' then raise exception 'Sales order % not found', p_id; end if;
  if so.status <> 'placed' then raise exception 'Only orders with status "Order Placed" can be fulfilled (this one is %)', so.status; end if;
  v_loc := coalesce(nullif(p_location,''), so.location_id);
  for l in select * from sales_lines where sale_id = p_id order by id loop
    continue when l.qty - l.qty_shipped <= 0;
    select coalesce(qty,0) into v_avail from stock where item_id = l.item_id and location_id = v_loc;
    v_ship := least(l.qty - l.qty_shipped, coalesce(v_avail,0));
    if v_ship > 0 then
      select * into s from _ship_line(l.id, v_ship, v_loc, p_id, now());
      g := g + s.gross; d := d + s.disc; t := t + s.tax; c := c + s.cost;
      v_shipped := v_shipped + v_ship;
    end if;
    v_back := v_back + (l.qty - l.qty_shipped - v_ship);
  end loop;
  if v_shipped = 0 then
    raise exception 'Nothing on hand at % to ship — the whole order is backordered', (select coalesce(name_en, name) from locations where id = v_loc);
  end if;
  perform _post_sale_gl(now(), p_id, g, d, t, c, 'Sales order fulfilment');
  if v_back = 0 then
    update sales set status = 'fulfilled', fulfilled_at = now() where id = p_id;
  end if;
  perform _log('order', p_id, 'shipped ' || _n(v_shipped) || ' units on ' || p_id || ' for ' || (select name from customers where id = so.customer_id)
    || case when v_back > 0 then ' (' || _n(v_back) || ' backordered)' else '' end);
  return jsonb_build_object('id', p_id, 'shipped', v_shipped, 'backordered', v_back, 'revenue', round(g-d,2), 'cost', round(c,2));
end $$;

create or replace function close_sales_order(p_id text) returns void
language plpgsql security definer set search_path = public as $$
declare so sales%rowtype;
begin
  perform _require_staff();
  select * into so from sales where id = p_id for update;
  if so.status = 'fulfilled' or (so.status = 'placed' and exists (select 1 from sales_lines where sale_id = p_id and qty_shipped > 0)) then
    update sales set status = 'closed', closed_at = now() where id = p_id;
    perform _log('order', p_id, 'closed sales order ' || p_id);
  else
    raise exception 'Only fulfilled (or partly shipped) orders can be closed';
  end if;
end $$;

create or replace function cancel_sales_order(p_id text, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare so sales%rowtype;
begin
  select * into so from sales where id = p_id for update;
  if not is_staff() and not (so.customer_id = my_customer_id() and so.channel = 'portal') then
    raise exception 'Not allowed';
  end if;
  if so.status <> 'placed' or exists (select 1 from sales_lines where sale_id = p_id and qty_shipped > 0) then
    raise exception 'Only orders that have not shipped anything can be cancelled';
  end if;
  update sales set status = 'cancelled', cancel_reason = coalesce(nullif(p_reason,''),'Cancelled'), closed_at = now() where id = p_id;
  perform _log('order', p_id, 'cancelled sales order ' || p_id || coalesce(' (' || nullif(p_reason,'') || ')', ''));
end $$;

-- =====================================================================
-- 5. RETURNS AND EXCHANGES
-- p = {sale_id, location_id, notes,
--      lines:[{sale_line_id, qty, reason, to_location_id?}],
--      exchange:[{item_id, qty}] }            (exchange optional)
-- Quality-failure reasons send units to the Quality Hold location.
-- =====================================================================
create or replace function process_return(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  so sales%rowtype; v_id text := _next_id('RT'); r record; l sales_lines%rowtype;
  v_cond text; v_to text; v_qh text; v_net numeric; v_tax numeric; v_cost numeric;
  v_refund numeric := 0; v_rnet numeric := 0; v_rtax numeric := 0; v_rcost numeric := 0;
  v_ex jsonb; v_ex_id text; v_ex_total numeric := 0; v_loc text;
  quality_reasons text[] := array['Seam failure','Fabric defect','Color/dye defect','Size/measurement off','Stain or hole'];
begin
  perform _require_staff();
  select * into so from sales where id = p->>'sale_id';
  if so.id is null then raise exception 'Original sale % not found', p->>'sale_id'; end if;
  v_loc := coalesce(nullif(p->>'location_id',''), so.location_id);
  select id into v_qh from locations where is_quality_hold limit 1;
  if jsonb_array_length(coalesce(p->'lines','[]')) = 0 then raise exception 'Choose at least one item to return'; end if;

  insert into returns(id, sale_id, kind, notes, created_by)
  values (v_id, so.id, case when jsonb_array_length(coalesce(p->'exchange','[]')) > 0 then 'exchange' else 'return' end,
          p->>'notes', auth.uid());

  for r in select * from jsonb_to_recordset(p->'lines') as x(sale_line_id bigint, qty numeric, reason text, to_location_id text)
  loop
    select * into l from sales_lines where id = r.sale_line_id and sale_id = so.id for update;
    if l.id is null then raise exception 'That line is not on sale %', so.id; end if;
    if coalesce(r.qty,0) <= 0 then raise exception 'Return quantity must be positive'; end if;
    if r.qty > l.qty_shipped - l.qty_returned then
      raise exception 'Only % of "%" can still be returned', l.qty_shipped - l.qty_returned, (select coalesce(name_en, name) from items where id = l.item_id);
    end if;
    if coalesce(r.reason,'') = '' then raise exception 'A reason code is required for every returned item'; end if;
    v_cond := case when r.reason = any(quality_reasons) then 'defective' else 'resellable' end;
    v_to := case when v_cond = 'defective' then v_qh else coalesce(nullif(r.to_location_id,''), v_loc) end;
    v_net := r.qty * l.unit_price * (1 - l.discount_pct);
    v_tax := v_net * l.tax_rate;
    v_cost := r.qty * coalesce(l.unit_cost, 0);
    -- goods come back at the cost they left with
    perform _wac_receive(l.item_id, r.qty, coalesce(l.unit_cost,0));
    perform _move(l.item_id, v_to, r.qty, coalesce(l.unit_cost,0), 'return', 'return', v_id, r.reason);
    update sales_lines set qty_returned = qty_returned + r.qty where id = l.id;
    insert into return_lines(return_id, sale_line_id, item_id, qty, condition, reason, to_location_id, unit_price, tax_rate, unit_cost)
    values (v_id, l.id, l.item_id, r.qty, v_cond, r.reason, v_to, l.unit_price * (1 - l.discount_pct), l.tax_rate, coalesce(l.unit_cost,0));
    v_rnet := v_rnet + v_net; v_rtax := v_rtax + v_tax; v_rcost := v_rcost + v_cost;
  end loop;
  v_refund := round(v_rnet,2) + round(v_rtax,2);

  -- reverse revenue and cost
  perform _gl(now(), 'Sales Returns', v_rnet, 0, 'return', v_id, 'Customer return of ' || so.id);
  perform _gl(now(), 'IGV Payable',   v_refund - round(v_rnet,2), 0, 'return', v_id, 'IGV refunded');
  perform _gl(now(), 'Cash',          0, v_refund, 'return', v_id, 'Refund');
  perform _gl(now(), 'Inventory',     v_rcost, 0, 'return', v_id, 'Returned goods back in stock');
  perform _gl(now(), 'COGS',          0, v_rcost, 'return', v_id, 'Cost reversed');

  -- exchange: ship replacement items as a new sale linked to this return
  if jsonb_array_length(coalesce(p->'exchange','[]')) > 0 then
    v_ex := post_sale(jsonb_build_object('customer_id', so.customer_id, 'location_id', v_loc,
             'notes', 'Exchange for return ' || v_id || ' (original ' || so.id || ')', 'lines', p->'exchange'));
    v_ex_id := v_ex->>'id';
    v_ex_total := (v_ex->>'total')::numeric;
  end if;

  update returns set refund_total = v_refund, exchange_sale_id = v_ex_id, net_due = round(v_ex_total - v_refund, 2)
   where id = v_id;
  perform _log('return', v_id, case when v_ex_id is null then 'processed a return' else 'processed an exchange' end || ' on ' || so.id
    || ' · refund ' || _money(v_refund) || coalesce(' · new sale ' || v_ex_id, ''));
  return jsonb_build_object('id', v_id, 'refund', v_refund, 'cost_reversed', round(v_rcost,2),
                            'exchange_sale_id', v_ex_id, 'exchange_total', v_ex_total, 'net_due', round(v_ex_total - v_refund,2));
end $$;

-- =====================================================================
-- 2. INVENTORY: transfers and adjustments (cycle count / damage)
-- =====================================================================
create or replace function transfer_stock(p_item text, p_from text, p_to text, p_qty numeric, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_id text := _next_id('TR'); v_cost numeric;
begin
  perform _require_staff();
  if p_from = p_to then raise exception 'Choose two different locations'; end if;
  if coalesce(p_qty,0) <= 0 then raise exception 'Quantity must be positive'; end if;
  select avg_cost into v_cost from items where id = p_item;
  perform _move(p_item, p_from, -p_qty, v_cost, 'transfer', 'transfer', v_id, p_note);
  perform _move(p_item, p_to,    p_qty, v_cost, 'transfer', 'transfer', v_id, p_note);
  perform _log('inventory', v_id, 'moved ' || _n(p_qty) || '× ' || _iname(p_item) || ' from ' || _lname(p_from) || ' to ' || _lname(p_to));
  return jsonb_build_object('id', v_id);
end $$;

-- p = {item_id, location_id, mode:'count'|'delta', qty, reason, note}
create or replace function adjust_stock(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_id text := _next_id('ADJ'); v_have numeric; v_delta numeric; v_cost numeric; v_item text := p->>'item_id'; v_loc text := p->>'location_id';
begin
  perform _require_staff();
  if coalesce(p->>'reason','') = '' then raise exception 'A reason code is required'; end if;
  select coalesce((select qty from stock where item_id = v_item and location_id = v_loc),0) into v_have;
  v_delta := case when p->>'mode' = 'count' then (p->>'qty')::numeric - v_have else (p->>'qty')::numeric end;
  if v_delta = 0 then raise exception 'No change: counted quantity equals the system quantity (%)', v_have; end if;
  select avg_cost into v_cost from items where id = v_item;
  perform _move(v_item, v_loc, v_delta, v_cost, 'adjust', 'adjustment', v_id, p->>'reason' || coalesce(' — ' || nullif(p->>'note',''), ''));
  if v_delta < 0 then
    perform _gl(now(), 'Inventory Adjustments', -v_delta * v_cost, 0, 'adjustment', v_id, p->>'reason');
    perform _gl(now(), 'Inventory', 0, -v_delta * v_cost, 'adjustment', v_id, p->>'reason');
  else
    perform _gl(now(), 'Inventory', v_delta * v_cost, 0, 'adjustment', v_id, p->>'reason');
    perform _gl(now(), 'Inventory Adjustments', 0, v_delta * v_cost, 'adjustment', v_id, p->>'reason');
  end if;
  perform _log('inventory', v_id, 'adjusted ' || _iname(v_item) || ' at ' || _lname(v_loc) || ' by ' || case when v_delta > 0 then '+' else '' end
    || _n(v_delta) || ' (' || (p->>'reason') || ')');
  return jsonb_build_object('id', v_id, 'before', v_have, 'delta', v_delta, 'after', v_have + v_delta, 'value', round(v_delta * v_cost,2));
end $$;

-- =====================================================================
-- 7. PURCHASING AND SUPPLIERS
-- =====================================================================
create or replace function save_supplier(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_id text := nullif(p->>'id','');
begin
  perform _require_staff();
  if coalesce(p->>'name','') = '' then raise exception 'Supplier name is required'; end if;
  if v_id is null then v_id := _next_id('SUP','',2); end if;
  insert into suppliers(id, name, supplier_type, contact_name, email, phone, city, country, lead_time_days, payment_terms, items_supplied, active)
  values (v_id, p->>'name', p->>'supplier_type', p->>'contact_name', p->>'email', p->>'phone', p->>'city', p->>'country',
          coalesce((p->>'lead_time_days')::int, 7), coalesce(nullif(p->>'payment_terms',''),'Net 30'), p->>'items_supplied',
          coalesce((p->>'active')::boolean, true))
  on conflict (id) do update set name = excluded.name, supplier_type = excluded.supplier_type, contact_name = excluded.contact_name,
    email = excluded.email, phone = excluded.phone, city = excluded.city, country = excluded.country,
    lead_time_days = excluded.lead_time_days, payment_terms = excluded.payment_terms,
    items_supplied = excluded.items_supplied, active = excluded.active;
  -- bought items take their supplier's quoted lead time (feeds ROP, EOQ and MRP)
  update items set lead_time_days = (p->>'lead_time_days')::int
   where supplier_id = v_id and make_or_buy = 'Buy' and p->>'lead_time_days' is not null;
  perform _log('master', v_id, 'saved supplier ' || (p->>'name'));
  return jsonb_build_object('id', v_id);
end $$;

-- p = {supplier_id, ship_to_location_id, notes, send:boolean, sent_date?, lines:[{item_id, qty, unit_cost?}]}
create or replace function create_po(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_id text := _next_id('PO'); r record;
begin
  perform _require_staff();
  if not exists (select 1 from suppliers where id = p->>'supplier_id') then raise exception 'Choose a supplier'; end if;
  if jsonb_array_length(coalesce(p->'lines','[]')) = 0 then raise exception 'Add at least one item'; end if;
  insert into purchase_orders(id, supplier_id, status, ship_to_location_id, notes, payment_terms)
  values (v_id, p->>'supplier_id', 'draft', coalesce(nullif(p->>'ship_to_location_id',''),'LOC01'), p->>'notes',
          (select payment_terms from suppliers where id = p->>'supplier_id'));
  for r in select * from jsonb_to_recordset(p->'lines') as x(item_id text, qty numeric, unit_cost numeric) loop
    if coalesce(r.qty,0) <= 0 then raise exception 'Quantity must be positive'; end if;
    insert into po_lines(po_id, item_id, qty_ordered, unit_cost)
    values (v_id, r.item_id, r.qty, coalesce(r.unit_cost, (select std_cost from items where id = r.item_id)));
  end loop;
  perform _log('purchasing', v_id, 'created ' || v_id || ' for ' || (select name from suppliers where id = p->>'supplier_id') || ': ' || _lines_text(v_id));
  if coalesce((p->>'send')::boolean, false) then perform send_po(v_id, nullif(p->>'sent_date','')::date); end if;
  return jsonb_build_object('id', v_id);
end $$;

-- Order Sent: expected receipt date = sent date + supplier's quoted lead time
create or replace function send_po(p_id text, p_date date default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare po purchase_orders%rowtype; v_lt int; v_date date := coalesce(p_date, current_date);
begin
  perform _require_staff();
  select * into po from purchase_orders where id = p_id for update;
  if po.status <> 'draft' then raise exception 'Only draft POs can be sent'; end if;
  select lead_time_days into v_lt from suppliers where id = po.supplier_id;
  update purchase_orders set status = 'sent', sent_date = v_date, expected_date = v_date + v_lt,
    payment_terms = (select payment_terms from suppliers where id = po.supplier_id)
   where id = p_id;
  perform _log('purchasing', p_id, 'sent ' || p_id || ' to ' || (select name from suppliers where id = po.supplier_id) || ' · expected ' || to_char(v_date + v_lt, 'Mon DD'));
  return jsonb_build_object('id', p_id, 'expected_date', v_date + v_lt);
end $$;

-- p = {po_id, location_id, received_date, lines:[{po_line_id, qty}]}
create or replace function receive_po(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare po purchase_orders%rowtype; r record; l po_lines%rowtype; v_loc text; v_date date; v_at timestamptz;
  v_value numeric := 0; v_qty numeric := 0;
begin
  perform _require_staff();
  select * into po from purchase_orders where id = p->>'po_id' for update;
  if po.id is null then raise exception 'PO not found'; end if;
  if po.status not in ('sent','partial') then raise exception 'Only sent POs can be received (this one is %)', po.status; end if;
  v_loc := coalesce(nullif(p->>'location_id',''), po.ship_to_location_id);
  v_date := coalesce(nullif(p->>'received_date','')::date, current_date);
  if v_date > current_date then raise exception 'Receipt date cannot be in the future'; end if;
  if v_date < po.sent_date then raise exception 'Receipt date cannot be before the PO was sent'; end if;
  v_at := case when v_date = current_date then now() else v_date + time '12:00' end;
  for r in select * from jsonb_to_recordset(p->'lines') as x(po_line_id bigint, qty numeric) loop
    continue when coalesce(r.qty,0) = 0;
    select * into l from po_lines where id = r.po_line_id and po_id = po.id for update;
    if l.id is null then raise exception 'Line not on this PO'; end if;
    if r.qty < 0 then raise exception 'Quantity must be positive'; end if;
    if r.qty > l.qty_ordered - l.qty_received + 0.0001 then
      raise exception 'Receiving % of "%" but only % is still open on the PO', r.qty, (select coalesce(name_en, name) from items where id = l.item_id), l.qty_ordered - l.qty_received;
    end if;
    perform _wac_receive(l.item_id, r.qty, l.unit_cost);
    perform _move(l.item_id, v_loc, r.qty, l.unit_cost, 'receipt', 'po', po.id, null, v_at);
    update po_lines set qty_received = qty_received + r.qty where id = l.id;
    insert into po_receipts(po_id, po_line_id, item_id, qty, location_id, received_date, unit_cost)
    values (po.id, l.id, l.item_id, r.qty, v_loc, v_date, l.unit_cost);
    v_value := v_value + r.qty * l.unit_cost; v_qty := v_qty + r.qty;
  end loop;
  if v_qty = 0 then raise exception 'Enter a quantity to receive'; end if;
  perform _gl(v_at, 'Inventory', v_value, 0, 'po', po.id, 'Goods received');
  perform _gl(v_at, 'Accounts Payable', 0, v_value, 'po', po.id, 'Supplier invoice');
  update purchase_orders set status = case when exists (select 1 from po_lines where po_id = po.id and qty_received < qty_ordered)
                                           then 'partial' else 'received' end
   where id = po.id;
  perform _log('purchasing', po.id, 'received ' || _n(v_qty) || ' units on ' || po.id || ' into ' || _lname(v_loc) || ' · ' || _money(v_value));
  return jsonb_build_object('id', po.id, 'qty', v_qty, 'value', round(v_value,2),
         'days_vs_expected', v_date - po.expected_date);
end $$;

create or replace function close_po(p_id text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _require_staff();
  update purchase_orders set status = 'closed', closed_at = now() where id = p_id and status in ('received','partial');
  if not found then raise exception 'Only received or partly received POs can be closed'; end if;
  perform _log('purchasing', p_id, 'closed ' || p_id);
end $$;

create or replace function cancel_po(p_id text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _require_staff();
  update purchase_orders set status = 'cancelled', closed_at = now() where id = p_id and status in ('draft','sent');
  if not found then raise exception 'Only draft or sent POs with nothing received can be cancelled'; end if;
  perform _log('purchasing', p_id, 'cancelled ' || p_id);
end $$;

create or replace function pay_po(p_id text, p_amount numeric, p_date date default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_billed numeric; v_paid numeric; v_terms text;
begin
  perform _require_staff();
  select payment_terms into v_terms from purchase_orders where id = p_id;
  select case when v_terms = 'Prepaid' then coalesce(sum(qty_ordered * unit_cost),0) else coalesce(sum(qty_received * unit_cost),0) end
    into v_billed from po_lines where po_id = p_id;
  select coalesce(sum(amount),0) into v_paid from supplier_payments where po_id = p_id;
  if p_amount <= 0 or round(p_amount,2) > round(v_billed - v_paid,2) then
    raise exception 'Payment must be between 0 and the open balance (S/ %)', round(v_billed - v_paid,2);
  end if;
  insert into supplier_payments(po_id, amount, paid_date) values (p_id, round(p_amount,2), coalesce(p_date, current_date));
  perform _gl(now(), 'Accounts Payable', p_amount, 0, 'payment', p_id, 'Supplier payment');
  perform _gl(now(), 'Cash', 0, p_amount, 'payment', p_id, 'Supplier payment');
  perform _log('purchasing', p_id, 'paid ' || _money(p_amount) || ' on ' || p_id);
  return jsonb_build_object('id', p_id, 'balance', round(v_billed - v_paid - p_amount,2));
end $$;

-- =====================================================================
-- 6. PRODUCTION ORDERS (work orders)
-- Planned -> In Progress (Issue materials) -> Completed, or Cancelled
-- =====================================================================
-- p = {item_id, qty, location_id, output_location_id, due_date, notes}
create or replace function create_wo(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_id text := _next_id('WO'); v_item items%rowtype; v_qty numeric := (p->>'qty')::numeric;
begin
  perform _require_staff();
  select * into v_item from items where id = p->>'item_id';
  if v_item.id is null or not exists (select 1 from bom where parent_id = v_item.id) then
    raise exception 'Choose an item that has a bill of materials';
  end if;
  if coalesce(v_qty,0) <= 0 or v_qty <> trunc(v_qty) then raise exception 'Quantity must be a whole number above zero'; end if;
  insert into work_orders(id, item_id, qty_planned, location_id, output_location_id, status, due_date, notes)
  values (v_id, v_item.id, v_qty, coalesce(nullif(p->>'location_id',''),'LOC02'), coalesce(nullif(p->>'output_location_id',''),'LOC03'),
          'planned', coalesce(nullif(p->>'due_date','')::date, current_date + v_item.lead_time_days), p->>'notes');
  -- BOM qty x quantity + scrap allowance. Fabric (kg) and thread (cones) can be partial;
  -- countable items (labels, bags, boxes, tees) are rounded UP to whole units.
  insert into wo_components(wo_id, item_id, qty_required)
  select v_id, b.component_id,
         case when c.uom in ('kg','cone') then round(v_qty * b.qty_per * (1 + b.scrap_pct), 4)
              else ceil(round(v_qty * b.qty_per * (1 + b.scrap_pct), 4)) end
    from bom b join items c on c.id = b.component_id
   where b.parent_id = v_item.id;
  perform _log('production', v_id, 'created ' || v_id || ': ' || _n(v_qty) || '× ' || coalesce(v_item.name_en, v_item.name)
    || ' · due ' || to_char(coalesce(nullif(p->>'due_date','')::date, current_date + v_item.lead_time_days), 'Mon DD'));
  return jsonb_build_object('id', v_id);
end $$;

-- Issue materials: consume every component per the BOM (all or nothing)
create or replace function issue_wo(p_id text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare wo work_orders%rowtype; c record; v_cost numeric; v_total numeric := 0;
begin
  perform _require_staff();
  select * into wo from work_orders where id = p_id for update;
  if wo.status <> 'planned' then raise exception 'Materials can only be issued for planned work orders'; end if;
  for c in select * from wo_components where wo_id = p_id loop
    select avg_cost into v_cost from items where id = c.item_id;
    perform _move(c.item_id, wo.location_id, -c.qty_required, v_cost, 'wo_issue', 'wo', p_id);
    update wo_components set qty_issued = c.qty_required, unit_cost = v_cost where id = c.id;
    v_total := v_total + c.qty_required * v_cost;
  end loop;
  perform _gl(now(), 'WIP', v_total, 0, 'wo', p_id, 'Materials issued to production');
  perform _gl(now(), 'Inventory', 0, v_total, 'wo', p_id, 'Materials issued to production');
  update work_orders set status = 'in_progress', started_at = now(), clock_started = now(), material_cost = round(v_total,4) where id = p_id;
  perform _log('production', p_id, 'issued materials to ' || p_id || ' (' || _n(wo.qty_planned) || '× ' || _iname(wo.item_id) || ') · ' || _money(v_total) || ' into WIP');
  return jsonb_build_object('id', p_id, 'material_cost', round(v_total,2));
end $$;

-- p = {id, qty_good, issues:[{kind:'scrap'|'rework', qty, reason}], started_at, finished_at, output_location_id}
create or replace function complete_wo(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare wo work_orders%rowtype; v_item items%rowtype; r record;
  v_good numeric := (p->>'qty_good')::numeric; v_scrap numeric := 0; v_rework numeric := 0;
  v_start timestamptz; v_finish timestamptz; v_labor numeric; v_total numeric; v_unit numeric; v_out text;
begin
  perform _require_staff();
  select * into wo from work_orders where id = p->>'id' for update;
  if wo.status <> 'in_progress' then raise exception 'Only in-progress work orders can be completed (issue materials first)'; end if;
  select * into v_item from items where id = wo.item_id;
  for r in select * from jsonb_to_recordset(coalesce(p->'issues','[]')) as x(kind text, qty numeric, reason text) loop
    continue when coalesce(r.qty,0) = 0;
    if r.kind not in ('scrap','rework') then raise exception 'Issue type must be scrap or rework'; end if;
    if coalesce(r.reason,'') = '' then raise exception 'Each scrap or rework quantity needs a reason code'; end if;
    insert into wo_issues(wo_id, kind, qty, reason) values (wo.id, r.kind, r.qty, r.reason);
    if r.kind = 'scrap' then v_scrap := v_scrap + r.qty; else v_rework := v_rework + r.qty; end if;
  end loop;
  if v_good is null or v_good < 0 then raise exception 'Enter the good quantity'; end if;
  if v_good + v_scrap <> wo.qty_planned then
    raise exception 'Good (%) + scrap (%) must equal the quantity started (%)', v_good, v_scrap, wo.qty_planned;
  end if;
  if v_rework > v_good then raise exception 'Reworked units are good units that needed fixing, so rework cannot exceed good'; end if;
  v_start := coalesce(nullif(p->>'started_at','')::timestamptz, wo.started_at);
  v_finish := coalesce(nullif(p->>'finished_at','')::timestamptz, now());
  if v_finish <= v_start then raise exception 'Finish time must be after start time'; end if;
  if v_finish > now() + interval '5 minutes' then raise exception 'Finish time cannot be in the future'; end if;

  -- cost roll-up: components actually issued + cut & sew labour, spread over units started
  v_labor := wo.qty_planned * v_item.labor_cost;
  v_total := wo.material_cost + v_labor;
  v_unit := v_total / wo.qty_planned;
  v_out := coalesce(nullif(p->>'output_location_id',''), wo.output_location_id);
  if v_good > 0 then
    perform _wac_receive(wo.item_id, v_good, v_unit);
    perform _move(wo.item_id, v_out, v_good, v_unit, 'wo_receipt', 'wo', wo.id, null, v_finish);
  end if;
  -- good units go to stock; the cost of scrapped units is expensed (cost of poor quality)
  perform _gl(v_finish, 'Inventory',     round(v_good * v_unit,2), 0, 'wo', wo.id, 'Finished goods received');
  perform _gl(v_finish, 'Scrap Expense', round(wo.material_cost,2) + round(v_labor,2) - round(v_good * v_unit,2), 0, 'wo', wo.id, 'Scrapped units expensed');
  perform _gl(v_finish, 'WIP',           0, round(wo.material_cost,2), 'wo', wo.id, 'Materials leave WIP');
  perform _gl(v_finish, 'Wages Payable', 0, round(v_labor,2), 'wo', wo.id, 'Cut & sew labour applied');
  update work_orders set status = 'completed', qty_good = v_good, qty_scrap = v_scrap, qty_rework = v_rework,
    started_at = v_start, finished_at = v_finish, clock_finished = now(), labor_cost = round(v_labor,4),
    unit_cost = round(v_unit,4), output_location_id = v_out
   where id = wo.id;
  perform _log('production', wo.id, 'completed ' || wo.id || ': ' || _n(v_good) || ' good' || case when v_scrap > 0 then ', ' || _n(v_scrap) || ' scrap' else '' end
    || ' × ' || coalesce(v_item.name_en, v_item.name) || ' → ' || _lname(v_out));
  return jsonb_build_object('id', wo.id, 'good', v_good, 'scrap', v_scrap, 'rework', v_rework,
                            'unit_cost', round(v_unit,4), 'total_cost', round(v_total,2));
end $$;

create or replace function cancel_wo(p_id text, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare wo work_orders%rowtype; c record; v_total numeric := 0;
begin
  perform _require_staff();
  if coalesce(p_reason,'') = '' then raise exception 'A cancel reason is required'; end if;
  select * into wo from work_orders where id = p_id for update;
  if wo.status not in ('planned','in_progress') then raise exception 'Completed or cancelled work orders cannot be cancelled'; end if;
  if wo.status = 'in_progress' then
    for c in select * from wo_components where wo_id = p_id and qty_issued > 0 loop
      perform _wac_receive(c.item_id, c.qty_issued, c.unit_cost);
      perform _move(c.item_id, wo.location_id, c.qty_issued, c.unit_cost, 'wo_cancel', 'wo', p_id, p_reason);
      v_total := v_total + c.qty_issued * c.unit_cost;
    end loop;
    perform _gl(now(), 'Inventory', v_total, 0, 'wo', p_id, 'Components returned from cancelled WO');
    perform _gl(now(), 'WIP', 0, v_total, 'wo', p_id, 'Components returned from cancelled WO');
  end if;
  update work_orders set status = 'cancelled', cancel_reason = p_reason, finished_at = now() where id = p_id;
  perform _log('production', p_id, 'cancelled ' || p_id || ' (' || p_reason || ')');
  return jsonb_build_object('id', p_id, 'returned_value', round(v_total,2));
end $$;

-- =====================================================================
-- MASTER DATA EDITS
-- =====================================================================
create or replace function save_item(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_id text := nullif(p->>'id','');
begin
  perform _require_staff();
  if coalesce(p->>'name','') = '' or coalesce(p->>'ean','') = '' then raise exception 'Name and barcode are required'; end if;
  if v_id is null then v_id := _next_id('ITM'); end if;
  insert into items(id, ean, sku, name, name_en, item_type, uom, std_cost, avg_cost, labor_cost, sale_price, wholesale_price,
                    make_or_buy, supplier_id, lead_time_days, lot_rule, lot_qty, active, color, size, gender, style, source)
  values (v_id, p->>'ean', p->>'sku', p->>'name', nullif(p->>'name_en',''), coalesce(p->>'item_type','Component'), coalesce(p->>'uom','unit'),
          coalesce((p->>'std_cost')::numeric,0), coalesce((p->>'std_cost')::numeric,0), coalesce((p->>'labor_cost')::numeric,0),
          nullif(p->>'sale_price','')::numeric, nullif(p->>'wholesale_price','')::numeric,
          coalesce(p->>'make_or_buy','Buy'), nullif(p->>'supplier_id',''), coalesce((p->>'lead_time_days')::int,0),
          coalesce(nullif(p->>'lot_rule',''),'L4L'), nullif(p->>'lot_qty','')::numeric, coalesce((p->>'active')::boolean,true),
          p->>'color', p->>'size', p->>'gender', p->>'style', 'Added in ERP')
  on conflict (id) do update set ean = excluded.ean, name = excluded.name, name_en = excluded.name_en, sale_price = excluded.sale_price,
    wholesale_price = excluded.wholesale_price, std_cost = excluded.std_cost, labor_cost = excluded.labor_cost,
    supplier_id = excluded.supplier_id, lead_time_days = excluded.lead_time_days, lot_rule = excluded.lot_rule,
    lot_qty = excluded.lot_qty, active = excluded.active;
  perform _log('master', v_id, 'saved item ' || coalesce(nullif(p->>'name_en',''), p->>'name'));
  return jsonb_build_object('id', v_id);
end $$;

create or replace function save_bom_line(p_parent text, p_component text, p_qty numeric, p_scrap numeric default 0) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _require_staff();
  if p_parent = p_component then raise exception 'An item cannot be its own component'; end if;
  if coalesce(p_qty,0) <= 0 then
    delete from bom where parent_id = p_parent and component_id = p_component;
  else
    insert into bom(parent_id, component_id, qty_per, scrap_pct) values (p_parent, p_component, p_qty, coalesce(p_scrap,0))
    on conflict (parent_id, component_id) do update set qty_per = excluded.qty_per, scrap_pct = excluded.scrap_pct;
  end if;
  perform _log('master', p_parent, 'changed the bill of materials of ' || _iname(p_parent) || ': ' || _iname(p_component)
    || case when coalesce(p_qty,0) <= 0 then ' removed' else ' = ' || _n(p_qty) || ' per unit' end);
end $$;

create or replace function save_customer(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_id text := nullif(p->>'id','');
begin
  perform _require_staff();
  if coalesce(p->>'name','') = '' then raise exception 'Customer name is required'; end if;
  if v_id is null then v_id := _next_id('CUS','',2); end if;
  insert into customers(id, name, type, channel, email, phone, city, country, igv_exempt, price_list)
  values (v_id, p->>'name', p->>'type', p->>'channel', p->>'email', p->>'phone', p->>'city', coalesce(p->>'country','Peru'),
          coalesce((p->>'igv_exempt')::boolean,false), coalesce(nullif(p->>'price_list',''),'retail'))
  on conflict (id) do update set name = excluded.name, type = excluded.type, channel = excluded.channel, email = excluded.email,
    phone = excluded.phone, city = excluded.city, country = excluded.country, igv_exempt = excluded.igv_exempt, price_list = excluded.price_list;
  perform _log('master', v_id, 'saved customer ' || (p->>'name'));
  return jsonb_build_object('id', v_id);
end $$;

create or replace function save_setting(p_key text, p_value numeric) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _require_staff();
  update settings set value = p_value where key = p_key;
  if not found then raise exception 'Unknown setting %', p_key; end if;
  perform _log('admin', null, 'changed setting ' || p_key || ' to ' || _n(p_value));
end $$;

-- =====================================================================
-- 12. USERS AND ROLES
-- New sign-ups become customers, unless they enter the team code (staff).
-- =====================================================================
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_code text := nullif(new.raw_user_meta_data->>'team_code','');
        v_name text := coalesce(nullif(new.raw_user_meta_data->>'full_name',''), split_part(new.email,'@',1));
        v_cust text;
begin
  if v_code is not null and exists (select 1 from team_config where team_code = v_code) then
    insert into profiles(id, email, full_name, role) values (new.id, new.email, v_name, 'staff') on conflict (id) do nothing;
  else
    select id into v_cust from customers where lower(email) = lower(new.email) limit 1;
    if v_cust is null then
      v_cust := _next_id('CUS','',2);
      insert into customers(id, name, type, channel, email, city, country, price_list)
      values (v_cust, v_name, 'Portal customer', 'Retail', new.email, 'Lima', 'Peru', 'retail');
    end if;
    insert into profiles(id, email, full_name, role, customer_id) values (new.id, new.email, v_name, 'customer', v_cust)
    on conflict (id) do nothing;
  end if;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function handle_new_user();

create or replace function claim_staff(p_code text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Log in first'; end if;
  if not exists (select 1 from team_config where team_code = p_code) then raise exception 'Wrong team code'; end if;
  update profiles set role = 'staff' where id = auth.uid();
end $$;

create or replace function set_user_role(p_user uuid, p_role text, p_customer text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _require_staff();
  if p_user = auth.uid() and p_role <> 'staff' then raise exception 'You cannot remove your own staff access'; end if;
  update profiles set role = p_role, customer_id = coalesce(p_customer, customer_id) where id = p_user;
  perform _log('admin', null, 'changed ' || coalesce((select full_name from profiles where id = p_user), 'a user') || ' to ' || p_role);
end $$;

create or replace function set_team_code(p_code text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _require_staff();
  if length(coalesce(p_code,'')) < 6 then raise exception 'Use at least 6 characters'; end if;
  update team_config set team_code = p_code where id = 1;
  perform _log('admin', null, 'changed the team code');
end $$;

-- =====================================================================
-- 9. FINANCIAL REPORTING helpers (computed from the ledger)
-- Dates are business dates in Lima time.
-- =====================================================================
create or replace function ledger_totals(p_from date, p_to date)
returns table(account text, debit numeric, credit numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  perform _require_staff();
  return query
    select l.account, sum(l.debit), sum(l.credit) from ledger l
     where (l.at at time zone 'America/Lima')::date between p_from and p_to
     group by l.account;
end $$;

-- Value of Inventory + WIP accounts at the END of a given day
create or replace function inventory_value_at(p_date date) returns numeric
language plpgsql stable security definer set search_path = public as $$
declare v numeric;
begin
  perform _require_staff();
  select coalesce(sum(debit - credit),0) into v from ledger
   where account in ('Inventory','WIP') and (at at time zone 'America/Lima')::date <= p_date;
  return v;
end $$;

-- Weekly / daily sales summary for charts
create or replace function sales_by_period(p_from date, p_to date, p_grain text default 'week')
returns table(period date, orders bigint, units numeric, revenue numeric, cost numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  perform _require_staff();
  return query
    select date_trunc(p_grain, (s.coalesce_at at time zone 'America/Lima'))::date,
           count(distinct s.id), sum(l.qty_shipped),
           sum(l.qty_shipped * l.unit_price * (1 - l.discount_pct)), sum(l.qty_shipped * coalesce(l.unit_cost,0))
      from (select id, coalesce(fulfilled_at, order_date) coalesce_at from sales where status <> 'cancelled') s
      join sales_lines l on l.sale_id = s.id
     where (s.coalesce_at at time zone 'America/Lima')::date between p_from and p_to
     group by 1 order by 1;
end $$;

create or replace function reset_demo() returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _require_staff();
  perform load_seed();
  truncate activity;
  perform _log('admin', null, 'reset the demo data');
end $$;

-- Lock down internal helpers so the app cannot call them directly
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and (p.proname like '\_%' or p.proname in ('handle_new_user','load_seed'))
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
  end loop;
end $$;
