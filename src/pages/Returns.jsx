import { useMemo, useState } from 'react'
import { useData } from '../lib/data.jsx'
import { Page, Card, Field, ItemSearch, LocationSelect, Btn, Empty, Badge, Tabs, CameraScanner } from '../components/ui.jsx'
import { money, qtyFmt, dt, setting, round, groupBy, sum } from '../lib/calc.js'
import { netPrice } from './POS.jsx'

export const QUALITY_REASONS = ['Seam failure', 'Fabric defect', 'Color/dye defect', 'Size/measurement off', 'Stain or hole']
export const OTHER_REASONS = ['Wrong size ordered', 'Changed mind', 'Gift exchange']

export default function Returns() {
  const { db, ix, call } = useData()
  const [tab, setTab] = useState('new')
  const [saleId, setSaleId] = useState('')
  const [cam, setCam] = useState(false)
  const sale = ix.sales.get(saleId.trim())
  const igv = setting(db, 'igv_rate', 0.18)
  const [rows, setRows] = useState({})       // sale_line_id -> {qty, reason, to}
  const [exch, setExch] = useState([])
  const [loc, setLoc] = useState('LOC04')
  const [notes, setNotes] = useState('')

  const lines = sale ? (ix.linesBySale.get(sale.id) || []).map(l => ({ ...l, item: ix.items.get(l.item_id), returnable: l.qty_shipped - l.qty_returned })) : []
  const chosen = lines.filter(l => Number(rows[l.id]?.qty) > 0)
  const refund = chosen.reduce((a, l) => { const n = Number(rows[l.id].qty) * l.unit_price * (1 - l.discount_pct); return a + round(n, 2) + round(n * l.tax_rate, 2) }, 0)
  const cust = sale ? ix.customers.get(sale.customer_id) : null
  const rate = cust?.igv_exempt ? 0 : igv
  const exchTotal = exch.reduce((a, x) => a + round(x.qty * x.price, 2) * (1 + rate), 0)
  const valid = chosen.length > 0 && chosen.every(l => rows[l.id].reason && Number(rows[l.id].qty) <= l.returnable)

  const submit = async () => {
    const r = await call('process_return', { p: {
      sale_id: sale.id, location_id: loc, notes,
      lines: chosen.map(l => ({ sale_line_id: l.id, qty: Number(rows[l.id].qty), reason: rows[l.id].reason, to_location_id: rows[l.id].to || loc })),
      exchange: exch.map(x => ({ item_id: x.item.id, qty: x.qty })),
    } }, { success: r => r.exchange_sale_id ? `Exchange ${r.id}: ${r.net_due >= 0 ? 'customer pays' : 'refund'} ${money(Math.abs(r.net_due))}` : `Return ${r.id}: refund ${money(r.refund)}` })
    if (r) { setRows({}); setExch([]); setNotes('') }
  }

  const recentSales = useMemo(() => db.sales.filter(s => s.status !== 'cancelled' && s.status !== 'placed').sort((a, b) => (b.order_date || '').localeCompare(a.order_date || '')).slice(0, 40), [db.sales])

  return (
    <Page title="Returns & Exchanges" subtitle="Bring goods back into inventory and reverse revenue and cost"
      how={<>
        <p>Find the original sale (type or scan the ticket number), choose what comes back and a <b>reason code</b> for each item.</p>
        <ul>
          <li><b>Resellable</b> reasons (wrong size, changed mind) put the units back into sellable stock at the location you choose.</li>
          <li><b>Quality failures</b> (seam failure, fabric defect…) go to the <b>Quality Hold</b> location, so they can't be sold until someone reworks or scraps them (see the Quality Hold tab). The reason codes feed the quality report.</li>
          <li>Money: the journal debits <b>Sales Returns</b> (reduces net sales) and IGV, credits Cash (refund), and moves the original cost back from <b>COGS</b> to <b>Inventory</b>.</li>
          <li>An <b>exchange</b> is a return plus a new sale of the replacement in one step; the screen shows the difference the customer pays or receives.</li>
        </ul>
      </>}>
      <Tabs value={tab} onChange={setTab} tabs={[['new', 'Process return / exchange'], ['history', 'Return history'], ['qh', `Quality Hold (${db.stock.filter(s => ix.qh.has(s.location_id) && s.qty > 0).length})`]]} />
      {tab === 'new' && <>
        <Card title="1 · Original sale">
          <div className="row gap wrap">
            <input style={{ maxWidth: 260 }} list="recent-sales" placeholder="Ticket / order number, e.g. POS-00001" value={saleId} onChange={e => { setSaleId(e.target.value); setRows({}); setExch([]) }} />
            <datalist id="recent-sales">{recentSales.map(s => <option key={s.id} value={s.id}>{ix.customers.get(s.customer_id)?.name} · {dt(s.order_date)}</option>)}</datalist>
            <button className="btn" onClick={() => setCam(true)}>📷 Scan ticket</button>
            {sale && <span className="muted">{ix.customers.get(sale.customer_id)?.name} · {dt(sale.order_date)} · {ix.locations.get(sale.location_id)?.name}</span>}
            {saleId && !sale && <span className="error-text">Not found</span>}
          </div>
        </Card>
        {sale && <>
          <Card title="2 · Items coming back">
            <div className="tbl-wrap"><table className="tbl lines"><thead><tr><th>Item</th><th className="num">Sold</th><th className="num">Can return</th><th className="num">Return qty</th><th>Reason code</th><th>Goes to</th></tr></thead><tbody>
              {lines.map(l => {
                const r = rows[l.id] || {}
                const quality = QUALITY_REASONS.includes(r.reason)
                const set = patch => setRows({ ...rows, [l.id]: { ...r, ...patch } })
                return <tr key={l.id} className={l.returnable <= 0 ? 'dim' : ''}>
                  <td>{l.item?.name}</td><td className="num">{qtyFmt(l.qty_shipped)}</td><td className="num">{qtyFmt(l.returnable)}</td>
                  <td className="num"><input type="number" min="0" max={l.returnable} disabled={l.returnable <= 0} value={r.qty || ''} onChange={e => set({ qty: e.target.value })} /></td>
                  <td><select value={r.reason || ''} onChange={e => set({ reason: e.target.value })} disabled={l.returnable <= 0}>
                    <option value="">Choose…</option>
                    <optgroup label="Quality failure → Quality Hold">{QUALITY_REASONS.map(x => <option key={x}>{x}</option>)}</optgroup>
                    <optgroup label="Resellable → back to stock">{OTHER_REASONS.map(x => <option key={x}>{x}</option>)}</optgroup>
                  </select></td>
                  <td>{quality ? <Badge tone="red">Quality Hold</Badge> : <div style={{ minWidth: 190 }}><LocationSelect value={r.to || loc} onChange={v => set({ to: v })} /></div>}</td>
                </tr>
              })}
            </tbody></table></div>
          </Card>
          <Card title="3 · Exchange items (optional)">
            <div className="form" style={{ marginBottom: 10 }}>
              <Field label="Replacement ships from"><LocationSelect value={loc} onChange={setLoc} /></Field>
              <Field label="Notes"><input value={notes} onChange={e => setNotes(e.target.value)} /></Field>
            </div>
            <ItemSearch stockAt={loc} filter={i => i.item_type !== 'Component'} onPick={item => setExch(x => [...x, { item, qty: 1, price: netPrice(item, cust, igv) }])} placeholder="Scan or search the replacement item…" />
            {exch.length > 0 && <table className="tbl lines" style={{ marginTop: 8 }}><tbody>{exch.map((x, i) => (
              <tr key={i}><td>{x.item.name}</td><td className="num"><input type="number" min="1" value={x.qty} onChange={e => setExch(a => a.map((y, k) => k === i ? { ...y, qty: Math.max(1, Number(e.target.value) || 1) } : y))} /></td>
                <td className="num">{money(x.qty * x.price * (1 + rate))} incl. IGV</td><td><button className="icon-btn" onClick={() => setExch(a => a.filter((_, k) => k !== i))}>✕</button></td></tr>))}</tbody></table>}
          </Card>
          <Card>
            <div className="row gap wrap">
              <div className="totals" style={{ minWidth: 280 }}>
                <div><span>Refund for returned items</span><span>{money(refund)}</span></div>
                {exch.length > 0 && <div><span>Replacement items</span><span>{money(exchTotal)}</span></div>}
                <div className="grand"><span>{exchTotal - refund >= 0 && exch.length ? 'Customer pays' : 'Refund to customer'}</span><span>{money(Math.abs(exchTotal - refund))}</span></div>
              </div>
              <div className="spacer" />
              <Btn kind="primary" disabled={!valid} onClick={submit}>{exch.length ? 'Process exchange' : 'Process return'}</Btn>
            </div>
          </Card>
        </>}
      </>}
      {tab === 'history' && <ReturnHistory />}
      {tab === 'qh' && <QualityHold />}
      {cam && <CameraScanner onClose={() => setCam(false)} onResult={code => { setSaleId(code); setCam(false) }} />}
    </Page>
  )
}

function ReturnHistory() {
  const { db, ix } = useData()
  const linesBy = groupBy(db.return_lines, 'return_id')
  const byReason = [...groupBy(db.return_lines, 'reason').entries()].map(([reason, ls]) => ({ reason, qty: sum(ls, l => l.qty), quality: QUALITY_REASONS.includes(reason) })).sort((a, b) => b.qty - a.qty)
  const list = [...db.returns].sort((a, b) => b.at.localeCompare(a.at))
  return <>
    <Card title="Returns by reason code">
      {byReason.length ? <table className="tbl compact"><tbody>{byReason.map(r => <tr key={r.reason}><td>{r.reason}</td><td>{r.quality ? <Badge tone="red">quality</Badge> : <Badge>resellable</Badge>}</td><td className="num">{r.qty} units</td></tr>)}</tbody></table> : <Empty icon="inbox">No returns yet.</Empty>}
    </Card>
    <Card title="All returns and exchanges">
      {list.length === 0 ? <Empty icon="inbox">No returns yet.</Empty> : <table className="tbl"><thead><tr><th>Return</th><th>When</th><th>Original</th><th>Items</th><th className="num">Refund</th><th>Exchange sale</th><th className="num">Net</th></tr></thead><tbody>
        {list.map(r => <tr key={r.id}><td><b>{r.id}</b> <Badge tone={r.kind === 'exchange' ? 'blue' : 'grey'}>{r.kind}</Badge></td><td className="nowrap">{dt(r.at)}</td><td>{r.sale_id}</td>
          <td className="wrap-cell">{(linesBy.get(r.id) || []).map(l => `${l.qty}× ${ix.items.get(l.item_id)?.name} (${l.reason})`).join('; ')}</td>
          <td className="num">{money(r.refund_total)}</td><td>{r.exchange_sale_id || ''}</td><td className="num">{r.kind === 'exchange' ? money(r.net_due) : ''}</td></tr>)}
      </tbody></table>}
    </Card>
  </>
}

function QualityHold() {
  const { db, ix, call } = useData()
  const rows = db.stock.filter(s => ix.qh.has(s.location_id) && s.qty > 0)
  return (
    <Card title="Items in Quality Hold">
      <p className="muted">Defective returns wait here. <b>Rework</b> moves them back to sellable stock after fixing; <b>Scrap</b> writes them off (an inventory adjustment with a reason, expensed in the P&amp;L).</p>
      {rows.length === 0 ? <Empty icon="check">Nothing is waiting in Quality Hold.</Empty> : <table className="tbl"><thead><tr><th>Item</th><th className="num">Qty</th><th className="num">Value</th><th></th></tr></thead><tbody>
        {rows.map(s => { const it = ix.items.get(s.item_id); return <tr key={s.item_id}><td>{it?.name}</td><td className="num">{qtyFmt(s.qty)}</td><td className="num">{money(s.qty * it.avg_cost)}</td>
          <td className="row gap">
            <Btn small onClick={() => call('transfer_stock', { p_item: s.item_id, p_from: s.location_id, p_to: 'LOC03', p_qty: s.qty, p_note: 'Reworked after quality hold' }, { success: 'Reworked units moved to finished-goods warehouse' })}>Rework → FG warehouse</Btn>
            <Btn small kind="danger" onClick={() => call('adjust_stock', { p: { item_id: s.item_id, location_id: s.location_id, mode: 'delta', qty: -s.qty, reason: 'Scrap from quality hold' } }, { success: 'Scrapped and expensed' })}>Scrap</Btn>
          </td></tr> })}
      </tbody></table>}
    </Card>
  )
}
