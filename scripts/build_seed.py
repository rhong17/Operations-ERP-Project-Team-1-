#!/usr/bin/env python3
"""
Build supabase/03_seed.sql from the company workbook.

    python3 scripts/build_seed.py "/path/to/COLORES Y SKU (3).xlsx"

Real data copied straight from the workbook sheets:
  Items, Locations, Inventory_On_Hand, BOM, Cost_Rollup (labour), Suppliers,
  Customers, Sales_History (May 1 - Oct 31 2026), Settings.
Generated here (fixed random seed, so it is the same every run):
  purchase-order history (for the supplier scorecard) and work-order
  history (for production metrics). Documents that must stay "in the future"
  (open sales orders, open POs, a planned work order) are written relative to
  the day the seed is loaded, so MRP always has something to plan.
"""
import sys, random, math, datetime as dt
from collections import defaultdict
from pathlib import Path
import openpyxl

SRC = sys.argv[1] if len(sys.argv) > 1 else str(Path.home() / 'Desktop/COLORES Y SKU (3).xlsx')
OUT = Path(__file__).resolve().parent.parent / 'supabase' / '03_seed.sql'
rnd = random.Random(20261101)
GO_LIVE = dt.date(2026, 11, 1)          # Inventory_On_Hand snapshot date
HIST_END = dt.date(2026, 10, 31)

wb = openpyxl.load_workbook(SRC, data_only=True)

def rows(sheet):
    ws = wb[sheet]
    it = ws.iter_rows(values_only=True)
    head = [h for h in next(it)]
    for r in it:
        if r[0] is None: continue
        yield dict(zip(head, r))

def q(v):
    """SQL literal"""
    if v is None or v == '': return 'null'
    if isinstance(v, bool): return 'true' if v else 'false'
    if isinstance(v, (int, float)): return repr(round(v, 6)) if isinstance(v, float) else str(v)
    if isinstance(v, (dt.datetime, dt.date)): return "'" + v.isoformat()[:10] + "'"
    return "'" + str(v).strip().replace("'", "''") + "'"

def values(table, cols, data):
    out = [f"  insert into {table}({', '.join(cols)}) values"]
    out.append(',\n'.join('    (' + ', '.join(r) + ')' for r in data) + ';')
    return '\n'.join(out)

# ---------------- master data ----------------
items = list(rows('Items'))
labor = {r['parent_item_id']: r['cut_sew_labor_cost'] for r in rows('Cost_Rollup')}
FOQ = {'C11': 2000, 'C12': 2000, 'C13': 2000, 'C14': 1000, 'C15': 2000, 'C16': 300}
item_by = {i['item_id']: i for i in items}

# English display names (the company's Spanish names are kept in "name").
# Translated by hand from the product descriptions; edit here if wording should change.
COLOR_EN = {'NEGRO': 'Black', 'HUESO': 'Bone', 'LILA': 'Lilac', 'CRISTAL': 'Crystal Blue'}
def name_en(i):
    iid, c, sz = i['item_id'], COLOR_EN.get((i['color'] or '').strip(), (i['color'] or '').title()), i['size']
    fixed = {
        'FG11': f"Men's Crew-Neck Tee, Short Sleeve · {c} · {sz}",
        'FG12': f"Women's Crew-Neck Tee, Long Sleeve · {c} · {sz}",
        'FG13': f"Women's Rib Racerback Tank · {c} · {sz}",
        'FG14': f"Women's Short Dress with Pockets · {c} · {sz}",
        'KIT01': "Women's V-Neck Tee 3-Pack · M (Black / Bone / Lilac)",
        'C01': 'Jersey Fabric, 100% Cotton · Black', 'C02': 'Jersey Fabric, 100% Cotton · Bone',
        'C03': 'Jersey Fabric, 100% Cotton · Lilac', 'C04': 'Jersey Fabric, 100% Cotton · Crystal Blue',
        'C05': 'Rib Fabric for Collars · Black', 'C06': 'Rib Fabric for Collars · Bone',
        'C07': 'Rib Fabric for Collars · Lilac', 'C08': 'Rib Fabric for Collars · Crystal Blue',
        'C09': 'Rib Fabric for Tank Tops · Black', 'C10': 'Polyester Sewing Thread (5,000 yd cone)',
        'C11': 'Woven Brand Label', 'C12': 'Size Label', 'C13': 'Care & Content Label',
        'C14': 'Printed Hangtag', 'C15': 'Self-Seal Polybag', 'C16': 'Printed 3-Pack Box',
    }
    if iid in fixed: return fixed[iid]
    if i['name'].startswith('POLO BASICO MC CUELLO V DAMA'): return f"Women's V-Neck Tee, Short Sleeve · {c} · {sz}"
    return i['name']
LOC_EN = {'LOC01': 'Fabric & Trims Warehouse', 'LOC02': 'Cutting & Sewing Workshop', 'LOC03': 'Finished Goods Warehouse',
          'LOC04': 'Gamarra Retail Store', 'LOC05': 'Quality Hold'}
item_rows = []
for i in items:
    iid = i['item_id']
    item_rows.append([q(iid), q(str(i['ean'])), q(i['cod_interno']), q(i['variant_sku']), q(i['name']), q(name_en(i)), q(i['item_type']),
        q(i['style']), q(i['gender']), q(i['color']), q(i['size']), q(i['uom']),
        q(round(i['unit_cost'], 4)), q(round(i['unit_cost'], 4)), q(labor.get(iid, 0)),
        q(i['sale_price']), q(i['wholesale_price']), q(i['make_or_buy']), q(i['primary_supplier_id']),
        q(int(i['lead_time_days'])), q('FOQ' if iid in FOQ else 'L4L'), q(FOQ.get(iid)), q(i['source'])])

locs = list(rows('Locations'))
loc_rows = [[q(l['location_id']), q(l['name']), q(LOC_EN.get(l['location_id'])), q(l['type']), q(l['address']), q(l['district']), q(l['city']), 'false', str(n)]
            for n, l in enumerate(locs, 1)]
loc_rows.append(["'LOC05'", "'Cuarentena de Calidad'", "'Quality Hold'", "'Quality hold for defective returns (at the workshop)'",
                 "'Jr. Antonio Bazo 1120'", "'La Victoria'", "'Lima'", 'true', '5'])

bom = list(rows('BOM'))
bom_rows = [[q(b['parent_item_id']), q(b['component_item_id']), q(b['qty_per_unit']), q(b['scrap_allowance_pct'])] for b in bom]
bom_by = defaultdict(list)
for b in bom: bom_by[b['parent_item_id']].append(b)

sups = list(rows('Suppliers'))
sup_rows = [[q(s['supplier_id']), q(s['name']), q(s['supplier_type']), q(s['contact_name']), q(s['email']), q(s['phone']),
             q(s['city']), q(s['country']), q(int(s['quoted_lead_time_days'])), q(s['payment_terms']), q(s['items_supplied'])] for s in sups]
sup_by = {s['supplier_id']: s for s in sups}

custs = list(rows('Customers'))
cust_rows = [[q(c['customer_id']), q(c['name']), q(c['type']), q(c['channel']), q(c['email']), q(c['phone']), q(c['city']), q(c['country']),
              'true' if c['igv_exempt'] == 'Y' else 'false', q('retail' if c['channel'] == 'Retail' else 'wholesale')] for c in custs]

inv = list(rows('Inventory_On_Hand'))
stock_rows = [[q(r['item_id']), q(r['location_id']), q(r['qty'])] for r in inv]
opening_value = sum(r['qty'] * item_by[r['item_id']]['unit_cost'] for r in inv)

settings = {r['setting']: r for r in rows('Settings')}

# ---------------- sales history (real workbook rows) ----------------
sales = list(rows('Sales_History'))
orders = {}
for s in sales:
    o = orders.setdefault(s['order_id'], s)
sale_rows, line_rows = [], []
for oid, s in orders.items():
    d = s['date'].date()
    kind = 'POS' if s['customer_id'] == 'CUS01' else 'SO'
    ts = f"'{d.isoformat()} 12:00:00-05'"
    sale_rows.append([q(oid), q(kind), q(s['customer_id']), q(s['location_id']), q('completed' if kind == 'POS' else 'closed'),
                      q('store' if kind == 'POS' else 'wholesale'), ts, q(d), ts, ts, 'true'])
for s in sales:
    net = s['net_amount'] or 0
    rate = 0 if not s['IGV'] else round(s['IGV'] / net, 2) if net else 0.18
    line_rows.append([q(s['order_id']), q(s['item_id']), q(s['qty']), q(s['qty']), q(s['unit_price']),
                      q(s['discount_pct'] or 0), q(rate), q(s['unit_cost_at_sale'])])

# Usage history used to size generated PO / WO history (BOM explosion of sales)
fg_units = defaultdict(float)
for s in sales: fg_units[s['item_id']] += s['qty']
kit_units = fg_units.get('KIT01', 0)
made_units = dict(fg_units)
for b in bom_by['KIT01']:
    if b['component_item_id'] in item_by and item_by[b['component_item_id']]['item_type'] != 'Component':
        made_units[b['component_item_id']] = made_units.get(b['component_item_id'], 0) + kit_units
comp_use = defaultdict(float)
for parent, units in made_units.items():
    for b in bom_by.get(parent, []):
        if item_by[b['component_item_id']]['item_type'] == 'Component':
            comp_use[b['component_item_id']] += units * b['effective_qty']

def workday(d):
    while d.weekday() == 6: d += dt.timedelta(days=1)   # closed Sundays
    return d

# ---------------- purchase-order history (generated) ----------------
# Supplier behaviour profiles: (delay days choices, chance of short shipment, short-ship fill)
PROFILE = {
    'SUP01': ([-1, 0, 0, 1, 2, 3, 3, 4, 5, 6], 0.15, (0.90, 0.97)),   # big mill, often late
    'SUP02': ([-1, 0, 0, 0, 1, 1, 2], 0.10, (0.93, 0.98)),
    'SUP03': ([-1, -1, 0, 0, 0, 0, 0, 1], 0.00, (1, 1)),               # reliable Gamarra distributor
    'SUP04': ([0, 0, 1, 2, 2, 3], 0.35, (0.80, 0.92)),                 # labels: short-ships
    'SUP05': ([-2, -1, 0, 0, 0, 1], 0.05, (0.95, 0.98)),
    'SUP06': ([0, 1, 1, 2, 3, 4], 0.20, (0.90, 0.95)),
    'SUP07': ([2, 5, 8, 10, 14], 0.00, (1, 1)),                        # China, sea freight
}
TERMS_DAYS = {'Net 30': 30, 'Net 15': 15, 'Prepaid': 0}
po_rows, pol_rows, rec_rows, pay_rows = [], [], [], []
unpaid_ap = 0.0
po_n = 0
comps = [i for i in items if i['item_type'] == 'Component']
for c in comps:
    cid, sid = c['item_id'], c['primary_supplier_id']
    lt = int(sup_by[sid]['quoted_lead_time_days'])
    eoq = c['EOQ'] or 100
    use = comp_use.get(cid, 0)
    n = max(2, min(7, round(use / eoq))) if use else 2
    qty_base = max(eoq, use / n)
    start, last_send = dt.date(2026, 4, 20), HIST_END - dt.timedelta(days=lt + 16)
    span = (last_send - start).days
    for k in range(n):
        sent = workday(start + dt.timedelta(days=int(span * (k + 0.5) / n) + rnd.randint(-4, 4)))
        expected = sent + dt.timedelta(days=lt)
        delays, p_short, fill_rng = PROFILE[sid]
        actual = expected + dt.timedelta(days=rnd.choice(delays))
        if actual > HIST_END: actual = HIST_END
        if actual < sent: actual = sent + dt.timedelta(days=1)
        unit = c['uom']
        qty = round(qty_base * rnd.uniform(0.85, 1.15), 1) if unit == 'kg' else int(round(qty_base * rnd.uniform(0.85, 1.15) / 10) * 10)
        if cid in FOQ: qty = FOQ[cid] * max(1, round(qty_base / FOQ[cid]))
        recv = qty
        if rnd.random() < p_short:
            recv = round(qty * rnd.uniform(*fill_rng), 1) if unit == 'kg' else int(qty * rnd.uniform(*fill_rng))
        po_n += 1
        pid = f'PO-{po_n:05d}'
        cost = c['unit_cost']
        po_rows.append([q(pid), q(sid), q('closed'), q('LOC01'), f"'{sent.isoformat()} 09:00:00-05'", q(sent), q(expected),
                        f"'{actual.isoformat()} 17:00:00-05'", q(sup_by[sid]['payment_terms']), 'true'])
        pol_rows.append([q(pid), q(cid), q(qty), q(recv), q(cost)])
        # split deliveries for the label maker
        if sid == 'SUP04' and recv > 1000 and rnd.random() < 0.5:
            first = int(recv * 0.6)
            rec_rows.append([q(pid), q(cid), q(first), q('LOC01'), q(actual - dt.timedelta(days=2)), q(cost)])
            rec_rows.append([q(pid), q(cid), q(recv - first), q('LOC01'), q(actual), q(cost)])
        else:
            rec_rows.append([q(pid), q(cid), q(recv), q('LOC01'), q(actual), q(cost)])
        terms = sup_by[sid]['payment_terms']
        billed = (qty if terms == 'Prepaid' else recv) * cost
        due = sent if terms == 'Prepaid' else actual + dt.timedelta(days=TERMS_DAYS.get(terms, 30))
        if due <= HIST_END - dt.timedelta(days=3):
            pay_rows.append([q(pid), q(round(billed, 2)), q(min(HIST_END, due + dt.timedelta(days=rnd.choice([-2, 0, 0, 1, 3]))))])
        else:
            unpaid_ap += round(billed, 2)

# ---------------- work-order history (generated) ----------------
SCRAP_REASONS = ['Seam failure', 'Fabric defect', 'Cutting error', 'Machine issue']
wo_rows, woc_rows, woi_rows = [], [], []
scrap_cost_total = 0.0
wo_n = 0
parents = [i for i in items if i['item_type'] in ('Finished Good', 'Kit')]
for p in parents:
    pid = p['item_id']
    units = made_units.get(pid, 0)
    eoq = p['EOQ'] or 100
    n = max(2, min(6, round(units / eoq)))
    batch = max(24, int(round((units / n) / 6) * 6))   # cut in multiples of 6 (one marker)
    for k in range(n):
        start_day = workday(dt.date(2026, 4, 22) + dt.timedelta(days=int(170 * (k + 0.3) / n) + rnd.randint(-3, 3)))
        lt = int(p['lead_time_days'])
        due = start_day + dt.timedelta(days=lt)
        dur = max(1, lt + rnd.choice([-3, -2, -2, -1, -1, -1, 0, 0, 1, 2]))
        finish_day = workday(start_day + dt.timedelta(days=dur))
        if finish_day > HIST_END: continue
        qty = batch + rnd.choice([-12, -6, 0, 0, 6, 12])
        qty = max(12, qty)
        scrap_rate = rnd.choice([0, 0.005, 0.01, 0.015, 0.02, 0.03, 0.045]) if pid != 'KIT01' else rnd.choice([0, 0, 0.01])
        scrap = int(round(qty * scrap_rate))
        rework = int(round(qty * rnd.choice([0, 0.02, 0.03, 0.05, 0.07]))) if pid != 'KIT01' else 0
        good = qty - scrap
        wo_n += 1
        wid = f'WO-{wo_n:05d}'
        material = 0.0
        for b in bom_by[pid]:
            ci = item_by[b['component_item_id']]
            req = round(qty * b['qty_per_unit'] * (1 + b['scrap_allowance_pct']), 4)
            material += req * ci['unit_cost']
            woc_rows.append([q(wid), q(ci['item_id']), q(req), q(req), q(round(ci['unit_cost'], 4))])
        lab = qty * labor.get(pid, 0)
        unit = (material + lab) / qty
        scrap_cost_total += round(material, 2) + round(lab, 2) - round(good * unit, 2)
        if scrap:
            woi_rows.append([q(wid), q('scrap'), q(scrap), q(rnd.choice(SCRAP_REASONS))])
        if rework:
            r1 = max(1, rework // 2)
            woi_rows.append([q(wid), q('rework'), q(r1), q(rnd.choice(SCRAP_REASONS))])
            if rework - r1 > 0:
                woi_rows.append([q(wid), q('rework'), q(rework - r1), q(rnd.choice(SCRAP_REASONS))])
        sh, fh = rnd.choice([7, 8, 8, 9]), rnd.choice([15, 16, 17, 18])
        wo_rows.append([q(wid), q(pid), q(qty), q('LOC02'), q('LOC03'), q('completed'),
                        f"'{start_day.isoformat()} 07:30:00-05'", q(due),
                        f"'{start_day.isoformat()} {sh:02d}:{rnd.choice(['00','15','30']) }:00-05'",
                        f"'{finish_day.isoformat()} {fh:02d}:{rnd.choice(['00','20','40'])}:00-05'",
                        q(good), q(scrap), q(rework), q(round(material, 4)), q(round(lab, 4)), q(round(unit, 4)), 'true'])

# ---------------- write SQL ----------------
S = []
S.append("""-- =====================================================================
-- Textiles Move ERP — 03 SEED DATA  (GENERATED by scripts/build_seed.py)
-- Do not hand-edit: change the workbook or the script and re-generate.
-- Running load_seed() wipes all business data and reloads the starting
-- dataset. Logins (profiles) are kept. Settings → "Reset demo data" calls it.
-- =====================================================================
create or replace function load_seed() returns void
language plpgsql security definer set search_path = public as $seed$
-- Go-live = the moment the data is (re)loaded: the workbook stock count becomes "today's" opening balance,
-- so stock is always consistent no matter when the reset runs. Everything before it is history.
declare golive timestamptz := now();
        today_start timestamptz := date_trunc('day', now() at time zone 'America/Lima') at time zone 'America/Lima';
begin
  if auth.uid() is not null and not is_staff() then raise exception 'Staff only'; end if;

  truncate ledger, inv_moves, wo_issues, wo_components, work_orders, supplier_payments, po_receipts, po_lines,
    purchase_orders, return_lines, returns, sales_lines, sales, stock, bom, items, customers, suppliers,
    locations, settings, doc_counters restart identity cascade;

  insert into team_config(id, team_code) values (1, 'change-me-2026') on conflict (id) do nothing;
""")
st = lambda k: settings[k]['value']
S.append(values('settings', ['key','value','text_value','label','unit','description'], [
  ["'igv_rate'", q(st('IGV_rate')), 'null', "'IGV (sales tax)'", "'rate'", "'Peru IGV applied to domestic sales; export customers are exempt'"],
  ["'ordering_cost'", q(st('ordering_cost_per_PO')), 'null', "'Ordering cost (S)'", "'S/ per order'", q(settings['ordering_cost_per_PO']['description'])],
  ["'holding_rate'", q(st('annual_holding_cost_pct')), 'null', "'Annual holding cost (H)'", "'% of unit cost per year'", q(settings['annual_holding_cost_pct']['description'])],
  ["'service_z'", q(st('service_level_z')), 'null', "'Service level z'", "'z-score'", "'1.65 ≈ 95% cycle service level (used for safety stock)'"],
  ["'working_days_per_year'", q(st('working_days_per_year')), 'null', "'Working days per year'", "'days'", "'Mon–Sat × 52 weeks; converts daily demand to annual demand'"],
  ["'demand_window_days'", '(current_date - date \'2026-05-01\' + 1)', 'null', "'Demand history window'", "'calendar days'", "'Average usage for ROP/EOQ uses sales from the last N days (default: since May 1, 2026)'"],
  ["'usd_rate'", '3.70', 'null', "'Exchange rate (S/ per US$)'", "'S/ per 1 US$'", "'Only used for the ≈ US$ notes next to big totals. Update it to the current rate before the demo.'"],
  ["'review_period_days'", '14', 'null', "'Periodic review interval (R)'", "'days'", "'How often the buyer reviews stock for the periodic (order-up-to) rule'"],
]))
S.append(values('locations', ['id','name','name_en','type','address','district','city','is_quality_hold','sort'], loc_rows))
S.append(values('suppliers', ['id','name','supplier_type','contact_name','email','phone','city','country','lead_time_days','payment_terms','items_supplied'], sup_rows))
S.append(values('items', ['id','ean','sku','variant_sku','name','name_en','item_type','style','gender','color','size','uom','std_cost','avg_cost','labor_cost',
                          'sale_price','wholesale_price','make_or_buy','supplier_id','lead_time_days','lot_rule','lot_qty','source'], item_rows))
S.append(values('bom', ['parent_id','component_id','qty_per','scrap_pct'], bom_rows))
S.append(values('customers', ['id','name','type','channel','email','phone','city','country','igv_exempt','price_list'], cust_rows))

S.append("\n  -- Opening stock (go-live snapshot: workbook Inventory_On_Hand count, taken as of the load day)")
S.append(values('stock', ['item_id','location_id','qty'], stock_rows))
S.append("""  insert into inv_moves(at, item_id, location_id, qty, unit_cost, kind, doc_type, doc_id, reason)
    select golive, s.item_id, s.location_id, s.qty, i.avg_cost, 'opening', 'opening', 'OPENING', 'Go-live stock count'
      from stock s join items i on i.id = s.item_id;
  insert into ledger(at, account, debit, credit, doc_type, doc_id, memo)
    select golive, 'Inventory', round(sum(s.qty * i.avg_cost),2), 0, 'opening', 'OPENING', 'Opening inventory at go-live'
      from stock s join items i on i.id = s.item_id;
  insert into ledger(at, account, debit, credit, doc_type, doc_id, memo)
    select golive, 'Opening Balance Equity', 0, round(sum(s.qty * i.avg_cost),2), 'opening', 'OPENING', 'Opening inventory at go-live'
      from stock s join items i on i.id = s.item_id;
""")

S.append("\n  -- Sales history: real workbook Sales_History (May 1 – Oct 31, 2026)")
S.append(values('sales', ['id','kind','customer_id','location_id','status','channel','order_date','requested_date','fulfilled_at','closed_at','is_history'], sale_rows))
S.append(values('sales_lines', ['sale_id','item_id','qty','qty_shipped','unit_price','discount_pct','tax_rate','unit_cost'], line_rows))
S.append("""  -- Fill the gap between the end of the real history (Oct 31) and go-live (the day this data is loaded):
  -- replay the company's real sales from exactly 26 weeks earlier (same weekday), id suffixed '-R'.
  insert into sales(id, kind, customer_id, location_id, status, channel, order_date, requested_date, fulfilled_at, closed_at, is_history, notes)
  select s.id || '-R', s.kind, s.customer_id, s.location_id, s.status, s.channel, s.order_date + interval '182 days',
         s.requested_date + 182, s.fulfilled_at + interval '182 days', s.closed_at + interval '182 days', true,
         'Replay of real sale ' || s.id || ' (26 weeks earlier) to fill the Nov 1 – go-live gap'
    from sales s
   where s.is_history and s.fulfilled_at + interval '182 days' >= timestamptz '2026-11-01 00:00:00-05'
     and s.fulfilled_at + interval '182 days' < today_start;
  insert into sales_lines(sale_id, item_id, qty, qty_shipped, unit_price, discount_pct, tax_rate, unit_cost)
  select l.sale_id || '-R', l.item_id, l.qty, l.qty_shipped, l.unit_price, l.discount_pct, l.tax_rate, l.unit_cost
    from sales_lines l join sales r on r.id = l.sale_id || '-R'
   order by l.id;

  -- Historical sales hit the P&L. Their stock left BEFORE the go-live count, so
  -- the cost side is posted against Opening Balance Equity instead of Inventory.
  insert into ledger(at, account, debit, credit, doc_type, doc_id, memo)
  select s.fulfilled_at, a.account, a.debit, a.credit, 'sale', s.id, 'Historical sale (pre go-live)'
    from sales s
    join lateral (
      select round(sum(l.qty*l.unit_price*(1-l.discount_pct)),2) net, round(sum(l.qty*l.unit_price*l.discount_pct),2) disc,
             round(sum(l.qty*l.unit_price),2) gross, round(sum(l.qty*l.unit_price*(1-l.discount_pct)*l.tax_rate),2) tax,
             round(sum(l.qty*l.unit_cost),2) cost
        from sales_lines l where l.sale_id = s.id) t on true
    cross join lateral (values
      ('Cash', t.net + t.tax, 0::numeric), ('Sales Discounts', t.disc, 0), ('Sales Revenue', 0, t.gross),
      ('IGV Payable', 0, t.net + t.tax + t.disc - t.gross), ('COGS', t.cost, 0), ('Opening Balance Equity', 0, t.cost)
    ) a(account, debit, credit)
   where s.is_history and (a.debit <> 0 or a.credit <> 0);
""")

S.append("\n  -- Purchase-order history (generated from supplier profiles; drives the scorecard)")
S.append(values('purchase_orders', ['id','supplier_id','status','ship_to_location_id','created_at','sent_date','expected_date','closed_at','payment_terms','is_history'], po_rows))
S.append("""  create temp table _pol(po_id text, item_id text, qty_ordered numeric, qty_received numeric, unit_cost numeric) on commit drop;""")
S.append(values('_pol', ['po_id','item_id','qty_ordered','qty_received','unit_cost'], pol_rows))
S.append("""  insert into po_lines(po_id, item_id, qty_ordered, qty_received, unit_cost) select * from _pol;
  create temp table _rec(po_id text, item_id text, qty numeric, location_id text, received_date date, unit_cost numeric) on commit drop;""")
S.append(values('_rec', ['po_id','item_id','qty','location_id','received_date','unit_cost'], rec_rows))
S.append("""  insert into po_receipts(po_id, po_line_id, item_id, qty, location_id, received_date, unit_cost)
    select r.po_id, l.id, r.item_id, r.qty, r.location_id, r.received_date, r.unit_cost from _rec r join po_lines l on l.po_id = r.po_id;""")
S.append(values('supplier_payments', ['po_id','amount','paid_date'], pay_rows))
S.append("""  -- Unpaid supplier invoices at go-live
  insert into ledger(at, account, debit, credit, doc_type, doc_id, memo)
  select golive, a.account, a.d, a.c, 'opening', 'OPENING-AP', 'Unpaid supplier invoices at go-live'
    from (select coalesce(sum(case when p.payment_terms = 'Prepaid' then l.qty_ordered else l.qty_received end * l.unit_cost),0)
               - coalesce((select sum(amount) from supplier_payments),0) owed
            from po_lines l join purchase_orders p on p.id = l.po_id) t
    cross join lateral (values ('Opening Balance Equity', round(t.owed,2), 0::numeric), ('Accounts Payable', 0::numeric, round(t.owed,2))) a(account, d, c)
   where round(t.owed,2) > 0;
""")

S.append("\n  -- Work-order history (generated; drives production & quality metrics)")
S.append(values('work_orders', ['id','item_id','qty_planned','location_id','output_location_id','status','created_at','due_date','started_at','finished_at',
                                'qty_good','qty_scrap','qty_rework','material_cost','labor_cost','unit_cost','is_history'], wo_rows))
S.append(values('wo_components', ['wo_id','item_id','qty_required','qty_issued','unit_cost'], woc_rows))
if woi_rows: S.append(values('wo_issues', ['wo_id','kind','qty','reason'], woi_rows))
S.append("""  update work_orders set clock_started = started_at, clock_finished = finished_at where is_history;
  -- scrap cost from historical production hits the P&L (pre go-live, against equity)
  insert into ledger(at, account, debit, credit, doc_type, doc_id, memo)
  select w.finished_at, a.account, a.d, a.c, 'wo', w.id, 'Historical production scrap (pre go-live)'
    from work_orders w
    cross join lateral (select round(w.material_cost,2) + round(w.labor_cost,2) - round(w.qty_good * w.unit_cost,2) v) t
    cross join lateral (values ('Scrap Expense', t.v, 0::numeric), ('Opening Balance Equity', 0::numeric, t.v)) a(account, d, c)
   where w.is_history and t.v > 0;
""")

S.append(f"""
  -- Counters so new documents continue after the history
  insert into doc_counters(prefix, n) values ('PO', {po_n}), ('WO', {wo_n}), ('SUP', {len(sups)}), ('CUS', {len(custs)}),
    ('POS', 0), ('SO', 0), ('RT', 0), ('TR', 0), ('ADJ', 0), ('ITM', 0);

  -- ---------------------------------------------------------------
  -- Open documents dated relative to TODAY so MRP and the reports
  -- always have upcoming work, whenever the seed is (re)loaded.
  -- ---------------------------------------------------------------
  -- Confirmed customer orders (these drive MRP gross requirements)
  insert into sales(id, kind, customer_id, location_id, status, channel, order_date, requested_date, notes) values
    ('SO-00001','SO','CUS03','LOC03','placed','wholesale', now() - interval '3 days', current_date + 6,  'Boutique restock — V-neck basics'),
    ('SO-00002','SO','CUS11','LOC03','placed','wholesale', now() - interval '6 days', current_date + 10, 'Export order to Chile (IGV exempt)'),
    ('SO-00003','SO','CUS09','LOC03','placed','wholesale', now() - interval '2 days', current_date + 13, 'School season: men''s crew-neck tees'),
    ('SO-00004','SO','CUS10','LOC03','placed','wholesale', now() - interval '1 day',  current_date + 20, 'Corporate Christmas gift packs'),
    ('SO-00005','SO','CUS07','LOC03','placed','wholesale', now(),                      current_date + 27, 'Chiclayo distributor — winter + bividi');
  insert into sales_lines(sale_id, item_id, qty, unit_price, discount_pct, tax_rate)
  select v.so, v.item, v.qty, i.wholesale_price, v.disc, case when v.so = 'SO-00002' then 0 else 0.18 end
    from (values ('SO-00001','FG02',36,0.0),('SO-00001','FG03',36,0.0),('SO-00001','FG07',24,0.0),
                 ('SO-00002','FG01',60,0.05),('SO-00002','FG04',60,0.05),
                 ('SO-00003','FG11',180,0.06),
                 ('SO-00004','KIT01',60,0.08),
                 ('SO-00005','FG12',72,0.05),('SO-00005','FG13',48,0.05)) v(so,item,qty,disc)
    join items i on i.id = v.item;
  update doc_counters set n = 5 where prefix = 'SO';

  -- Open purchase orders (scheduled receipts in MRP)
  insert into purchase_orders(id, supplier_id, status, ship_to_location_id, created_at, sent_date, expected_date, payment_terms) values
    ('PO-{po_n+1:05d}','SUP01','sent','LOC01', now() - interval '8 days',  current_date - 8,  current_date + 10, 'Net 30'),
    ('PO-{po_n+2:05d}','SUP07','sent','LOC01', now() - interval '27 days', current_date - 27, current_date + 13, 'Prepaid'),
    ('PO-{po_n+3:05d}','SUP03','sent','LOC01', now() - interval '6 days',  current_date - 6,  current_date - 2,  'Net 15'),
    ('PO-{po_n+4:05d}','SUP04','draft','LOC01', now(), null, null, 'Net 30');
  insert into po_lines(po_id, item_id, qty_ordered, unit_cost) values
    ('PO-{po_n+1:05d}','C01',120,34), ('PO-{po_n+1:05d}','C02',30,31),
    ('PO-{po_n+2:05d}','C16',300,1.8),
    ('PO-{po_n+3:05d}','C10',30,9.5),
    ('PO-{po_n+4:05d}','C11',2000,0.15);
  insert into supplier_payments(po_id, amount, paid_date) values ('PO-{po_n+2:05d}', 540, current_date - 27);
  update doc_counters set n = {po_n + 4} where prefix = 'PO';

  -- A planned work order (scheduled receipt for a parent item)
  insert into work_orders(id, item_id, qty_planned, location_id, output_location_id, status, created_at, due_date, notes)
  values ('WO-{wo_n+1:05d}','FG02',120,'LOC02','LOC03','planned', now(), current_date + 5, 'Restock best seller (V-neck black M)');
  insert into wo_components(wo_id, item_id, qty_required)
  select 'WO-{wo_n+1:05d}', component_id, round(120 * qty_per * (1 + scrap_pct), 4) from bom where parent_id = 'FG02';
  update doc_counters set n = {wo_n + 1} where prefix = 'WO';

  -- Keep customer logins working after a reset
  insert into customers(id, name, type, channel, email, city, country)
  select p.customer_id, coalesce(p.full_name, p.email), 'Portal customer', 'Retail', p.email, 'Lima', 'Peru'
    from profiles p
   where p.role = 'customer' and p.customer_id is not null
     and not exists (select 1 from customers c where c.id = p.customer_id);
  update doc_counters set n = greatest(n, (select coalesce(max(substring(id from 4)::int),0) from customers where id ~ '^CUS[0-9]+$'))
   where prefix = 'CUS';
end $seed$;

revoke execute on function load_seed() from public, anon, authenticated;
""")

OUT.write_text('\n'.join(S) + '\n')
print(f'wrote {OUT}')
print(f'items {len(items)}  bom lines {len(bom)}  suppliers {len(sups)}  customers {len(custs)}  locations {len(locs)}+1')
print(f'sales orders {len(orders)}  sales lines {len(sales)}')
print(f'PO history {po_n}  receipts {len(rec_rows)}  payments {len(pay_rows)}  unpaid S/ {unpaid_ap:,.2f}')
print(f'WO history {wo_n}  issue lines {len(woi_rows)}  scrap cost S/ {scrap_cost_total:,.2f}')
print(f'opening inventory value S/ {opening_value:,.2f}')
