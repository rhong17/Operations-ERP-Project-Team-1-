import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useData } from '../lib/data.jsx'
import { Page, Card, DateRange, Bars, Tabs, StatusBadge, Badge, Empty, ItemName } from '../components/ui.jsx'
import { money, num, pct, dshort, dfmt, todayLima, salesLinesInRange, salesByPeriod, topItems, inventoryPolicy, supplierScorecard, groupBy, sum, qtyFmt } from '../lib/calc.js'

export default function Reports() {
  const { db, ix } = useData()
  const [from, setFrom] = useState('2026-05-01')
  const [to, setTo] = useState(todayLima())
  const [grain, setGrain] = useState('week')
  const [tab, setTab] = useState('sales')
  const rows = useMemo(() => salesLinesInRange(db, ix, from, to), [db, ix, from, to])
  const periods = useMemo(() => salesByPeriod(rows, grain), [rows, grain])
  const top = useMemo(() => topItems(rows, ix, 15), [rows, ix])
  const policy = useMemo(() => inventoryPolicy(db, ix), [db, ix])
  const sc = useMemo(() => supplierScorecard(db, ix), [db, ix])
  const byCust = [...groupBy(rows, r => r.sale.customer_id).entries()].map(([id, rs]) => ({ c: ix.customers.get(id), rev: sum(rs, r => r.revenue), units: sum(rs, r => r.qty), orders: new Set(rs.filter(r => !r.isReturn).map(r => r.sale.id)).size })).sort((a, b) => b.rev - a.rev)

  return (
    <Page title="Management Reports" subtitle="Everything is recalculated from the database whenever anyone changes something"
      how={<p>Use the date range to look at any period of the 6-month sales history plus new activity. Sales are by shipment date (POS sale or sales-order fulfilment), net of discounts and before IGV. Returns are subtracted on the day they happen, exactly like the P&amp;L, so these totals match Financials.</p>}>
      <Card><div className="row gap wrap"><DateRange from={from} to={to} onChange={(a, b) => { setFrom(a); setTo(b) }} />
        <select style={{ width: 130 }} value={grain} onChange={e => setGrain(e.target.value)}><option value="day">By day</option><option value="week">By week</option><option value="month">By month</option></select></div></Card>
      <Tabs value={tab} onChange={setTab} tabs={[['sales', 'Sales by period'], ['top', 'Top-selling items'], ['cust', 'Sales by customer'], ['low', 'Low stock & order-by'], ['loc', 'Inventory by location'], ['sup', 'Supplier performance']]} />

      {tab === 'sales' && <>
        <Card title={`Net sales by ${grain}`}><Bars rows={periods.map(p => ({ label: grain === 'month' ? p.period.slice(0, 7) : dshort(p.period), value: p.revenue }))} format={money} height={220} /></Card>
        <Card><div className="tbl-wrap"><table className="tbl compact"><thead><tr><th>{grain === 'day' ? 'Day' : grain === 'week' ? 'Week of' : 'Month'}</th><th className="num">Orders</th><th className="num">Units</th><th className="num">Net sales</th><th className="num">COGS</th><th className="num">Gross margin</th></tr></thead><tbody>
          {periods.map(p => <tr key={p.period}><td>{grain === 'month' ? p.period.slice(0, 7) : dfmt(p.period)}</td><td className="num">{p.orders}</td><td className="num">{num(p.units)}</td><td className="num">{money(p.revenue)}</td><td className="num">{money(p.cost)}</td><td className="num">{pct(1 - p.cost / p.revenue)}</td></tr>)}
          <tr className="total"><td>Total</td><td className="num">{sum(periods, p => p.orders)}</td><td className="num">{num(sum(periods, p => p.units))}</td><td className="num">{money(sum(periods, p => p.revenue))}</td><td className="num">{money(sum(periods, p => p.cost))}</td><td className="num">{pct(1 - sum(periods, p => p.cost) / sum(periods, p => p.revenue))}</td></tr>
        </tbody></table></div></Card>
      </>}

      {tab === 'top' && <Card title="Top-selling items by net sales">
        <table className="tbl"><thead><tr><th>#</th><th>Item</th><th className="num">Units</th><th className="num">Net sales</th><th className="num">Gross margin</th><th style={{ width: '25%' }}></th></tr></thead><tbody>
          {top.map((t, k) => <tr key={t.item.id}><td>{k + 1}</td><td>{t.item.name}</td><td className="num">{num(t.qty)}</td><td className="num">{money(t.revenue)}</td><td className="num">{pct(1 - t.cost / t.revenue)}</td><td><div className="hbar"><div style={{ width: `${(t.revenue / top[0].revenue) * 100}%` }} /></div></td></tr>)}
        </tbody></table></Card>}

      {tab === 'cust' && <Card title="Sales by customer / channel">
        <table className="tbl"><thead><tr><th>Customer</th><th>Channel</th><th className="num">Orders</th><th className="num">Units</th><th className="num">Net sales</th><th className="num">Share</th></tr></thead><tbody>
          {byCust.map(c => <tr key={c.c?.id}><td>{c.c?.name}</td><td>{c.c?.channel}</td><td className="num">{c.orders}</td><td className="num">{num(c.units)}</td><td className="num">{money(c.rev)}</td><td className="num">{pct(c.rev / sum(byCust, x => x.rev))}</td></tr>)}
        </tbody></table></Card>}

      {tab === 'low' && <Card title="Low stock with suggested order quantities and order-by dates" actions={<Link className="btn small" to="/purchasing?tab=replenish">Open replenishment</Link>}>
        {policy.filter(p => p.belowRop).length === 0 ? <Empty icon="check">No items at or below their reorder point.</Empty> :
          <table className="tbl"><thead><tr><th>Item</th><th className="num">On hand</th><th className="num">On order</th><th className="num">Committed</th><th className="num">ROP</th><th className="num">Suggested qty</th><th>Order by</th><th>Source</th></tr></thead><tbody>
            {policy.filter(p => p.belowRop).sort((a, b) => a.orderBy.localeCompare(b.orderBy)).map(p => <tr key={p.item.id}><td><ItemName item={p.item} /></td><td className="num">{qtyFmt(p.onHand, p.item.uom)}</td><td className="num">{num(p.onOrder, 1)}</td><td className="num">{num(p.committed, 1)}</td><td className="num">{num(p.rop, 1)}</td><td className="num"><b>{qtyFmt(p.suggest, p.item.uom)}</b></td>
              <td className={p.orderBy <= todayLima() ? 'neg' : ''}>{p.orderBy <= todayLima() ? 'Today' : dfmt(p.orderBy)}</td><td>{p.item.make_or_buy === 'Make' ? 'Make (work order)' : ix.suppliers.get(p.item.supplier_id)?.name}</td></tr>)}
          </tbody></table>}
      </Card>}

      {tab === 'loc' && <Card title="Inventory by location">
        <div className="grid g2">{[...db.locations].sort((a, b) => a.sort - b.sort).map(l => {
          const rs = db.stock.filter(s => s.location_id === l.id && s.qty > 0)
          return <div key={l.id}><h3>{l.name} — {money(sum(rs, s => s.qty * ix.items.get(s.item_id).avg_cost))}</h3>
            <table className="tbl compact"><tbody>{rs.map(s => { const it = ix.items.get(s.item_id); return <tr key={s.item_id}><td><ItemName item={it} /></td><td className="num">{qtyFmt(s.qty, it.uom)}</td></tr> })}</tbody></table>
            {!rs.length && <p className="muted">Empty</p>}</div>
        })}</div>
      </Card>}

      {tab === 'sup' && <Card title="Supplier performance">
        <table className="tbl"><thead><tr><th>Supplier</th><th className="num">Avg actual lead time</th><th className="num">Quoted</th><th className="num">Difference</th><th className="num">On-time</th><th className="num">Fill rate</th><th>Rating</th></tr></thead><tbody>
          {sc.map(s => <tr key={s.supplier.id}><td>{s.supplier.name}</td><td className="num">{num(s.avgLT, 1)} d</td><td className="num">{s.quotedLT} d</td>
            <td className={'num ' + (s.avgLT > s.quotedLT ? 'neg' : 'pos')}>{s.avgLT === null ? '—' : (s.avgLT - s.quotedLT > 0 ? '+' : '') + num(s.avgLT - s.quotedLT, 1) + ' d'}</td>
            <td className="num">{pct(s.onTimeRate, 0)}</td><td className="num">{pct(s.fillRate)}</td><td><StatusBadge status={s.rating} /> <Badge>{s.score}</Badge></td></tr>)}
        </tbody></table></Card>}
    </Page>
  )
}
