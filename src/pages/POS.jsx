import { useState } from 'react'
import { useData } from '../lib/data.jsx'
import { Page, Card, Field, ItemSearch, LocationSelect, Modal, Btn, Empty, Barcode, useUsd } from '../components/ui.jsx'
import { money, qtyFmt, round, setting, dt } from '../lib/calc.js'

// Price before IGV for a customer's price list (mirrors _price() in the database)
export function netPrice(item, customer, igv) {
  if (customer?.price_list === 'wholesale' && item.wholesale_price != null) return Number(item.wholesale_price)
  return item.sale_price != null ? round(Number(item.sale_price) / (1 + igv), 2) : null
}

export default function POS() {
  const { db, ix, call, toast } = useData()
  const usd = useUsd()
  const igv = setting(db, 'igv_rate', 0.18)
  const [loc, setLoc] = useState('LOC04')
  const [cust, setCust] = useState('CUS01')
  const [cart, setCart] = useState([])
  const [allDisc, setAllDisc] = useState('')
  const [receipt, setReceipt] = useState(null)
  const customer = ix.customers.get(cust)
  const rate = customer?.igv_exempt ? 0 : igv

  const add = item => {
    const price = netPrice(item, customer, igv)
    if (price == null) { toast(`${item.name} is a raw material — not for sale`, 'error'); return }
    setCart(c => {
      const i = c.findIndex(x => x.item.id === item.id)
      if (i >= 0) return c.map((x, k) => (k === i ? { ...x, qty: x.qty + 1 } : x))
      return [...c, { item, qty: 1, price, disc: Number(allDisc || 0) }]
    })
  }
  const upd = (i, patch) => setCart(c => c.map((x, k) => (k === i ? { ...x, ...patch } : x)))
  const lines = cart.map(x => {
    const gross = x.qty * x.price, disc = gross * (x.disc / 100), net = gross - disc
    return { ...x, gross, discAmt: disc, net, tax: net * rate, avail: ix.onHand(x.item.id, loc) }
  })
  const t = { gross: lines.reduce((a, l) => a + l.gross, 0), disc: lines.reduce((a, l) => a + l.discAmt, 0), net: lines.reduce((a, l) => a + l.net, 0) }
  t.tax = round(t.net, 2) * rate; t.total = round(t.net, 2) + round(t.tax, 2)
  const short = lines.filter(l => l.qty > l.avail)

  const checkout = async () => {
    const res = await call('post_sale', {
      p: { customer_id: cust, location_id: loc, lines: lines.map(l => ({ item_id: l.item.id, qty: l.qty, unit_price: l.price, discount_pct: l.disc / 100 })) },
    }, { success: r => `Sale ${r.id} completed — ${money(r.total)}` })
    if (res) { setReceipt({ ...res, lines, customer, loc: ix.locations.get(loc), at: new Date(), rate }); setCart([]) }
  }

  return (
    <Page title="Point of Sale" subtitle="Scan or search items, apply discounts, charge IGV, print a receipt"
      how={<>
        <p><b>Scan to add:</b> click in the scan box and use a USB barcode scanner (it types the code and presses Enter), tap <b>📷 Camera</b> to scan with a phone, or type a name.</p>
        <p>Prices on the shelf include IGV (18%). The POS shows the price <i>before</i> IGV and adds IGV on the total, so <code>total = net + 18% IGV</code> equals the shelf price. Wholesale customers get the wholesale price list; export customers are IGV-exempt.</p>
        <p><b>Completing the sale</b> lowers on-hand stock at the selected location at its weighted-average cost and posts Cash, Revenue, Discounts, IGV payable, COGS and Inventory in the journal — watch the panel that opens.</p>
      </>}>
      <div className="pos-grid">
        <div>
          <Card>
            <div className="form">
              <Field label="Selling location"><LocationSelect value={loc} onChange={setLoc} /></Field>
              <Field label="Customer">
                <select value={cust} onChange={e => { setCust(e.target.value); setCart([]) }}>
                  {db.customers.map(c => <option key={c.id} value={c.id}>{c.name} ({c.price_list}{c.igv_exempt ? ', no IGV' : ''})</option>)}
                </select>
              </Field>
              <Field label="Discount for new lines %"><input type="number" min="0" max="50" value={allDisc} onChange={e => setAllDisc(e.target.value)} placeholder="0" /></Field>
            </div>
            <div style={{ marginTop: 12 }}><ItemSearch onPick={add} autoFocus stockAt={loc} filter={i => i.item_type !== 'Component'} /></div>
          </Card>
          <Card title={`Cart (${lines.length})`}>
            {lines.length === 0 ? <Empty icon="cart">Scan a barcode or search an item to start a sale.</Empty> : (
              <div className="tbl-wrap"><table className="tbl lines"><thead><tr><th>Item</th><th className="num">On hand here</th><th className="num">Qty</th><th className="num">Price (pre-IGV)</th><th className="num">Disc %</th><th className="num">Net</th><th></th></tr></thead>
                <tbody>{lines.map((l, i) => (
                  <tr key={l.item.id}>
                    <td>{l.item.name}<div className="muted small">{l.item.name_es} · {l.item.ean}</div></td>
                    <td className={'num ' + (l.qty > l.avail ? 'neg' : '')}>{qtyFmt(l.avail, l.item.uom)}</td>
                    <td className="num"><input type="number" min="1" value={l.qty} onChange={e => upd(i, { qty: Math.max(1, Number(e.target.value) || 1) })} /></td>
                    <td className="num">{money(l.price)}</td>
                    <td className="num"><input type="number" min="0" max="50" value={l.disc} onChange={e => upd(i, { disc: Math.min(50, Math.max(0, Number(e.target.value) || 0)) })} /></td>
                    <td className="num">{money(l.net)}</td>
                    <td><button className="icon-btn" onClick={() => setCart(c => c.filter((_, k) => k !== i))} aria-label="Remove">✕</button></td>
                  </tr>))}
                </tbody></table></div>)}
          </Card>
        </div>
        <Card title="Total">
          <div className="totals">
            <div><span>Subtotal</span><span>{money(t.gross)}</span></div>
            <div><span>Discounts</span><span>−{money(t.disc)}</span></div>
            <div><span>Net sale</span><span>{money(t.net)}</span></div>
            <div><span>IGV {rate ? '18%' : '(exempt)'}</span><span>{money(t.tax)}</span></div>
            <div className="grand"><span>Total</span><span>{money(t.total)}</span></div>
            {t.total > 0 && <div className="usd" style={{ justifyContent: 'flex-end' }}>{usd(t.total)}</div>}
          </div>
          {short.length > 0 && <p className="error-text small">Not enough stock here for: {short.map(l => l.item.name).join(', ')}. Transfer stock first or use a sales order (backorder).</p>}
          <div style={{ marginTop: 12 }}><Btn kind="primary" onClick={checkout} disabled={!lines.length || short.length > 0} busyText="Posting sale…">Complete sale</Btn></div>
        </Card>
      </div>
      {receipt && <Receipt r={receipt} onClose={() => setReceipt(null)} />}
    </Page>
  )
}

function Receipt({ r, onClose }) {
  return (
    <Modal title={`Receipt ${r.id}`} onClose={onClose} footer={<><button className="btn" onClick={() => window.print()}>🖨 Print</button><button className="btn primary" onClick={onClose}>New sale</button></>}>
      <div className="receipt">
        <div className="c"><b>TEXTILES MOVE</b><br />{r.loc?.name}<br />{r.loc?.address}, {r.loc?.district}<br />{dt(r.at)}</div>
        <hr />
        <div>Receipt: {r.id}<br />Customer: {r.customer?.name}</div>
        <hr />
        <table><tbody>{r.lines.map(l => (
          <tr key={l.item.id}><td>{l.qty} × {l.item.name}{l.disc ? ` (−${l.disc}%)` : ''}</td><td style={{ textAlign: 'right' }}>{money(l.net)}</td></tr>))}
        </tbody></table>
        <hr />
        <table><tbody>
          <tr><td>Subtotal (before IGV)</td><td style={{ textAlign: 'right' }}>{money(r.subtotal)}</td></tr>
          {r.discount > 0 && <tr><td>Discounts</td><td style={{ textAlign: 'right' }}>−{money(r.discount)}</td></tr>}
          <tr><td>IGV sales tax {r.rate ? '18%' : '(exempt)'}</td><td style={{ textAlign: 'right' }}>{money(r.tax)}</td></tr>
          <tr><td><b>TOTAL</b></td><td style={{ textAlign: 'right' }}><b>{money(r.total)}</b></td></tr>
        </tbody></table>
        <hr />
        <div className="c"><Barcode value={r.id} height={36} width={1.4} /><br />Thank you for your purchase!<br />Returns and exchanges within 30 days with this receipt.</div>
      </div>
    </Modal>
  )
}
