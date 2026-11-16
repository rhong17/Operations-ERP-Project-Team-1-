import { useEffect, useMemo, useState } from 'react'
import { useData } from '../lib/data.jsx'
import { supabase } from '../lib/supabase.js'
import { Page, Card, Stat, DateRange, Tabs, useUsd } from '../components/ui.jsx'
import { money, pct, num, profitAndLoss, todayLima, addDays, daysBetween, sum, groupBy } from '../lib/calc.js'

const GO_LIVE = '2026-11-01'

export default function Finance() {
  const { db, ix, version } = useData()
  const usd = useUsd()
  const [from, setFrom] = useState('2026-05-01')
  const [to, setTo] = useState(todayLima())
  const [tab, setTab] = useState('pl')
  const [totals, setTotals] = useState(null)
  const [invStart, setInvStart] = useState(null)
  const [invEnd, setInvEnd] = useState(null)

  // re-query the ledger whenever anything changes anywhere (version bumps on every refresh)
  useEffect(() => {
    let stop = false
    const startDay = addDays(from, -1) < GO_LIVE ? GO_LIVE : addDays(from, -1)   // no inventory on the books before go-live
    Promise.all([
      supabase.rpc('ledger_totals', { p_from: from, p_to: to }),
      supabase.rpc('inventory_value_at', { p_date: startDay }),
      supabase.rpc('inventory_value_at', { p_date: to }),
    ]).then(([t, a, b]) => { if (!stop) { setTotals(t.data || []); setInvStart(Number(a.data)); setInvEnd(Number(b.data)) } })
    return () => { stop = true }
  }, [from, to, version])

  const pl = totals ? profitAndLoss(totals) : null
  const days = daysBetween(from, to) + 1
  const avgInv = invStart !== null && invEnd !== null ? (invStart + invEnd) / 2 : null
  const turns = pl && avgInv ? pl.cogs / avgInv : null
  const annual = turns !== null ? turns * 365 / days : null

  const valuation = useMemo(() => {
    const rows = db.stock.filter(s => s.qty > 0).map(s => { const it = ix.items.get(s.item_id); return { it, loc: ix.locations.get(s.location_id), qty: s.qty, value: s.qty * it.avg_cost } })
    const wip = sum(db.work_orders.filter(w => w.status === 'in_progress'), w => w.material_cost)
    return { rows, wip, total: sum(rows, r => r.value) }
  }, [db, ix])

  return (
    <Page title="Financial Reporting" subtitle="Profit & loss, inventory valuation and turnover — computed from the accounting journal"
      how={<>
        <p>Every transaction posts <b>balanced debit/credit lines</b> to one journal (see <i>Accounting Journal</i>). The P&amp;L adds those lines up for the dates you pick, so it changes the moment anyone sells, returns, scraps or adjusts something.</p>
        <ul>
          <li><b>Net sales</b> = sales revenue − discounts − returns (IGV is a tax collected for SUNAT, not revenue).</li>
          <li><b>COGS</b> = the weighted-average cost of the units shipped (returns of resellable goods reverse it).</li>
          <li><b>Inventory valuation</b> = on-hand quantity × weighted average cost, per location; plus work in process.</li>
          <li><b>Inventory turnover</b> = COGS for the period ÷ average inventory value <code>(start + end) ÷ 2</code>; annualised × 365 ÷ days. Days of inventory = 365 ÷ annual turns.</li>
        </ul>
        <p className="small">Go-live note: the company's stock count on Nov 1, 2026 is the opening balance. Sales before that are real history for the P&amp;L, but their inventory left before the count, so their cost is posted against <i>Opening Balance Equity</i> (standard practice when an ERP goes live mid-year). For periods starting before go-live, the opening count is used as starting inventory.</p>
      </>}>
      <Card><DateRange from={from} to={to} onChange={(a, b) => { setFrom(a); setTo(b) }} /></Card>
      <div className="stats">
        <Stat label="Net sales" value={pl ? money(pl.netSales) : '…'} soles={pl?.netSales} />
        <Stat label="Gross profit" value={pl ? money(pl.grossProfit) : '…'} soles={pl?.grossProfit} sub={pl ? `margin ${pct(pl.grossMargin)}` : ''} tone="good" />
        <Stat label="Inventory value now" value={money(valuation.total + valuation.wip)} soles={valuation.total + valuation.wip} sub={`incl. WIP ${money(valuation.wip)}`} />
        <Stat label="Inventory turnover" value={turns === null ? '…' : `${num(turns, 2)}×`} sub={annual === null ? '' : `${num(annual, 1)}× per year · ${num(365 / annual, 0)} days of inventory`} />
      </div>
      <Tabs value={tab} onChange={setTab} tabs={[['pl', 'Profit & Loss'], ['val', 'Inventory valuation'], ['turn', 'Turnover']]} />
      {tab === 'pl' && pl && <Card title={`Profit & Loss · ${from} to ${to}`}>
        <table className="tbl" style={{ maxWidth: 620 }}><tbody>
          <tr><td>Gross sales revenue</td><td className="num">{money(pl.gross)}</td></tr>
          <tr><td>&nbsp;&nbsp;Less sales discounts</td><td className="num neg">−{money(pl.discounts)}</td></tr>
          <tr><td>&nbsp;&nbsp;Less sales returns</td><td className="num neg">−{money(pl.returns)}</td></tr>
          <tr className="sub"><td>Net sales</td><td className="num">{money(pl.netSales)}<div className="usd">{usd(pl.netSales)}</div></td></tr>
          <tr><td>Cost of goods sold (weighted average cost)</td><td className="num neg">−{money(pl.cogs)}</td></tr>
          <tr className="sub"><td>Gross profit <span className="muted">({pct(pl.grossMargin)})</span></td><td className="num">{money(pl.grossProfit)}<div className="usd">{usd(pl.grossProfit)}</div></td></tr>
          <tr><td>Production scrap expense (cost of poor quality)</td><td className="num neg">−{money(pl.scrap)}</td></tr>
          <tr><td>Inventory adjustments (shrinkage / damage / count differences)</td><td className="num neg">{pl.adjustments >= 0 ? '−' : '+'}{money(Math.abs(pl.adjustments))}</td></tr>
          <tr className="total"><td>Operating profit before overhead</td><td className="num">{money(pl.operating)}<div className="usd">{usd(pl.operating)}</div></td></tr>
        </tbody></table>
        <p className="muted small">Amounts are in Peruvian soles (S/); ≈ US$ uses the exchange rate in Settings. Overheads (rent, salaries, utilities) are outside this mini-ERP's scope; labour used in production is included in product cost.</p>
      </Card>}
      {tab === 'val' && <Valuation v={valuation} />}
      {tab === 'turn' && <Card title="Inventory turnover calculation">
        <table className="tbl" style={{ maxWidth: 620 }}><tbody>
          <tr><td>COGS in period ({days} days)</td><td className="num">{money(pl?.cogs)}</td></tr>
          <tr><td>Inventory + WIP at start {from < GO_LIVE ? '(go-live count, Nov 1)' : `(end of ${addDays(from, -1)})`}</td><td className="num">{money(invStart)}</td></tr>
          <tr><td>Inventory + WIP at end of {to}</td><td className="num">{money(invEnd)}</td></tr>
          <tr className="sub"><td>Average inventory</td><td className="num">{money(avgInv)}</td></tr>
          <tr className="sub"><td>Turnover for the period = COGS ÷ average inventory</td><td className="num">{num(turns, 2)}×</td></tr>
          <tr><td>Annualised turnover = turns × 365 ÷ {days}</td><td className="num">{num(annual, 2)}×</td></tr>
          <tr><td>Days of inventory = 365 ÷ annual turnover</td><td className="num">{annual ? num(365 / annual, 0) : '—'} days</td></tr>
        </tbody></table>
      </Card>}
    </Page>
  )
}

function Valuation({ v }) {
  const byLoc = [...groupBy(v.rows, r => r.loc.id).entries()].map(([id, rs]) => ({ loc: rs[0].loc, value: sum(rs, r => r.value), units: rs.length }))
  const byType = [...groupBy(v.rows, r => r.it.item_type).entries()].map(([t, rs]) => ({ t, value: sum(rs, r => r.value) }))
  const byItem = [...groupBy(v.rows, r => r.it.id).entries()].map(([, rs]) => ({ it: rs[0].it, qty: sum(rs, r => r.qty), value: sum(rs, r => r.value) })).sort((a, b) => b.value - a.value)
  return <>
    <div className="grid g2">
      <Card title="By location"><table className="tbl compact"><tbody>{byLoc.map(x => <tr key={x.loc.id}><td>{x.loc.name}</td><td className="num">{money(x.value)}</td><td className="num muted">{pct(x.value / v.total)}</td></tr>)}
        <tr><td>Work in process (issued to open work orders)</td><td className="num">{money(v.wip)}</td><td /></tr>
        <tr className="total"><td>Total</td><td className="num">{money(v.total + v.wip)}</td><td /></tr></tbody></table></Card>
      <Card title="By item type"><table className="tbl compact"><tbody>{byType.map(x => <tr key={x.t}><td>{x.t}</td><td className="num">{money(x.value)}</td><td className="num muted">{pct(x.value / v.total)}</td></tr>)}</tbody></table></Card>
    </div>
    <Card title="By item (quantity × weighted average cost)">
      <div className="tbl-wrap"><table className="tbl compact"><thead><tr><th>Item</th><th className="num">Qty</th><th className="num">Avg cost</th><th className="num">Value</th></tr></thead><tbody>
        {byItem.map(x => <tr key={x.it.id}><td>{x.it.name}</td><td className="num">{num(x.qty, 2)} {x.it.uom}</td><td className="num">{money(x.it.avg_cost)}</td><td className="num">{money(x.value)}</td></tr>)}
      </tbody></table></div>
    </Card>
  </>
}
