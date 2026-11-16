// Tests for src/lib/calc.js — run with: npm run test:calc
// 1) MRP reproduces the worked examples from the Chapter 10 slides.
// 2) Reorder point / EOQ reproduce the team workbook's Calculations sheet
//    (needs the local test database from scripts/test/run.sh).
import test from 'node:test'
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { index, runMRP, inventoryPolicy, supplierScorecard, productionReport, addDays } from '../../src/lib/calc.js'

const MON = '2026-01-05' // a Monday = week 1
const wk = n => addDays(MON, 7 * (n - 1) + 2) // a date inside week n

function slideDb({ items, bom = [], so = [], po = [] }) {
  return {
    settings: [], locations: [{ id: 'L1', is_quality_hold: false }],
    items: items.map(i => ({ active: true, uom: 'unit', lot_rule: 'L4L', make_or_buy: 'Make', ...i })),
    stock: items.map(i => ({ item_id: i.id, location_id: 'L1', qty: i.oh })),
    bom, sales: so.map((s, k) => ({ id: 'SO' + k, kind: 'SO', status: 'placed', requested_date: s.date })),
    sales_lines: so.map((s, k) => ({ sale_id: 'SO' + k, item_id: s.item, qty: s.qty, qty_shipped: 0 })),
    purchase_orders: po.map((p, k) => ({ id: 'PO' + k, status: 'sent', expected_date: p.date })),
    po_lines: po.map((p, k) => ({ po_id: 'PO' + k, item_id: p.item, qty_ordered: p.qty, qty_received: 0 })),
    work_orders: [], wo_components: [],
  }
}
const rec = (mrp, id) => mrp.records.find(r => r.item.id === id)

test('MRP slide #1: Item A, 600 in week 6, OH 200, SR 100 wk 4, LT 2, L4L', () => {
  const db = slideDb({ items: [{ id: 'A', oh: 200, lead_time_days: 14 }], so: [{ item: 'A', qty: 600, date: wk(6) }], po: [{ item: 'A', qty: 100, date: wk(4) }] })
  const m = runMRP(db, index(db), { today: MON, weeks: 8 })
  const a = rec(m, 'A')
  assert.deepEqual(a.gross, [0, 0, 0, 0, 0, 600, 0, 0])
  assert.deepEqual(a.sched, [0, 0, 0, 100, 0, 0, 0, 0])
  assert.deepEqual(a.poh, [200, 200, 200, 300, 300, 0, 0, 0])
  assert.deepEqual(a.net, [0, 0, 0, 0, 0, 300, 0, 0])
  assert.deepEqual(a.por, [0, 0, 0, 0, 0, 300, 0, 0])
  assert.deepEqual(a.pol, [0, 0, 0, 300, 0, 0, 0, 0])
})

test('MRP slide #2: 300 tables wk 7; legs FOQ 250; top L4L', () => {
  const db = slideDb({
    items: [{ id: 'TABLE', oh: 40, lead_time_days: 7 }, { id: 'LEGS', oh: 120, lead_time_days: 14, lot_rule: 'FOQ', lot_qty: 250 },
            { id: 'TOP', oh: 0, lead_time_days: 21 }],
    bom: [{ parent_id: 'TABLE', component_id: 'LEGS', qty_per: 4, scrap_pct: 0 }, { parent_id: 'TABLE', component_id: 'TOP', qty_per: 1, scrap_pct: 0 }],
    so: [{ item: 'TABLE', qty: 300, date: wk(7) }],
    po: [{ item: 'LEGS', qty: 200, date: wk(2) }, { item: 'TOP', qty: 60, date: wk(3) }],
  })
  const m = runMRP(db, index(db), { today: MON, weeks: 7 })
  const t = rec(m, 'TABLE'), l = rec(m, 'LEGS'), p = rec(m, 'TOP')
  assert.equal(t.level, 0); assert.equal(l.level, 1)
  assert.deepEqual(t.por, [0, 0, 0, 0, 0, 0, 260]); assert.deepEqual(t.pol, [0, 0, 0, 0, 0, 260, 0])
  assert.deepEqual(l.gross, [0, 0, 0, 0, 0, 1040, 0])
  assert.deepEqual(l.poh, [120, 320, 320, 320, 320, 30, 30])
  assert.deepEqual(l.net, [0, 0, 0, 0, 0, 720, 0])
  assert.deepEqual(l.por, [0, 0, 0, 0, 0, 750, 0])       // 3 × FOQ 250
  assert.deepEqual(l.pol, [0, 0, 0, 750, 0, 0, 0])
  assert.deepEqual(p.gross, [0, 0, 0, 0, 0, 260, 0])
  assert.deepEqual(p.por, [0, 0, 0, 0, 0, 200, 0])
  assert.deepEqual(p.pol, [0, 0, 200, 0, 0, 0, 0])
  const s = m.suggestions.find(x => x.item.id === 'TOP')
  assert.equal(s.orderBy, addDays(addDays(MON, 35), -21))  // week 6 start minus 21-day lead time
})

// ---------- against the real seed (local Postgres) ----------
let db = null
try {
  const tables = ['settings', 'locations', 'suppliers', 'items', 'bom', 'stock', 'customers', 'sales', 'sales_lines', 'purchase_orders',
    'po_lines', 'po_receipts', 'supplier_payments', 'work_orders', 'wo_components', 'wo_issues']
  const sql = 'select json_build_object(' + tables.map(t => `'${t}', (select coalesce(json_agg(x),'[]') from ${t} x)`).join(',') + ')'
  execSync('psql -q -d tm_erp_test -c "select load_seed()"', { stdio: 'ignore' })
  db = JSON.parse(execSync(`psql -At -d tm_erp_test -c "${sql}"`, { maxBuffer: 1 << 28 }).toString())
  for (const t of Object.values(db)) for (const r of t) for (const k in r) if (typeof r[k] === 'string' && /^-?\d+(\.\d+)?$/.test(r[k]) && !['id', 'ean', 'po_id', 'sale_id', 'item_id'].includes(k)) r[k] = Number(r[k])
} catch { /* no local database — skip */ }

test('ROP and EOQ match the workbook Calculations sheet (May 1 – Oct 31 window)', { skip: !db && 'local test DB not found' }, () => {
  const d = structuredClone(db)
  d.settings.find(s => s.key === 'demand_window_days').value = 184     // May 1 .. Oct 31
  d.sales = d.sales.filter(s => s.is_history)                          // history only, as in the workbook
  const pol = inventoryPolicy(d, index(d), '2026-10-31')
  const fg02 = pol.find(p => p.item.id === 'FG02'), c01 = pol.find(p => p.item.id === 'C01')
  assert.equal(fg02.days, 158)
  assert.ok(Math.abs(fg02.d - 6.3481) < 0.001, 'FG02 avg daily demand incl. kit usage = 6.348 ' + fg02.d)
  assert.ok(Math.abs(fg02.rop - 118) <= 1, 'FG02 ROP ≈ 118 got ' + fg02.rop)
  assert.ok(Math.abs(fg02.eoq - 283) <= 1, 'FG02 EOQ ≈ 283 got ' + fg02.eoq)
  assert.ok(c01.d > 0 && c01.rop > 0 && c01.eoq > 0, 'components get demand through the BOM')
})

test('MRP on seed data produces suggestions with order-by dates', { skip: !db && 'local test DB not found' }, () => {
  const ix = index(db)
  const m = runMRP(db, ix, { today: new Date().toISOString().slice(0, 10), weeks: 4 })
  const fg11 = m.records.find(r => r.item.id === 'FG11')
  assert.ok(fg11.gross.some(x => x >= 180), 'school order of 180 men tees is a gross requirement')
  assert.ok(m.suggestions.some(s => s.item.id === 'FG11'), 'net shortage of FG11 is planned')
  const c01 = m.records.find(r => r.item.id === 'C01')
  assert.ok(c01.dependent.some(x => x > 0), 'FG11 planned release explodes into black jersey requirements')
  for (const s of m.suggestions) assert.ok(s.orderBy <= s.needDate)
})

test('supplier scorecard and production report compute from history', { skip: !db && 'local test DB not found' }, () => {
  const ix = index(db)
  const sc = supplierScorecard(db, ix, '2026-11-16')
  for (const s of sc) {
    assert.ok(s.deliveredCount > 0, s.supplier.id + ' has delivered POs')
    assert.ok(s.onTimeRate >= 0 && s.onTimeRate <= 1 && s.fillRate > 0.5 && s.fillRate <= 1)
  }
  const reliable = sc.find(s => s.supplier.id === 'SUP03'), china = sc.find(s => s.supplier.id === 'SUP07')
  assert.ok(reliable.score > china.score, 'reliable thread supplier outscores slow importer')
  const pr = productionReport(db, ix, '2026-05-01', '2026-10-31')
  assert.ok(pr.count > 20 && pr.yield > 0.9 && pr.yield <= 1 && pr.scrap > 0)
  console.log('scorecard:', sc.map(s => `${s.supplier.id} ${s.score} ${s.rating} ontime ${(s.onTimeRate * 100).toFixed(0)}% fill ${(s.fillRate * 100).toFixed(1)}% LT ${s.avgLT.toFixed(1)}/${s.avgQuoted.toFixed(1)} owed ${s.owed}`).join('\n  '))
  console.log('production:', pr.count, 'WOs, yield', pr.yield.toFixed(3), 'FPY', pr.fpy.toFixed(3), 'on-time', pr.onTimeRate.toFixed(2), 'cycle h', pr.avgCycleHours.toFixed(1))
})

test('Allocation: two open orders cannot both claim the same stock', async () => {
  const { allocations } = await import('../../src/lib/calc.js')
  const db = {
    settings: [], locations: [{ id: 'L1', is_quality_hold: false }, { id: 'QH', is_quality_hold: true }],
    items: [{ id: 'T', active: true }], stock: [{ item_id: 'T', location_id: 'L1', qty: 40 }, { item_id: 'T', location_id: 'QH', qty: 5 }],
    bom: [], purchase_orders: [], po_lines: [], work_orders: [],
    sales: [{ id: 'B', kind: 'SO', status: 'placed', location_id: 'L1', requested_date: '2026-11-25' },
            { id: 'A', kind: 'SO', status: 'placed', location_id: 'L1', requested_date: '2026-11-20' }],
    sales_lines: [{ id: 2, sale_id: 'B', item_id: 'T', qty: 30, qty_shipped: 0 }, { id: 1, sale_id: 'A', item_id: 'T', qty: 30, qty_shipped: 0 }],
  }
  const a = allocations(db, index(db))
  assert.deepEqual(a.lines.get(1), { open: 30, allocated: 30, short: 0 })   // earlier requested date served first
  assert.deepEqual(a.lines.get(2), { open: 30, allocated: 10, short: 20 })
  assert.equal(a.committedOf('T'), 60)
  assert.equal(a.freeAt('T', 'L1'), 0)
})
