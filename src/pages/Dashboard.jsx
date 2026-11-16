import { useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useData } from '../lib/data.jsx'
import { Page, Card, Stat, Bars, StatusBadge } from '../components/ui.jsx'
import { inventoryPolicy, salesLinesInRange, salesByPeriod, money, num, pct, todayLima, addDays, dshort, dt, sum, runMRP } from '../lib/calc.js'

export default function Dashboard() {
  const { db, ix } = useData()
  const nav = useNavigate()
  const today = todayLima()
  const k = useMemo(() => {
    const todayRows = salesLinesInRange(db, ix, today, today)
    const mtd = salesLinesInRange(db, ix, today.slice(0, 8) + '01', today)
    const last12w = salesByPeriod(salesLinesInRange(db, ix, addDays(today, -83), today), 'week')
    const policy = inventoryPolicy(db, ix, today)
    const invValue = sum(db.stock, s => s.qty * (ix.items.get(s.item_id)?.avg_cost || 0))
    const mrp = runMRP(db, ix, { today, weeks: 4 })
    const weekEnd = addDays(today, 7)
    return {
      todayRev: sum(todayRows, r => r.revenue), todayOrders: new Set(todayRows.map(r => r.sale.id)).size,
      mtdRev: sum(mtd, r => r.revenue), mtdMargin: sum(mtd, r => r.revenue) ? 1 - sum(mtd, r => r.cost) / sum(mtd, r => r.revenue) : null,
      invValue, below: policy.filter(p => p.belowRop),
      openSO: db.sales.filter(s => s.kind === 'SO' && s.status === 'placed'),
      inbound: db.purchase_orders.filter(p => ['sent', 'partial'].includes(p.status) && p.expected_date <= weekEnd),
      wip: db.work_orders.filter(w => w.status === 'in_progress'),
      planned: db.work_orders.filter(w => w.status === 'planned'),
      lateMrp: mrp.suggestions.filter(s => s.late).length, mrpCount: mrp.suggestions.length,
      weeks: last12w,
      recent: [...db.inv_moves].sort((a, b) => b.id - a.id).slice(0, 8),
    }
  }, [db, ix, today])

  return (
    <Page title="Dashboard" subtitle={`Textiles Move · ${dshort(today)} (Lima) · every number below is computed live from the database`}
      how={<>
        <p><b>An ERP is one shared database that every department works in.</b> When the store sells a T-shirt, the same transaction lowers stock at that location, records revenue and cost of goods sold in the accounting journal, raises tomorrow's reorder suggestions and changes what MRP tells purchasing to buy — for everyone, at once.</p>
        <p>Click any module below to see its part of the flow. After every transaction a panel in the bottom-right corner shows exactly which records changed.</p>
      </>}>
      <div className="stats">
        <Stat label="Sales today (net of IGV)" value={money(k.todayRev)} sub={`${k.todayOrders} orders`} onClick={() => nav('/reports')} />
        <Stat label="Sales this month" value={money(k.mtdRev)} sub={`Gross margin ${pct(k.mtdMargin)}`} onClick={() => nav('/finance')} />
        <Stat label="Inventory value (weighted avg cost)" value={money(k.invValue)} onClick={() => nav('/finance')} />
        <Stat label="Items at / below reorder point" value={k.below.length} tone={k.below.length ? 'warn' : 'good'} sub="Purchasing → Replenishment" onClick={() => nav('/purchasing?tab=replenish')} />
        <Stat label="Open sales orders" value={k.openSO.length} sub={`${num(sum(k.openSO.flatMap(s => ix.linesBySale.get(s.id) || []), l => l.qty - l.qty_shipped))} units to ship`} onClick={() => nav('/sales')} />
        <Stat label="MRP planned orders (4 wks)" value={k.mrpCount} tone={k.lateMrp ? 'bad' : ''} sub={k.lateMrp ? `${k.lateMrp} past their order-by date` : 'all on time'} onClick={() => nav('/mrp')} />
        <Stat label="POs arriving ≤ 7 days" value={k.inbound.length} onClick={() => nav('/purchasing')} />
        <Stat label="Work orders" value={`${k.wip.length} in progress`} sub={`${k.planned.length} planned`} onClick={() => nav('/production')} />
      </div>

      <Card title="How the modules connect">
        <div className="flow">
          {[
            ['/purchasing', '1 · Purchasing', 'POs to suppliers → receipts raise stock & accounts payable'],
            ['/inventory', '2 · Inventory', 'On hand by item × location, transfers, cycle counts'],
            ['/production', '3 · Production', 'Work orders consume components (BOM) and create finished goods'],
            ['/pos', '4 · Sales', 'POS & sales orders reduce stock, record revenue + COGS'],
            ['/returns', '5 · Returns', 'Reverse revenue & cost; defects go to Quality Hold'],
            ['/mrp', '6 · MRP', 'Open orders × BOM − stock − open POs = what to buy/make and when'],
            ['/finance', '7 · Financials', 'P&L, inventory valuation, turnover from the journal'],
          ].map(([to, t, s]) => <Link key={to} to={to} className="flow-node"><strong>{t}</strong><span>{s}</span></Link>)}
        </div>
      </Card>

      <div className="grid g2">
        <Card title="Weekly sales — last 12 weeks">
          <Bars rows={k.weeks.map(w => ({ label: dshort(w.period), value: w.revenue }))} format={money} />
          {!k.weeks.length && <p className="muted">No sales in the last 12 weeks yet.</p>}
        </Card>
        <Card title="Needs attention">
          <table className="tbl compact"><tbody>
            {k.below.slice(0, 6).map(p => (
              <tr key={p.item.id} className="click" onClick={() => nav('/purchasing?tab=replenish')}>
                <td>{p.item.name}</td><td className="num">pos. {num(p.position, 1)} ≤ ROP {num(p.rop, 1)}</td><td><span className="badge amber">Reorder</span></td>
              </tr>))}
            {k.openSO.slice(0, 4).map(s => (
              <tr key={s.id} className="click" onClick={() => nav('/sales')}>
                <td>{s.id} · {ix.customers.get(s.customer_id)?.name}</td><td className="num">due {dshort(s.requested_date)}</td><td><StatusBadge status={s.status} /></td>
              </tr>))}
          </tbody></table>
        </Card>
      </div>

      <Card title="Latest stock movements (all users)">
        <table className="tbl compact"><thead><tr><th>When</th><th>Type</th><th>Item</th><th>Location</th><th className="num">Qty</th><th>Document</th></tr></thead><tbody>
          {k.recent.map(m => <tr key={m.id}><td>{dt(m.at)}</td><td>{m.kind}</td><td>{ix.items.get(m.item_id)?.name}</td><td>{ix.locations.get(m.location_id)?.name}</td>
            <td className={'num ' + (m.qty < 0 ? 'neg' : 'pos')}>{m.qty > 0 ? '+' : ''}{num(m.qty, 2)}</td><td>{m.doc_id}</td></tr>)}
        </tbody></table>
      </Card>
    </Page>
  )
}
