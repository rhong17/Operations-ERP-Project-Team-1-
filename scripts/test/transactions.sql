-- Automated checks for every business transaction.
-- Run with: bash scripts/test/run.sh   (needs a local Postgres)
\set ON_ERROR_STOP 1
\set QUIET 1
set client_min_messages = warning;

-- helper: assert
create or replace function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FAIL: %', msg; end if;
  raise notice 'ok - %', msg;
end $$;
create or replace function pg_temp.q(p_item text, p_loc text) returns numeric language sql as $$
  select coalesce((select qty from stock where item_id = p_item and location_id = p_loc), 0) $$;
create or replace function pg_temp.balanced() returns boolean language sql as $$
  select round(sum(debit) - sum(credit), 2) = 0 from ledger $$;
create or replace function pg_temp.gl_matches_stock() returns boolean language sql as $$
  select abs((select sum(debit-credit) from ledger where account='Inventory')
           - (select sum(s.qty*i.avg_cost) from stock s join items i on i.id=s.item_id)) < 1.00 $$;
set client_min_messages = notice;

-- ---------- users ----------
insert into auth.users(id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-000000000001', 'staff@test.pe', '{"full_name":"Staff Tester","team_code":"change-me-2026"}'),
  ('00000000-0000-0000-0000-000000000002', 'shopper@test.pe', '{"full_name":"Portal Shopper"}'),
  ('00000000-0000-0000-0000-000000000003', 'guess@test.pe', '{"team_code":"wrong-code"}');
select pg_temp.ok((select role from profiles where email='staff@test.pe') = 'staff', 'team code sign-up becomes staff');
select pg_temp.ok((select role from profiles where email='shopper@test.pe') = 'customer', 'plain sign-up becomes customer');
select pg_temp.ok((select role from profiles where email='guess@test.pe') = 'customer', 'wrong team code stays customer');
select pg_temp.ok((select customer_id from profiles where email='shopper@test.pe') = 'CUS13', 'customer record created for portal sign-up');

-- ---------- customers cannot post staff transactions ----------
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', false);
do $$ begin
  perform post_sale('{"lines":[{"item_id":"FG01","qty":1}]}');
  raise exception 'FAIL: customer was allowed to post a sale';
exception when others then
  if sqlerrm like 'FAIL%' then raise; end if;
  raise notice 'ok - customer blocked from POS (%)', sqlerrm;
end $$;

-- customer places a pickup order
select place_pickup_order('{"location_id":"LOC04","lines":[{"item_id":"FG01","qty":2,"unit_price":0.01}]}') ->> 'id' as pickup \gset
select pg_temp.ok((select customer_id from sales where id = :'pickup') = 'CUS13', 'pickup order belongs to the customer');
select pg_temp.ok((select unit_price from sales_lines where sale_id = :'pickup') = 25.34, 'customer cannot set own price (retail price used)');
-- stock promised to open wholesale orders cannot be taken by a portal customer
select pg_temp.ok((select qty from free_stock() where item_id = 'FG02' and location_id = 'LOC03') =
  greatest(0, pg_temp.q('FG02','LOC03') - (select sum(l.qty - l.qty_shipped) from sales_lines l join sales s on s.id = l.sale_id
    where s.kind = 'SO' and s.status = 'placed' and s.location_id = 'LOC03' and l.item_id = 'FG02')), 'free stock = on hand minus open orders');
do $$ begin
  perform place_pickup_order(json_build_object('location_id','LOC03','lines', json_build_array(json_build_object('item_id','FG02','qty',
    (select qty from free_stock() where item_id='FG02' and location_id='LOC03') + 1)))::jsonb);
  raise exception 'FAIL: portal took stock reserved for another order';
exception when others then
  if sqlerrm like 'FAIL%' then raise; end if;
  raise notice 'ok - portal cannot take reserved stock (%)', sqlerrm;
end $$;

-- ---------- staff ----------
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', false);

-- 1. POS sale: inventory down, revenue + COGS posted
select pg_temp.q('FG02','LOC04') as fg02_before \gset
select post_sale('{"customer_id":"CUS01","location_id":"LOC04","lines":[{"item_id":"FG02","qty":2},{"item_id":"FG03","qty":1,"discount_pct":0.10}]}') as sale \gset
select (:'sale'::jsonb)->>'id' as sale_id \gset
select pg_temp.ok(pg_temp.q('FG02','LOC04') = :fg02_before - 2, 'POS reduces stock at the store');
select pg_temp.ok(((:'sale'::jsonb)->>'total')::numeric = round(2*25.34 + 25.34*0.9, 2) + round((2*25.34 + 25.34*0.9)*0.18, 2), 'POS total = net + 18% IGV');
select pg_temp.ok((select sum(credit) from ledger where doc_id = :'sale_id' and account = 'Sales Revenue') = round(3*25.34,2), 'revenue posted (gross)');
select pg_temp.ok((select sum(debit) from ledger where doc_id = :'sale_id' and account = 'Sales Discounts') = 2.53, 'discount posted');
select pg_temp.ok((select sum(debit) from ledger where doc_id = :'sale_id' and account = 'COGS') > 0, 'COGS posted');
select pg_temp.ok(pg_temp.balanced(), 'ledger balanced after POS');

-- stock cannot go negative
do $$ begin
  perform post_sale('{"location_id":"LOC04","lines":[{"item_id":"FG14","qty":9999}]}');
  raise exception 'FAIL: oversell allowed';
exception when others then
  if sqlerrm like 'FAIL%' then raise; end if;
  raise notice 'ok - oversell blocked (%)', sqlerrm;
end $$;

-- 2. Transfer & adjustment
select pg_temp.q('C01','LOC01') as c01a \gset
select pg_temp.q('C01','LOC02') as c01b \gset
select transfer_stock('C01','LOC01','LOC02',10,'test');
select pg_temp.ok(pg_temp.q('C01','LOC01') = :c01a - 10 and pg_temp.q('C01','LOC02') = :c01b + 10, 'transfer moves stock between locations');
select adjust_stock('{"item_id":"FG01","location_id":"LOC04","mode":"count","qty":30,"reason":"Cycle count"}') as adj \gset
select pg_temp.ok(pg_temp.q('FG01','LOC04') = 30, 'cycle count sets stock to counted qty');
select pg_temp.ok((select debit from ledger where doc_id = (:'adj'::jsonb)->>'id' and account='Inventory Adjustments') > 0, 'shrinkage expensed');
do $$ begin
  perform adjust_stock('{"item_id":"FG01","location_id":"LOC04","mode":"delta","qty":-1}');
  raise exception 'FAIL: adjustment without reason';
exception when others then
  if sqlerrm like 'FAIL%' then raise; end if;
  raise notice 'ok - reason code required';
end $$;

-- 4. Sales order with partial fulfilment (backorder)
select create_sales_order('{"customer_id":"CUS03","location_id":"LOC03","lines":[{"item_id":"FG14","qty":20},{"item_id":"FG13","qty":5}]}') ->> 'id' as so \gset
select pg_temp.ok((select status from sales where id = :'so') = 'placed', 'new SO is Order Placed');
select pg_temp.ok((select unit_price from sales_lines where sale_id = :'so' and item_id='FG14') = 42, 'wholesale customer gets wholesale price');
select fulfill_sales_order(:'so') as ful \gset
select pg_temp.ok(((:'ful'::jsonb)->>'backordered')::numeric = 8, 'ships 12 dresses on hand, 8 backordered');
select pg_temp.ok((select status from sales where id = :'so') = 'placed', 'partially shipped SO stays open');
select pg_temp.ok(pg_temp.q('FG14','LOC03') = 0, 'dress stock at warehouse used up');
select close_sales_order(:'so');
select pg_temp.ok((select status from sales where id = :'so') = 'closed', 'SO can be closed short');
select pg_temp.ok(pg_temp.balanced(), 'ledger balanced after SO');

select cancel_sales_order('SO-00005', 'Customer changed plan');
select pg_temp.ok((select status from sales where id = 'SO-00005') = 'cancelled', 'unshipped SO cancelled');

-- 5. Return (resellable + quality failure) and exchange
select id as line1 from sales_lines where sale_id = :'sale_id' and item_id = 'FG02' \gset
select id as line2 from sales_lines where sale_id = :'sale_id' and item_id = 'FG03' \gset
select pg_temp.q('FG02','LOC04') as fg02_mid \gset
select pg_temp.q('FG03','LOC05') as fg03_qh \gset
select process_return(json_build_object('sale_id', :'sale_id', 'lines', json_build_array(
   json_build_object('sale_line_id', :line1, 'qty', 1, 'reason', 'Wrong size ordered'),
   json_build_object('sale_line_id', :line2, 'qty', 1, 'reason', 'Seam failure')))::jsonb) as ret \gset
select pg_temp.ok(pg_temp.q('FG02','LOC04') = :fg02_mid + 1, 'resellable return goes back to store stock');
select pg_temp.ok(pg_temp.q('FG03','LOC05') = :fg03_qh + 1, 'quality failure goes to Quality Hold');
select pg_temp.ok(((:'ret'::jsonb)->>'refund')::numeric = round(25.34 + 25.34*0.9, 2) + round((25.34 + 25.34*0.9)*0.18, 2), 'refund = price paid incl. IGV');
select pg_temp.ok((select credit from ledger where doc_id = (:'ret'::jsonb)->>'id' and account='COGS') > 0, 'COGS reversed on return');
do $$ begin
  perform process_return(jsonb_build_object('sale_id', (select sale_id from sales_lines where id = (select min(sale_line_id) from return_lines)),
     'lines', jsonb_build_array(jsonb_build_object('sale_line_id', (select min(sale_line_id) from return_lines), 'qty', 5, 'reason', 'Changed mind'))));
  raise exception 'FAIL: returned more than sold';
exception when others then
  if sqlerrm like 'FAIL%' then raise; end if;
  raise notice 'ok - cannot return more than was sold';
end $$;
select process_return(json_build_object('sale_id', :'sale_id', 'location_id', 'LOC04',
   'lines', json_build_array(json_build_object('sale_line_id', :line1, 'qty', 1, 'reason', 'Wrong size ordered')),
   'exchange', json_build_array(json_build_object('item_id', 'FG03', 'qty', 1)))::jsonb) as ex \gset
select pg_temp.ok((:'ex'::jsonb)->>'exchange_sale_id' is not null, 'exchange creates replacement sale');
select pg_temp.ok(((:'ex'::jsonb)->>'net_due')::numeric = 0, 'same-price exchange nets to zero');
select pg_temp.ok(pg_temp.balanced(), 'ledger balanced after returns');

-- 7. Purchasing: create, send, partial receive, pay, close
select create_po('{"supplier_id":"SUP02","ship_to_location_id":"LOC01","send":true,"lines":[{"item_id":"C06","qty":10},{"item_id":"C07","qty":5}]}') ->> 'id' as po \gset
select pg_temp.ok((select expected_date from purchase_orders where id = :'po') = current_date + 9, 'expected date = sent + 9-day quoted lead time');
select id as pl from po_lines where po_id = :'po' and item_id = 'C06' \gset
select avg_cost as c06_avg from items where id='C06' \gset
select pg_temp.q('C06','LOC01') as c06a \gset
select receive_po(json_build_object('po_id', :'po', 'lines', json_build_array(json_build_object('po_line_id', :pl, 'qty', 6)))::jsonb);
select pg_temp.ok(pg_temp.q('C06','LOC01') = :c06a + 6, 'receipt increases stock at chosen location');
select pg_temp.ok((select status from purchase_orders where id = :'po') = 'partial', 'PO partially received');
select pg_temp.ok((select credit from ledger where doc_id = :'po' and account='Accounts Payable') = 216, 'AP = 6 kg × S/36');
do $$ begin
  perform receive_po(jsonb_build_object('po_id', (select max(id) from purchase_orders where supplier_id='SUP02' and not is_history),
    'lines', jsonb_build_array(jsonb_build_object('po_line_id', (select max(id) from po_lines where item_id='C06'), 'qty', 50))));
  raise exception 'FAIL: over-receipt allowed';
exception when others then
  if sqlerrm like 'FAIL%' then raise; end if;
  raise notice 'ok - over-receipt blocked';
end $$;
select pay_po(:'po', 100);
select pg_temp.ok((select sum(amount) from supplier_payments where po_id = :'po') = 100, 'payment recorded');
select close_po(:'po');
select pg_temp.ok((select status from purchase_orders where id = :'po') = 'closed', 'PO closed short');
select pg_temp.ok(pg_temp.balanced(), 'ledger balanced after purchasing');

-- 6. Production: create, issue, complete with scrap and rework
select create_wo('{"item_id":"FG13","qty":20,"location_id":"LOC02","output_location_id":"LOC03"}') ->> 'id' as wo \gset
do $$ begin
  perform issue_wo((select max(id) from work_orders));
  raise exception 'FAIL: issued without rib 2x1 at workshop';
exception when others then
  if sqlerrm like 'FAIL%' then raise; end if;
  raise notice 'ok - issue blocked when components are short (%)', sqlerrm;
end $$;
select transfer_stock('C09','LOC01','LOC02',5,'for WO');
select pg_temp.q('C09','LOC02') as c09 \gset
select pg_temp.q('FG13','LOC03') as fg13 \gset
select issue_wo(:'wo') as iss \gset
select pg_temp.ok(pg_temp.q('C09','LOC02') = round(:c09 - 20*0.15*1.08, 4), 'issue consumes BOM qty incl. scrap allowance');
select complete_wo(json_build_object('id', :'wo', 'qty_good', 19, 'started_at', (now() - interval '6 hours')::text,
  'issues', json_build_array(json_build_object('kind','scrap','qty',1,'reason','Seam failure'),
                             json_build_object('kind','rework','qty',2,'reason','Machine issue')))::jsonb) as comp \gset
select pg_temp.ok(pg_temp.q('FG13','LOC03') = :fg13 + 19, 'good units received into finished goods');
select pg_temp.ok(((:'comp'::jsonb)->>'unit_cost')::numeric = round((((:'iss'::jsonb)->>'material_cost')::numeric + 20*3) / 20, 2)
  or abs(((:'comp'::jsonb)->>'unit_cost')::numeric - (((:'iss'::jsonb)->>'material_cost')::numeric + 60) / 20) < 0.01, 'unit cost rolled up from components + labour');
select pg_temp.ok((select debit from ledger where doc_id = :'wo' and account='Scrap Expense') > 0, 'scrap cost expensed');
select pg_temp.ok((select sum(debit)-sum(credit) from ledger where account='WIP') = 0, 'WIP cleared after completion');
do $$ begin
  perform complete_wo('{"id":"nope","qty_good":1}');
  raise exception 'FAIL';
exception when others then
  if sqlerrm like 'FAIL%' then raise; end if;
  raise notice 'ok - completing a non-started WO blocked';
end $$;

-- cancel in-progress WO returns components
select create_wo('{"item_id":"FG01","qty":10}') ->> 'id' as wo2 \gset
select pg_temp.q('C01','LOC02') as c01w \gset
select issue_wo(:'wo2');
select cancel_wo(:'wo2', 'Entered by mistake');
select pg_temp.ok(pg_temp.q('C01','LOC02') = :c01w, 'cancelled WO returns components');
select pg_temp.ok((select sum(debit)-sum(credit) from ledger where account='WIP') = 0, 'WIP zero after cancel');

-- kit production consumes finished tees
select transfer_stock('FG02','LOC03','LOC02',2), transfer_stock('FG05','LOC03','LOC02',2), transfer_stock('FG07','LOC03','LOC02',2);
select create_wo('{"item_id":"KIT01","qty":2}') ->> 'id' as wo3 \gset
select pg_temp.q('FG05','LOC02') as fg05 \gset
select issue_wo(:'wo3');
select pg_temp.ok(pg_temp.q('FG05','LOC02') = :fg05 - 2, 'kit build consumes child finished goods');

-- countable components are whole units; fabric can be partial
select create_wo('{"item_id":"FG02","qty":120}') ->> 'id' as wo4 \gset
select pg_temp.ok((select qty_required from wo_components where wo_id = :'wo4' and item_id = 'C11') = 122, '120 tees need 122 brand labels (121.2 rounded up)');
select pg_temp.ok((select qty_required from wo_components where wo_id = :'wo4' and item_id = 'C01') = 24.624, 'fabric keeps decimals (24.624 kg)');
select pg_temp.ok((select count(*) from wo_components c join items i on i.id = c.item_id where i.uom not in ('kg','cone') and c.qty_required <> trunc(c.qty_required) and c.wo_id >= :'wo4') = 0, 'no fractional labels, bags or boxes');
select pg_temp.ok((select count(*) from wo_components c join items i on i.id = c.item_id join work_orders w on w.id = c.wo_id where not w.is_history and i.uom not in ('kg','cone') and c.qty_required <> trunc(c.qty_required)) = 0, 'seeded open work order also uses whole units');

select pg_temp.ok(abs((select sum(credit)-sum(debit) from ledger where account='Accounts Payable')
  - ((select coalesce(sum(qty*unit_cost),0) from po_receipts) - (select coalesce(sum(amount),0) from supplier_payments))) < 0.01,
  'Accounts Payable = goods received - supplier payments (incl. advance paid before go-live)');
select pg_temp.ok(pg_temp.balanced(), 'ledger balanced at the end');
select pg_temp.ok(pg_temp.gl_matches_stock(), 'ledger Inventory = stock × average cost (within S/1)');
select pg_temp.ok((select count(*) from stock where qty < 0) = 0, 'no negative stock anywhere');

-- multi-user activity log: every transaction says who did what
select pg_temp.ok((select count(*) from activity) >= 10, 'transactions write activity lines');
select pg_temp.ok((select count(*) from activity where user_id is null and summary not like 'reset%') = 0, 'every activity line records the user');
select pg_temp.ok(exists(select 1 from activity where kind = 'sale' and summary like 'sold %× % at % · S/ %'), 'POS sale activity reads like "sold 2× … at … · S/ …"');
select pg_temp.ok(exists(select 1 from activity where kind = 'production' and summary like 'completed WO-%: % good%'), 'work order completion is logged');
select pg_temp.ok(exists(select 1 from activity a join profiles p on p.id = a.user_id where p.role = 'customer' and a.summary like 'placed a pickup order%'), 'portal order logged under the customer');
select pg_temp.ok(not exists(select 1 from activity where summary ilike '%change-me%'), 'team code never written to the log');

-- reset works
select reset_demo();
select pg_temp.ok((select count(*) from sales where not is_history) = 5, 'reset restores starting data');
select pg_temp.ok((select role from profiles where email='staff@test.pe') = 'staff', 'logins survive reset');
select pg_temp.ok(exists(select 1 from customers where id = 'CUS13'), 'portal customer re-linked after reset');
select pg_temp.ok((select count(*) from activity) = 1 and (select summary from activity) = 'reset the demo data', 'reset clears the activity log');
\echo ALL TESTS PASSED
