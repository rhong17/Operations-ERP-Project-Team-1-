import { useMemo, useState } from 'react'
import { useData } from '../lib/data.jsx'
import { Page, Card, Field, Btn, StatusBadge, Empty, Badge } from '../components/ui.jsx'
import { money, dt, dfmt, setting, todayLima, addDays, round } from '../lib/calc.js'

const SWATCH = { NEGRO: '#151515', HUESO: '#efe6d2', LILA: '#c3a3d1', CRISTAL: '#cfe8ee', SURTIDO: 'linear-gradient(90deg,#151515,#efe6d2,#c3a3d1)' }
const PICKUP = ['LOC04', 'LOC03']   // store and finished-goods warehouse

// Customer-facing portal: see what's available where, and order for pickup.
export default function Portal({ tab = 'shop', preview }) {
  const { db, ix, call, profile } = useData()
  const igv = setting(db, 'igv_rate', 0.18)
  const [q, setQ] = useState('')
  const [cart, setCart] = useState({})
  const [loc, setLoc] = useState('LOC04')
  const [date, setDate] = useState(addDays(todayLima(), 1))
  const products = useMemo(() => db.items.filter(i => i.active && i.item_type !== 'Component' && i.sale_price && (!q || i.name.toLowerCase().includes(q.toLowerCase()))), [db.items, q])
  const me = db.customers.find(c => c.id === profile.customer_id)
  const myOrders = db.sales.filter(s => s.customer_id === profile.customer_id && s.kind === 'SO').sort((a, b) => b.order_date.localeCompare(a.order_date))
  const lines = Object.entries(cart).filter(([, n]) => n > 0).map(([id, n]) => ({ item: ix.items.get(id), qty: n, avail: ix.onHand(id, loc) }))
  const total = lines.reduce((a, l) => a + l.qty * Number(l.item.sale_price), 0)
  const bad = lines.filter(l => l.qty > l.avail)

  const place = async () => {
    const r = await call('place_pickup_order', { p: { location_id: loc, requested_date: date, notes: 'Pickup order from customer portal', lines: lines.map(l => ({ item_id: l.item.id, qty: l.qty })) } },
      { success: r => `Order ${r.id} placed — we'll have it ready for pickup`, showRipple: false })
    if (r) setCart({})
  }

  if (tab === 'orders') return (
    <Page title="My orders" subtitle={me?.name}>
      <Card>{myOrders.length === 0 ? <Empty>No orders yet.</Empty> : <table className="tbl"><thead><tr><th>Order</th><th>Placed</th><th>Pickup at</th><th>Pickup date</th><th>Items</th><th>Status</th><th></th></tr></thead><tbody>
        {myOrders.map(s => <tr key={s.id}><td><b>{s.id}</b></td><td>{dt(s.order_date)}</td><td>{ix.locations.get(s.location_id)?.name}</td><td>{dfmt(s.requested_date)}</td>
          <td className="small">{(ix.linesBySale.get(s.id) || []).map(l => `${l.qty}× ${ix.items.get(l.item_id)?.name}`).join(', ')}</td>
          <td><StatusBadge status={s.status} /></td>
          <td>{s.status === 'placed' && s.channel === 'portal' && <Btn small kind="danger" onClick={() => call('cancel_sales_order', { p_id: s.id, p_reason: 'Cancelled by customer' }, { success: 'Order cancelled', showRipple: false })}>Cancel</Btn>}</td></tr>)}
      </tbody></table>}</Card>
    </Page>
  )

  return (
    <Page title={preview ? 'Customer portal (staff preview)' : `Hi${me ? ', ' + me.name.split(' ')[0] : ''} 👋`} subtitle="See what's in stock at our Gamarra store and warehouse, and order for pickup"
      how={preview ? <p>This is what a customer sees after signing up without a team code. Live stock comes from the same database as the ERP; placing an order creates a sales order (status Order Placed) that staff fulfil. Staff logins can't place portal orders.</p> : null}>
      <div className="pos-grid">
        <div>
          <Card><input placeholder="Search products…" value={q} onChange={e => setQ(e.target.value)} /></Card>
          <div className="shop">{products.map(i => (
            <div className="product" key={i.id}>
              <div><span className="swatch" style={{ background: SWATCH[i.color] || '#ccc' }} /><b>{i.name}</b></div>
              <div className="es">{i.name_es}</div>
              <div style={{ fontSize: 18, fontWeight: 800 }}>{money(me?.price_list === 'wholesale' && i.wholesale_price ? i.wholesale_price * (1 + (me?.igv_exempt ? 0 : igv)) : i.sale_price)}</div>
              <table className="tbl compact"><tbody>{PICKUP.map(l => { const n = ix.onHand(i.id, l); return <tr key={l}><td>{ix.locations.get(l)?.name}</td><td className="num">{n > 0 ? <Badge tone={n > 10 ? 'green' : 'amber'}>{n} available</Badge> : <Badge tone="red">out of stock</Badge>}</td></tr> })}</tbody></table>
              <div className="row gap"><button className="btn small" onClick={() => setCart(c => ({ ...c, [i.id]: Math.max(0, (c[i.id] || 0) - 1) }))}>−</button><b>{cart[i.id] || 0}</b><button className="btn small" onClick={() => setCart(c => ({ ...c, [i.id]: (c[i.id] || 0) + 1 }))}>+</button></div>
            </div>))}</div>
        </div>
        <Card title="Pickup order">
          <Field label="Pick up at"><select value={loc} onChange={e => setLoc(e.target.value)}>{PICKUP.map(l => <option key={l} value={l}>{ix.locations.get(l)?.name} — {ix.locations.get(l)?.address}</option>)}</select></Field>
          <Field label="Pickup date"><input type="date" min={todayLima()} value={date} onChange={e => setDate(e.target.value)} /></Field>
          {lines.length === 0 ? <p className="muted">Add products with +.</p> : <table className="tbl compact" style={{ marginTop: 10 }}><tbody>{lines.map(l => <tr key={l.item.id}><td>{l.qty}× {l.item.name}</td><td className={'num ' + (l.qty > l.avail ? 'neg' : '')}>{l.qty > l.avail ? `only ${l.avail}` : money(l.qty * l.item.sale_price)}</td></tr>)}
            <tr className="total"><td>Total (pay at pickup, IGV incl.)</td><td className="num">{money(round(total, 2))}</td></tr></tbody></table>}
          {bad.length > 0 && <p className="error-text small">Some items aren't available at this location in that quantity.</p>}
          <div style={{ marginTop: 10 }}><Btn kind="primary" disabled={!lines.length || bad.length > 0 || preview} onClick={place}>Place pickup order</Btn></div>
        </Card>
      </div>
    </Page>
  )
}
