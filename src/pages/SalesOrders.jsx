import { useMemo, useState } from 'react'
import { useData } from '../lib/data.jsx'
import { Page, Card, Field, ItemSearch, LocationSelect, Modal, Btn, StatusBadge, Tabs, Empty, Badge, useOpenParam, Steps, userName, ItemName } from '../components/ui.jsx'
import { money, qtyFmt, dfmt, dt, etaFor, onOrder, setting, todayLima, addDays, round, allocations } from '../lib/calc.js'
import { netPrice } from './POS.jsx'

export default function SalesOrders() {
  const { db, ix } = useData()
  const [tab, setTab] = useState('open')
  const [creating, setCreating] = useState(false)
  const [openId, setOpenId] = useState(null)
  useOpenParam(setOpenId)
  const orders = useMemo(() => db.sales.filter(s => s.kind === 'SO' && (tab === 'all' ? true : tab === 'open' ? s.status === 'placed' : tab === 'portal' ? s.channel === 'portal' : s.status === tab))
    .sort((a, b) => (b.order_date || '').localeCompare(a.order_date || '')).slice(0, 300), [db.sales, tab])
  const alloc = useMemo(() => allocations(db, ix), [db, ix])
  const total = s => (ix.linesBySale.get(s.id) || []).reduce((a, l) => a + l.qty * l.unit_price * (1 - l.discount_pct), 0)
  // short = open qty not covered by stock after earlier orders took their share (allocation)
  const backQty = s => s.status === 'placed' ? (ix.linesBySale.get(s.id) || []).reduce((a, l) => a + (alloc.lines.get(l.id)?.short || 0), 0) : 0

  return (
    <Page title="Sales Orders" subtitle="Order Placed → Fulfilled → Closed (or Cancelled)"
      actions={<button className="btn primary" onClick={() => setCreating(true)}>+ New sales order</button>}
      how={<>
        <p>A <b>sales order</b> is a customer commitment that ships later (wholesale boutiques, schools, export, or a customer-portal pickup). Creating it does <i>not</i> move stock — but it immediately becomes <b>demand in MRP</b> and <b>committed stock</b> in the reorder calculation.</p>
        <p><b>Allocation (available-to-promise):</b> stock at each location is reserved for open orders first-come, first-served (earliest requested date first), so two orders never count the same units — a later order shows <i>short</i> if earlier orders already claim the stock.</p>
        <p><b>Fulfil</b> ships whatever is on hand at the shipping location (stock ↓, revenue and COGS posted). Anything short stays <b>backordered</b> with an <b>estimated available date</b>: the earliest open PO or work order that covers it, otherwise today + the item's lead time. <b>Close</b> ends the order (even if partly shipped); <b>Cancel</b> is only for orders that shipped nothing.</p>
      </>}>
      <Tabs value={tab} onChange={setTab} tabs={[['open', 'Order Placed'], ['fulfilled', 'Fulfilled'], ['closed', 'Closed'], ['cancelled', 'Cancelled'], ['portal', 'Portal pickups'], ['all', 'All']]} />
      <Card>
        {orders.length === 0 ? <Empty icon="cart" title="No orders here" action={<button className="btn primary small" onClick={() => setCreating(true)}>+ New sales order</button>}>Orders placed by wholesale customers or the customer portal show up here.</Empty> : (
          <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Order</th><th>Customer</th><th>Ship from</th><th>Ordered</th><th>Requested</th><th className="num">Net value</th><th>Status</th><th></th></tr></thead>
            <tbody>{orders.map(s => {
              const b = backQty(s)
              return (
                <tr key={s.id} className="click" onClick={() => setOpenId(s.id)}>
                  <td><b>{s.id}</b>{s.channel === 'portal' && <> <Badge tone="brand">portal</Badge></>}</td>
                  <td>{ix.customers.get(s.customer_id)?.name}</td><td>{ix.locations.get(s.location_id)?.name}</td>
                  <td className="nowrap">{dt(s.order_date)}</td><td className="nowrap">{dfmt(s.requested_date)}</td><td className="num">{money(total(s))}</td>
                  <td><StatusBadge status={s.status} /> {b > 0 && <Badge tone="red">{b} short</Badge>}</td><td>›</td>
                </tr>)
            })}</tbody></table></div>)}
      </Card>
      {creating && <NewOrder onClose={() => setCreating(false)} onCreated={id => { setCreating(false); setOpenId(id) }} />}
      {openId && <OrderDetail id={openId} onClose={() => setOpenId(null)} />}
    </Page>
  )
}

function NewOrder({ onClose, onCreated }) {
  const { db, ix, call } = useData()
  const igv = setting(db, 'igv_rate', 0.18)
  const [f, setF] = useState({ customer_id: 'CUS03', location_id: 'LOC03', requested_date: addDays(todayLima(), 7), notes: '' })
  const [lines, setLines] = useState([])
  const cust = ix.customers.get(f.customer_id)
  const alloc = useMemo(() => allocations(db, ix), [db, ix])
  const add = item => setLines(ls => ls.some(l => l.item.id === item.id) ? ls.map(l => l.item.id === item.id ? { ...l, qty: l.qty + 1 } : l) : [...ls, { item, qty: 1, price: netPrice(item, cust, igv), disc: 0 }])
  const save = async () => {
    const r = await call('create_sales_order', { p: { ...f, lines: lines.map(l => ({ item_id: l.item.id, qty: l.qty, unit_price: l.price, discount_pct: l.disc / 100 })) } },
      { success: r => `Sales order ${r.id} placed`, showRipple: false })
    if (r) onCreated(r.id)
  }
  return (
    <Modal wide title="New sales order" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><Btn kind="primary" onClick={save} disabled={!lines.length}>Place order</Btn></>}>
      <div className="form">
        <Field label="Customer"><select value={f.customer_id} onChange={e => { setF({ ...f, customer_id: e.target.value }); setLines([]) }}>
          {db.customers.map(c => <option key={c.id} value={c.id}>{c.name} · {c.price_list}</option>)}</select></Field>
        <Field label="Ship from location"><LocationSelect value={f.location_id} onChange={v => setF({ ...f, location_id: v })} /></Field>
        <Field label="Requested date" hint="MRP schedules this demand in that week"><input type="date" value={f.requested_date} onChange={e => setF({ ...f, requested_date: e.target.value })} /></Field>
        <Field label="Notes"><input value={f.notes} onChange={e => setF({ ...f, notes: e.target.value })} /></Field>
      </div>
      <div style={{ margin: '12px 0' }}><ItemSearch onPick={add} filter={i => i.item_type !== 'Component'} stockAt={f.location_id} /></div>
      {lines.length > 0 && <table className="tbl lines"><thead><tr><th>Item</th><th className="num">On hand at location</th><th className="num">Available (after open orders)</th><th className="num">Qty</th><th className="num">Price</th><th className="num">Disc %</th><th></th></tr></thead><tbody>
        {lines.map((l, i) => (
          <tr key={l.item.id}><td><ItemName item={l.item} /></td><td className="num">{qtyFmt(ix.onHand(l.item.id, f.location_id), l.item.uom)}</td>
            <td className={'num ' + (l.qty > alloc.freeAt(l.item.id, f.location_id) ? 'neg' : '')}>{qtyFmt(alloc.freeAt(l.item.id, f.location_id), l.item.uom)}{l.qty > alloc.freeAt(l.item.id, f.location_id) && <div className="small">{qtyFmt(l.qty - alloc.freeAt(l.item.id, f.location_id))} will be backordered</div>}</td>
            <td className="num"><input type="number" min="1" value={l.qty} onChange={e => setLines(ls => ls.map((x, k) => k === i ? { ...x, qty: Math.max(1, Number(e.target.value) || 1) } : x))} /></td>
            <td className="num"><input type="number" step="0.01" value={l.price} onChange={e => setLines(ls => ls.map((x, k) => k === i ? { ...x, price: Number(e.target.value) } : x))} /></td>
            <td className="num"><input type="number" min="0" max="50" value={l.disc} onChange={e => setLines(ls => ls.map((x, k) => k === i ? { ...x, disc: Number(e.target.value) || 0 } : x))} /></td>
            <td><button className="icon-btn" onClick={() => setLines(ls => ls.filter((_, k) => k !== i))}>✕</button></td></tr>))}
      </tbody></table>}
    </Modal>
  )
}

export function OrderDetail({ id, onClose }) {
  const { db, ix, call } = useData()
  const s = ix.sales.get(id)
  const [loc, setLoc] = useState(s?.location_id)
  const [reason, setReason] = useState('')
  if (!s) return null
  const lines = ix.linesBySale.get(id) || []
  const orders = onOrder(db, ix)
  const alloc = allocations(db, ix)
  const tot = lines.reduce((a, l) => { const n = l.qty * l.unit_price * (1 - l.discount_pct); return { net: a.net + n, tax: a.tax + n * l.tax_rate } }, { net: 0, tax: 0 })
  const returns = db.returns.filter(r => r.sale_id === id)
  const shipBy = userName(db, db.inv_moves.find(m => m.doc_id === id && m.kind === 'sale')?.user_id)
  const anyShipped = lines.some(l => Number(l.qty_shipped) > 0)
  const steps = s.kind === 'POS'
    ? [{ label: 'Sold at the store', at: dt(s.order_date), by: userName(db, s.created_by), state: 'done' },
       ...(returns.length ? [{ label: 'Returned', at: dt(returns[returns.length - 1].at), by: userName(db, returns[returns.length - 1].created_by), state: 'done' }] : [])]
    : [{ label: 'Order placed', at: s.is_history ? '' : dt(s.order_date), by: userName(db, s.created_by), state: 'done' },
       ...(s.status === 'cancelled' ? [{ label: 'Cancelled', at: s.cancel_reason || '', state: 'cancelled' }] : [
         { label: s.status === 'placed' && anyShipped ? 'Partly shipped' : 'Fulfilled', at: s.fulfilled_at ? dt(s.fulfilled_at) : `requested ${dfmt(s.requested_date)}`, by: shipBy,
           state: ['fulfilled', 'closed'].includes(s.status) ? 'done' : 'current' },
         { label: 'Closed', at: s.closed_at ? dt(s.closed_at) : '', state: s.status === 'closed' ? 'done' : s.status === 'fulfilled' ? 'current' : 'todo' }])]
  return (
    <Modal wide title={`${s.kind === 'POS' ? 'Sale' : 'Sales order'} ${id}`} onClose={onClose}
      footer={s.status === 'placed' ? <>
        <span className="muted small">Ship from</span><div style={{ width: 230 }}><LocationSelect value={loc} onChange={setLoc} /></div>
        <Btn kind="primary" onClick={() => call('fulfill_sales_order', { p_id: id, p_location: loc }, { success: r => `Shipped ${r.shipped} units${r.backordered ? `, ${r.backordered} backordered` : ''}` })}>Fulfil (ship available)</Btn>
        {lines.some(l => l.qty_shipped > 0) && <Btn onClick={() => call('close_sales_order', { p_id: id }, { success: 'Order closed (remaining qty cancelled)' })}>Close short</Btn>}
        {!lines.some(l => l.qty_shipped > 0) && <><input placeholder="Cancel reason" value={reason} onChange={e => setReason(e.target.value)} style={{ width: 170 }} />
          <Btn kind="danger" disabled={!reason} onClick={() => call('cancel_sales_order', { p_id: id, p_reason: reason }, { success: 'Order cancelled' })}>Cancel order</Btn></>}
      </> : s.status === 'fulfilled' ? <Btn kind="primary" onClick={() => call('close_sales_order', { p_id: id }, { success: 'Order closed' })}>Close order</Btn> : null}>
      <Steps steps={steps} />
      <div className="row gap wrap" style={{ marginBottom: 10 }}>
        <StatusBadge status={s.status} /><span>{ix.customers.get(s.customer_id)?.name}</span>
        <span className="muted">· ordered {dt(s.order_date)} · requested {dfmt(s.requested_date)}{s.fulfilled_at ? ` · fulfilled ${dt(s.fulfilled_at)}` : ''}</span>
        {s.cancel_reason && <Badge tone="red">{s.cancel_reason}</Badge>}
      </div>
      {s.notes && <p className="muted">{s.notes}</p>}
      <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Item</th><th className="num">Ordered</th><th className="num">Shipped</th><th className="num">Returned</th><th className="num">Backordered</th><th>Est. available</th><th className="num">Unit price</th><th className="num">Net</th></tr></thead><tbody>
        {lines.map(l => {
          const it = ix.items.get(l.item_id)
          const open = s.status === 'placed' ? l.qty - l.qty_shipped : 0
          // ship-from = order location: use allocation (earlier orders keep their share);
          // a different ship-from chosen here: compare to free stock there
          const shipLoc = loc || s.location_id
          const short = !open ? 0 : shipLoc === s.location_id ? (alloc.lines.get(l.id)?.short ?? open) : Math.max(0, open - alloc.freeAt(l.item_id, shipLoc))
          const eta = short > 0 ? etaFor(l.item_id, short, db, ix, todayLima(), orders) : null
          return <tr key={l.id}><td><ItemName item={it} /><div className="muted small mono">{it?.ean}</div></td><td className="num">{qtyFmt(l.qty, it?.uom)}</td><td className="num">{qtyFmt(l.qty_shipped)}</td>
            <td className="num">{l.qty_returned ? qtyFmt(l.qty_returned) : ''}</td>
            <td className={'num ' + (short ? 'neg' : '')}>{short ? qtyFmt(short) : open ? <span className="muted">in stock</span> : ''}</td>
            <td>{eta ? <span title={eta.basis}>{dfmt(eta.date)} <span className="muted small">({eta.basis})</span></span> : ''}</td>
            <td className="num">{money(l.unit_price)}{l.discount_pct ? <div className="muted small">−{round(l.discount_pct * 100, 1)}%</div> : null}</td>
            <td className="num">{money(l.qty * l.unit_price * (1 - l.discount_pct))}</td></tr>
        })}
        <tr className="total"><td colSpan={7}>Net {money(tot.net)} + IGV {money(tot.tax)}</td><td className="num">{money(tot.net + tot.tax)}</td></tr>
      </tbody></table></div>
      {returns.length > 0 && <p className="muted">Returns on this order: {returns.map(r => r.id).join(', ')}</p>}
    </Modal>
  )
}
