import { useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useData } from '../lib/data.jsx'
import { Page, Card, Stat, Bars, Badge } from '../components/ui.jsx'
import { inventoryPolicy, salesLinesInRange, salesByPeriod, money, num, pct, todayLima, addDays, dshort, dfmt, sum, runMRP } from '../lib/calc.js'

// Four key numbers, one chart, one to-do list. Detail lives on each module's page.
export default function Dashboard() {
  const { db, ix } = useData()
  const nav = useNavigate()
  const today = todayLima()
  const k = useMemo(() => {
    const todayRows = salesLinesInRange(db, ix, today, today)
    const mtd = salesLinesInRange(db, ix, today.slice(0, 8) + '01', today)
    const mtdRev = sum(mtd, r => r.revenue)
    const policy = inventoryPolicy(db, ix, today)
    const mrp = runMRP(db, ix, { today, weeks: 4 })
    const openSO = db.sales.filter(s => s.kind === 'SO' && s.status === 'placed')
    const below = policy.filter(p => p.belowRop).sort((a, b) => (a.orderBy || '').localeCompare(b.orderBy || ''))
    const inbound = db.purchase_orders.filter(p => ['sent', 'partial'].includes(p.status))
    // one prioritised to-do list across modules
    const todo = [
      ...mrp.suggestions.filter(s => s.late).map(s => ({ key: 'm' + s.item.id + s.week, tone: 'red', tag: 'MRP · past due', text: `${s.action === 'Work order' ? 'Make' : 'Buy'} ${num(s.qty, 1)} ${s.item.name}`, when: 'order now', to: '/mrp' })),
      ...db.work_orders.filter(w => ['planned', 'in_progress'].includes(w.status) && w.due_date < today).map(w => ({ key: w.id, tone: 'red', tag: 'Late WO', text: `${w.id} · ${num(w.qty_planned)} ${ix.items.get(w.item_id)?.name}`, when: `due ${dshort(w.due_date)}`, to: '/production' })),
      ...inbound.filter(p => p.expected_date < today).map(p => ({ key: p.id, tone: 'amber', tag: 'Late PO', text: `${p.id} · ${ix.suppliers.get(p.supplier_id)?.name}`, when: `due ${dshort(p.expected_date)}`, to: '/purchasing' })),
      ...openSO.filter(s => s.requested_date <= addDays(today, 7)).map(s => ({ key: s.id, tone: 'blue', tag: 'Ship soon', text: `${s.id} · ${ix.customers.get(s.customer_id)?.name}`, when: dshort(s.requested_date), to: '/sales' })),
      ...below.slice(0, 5).map(p => ({ key: 'r' + p.item.id, tone: 'amber', tag: 'Reorder', text: p.item.name, when: p.orderBy <= today ? 'today' : dshort(p.orderBy), to: '/purchasing?tab=replenish' })),
    ]
    return {
      todayRev: sum(todayRows, r => r.revenue), mtdRev,
      mtdMargin: mtdRev ? 1 - sum(mtd, r => r.cost) / mtdRev : null,
      invValue: sum(db.stock, s => s.qty * (ix.items.get(s.item_id)?.avg_cost || 0)),
      openSO, unitsToShip: sum(openSO.flatMap(s => ix.linesBySale.get(s.id) || []), l => l.qty - l.qty_shipped),
      below, weeks: salesByPeriod(salesLinesInRange(db, ix, addDays(today, -83), today), 'week'), todo,
    }
  }, [db, ix, today])

  return (
    <Page title="Dashboard" subtitle={dfmt(today) + ' · Lima'}
      how={<>
        <p><b>An ERP is one shared database that every department works in.</b> When the store sells a T-shirt, the same transaction lowers stock at that location, records revenue and cost of goods sold, changes reorder suggestions and what MRP tells purchasing to buy — for every user at once. Every number here is computed live from that data.</p>
        <p>How the modules connect: <Link to="/purchasing">Purchasing</Link> (receipts raise stock and accounts payable) → <Link to="/inventory">Inventory</Link> (stock by location) → <Link to="/production">Production</Link> (work orders consume BOM components) → <Link to="/pos">Sales</Link> (stock down, revenue + COGS) → <Link to="/returns">Returns</Link> (reverse them) → <Link to="/mrp">MRP</Link> (what to buy/make, when) → <Link to="/finance">Financials</Link> (P&amp;L, valuation, turnover).</p>
        <p>After every transaction, a panel in the bottom-right corner shows exactly which records changed.</p>
      </>}>
      <div className="stats">
        <Stat label="Sales this month" value={money(k.mtdRev)} soles={k.mtdRev}
          sub={k.mtdRev ? `${pct(k.mtdMargin)} gross margin · today ${money(k.todayRev)}` : 'No sales recorded yet this month'} onClick={() => nav('/finance')} />
        <Stat label="Inventory value" value={money(k.invValue)} soles={k.invValue} sub="weighted average cost" onClick={() => nav('/finance')} />
        <Stat label="Orders to ship" value={k.openSO.length} sub={`${num(k.unitsToShip)} units`} onClick={() => nav('/sales')} />
        <Stat label="Items to reorder" value={k.below.length} tone={k.below.length ? 'warn' : ''} sub="at or below reorder point" onClick={() => nav('/purchasing?tab=replenish')} />
      </div>

      <div className="grid dash">
        <Card title="Weekly sales" actions={<Link className="btn small ghost" to="/reports">Reports →</Link>}>
          {k.weeks.length ? <Bars rows={k.weeks.map(w => ({ label: dshort(w.period), value: w.revenue }))} format={money} height={200} />
            : <p className="muted">No sales in the last 12 weeks yet.</p>}
          <p className="muted small" style={{ margin: '8px 0 0' }}>Net sales before IGV, last 12 weeks</p>
        </Card>
        <Card title="Needs attention">
          {k.todo.length === 0 ? <p className="muted">All clear.</p> : (
            <ul className="todo">
              {k.todo.slice(0, 9).map(t => (
                <li key={t.key} onClick={() => nav(t.to)}>
                  <Badge tone={t.tone}>{t.tag}</Badge>
                  <span className="todo-text">{t.text}</span>
                  <span className="muted small">{t.when}</span>
                </li>))}
            </ul>)}
        </Card>
      </div>
    </Page>
  )
}
