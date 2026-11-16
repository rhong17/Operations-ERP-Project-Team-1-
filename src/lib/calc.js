// =====================================================================
// calc.js — every number the ERP shows that is not a plain stored value is
// computed here, from the stored data, every time the data changes.
// Pure functions (no React, no database) so they are easy to read and test.
// =====================================================================

export const TZ = 'America/Lima'
const DAY = 86400000

// ---------- dates (business dates are Lima dates, yyyy-mm-dd) ----------
export const limaDate = (ts = new Date()) =>
  new Date(ts).toLocaleDateString('en-CA', { timeZone: TZ })
export const todayLima = () => limaDate(new Date())
export const addDays = (d, n) => {
  const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10)
}
export const daysBetween = (a, b) => Math.round((new Date(b + 'T12:00:00Z') - new Date(a + 'T12:00:00Z')) / DAY)
export const weekday = d => new Date(d + 'T12:00:00Z').getUTCDay()   // 0 = Sunday
export const isWorkday = d => weekday(d) !== 0                         // Mon–Sat, closed Sunday
export const mondayOf = d => addDays(d, -((weekday(d) + 6) % 7))
export function workdaysBetween(from, to) {
  let n = 0
  for (let d = from; d <= to; d = addDays(d, 1)) if (isWorkday(d)) n++
  return n
}

// ---------- small helpers ----------
export const sum = (arr, f = x => x) => arr.reduce((a, x) => a + (Number(f(x)) || 0), 0)
export const groupBy = (arr, key) => {
  const m = new Map()
  for (const x of arr) { const k = typeof key === 'function' ? key(x) : x[key]; if (!m.has(k)) m.set(k, []); m.get(k).push(x) }
  return m
}
export const round = (n, d = 2) => Math.round((Number(n) + Number.EPSILON) * 10 ** d) / 10 ** d
export const setting = (db, key, fallback = 0) => {
  const s = db.settings?.find(x => x.key === key); return s ? Number(s.value) : fallback
}

// ---------- indexes ----------
export function index(db) {
  const byId = arr => new Map((arr || []).map(x => [x.id, x]))
  const items = byId(db.items)
  const qh = new Set((db.locations || []).filter(l => l.is_quality_hold).map(l => l.id))
  const stockBy = new Map()        // item -> {loc: qty}
  for (const s of db.stock || []) {
    if (!stockBy.has(s.item_id)) stockBy.set(s.item_id, {})
    stockBy.get(s.item_id)[s.location_id] = Number(s.qty)
  }
  const onHand = (item, loc) => {
    const m = stockBy.get(item) || {}
    if (loc) return m[loc] || 0
    return Object.entries(m).reduce((a, [l, q]) => a + (qh.has(l) ? 0 : q), 0)  // usable stock excludes Quality Hold
  }
  const bomBy = groupBy(db.bom || [], 'parent_id')
  const linesBySale = groupBy(db.sales_lines || [], 'sale_id')
  const poLinesBy = groupBy(db.po_lines || [], 'po_id')
  return {
    items, onHand, stockBy, qh, bomBy, linesBySale, poLinesBy,
    locations: byId(db.locations), suppliers: byId(db.suppliers), customers: byId(db.customers),
    sales: byId(db.sales), pos: byId(db.purchase_orders), wos: byId(db.work_orders),
  }
}

// Quantity of each component per ONE parent, including the scrap allowance
export const effQty = b => Number(b.qty_per) * (1 + Number(b.scrap_pct || 0))

// ---------- open commitments ----------
// Open purchase orders (bought items) and work orders (made items) that will add stock
export function onOrder(db, ix) {
  const m = new Map()   // item -> [{qty, date, doc}]
  const add = (item, qty, date, doc) => { if (qty > 0) { if (!m.has(item)) m.set(item, []); m.get(item).push({ qty, date, doc }) } }
  for (const po of db.purchase_orders || []) {
    if (!['sent', 'partial'].includes(po.status)) continue
    for (const l of ix.poLinesBy.get(po.id) || []) add(l.item_id, Number(l.qty_ordered) - Number(l.qty_received), po.expected_date, po.id)
  }
  for (const wo of db.work_orders || []) {
    if (['planned', 'in_progress'].includes(wo.status)) add(wo.item_id, Number(wo.qty_planned), wo.due_date, wo.id)
  }
  return m
}

// Unshipped quantity on confirmed (Order Placed) sales orders
export function committed(db, ix) {
  const m = new Map()
  for (const s of db.sales || []) {
    if (s.kind !== 'SO' || s.status !== 'placed') continue
    for (const l of ix.linesBySale.get(s.id) || []) {
      const open = Number(l.qty) - Number(l.qty_shipped)
      if (open > 0) m.set(l.item_id, (m.get(l.item_id) || 0) + open)
    }
  }
  return m
}

// Allocation (available-to-promise): hand out on-hand stock at each location to
// open sales orders first-come, first-served (earliest requested date, then
// earliest order date), so two orders can't both count the same units.
// Returns Map(sales_line id -> { open, allocated, short }) plus per item/location
// totals of committed (open qty) and allocated.
export function allocations(db, ix) {
  const lines = new Map()
  const committedAt = new Map()   // `${item}|${loc}` -> open qty on placed orders
  const left = new Map()          // `${item}|${loc}` -> stock not yet allocated
  const open = (db.sales || []).filter(s => s.kind === 'SO' && s.status === 'placed')
    .sort((a, b) => (a.requested_date || '').localeCompare(b.requested_date || '') || (a.order_date || '').localeCompare(b.order_date || '') || String(a.id).localeCompare(String(b.id)))
  for (const s of open) {
    for (const l of ix.linesBySale.get(s.id) || []) {
      const qty = Math.max(0, Number(l.qty) - Number(l.qty_shipped))
      if (!qty) continue
      const key = l.item_id + '|' + s.location_id
      if (!left.has(key)) left.set(key, Math.max(0, ix.onHand(l.item_id, s.location_id)))
      const allocated = Math.min(qty, left.get(key))
      left.set(key, left.get(key) - allocated)
      committedAt.set(key, (committedAt.get(key) || 0) + qty)
      lines.set(l.id, { open: qty, allocated, short: qty - allocated })
    }
  }
  const committedOf = (item, loc) => loc ? committedAt.get(item + '|' + loc) || 0
    : [...committedAt.entries()].reduce((a, [k, q]) => a + (k.startsWith(item + '|') && !ix.qh.has(k.split('|')[1]) ? q : 0), 0)
  // Free stock at a location after earlier orders have taken their share
  const freeAt = (item, loc) => left.has(item + '|' + loc) ? left.get(item + '|' + loc) : Math.max(0, ix.onHand(item, loc))
  return { lines, committedOf, freeAt }
}

// Estimated date a backordered item will be available again:
// earliest open PO/WO that covers it, otherwise today + item lead time.
export function etaFor(itemId, shortQty, db, ix, today = todayLima(), orders = onOrder(db, ix)) {
  const list = (orders.get(itemId) || []).filter(o => o.date).sort((a, b) => a.date.localeCompare(b.date))
  let cum = 0
  for (const o of list) { cum += o.qty; if (cum >= shortQty) return { date: o.date < today ? today : o.date, basis: `${o.doc} due ${o.date}` } }
  const it = ix.items.get(itemId)
  return { date: addDays(today, Number(it?.lead_time_days || 0)), basis: `lead time ${it?.lead_time_days ?? 0} d (nothing on order covers it)` }
}

// ---------- demand history ----------
// Daily demand per item from shipped sales, exploded through the BOM:
// selling a kit creates demand for its tees, selling a tee creates demand
// for fabric, thread, labels... (this is "dependent demand").
export function demandHistory(db, ix, today = todayLima()) {
  const windowDays = setting(db, 'demand_window_days', 184)
  const from = addDays(today, -windowDays + 1)
  const days = workdaysBetween(from, today)
  const daily = new Map()   // item -> Map(date -> qty)
  const add = (item, date, q) => {
    if (!daily.has(item)) daily.set(item, new Map())
    const m = daily.get(item); m.set(date, (m.get(date) || 0) + q)
  }
  const explode = (item, date, q, depth = 0) => {
    add(item, date, q)
    if (depth > 5) return
    for (const b of ix.bomBy.get(item) || []) explode(b.component_id, date, q * effQty(b), depth + 1)
  }
  for (const s of db.sales || []) {
    if (s.status === 'cancelled') continue
    const d = limaDate(s.fulfilled_at || s.order_date)
    if (d < from || d > today) continue
    for (const l of ix.linesBySale.get(s.id) || []) {
      const q = Number(l.qty_shipped) - Number(l.qty_returned || 0)
      if (q > 0) explode(l.item_id, d, q)
    }
  }
  return { from, to: today, days, daily }
}

// ---------- inventory policy: reorder point, EOQ, periodic review ----------
export function inventoryPolicy(db, ix, today = todayLima()) {
  const hist = demandHistory(db, ix, today)
  const z = setting(db, 'service_z', 1.65)
  const S = setting(db, 'ordering_cost', 60)
  const hRate = setting(db, 'holding_rate', 0.25)
  const wdpy = setting(db, 'working_days_per_year', 312)
  const R = setting(db, 'review_period_days', 14)
  const orders = onOrder(db, ix)
  const commit = committed(db, ix)
  const dates = []
  for (let d = hist.from; d <= hist.to; d = addDays(d, 1)) if (isWorkday(d)) dates.push(d)

  return (db.items || []).filter(i => i.active).map(i => {
    const m = hist.daily.get(i.id) || new Map()
    const series = dates.map(d => m.get(d) || 0)
    const total = sum(series)
    const d = hist.days ? total / hist.days : 0                                   // average daily demand
    const mean = d
    const sd = series.length > 1 ? Math.sqrt(sum(series, x => (x - mean) ** 2) / (series.length - 1)) : 0
    const LT = Number(i.lead_time_days) || 0
    const ltd = d * LT                                                            // lead-time demand
    const ss = z * sd * Math.sqrt(LT)                                             // safety stock
    const rop = ltd + ss                                                          // reorder point
    const D = d * wdpy                                                            // annual demand
    const cost = Number(i.avg_cost) || Number(i.std_cost) || 0
    const H = hRate * cost                                                        // holding cost / unit / year
    const eoq = H > 0 && D > 0 ? Math.sqrt((2 * D * S) / H) : 0                   // economic order quantity
    const target = d * (R + LT) + z * sd * Math.sqrt(R + LT)                       // periodic review order-up-to level
    const oh = ix.onHand(i.id)
    const oo = sum(orders.get(i.id) || [], o => o.qty)
    const bo = commit.get(i.id) || 0
    const position = oh + oo - bo                                                 // inventory position
    const decimals = i.uom === 'kg' ? 1 : 0
    const roundUp = x => decimals ? Math.ceil(x * 10) / 10 : Math.ceil(x)
    let suggest = 0
    if (position <= rop && d > 0) {
      suggest = Math.max(eoq, rop - position)
      if (i.lot_rule === 'FOQ' && Number(i.lot_qty) > 0) suggest = Math.ceil(suggest / Number(i.lot_qty)) * Number(i.lot_qty)
      suggest = roundUp(suggest)
    }
    // order-by: today if already at/below ROP, else when position is projected to hit ROP
    let orderBy = null
    if (d > 0) {
      const workdaysLeft = Math.max(0, Math.floor((position - rop) / d))
      orderBy = today; let n = 0
      while (n < workdaysLeft && n < 400) { orderBy = addDays(orderBy, 1); if (isWorkday(orderBy)) n++ }
    }
    return {
      item: i, d, sd, LT, ltd, ss, rop: roundUp(rop), eoq: roundUp(eoq), D, H, S, z, R,
      target: roundUp(target), periodicQty: Math.max(0, roundUp(target - position)),
      onHand: oh, onOrder: oo, committed: bo, position, belowRop: d > 0 && position <= rop,
      suggest, orderBy, totalDemand: total, days: hist.days, from: hist.from,
    }
  })
}

// ---------- MRP (time-phased records, same layout as the class slides) ----------
// Gross Requirements, Scheduled Receipts, Projected On Hand, Net Requirements,
// Planned Order Receipts, Planned Order Releases — one record per item,
// parents first (level 0), then their components (level 1, 2...).
export function lowLevelCodes(db) {
  const parentsOf = groupBy(db.bom || [], 'component_id')
  const memo = new Map()
  const lvl = (id, seen = new Set()) => {
    if (memo.has(id)) return memo.get(id)
    if (seen.has(id)) return 0
    seen.add(id)
    const ps = parentsOf.get(id) || []
    const v = ps.length ? Math.max(...ps.map(p => lvl(p.parent_id, seen) + 1)) : 0
    memo.set(id, v); return v
  }
  for (const i of db.items || []) lvl(i.id)
  return memo
}

export function runMRP(db, ix, { today = todayLima(), weeks = 4 } = {}) {
  const start = mondayOf(today)
  const weekStarts = Array.from({ length: weeks }, (_, k) => addDays(start, 7 * k))
  const horizonEnd = addDays(start, 7 * weeks - 1)
  const periodOf = date => {                       // 0-based week index; past dates -> week 1 (index 0)
    if (!date || date < start) return 0
    const k = Math.floor(daysBetween(start, date) / 7)
    return k < weeks ? k : null                   // null = beyond the horizon
  }
  const levels = lowLevelCodes(db)
  const items = (db.items || []).filter(i => i.active)
  const recs = new Map()
  const zero = () => Array(weeks).fill(0)
  for (const i of items) {
    recs.set(i.id, {
      item: i, level: levels.get(i.id) || 0, ltWeeks: Math.ceil((Number(i.lead_time_days) || 0) / 7),
      onHand: ix.onHand(i.id), gross: zero(), sched: zero(), poh: zero(), net: zero(), por: zero(), pol: zero(),
      pastDueRelease: 0, independent: zero(), dependent: zero(), sources: [], beyond: 0,
    })
  }
  // independent demand: unshipped qty on confirmed sales orders, by requested date
  for (const s of db.sales || []) {
    if (s.kind !== 'SO' || s.status !== 'placed') continue
    for (const l of ix.linesBySale.get(s.id) || []) {
      const open = Number(l.qty) - Number(l.qty_shipped); const r = recs.get(l.item_id)
      if (open <= 0 || !r) continue
      const k = periodOf(s.requested_date)
      if (k === null) { r.beyond += open; continue }
      r.gross[k] += open; r.independent[k] += open
      r.sources.push({ doc: s.id, qty: open, week: k + 1, type: 'Sales order' })
    }
  }
  // scheduled receipts: open POs (bought) and open work orders (made)
  for (const [item, list] of onOrder(db, ix)) {
    const r = recs.get(item); if (!r) continue
    for (const o of list) { const k = periodOf(o.date); if (k !== null) { r.sched[k] += o.qty; r.sources.push({ doc: o.doc, qty: o.qty, week: k + 1, type: 'Scheduled receipt' }) } }
  }
  // components still to be issued to PLANNED work orders are already needed
  for (const wo of db.work_orders || []) {
    if (wo.status !== 'planned') continue
    const it = ix.items.get(wo.item_id)
    const k = periodOf(addDays(wo.due_date || today, -(Number(it?.lead_time_days) || 0)))
    for (const c of (db.wo_components || []).filter(c => c.wo_id === wo.id)) {
      const r = recs.get(c.item_id); if (!r || k === null) continue
      r.gross[k] += Number(c.qty_required); r.dependent[k] += Number(c.qty_required)
      r.sources.push({ doc: wo.id, qty: Number(c.qty_required), week: k + 1, type: 'Planned work order' })
    }
  }
  const lot = (r, net) => {
    if (net <= 0) return 0
    const i = r.item
    let q = net
    if (i.lot_rule === 'FOQ' && Number(i.lot_qty) > 0) q = Math.ceil(net / Number(i.lot_qty)) * Number(i.lot_qty)
    return i.uom === 'kg' ? Math.ceil(q * 10) / 10 : Math.ceil(q - 1e-9)
  }
  // process by level so every parent is planned before its components
  const ordered = [...recs.values()].sort((a, b) => a.level - b.level || a.item.id.localeCompare(b.item.id))
  for (const r of ordered) {
    let prev = r.onHand
    for (let t = 0; t < weeks; t++) {
      const avail = prev + r.sched[t]
      const net = Math.max(0, r.gross[t] - avail)
      r.net[t] = round(net, 4)
      r.por[t] = lot(r, net)
      r.poh[t] = round(avail + r.por[t] - r.gross[t], 4)
      prev = r.poh[t]
      if (r.por[t] > 0) {
        const rel = t - r.ltWeeks
        if (rel >= 0) r.pol[rel] += r.por[t]
        else r.pastDueRelease += r.por[t]                    // should already have been ordered
      }
    }
    // explode planned order releases into component gross requirements
    const releases = r.pol.map((q, t) => (t === 0 ? q + r.pastDueRelease : q))
    for (const b of ix.bomBy.get(r.item.id) || []) {
      const c = recs.get(b.component_id); if (!c) continue
      releases.forEach((q, t) => {
        if (q > 0) {
          const need = round(q * effQty(b), 4)
          c.gross[t] += need; c.dependent[t] += need
          c.sources.push({ doc: `${r.item.id} release`, qty: need, week: t + 1, type: 'Parent planned order' })
        }
      })
    }
  }
  // suggestions: one per planned order receipt, with an order-by date backed off by lead time
  const suggestions = []
  for (const r of ordered) {
    r.por.forEach((q, t) => {
      if (q <= 0) return
      const needDate = t === 0 && today > weekStarts[0] ? today : weekStarts[t]
      const orderBy = addDays(needDate, -(Number(r.item.lead_time_days) || 0))
      suggestions.push({
        item: r.item, level: r.level, qty: q, week: t + 1, needDate, orderBy, late: orderBy < today,
        action: r.item.make_or_buy === 'Make' ? 'Work order' : 'Purchase order',
        supplier_id: r.item.supplier_id,
      })
    })
  }
  suggestions.sort((a, b) => a.orderBy.localeCompare(b.orderBy) || a.level - b.level)
  return { weekStarts, horizonEnd, records: ordered, suggestions, today }
}

// ---------- supplier scorecard (computed from PO history) ----------
const TERMS_DAYS = t => (t === 'Prepaid' ? 0 : Number((t || '').match(/\d+/)?.[0] || 30))
export function supplierScorecard(db, ix, today = todayLima()) {
  const recBy = groupBy(db.po_receipts || [], 'po_id')
  const payBy = groupBy(db.supplier_payments || [], 'po_id')
  return (db.suppliers || []).map(s => {
    const pos = (db.purchase_orders || []).filter(p => p.supplier_id === s.id && !['draft', 'cancelled'].includes(p.status))
    const delivered = [], payables = []
    let ordered = 0, received = 0
    for (const p of pos) {
      const lines = ix.poLinesBy.get(p.id) || []
      const recs = recBy.get(p.id) || []
      const done = ['received', 'closed'].includes(p.status)
      if (done) { ordered += sum(lines, l => l.qty_ordered); received += sum(lines, l => l.qty_received) }
      if (recs.length) {
        const last = recs.map(r => r.received_date).sort().at(-1)
        const first = recs.map(r => r.received_date).sort()[0]
        if (done) delivered.push({ po: p, last, actualLT: daysBetween(p.sent_date, last), quotedLT: daysBetween(p.sent_date, p.expected_date), onTime: last <= p.expected_date, lateDays: Math.max(0, daysBetween(p.expected_date, last)) })
        p._first = first
      }
      const billed = p.payment_terms === 'Prepaid' ? sum(lines, l => l.qty_ordered * l.unit_cost) : sum(lines, l => l.qty_received * l.unit_cost)
      const paid = sum(payBy.get(p.id) || [], x => x.amount)
      const owed = round(billed - paid)
      if (owed > 0.004) {
        const due = p.payment_terms === 'Prepaid' ? p.sent_date : addDays(p._first, TERMS_DAYS(p.payment_terms))
        payables.push({ po: p.id, owed, due, overdue: due < today })
      }
    }
    const onTimeRate = delivered.length ? delivered.filter(x => x.onTime).length / delivered.length : null
    const avgLT = delivered.length ? sum(delivered, x => x.actualLT) / delivered.length : null
    const avgQuoted = delivered.length ? sum(delivered, x => x.quotedLT) / delivered.length : Number(s.lead_time_days)
    const fillRate = ordered ? received / ordered : null
    const ltScore = avgLT ? Math.min(1, avgQuoted / avgLT) : null
    const parts = [[onTimeRate, 40], [fillRate, 30], [ltScore, 30]].filter(([v]) => v !== null)
    const score = parts.length ? Math.round(100 * sum(parts, ([v, w]) => v * w) / sum(parts, ([, w]) => w)) : null
    const rating = score === null ? 'No history' : score >= 90 ? 'Keep' : score >= 75 ? 'Watch' : 'Replace'
    return {
      supplier: s, poCount: pos.length, deliveredCount: delivered.length, onTimeRate, avgLT, avgQuoted,
      quotedLT: Number(s.lead_time_days), fillRate, ltScore, score, rating, delivered,
      owed: round(sum(payables, x => x.owed)), payables: payables.sort((a, b) => (a.due || '').localeCompare(b.due || '')),
      overdue: round(sum(payables.filter(x => x.overdue), x => x.owed)),
      nextDue: payables.filter(x => !x.overdue).map(x => x.due).sort()[0] || null,
      openPOs: pos.filter(p => ['sent', 'partial'].includes(p.status)).length,
    }
  })
}

// ---------- production metrics ----------
export function productionReport(db, ix, from, to) {
  const wos = (db.work_orders || []).filter(w => w.status === 'completed' && w.finished_at &&
    limaDate(w.finished_at) >= from && limaDate(w.finished_at) <= to)
  const started = sum(wos, w => w.qty_planned), good = sum(wos, w => w.qty_good)
  const scrap = sum(wos, w => w.qty_scrap), rework = sum(wos, w => w.qty_rework)
  const hours = wos.map(w => (new Date(w.finished_at) - new Date(w.started_at)) / 3600000)
  const onTime = wos.filter(w => w.due_date && limaDate(w.finished_at) <= w.due_date).length
  const scrapCost = sum(wos, w => Number(w.qty_scrap) * Number(w.unit_cost))
  const ids = new Set(wos.map(w => w.id))
  const reasons = new Map()
  for (const i of db.wo_issues || []) {
    if (!ids.has(i.wo_id)) continue
    const k = `${i.reason}|${i.kind}`
    reasons.set(k, (reasons.get(k) || 0) + Number(i.qty))
  }
  const days = Math.max(1, workdaysBetween(from, to))
  return {
    wos, count: wos.length, started, good, scrap, rework,
    yield: started ? good / started : null,                         // good ÷ started
    fpy: started ? (good - rework) / started : null,                 // first-pass yield: right the first time
    scrapRate: started ? scrap / started : null,
    reworkRate: started ? rework / started : null,
    onTimeRate: wos.length ? onTime / wos.length : null,
    avgCycleHours: hours.length ? sum(hours) / hours.length : null,
    throughputPerDay: good / days,
    scrapCost,
    avgUnitCost: good ? sum(wos, w => Number(w.qty_good) * Number(w.unit_cost)) / good : null,
    reasons: [...reasons.entries()].map(([k, qty]) => { const [reason, kind] = k.split('|'); return { reason, kind, qty } })
      .sort((a, b) => b.qty - a.qty),
    cancelled: (db.work_orders || []).filter(w => w.status === 'cancelled' && w.finished_at && limaDate(w.finished_at) >= from && limaDate(w.finished_at) <= to).length,
  }
}

// ---------- materials check for a work order ----------
export function materialCheck(db, ix, itemId, qty, loc) {
  return (ix.bomBy.get(itemId) || []).map(b => {
    const need = round(qty * effQty(b), 4)
    const here = ix.onHand(b.component_id, loc)
    const total = ix.onHand(b.component_id)
    return { component: ix.items.get(b.component_id), need, here, total, short: Math.max(0, round(need - here, 4)), elsewhere: round(total - here, 4) }
  })
}

// ---------- sales analytics ----------
export function salesLinesInRange(db, ix, from, to) {
  const out = []
  for (const s of db.sales || []) {
    if (s.status === 'cancelled') continue
    const d = limaDate(s.fulfilled_at || s.order_date)
    if (d < from || d > to) continue
    for (const l of ix.linesBySale.get(s.id) || []) {
      const q = Number(l.qty_shipped); if (!q) continue
      const net = q * l.unit_price * (1 - l.discount_pct)
      out.push({ sale: s, line: l, date: d, qty: q, revenue: net, cost: q * Number(l.unit_cost || 0) })
    }
  }
  return out
}

export function salesByPeriod(rows, grain = 'week') {
  const m = new Map()
  for (const r of rows) {
    const k = grain === 'day' ? r.date : grain === 'month' ? r.date.slice(0, 7) + '-01' : mondayOf(r.date)
    const x = m.get(k) || { period: k, revenue: 0, cost: 0, units: 0, orders: new Set() }
    x.revenue += r.revenue; x.cost += r.cost; x.units += r.qty; x.orders.add(r.sale.id); m.set(k, x)
  }
  return [...m.values()].map(x => ({ ...x, orders: x.orders.size })).sort((a, b) => a.period.localeCompare(b.period))
}

export function topItems(rows, ix, n = 10) {
  const m = new Map()
  for (const r of rows) {
    const x = m.get(r.line.item_id) || { item: ix.items.get(r.line.item_id), qty: 0, revenue: 0, cost: 0 }
    x.qty += r.qty; x.revenue += r.revenue; x.cost += r.cost; m.set(r.line.item_id, x)
  }
  return [...m.values()].sort((a, b) => b.revenue - a.revenue).slice(0, n)
}

// ---------- P&L from ledger account totals ----------
export function profitAndLoss(totals) {
  const t = a => totals.find(x => x.account === a) || { debit: 0, credit: 0 }
  const cr = a => Number(t(a).credit) - Number(t(a).debit)
  const dr = a => Number(t(a).debit) - Number(t(a).credit)
  const gross = cr('Sales Revenue'), discounts = dr('Sales Discounts'), returns = dr('Sales Returns')
  const netSales = gross - discounts - returns
  const cogs = dr('COGS')
  const grossProfit = netSales - cogs
  const scrap = dr('Scrap Expense'), adjustments = dr('Inventory Adjustments')
  const operating = grossProfit - scrap - adjustments
  return { gross, discounts, returns, netSales, cogs, grossProfit, grossMargin: netSales ? grossProfit / netSales : null, scrap, adjustments, operating }
}

// ---------- formatting ----------
export const money = n => (n === null || n === undefined || Number.isNaN(n)) ? '—'
  : 'S/ ' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
export const num = (n, d = 0) => (n === null || n === undefined || Number.isNaN(Number(n))) ? '—'
  : Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: d })
export const pct = (n, d = 1) => (n === null || n === undefined || Number.isNaN(n)) ? '—' : (n * 100).toFixed(d) + '%'
export const qtyFmt = (n, uom) => num(n, uom === 'kg' ? 2 : uom === 'cone' ? 2 : 0) + (uom && uom !== 'unit' ? ' ' + uom : '')
export const dt = ts => ts ? new Date(ts).toLocaleString('en-US', { timeZone: TZ, month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—'
export const dfmt = d => d ? new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : '—'
export const dshort = d => d ? new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : '—'
// datetime-local input <-> timestamp, always in Lima time (UTC-5, no daylight saving)
export const toLimaInput = ts => ts ? new Date(new Date(ts).getTime() - 5 * 3600000).toISOString().slice(0, 16) : ''
export const fromLimaInput = s => s ? new Date(s + ':00-05:00').toISOString() : null
