import { useState } from 'react'
import { useData } from '../lib/data.jsx'
import { Page, Card, Field, Modal, Btn, Badge, useOpenParam } from '../components/ui.jsx'
import { money, sum, dt } from '../lib/calc.js'

export default function Customers() {
  const { db, ix, call } = useData()
  const [edit, setEdit] = useState(null)
  useOpenParam(id => { const c = db.customers.find(x => x.id === id); if (c) setEdit(c) })
  const stats = c => {
    const ss = db.sales.filter(s => s.customer_id === c.id && s.status !== 'cancelled')
    const rev = sum(ss.flatMap(s => ix.linesBySale.get(s.id) || []), l => l.qty_shipped * l.unit_price * (1 - l.discount_pct))
    return { n: ss.length, rev, last: ss.map(s => s.order_date).sort().at(-1) }
  }
  return (
    <Page title="Customers" subtitle="Walk-in and online shoppers, boutiques, distributors, institutional and export buyers"
      how={<p>The <b>price list</b> decides which price the POS and sales orders use (retail shelf price or wholesale price). <b>IGV-exempt</b> customers (exports) are charged no sales tax. Customers who sign up on the portal get their own customer record automatically; if their email matches an existing customer, they are linked to it.</p>}
      actions={<button className="btn primary" onClick={() => setEdit({ price_list: 'wholesale', country: 'Peru', igv_exempt: false })}>+ New customer</button>}>
      <Card>
        <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Customer</th><th>Channel</th><th>Contact</th><th>Price list</th><th className="num">Orders</th><th className="num">Net sales</th><th>Last order</th><th></th></tr></thead><tbody>
          {db.customers.map(c => { const s = stats(c); return <tr key={c.id}><td><b>{c.name}</b><div className="small muted">{c.id} · {c.type} · {c.city}</div></td><td>{c.channel}</td>
            <td className="small">{c.email}<br />{c.phone}</td><td>{c.price_list} {c.igv_exempt && <Badge tone="blue">IGV exempt</Badge>}</td>
            <td className="num">{s.n}</td><td className="num">{money(s.rev)}</td><td className="nowrap">{dt(s.last)}</td><td><button className="btn small" onClick={() => setEdit(c)}>Edit</button></td></tr> })}
        </tbody></table></div>
      </Card>
      {edit && <Modal title={edit.id ? `Edit ${edit.name}` : 'New customer'} onClose={() => setEdit(null)} footer={<><button className="btn" onClick={() => setEdit(null)}>Cancel</button>
        <Btn kind="primary" onClick={async () => { if (await call('save_customer', { p: edit }, { success: 'Customer saved', showRipple: false })) setEdit(null) }}>Save</Btn></>}>
        <div className="form">
          {[['name', 'Name'], ['type', 'Type'], ['channel', 'Channel'], ['email', 'Email'], ['phone', 'Phone'], ['city', 'City'], ['country', 'Country']].map(([k, l]) =>
            <Field key={k} label={l}><input value={edit[k] || ''} onChange={e => setEdit({ ...edit, [k]: e.target.value })} /></Field>)}
          <Field label="Price list"><select value={edit.price_list} onChange={e => setEdit({ ...edit, price_list: e.target.value })}><option value="retail">Retail (shelf price)</option><option value="wholesale">Wholesale</option></select></Field>
          <Field label="IGV"><select value={String(edit.igv_exempt)} onChange={e => setEdit({ ...edit, igv_exempt: e.target.value === 'true' })}><option value="false">Charge IGV 18%</option><option value="true">Exempt (export)</option></select></Field>
        </div>
      </Modal>}
    </Page>
  )
}
