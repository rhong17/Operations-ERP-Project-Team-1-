import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useData } from '../lib/data.jsx'
import { Page, Card, Field, ItemSearch, LocationSelect, Btn, Empty, Badge, Tabs, Barcode, userName, ItemName } from '../components/ui.jsx'
import { money, qtyFmt, dt, dfmt, etaFor, onOrder, todayLima, inventoryPolicy, num, allocations } from '../lib/calc.js'

export const ADJ_REASONS = ['Cycle count', 'Damaged', 'Lost / stolen', 'Found', 'Sample / display', 'Data correction', 'Scrap from quality hold']

export default function Inventory() {
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') || 'onhand'
  const setTab = t => setParams({ tab: t })
  return (
    <Page title="Inventory" subtitle="On-hand by item and location, transfers, adjustments, scanning, backorders and labels"
      how={<>
        <p><b>Stock is kept per item per location</b> (4 sites in Lima + a Quality Hold area). Every change is a <b>movement</b> with a document number, so on-hand = opening count + all movements.</p>
        <ul>
          <li><b>Transfer</b> moves stock between locations (e.g. fabric from the Santa Anita warehouse to the workshop before a work order). Value doesn't change, so there is no accounting entry.</li>
          <li><b>Adjust / cycle count</b> corrects the system to what is physically there. A <b>reason code</b> is required; the difference × average cost goes to the <i>Inventory Adjustments</i> expense.</li>
          <li><b>Committed vs. available:</b> open sales orders reserve (allocate) stock first-come, first-served by requested date. <i>Available</i> = usable on hand − committed, so a later order shows short instead of double-counting the same units.</li>
          <li><b>Backorders</b> are confirmed sales-order quantities we can't ship yet. The estimated available date comes from the earliest open PO / work order, otherwise today + the supplier's or workshop's lead time.</li>
          <li>Cost method: <b>weighted average</b> — each receipt blends its cost into the item's average.</li>
        </ul>
      </>}>
      <Tabs value={tab} onChange={setTab} tabs={[['onhand', 'On hand'], ['scan', 'Scan to receive / adjust'], ['transfer', 'Transfer'], ['adjust', 'Adjust / cycle count'], ['backorders', 'Backorders'], ['moves', 'Movement history'], ['labels', 'Barcode labels']]} />
      {tab === 'onhand' && <OnHand />}
      {tab === 'scan' && <Scan />}
      {tab === 'transfer' && <Transfer />}
      {tab === 'adjust' && <Adjust />}
      {tab === 'backorders' && <Backorders />}
      {tab === 'moves' && <Moves />}
      {tab === 'labels' && <Labels />}
    </Page>
  )
}

function OnHand() {
  const { db, ix } = useData()
  const [q, setQ] = useState('')
  const [type, setType] = useState('')
  const policy = useMemo(() => new Map(inventoryPolicy(db, ix).map(p => [p.item.id, p])), [db, ix])
  const alloc = useMemo(() => allocations(db, ix), [db, ix])
  const locs = [...db.locations].sort((a, b) => a.sort - b.sort)
  const items = db.items.filter(i => i.active && (!type || i.item_type === type) && (!q || (i.name + (i.name_es || '') + i.ean + i.id).toLowerCase().includes(q.toLowerCase())))
  const total = items.reduce((a, i) => a + ix.onHand(i.id) * i.avg_cost, 0)
  return (
    <Card title="Stock by item and location" actions={<span className="muted">Value shown: {money(total)}</span>}>
      <div className="row gap wrap" style={{ marginBottom: 10 }}>
        <input style={{ maxWidth: 280 }} placeholder="Filter by name, barcode, ID" value={q} onChange={e => setQ(e.target.value)} />
        <select style={{ maxWidth: 200 }} value={type} onChange={e => setType(e.target.value)}><option value="">All types</option><option>Finished Good</option><option>Kit</option><option>Component</option></select>
      </div>
      <div className="tbl-wrap"><table className="tbl compact"><thead><tr><th style={{ minWidth: 260 }}>Item</th><th>Barcode</th>{locs.map(l => <th key={l.id} className="num" title={l.name}>{l.id}<div className="small muted">{l.name.split(' ').slice(0, 3).join(' ')}</div></th>)}<th className="num">Usable total</th><th className="num" title="Open sales-order quantity not yet shipped">Committed</th><th className="num" title="Usable total − committed">Available</th><th className="num">ROP</th><th className="num">Avg cost</th><th className="num">Value</th></tr></thead>
        <tbody>{items.map(i => {
          const p = policy.get(i.id), tot = ix.onHand(i.id), com = alloc.committedOf(i.id), avl = tot - com
          const dec = ['kg', 'cone'].includes(i.uom) ? 2 : 0   // fabric and thread show decimals so small changes are visible
          return <tr key={i.id}>
            <td><ItemName item={i} /><span className="es">{i.name_es}</span></td><td className="small mono">{i.ean}<div className="muted">{i.id}</div></td>
            {locs.map(l => { const v = ix.onHand(i.id, l.id); return <td key={l.id} className="num">{v ? num(v, dec) : <span className="zero">0</span>}</td> })}
            <td className="num"><b>{qtyFmt(tot, i.uom)}</b> {p?.belowRop && <Badge tone="amber">≤ ROP</Badge>}</td>
            <td className="num">{com ? num(com, dec) : <span className="zero">0</span>}</td>
            <td className={'num ' + (avl < 0 ? 'neg' : '')}>{num(avl, dec)}</td>
            <td className="num">{p ? num(p.rop, 1) : '—'}</td><td className="num">{money(i.avg_cost)}</td><td className="num">{money(tot * i.avg_cost)}</td>
          </tr>
        })}</tbody></table></div>
    </Card>
  )
}

// "Scan to receive / adjust": scan a label; receive it against an open PO line, or adjust stock with a reason
function Scan() {
  const { db, ix, call } = useData()
  const [item, setItem] = useState(null)
  const [loc, setLoc] = useState('LOC01')
  const [qty, setQty] = useState(1)
  const [reason, setReason] = useState('Cycle count')
  const openLines = item ? db.po_lines.filter(l => l.item_id === item.id && l.qty_received < l.qty_ordered && ['sent', 'partial'].includes(ix.pos.get(l.po_id)?.status)) : []
  return (
    <div className="grid g2">
      <Card title="1 · Scan the item">
        <ItemSearch autoFocus onPick={i => { setItem(i); setLoc(i.item_type === 'Component' ? 'LOC01' : 'LOC03') }} />
        {item && <div style={{ marginTop: 12 }}>
          <h2>{item.name}</h2>
          <p className="muted">{item.ean} · {item.uom}</p>
          <table className="tbl compact"><tbody>{db.locations.map(l => <tr key={l.id}><td>{l.name}</td><td className="num">{qtyFmt(ix.onHand(item.id, l.id), item.uom)}</td></tr>)}</tbody></table>
        </div>}
      </Card>
      {item && <Card title="2 · Receive or adjust">
        <div className="form">
          <Field label="Location"><LocationSelect value={loc} onChange={setLoc} includeQH /></Field>
          <Field label={`Quantity (${item.uom})`}><input type="number" min="0" step={item.uom === 'kg' ? '0.1' : '1'} value={qty} onChange={e => setQty(e.target.value)} /></Field>
        </div>
        <h3>Receive against an open purchase order</h3>
        {openLines.length === 0 ? <p className="muted">No open PO for this item.</p> : <table className="tbl compact"><tbody>{openLines.map(l => {
          const po = ix.pos.get(l.po_id)
          return <tr key={l.id}><td><b>{po.id}</b> · {ix.suppliers.get(po.supplier_id)?.name}<div className="small muted">expected {dfmt(po.expected_date)}</div></td>
            <td className="num">{qtyFmt(l.qty_ordered - l.qty_received, item.uom)} open</td>
            <td><Btn small kind="primary" onClick={() => call('receive_po', { p: { po_id: po.id, location_id: loc, lines: [{ po_line_id: l.id, qty: Number(qty) }] } }, { success: r => `Received ${r.qty} on ${po.id}` })}>Receive {qty}</Btn></td></tr>
        })}</tbody></table>}
        <h3>…or adjust stock (cycle count / damage)</h3>
        <div className="form">
          <Field label="Reason code"><select value={reason} onChange={e => setReason(e.target.value)}>{ADJ_REASONS.map(r => <option key={r}>{r}</option>)}</select></Field>
        </div>
        <div className="row gap wrap" style={{ marginTop: 10 }}>
          <Btn onClick={() => call('adjust_stock', { p: { item_id: item.id, location_id: loc, mode: 'count', qty: Number(qty), reason } }, { success: r => `Counted: ${r.before} → ${r.after}` })}>Set count to {qty}</Btn>
          <Btn onClick={() => call('adjust_stock', { p: { item_id: item.id, location_id: loc, mode: 'delta', qty: Number(qty), reason } }, { success: 'Added to stock' })}>+ Add {qty}</Btn>
          <Btn kind="danger" onClick={() => call('adjust_stock', { p: { item_id: item.id, location_id: loc, mode: 'delta', qty: -Number(qty), reason } }, { success: 'Removed from stock' })}>− Remove {qty}</Btn>
        </div>
      </Card>}
    </div>
  )
}

export function Transfer({ preset, onDone }) {
  const { db, ix, call } = useData()
  const [item, setItem] = useState(preset?.item ? ix.items.get(preset.item) : null)
  const [from, setFrom] = useState(preset?.from || 'LOC01')
  const [to, setTo] = useState(preset?.to || 'LOC02')
  const [qty, setQty] = useState(preset?.qty || '')
  const [note, setNote] = useState('')
  return (
    <Card title="Transfer between locations">
      {!preset && <ItemSearch onPick={setItem} />}
      {item && <>
        <p><b>{item.name}</b> <span className="muted">· {item.ean}</span></p>
        <div className="form">
          <Field label={`From (has ${qtyFmt(ix.onHand(item.id, from), item.uom)})`}><LocationSelect value={from} onChange={setFrom} includeQH /></Field>
          <Field label={`To (has ${qtyFmt(ix.onHand(item.id, to), item.uom)})`}><LocationSelect value={to} onChange={setTo} includeQH /></Field>
          <Field label={`Quantity (${item.uom})`}><input type="number" min="0" step={item.uom === 'kg' ? '0.1' : '1'} value={qty} onChange={e => setQty(e.target.value)} /></Field>
          <Field label="Note"><input value={note} onChange={e => setNote(e.target.value)} /></Field>
        </div>
        <div style={{ marginTop: 12 }}><Btn kind="primary" disabled={!(Number(qty) > 0)} onClick={async () => {
          const r = await call('transfer_stock', { p_item: item.id, p_from: from, p_to: to, p_qty: Number(qty), p_note: note }, { success: r => `Transfer ${r.id} done` })
          if (r) { setQty(''); onDone?.() }
        }}>Transfer</Btn></div>
      </>}
      {!item && db && <p className="muted">Scan or search an item to transfer.</p>}
    </Card>
  )
}

function Adjust() {
  const { ix, call } = useData()
  const [item, setItem] = useState(null)
  const [loc, setLoc] = useState('LOC04')
  const [mode, setMode] = useState('count')
  const [qty, setQty] = useState('')
  const [reason, setReason] = useState('Cycle count')
  const [note, setNote] = useState('')
  const have = item ? ix.onHand(item.id, loc) : 0
  const diff = mode === 'count' ? Number(qty) - have : Number(qty)
  return (
    <Card title="Adjustment / cycle count">
      <ItemSearch onPick={setItem} />
      {item && <>
        <p><b>{item.name}</b> · system quantity at this location: <b>{qtyFmt(have, item.uom)}</b></p>
        <div className="form">
          <Field label="Location"><LocationSelect value={loc} onChange={setLoc} includeQH /></Field>
          <Field label="Type"><select value={mode} onChange={e => setMode(e.target.value)}><option value="count">Cycle count (enter what you counted)</option><option value="delta">Adjust by + / − quantity</option></select></Field>
          <Field label={mode === 'count' ? 'Counted quantity' : 'Change (+/−)'}><input type="number" step="any" value={qty} onChange={e => setQty(e.target.value)} /></Field>
          <Field label="Reason code"><select value={reason} onChange={e => setReason(e.target.value)}>{ADJ_REASONS.map(r => <option key={r}>{r}</option>)}</select></Field>
          <Field label="Note" wide><input value={note} onChange={e => setNote(e.target.value)} /></Field>
        </div>
        {qty !== '' && <p>Difference: <b className={diff < 0 ? 'neg' : 'pos'}>{diff > 0 ? '+' : ''}{num(diff, 2)}</b> → value {money(diff * item.avg_cost)} {diff < 0 ? '(expense)' : '(gain)'}</p>}
        <Btn kind="primary" disabled={qty === '' || diff === 0} onClick={async () => {
          const r = await call('adjust_stock', { p: { item_id: item.id, location_id: loc, mode, qty: Number(qty), reason, note } }, { success: r => `Adjusted ${r.before} → ${r.after}` })
          if (r) setQty('')
        }}>Post adjustment</Btn>
      </>}
    </Card>
  )
}

function Backorders() {
  const { db, ix } = useData()
  const orders = onOrder(db, ix)
  const alloc = allocations(db, ix)
  const rows = []
  for (const s of db.sales.filter(s => s.kind === 'SO' && s.status === 'placed')) {
    for (const l of ix.linesBySale.get(s.id) || []) {
      const a = alloc.lines.get(l.id)
      if (a?.short > 0) rows.push({ s, l, open: a.open, avail: ix.onHand(l.item_id, s.location_id), allocated: a.allocated, short: a.short, eta: etaFor(l.item_id, a.short, db, ix, todayLima(), orders) })
    }
  }
  rows.sort((a, b) => (a.s.requested_date || '').localeCompare(b.s.requested_date || ''))
  return (
    <Card title="Backordered sales-order lines" actions={<span className="muted small">Stock is allocated to open orders by earliest requested date</span>}>
      {rows.length === 0 ? <Empty icon="check" title="No backorders">Everything on open orders is in stock at its shipping location.</Empty> : <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Order</th><th>Customer</th><th>Item</th><th className="num">Open</th><th className="num">On hand at ship location</th><th className="num" title="Reserved for this order after earlier orders took their share">Allocated</th><th className="num">Backordered</th><th>Requested</th><th>Est. available</th></tr></thead><tbody>
        {rows.map((r, k) => <tr key={k}><td>{r.s.id}</td><td>{ix.customers.get(r.s.customer_id)?.name}</td><td>{ix.items.get(r.l.item_id)?.name}</td><td className="num">{r.open}</td><td className="num">{qtyFmt(r.avail)}</td><td className="num">{qtyFmt(r.allocated)}</td>
          <td className="num neg">{qtyFmt(r.short)}</td><td className="nowrap">{dfmt(r.s.requested_date)}</td><td><b className={r.eta.date > r.s.requested_date ? 'neg' : ''}>{dfmt(r.eta.date)}</b><div className="small muted">{r.eta.basis}</div></td></tr>)}
      </tbody></table></div>}
    </Card>
  )
}

function Moves() {
  const { db, ix } = useData()
  const [kind, setKind] = useState('')
  const list = [...db.inv_moves].filter(m => !kind || m.kind === kind).sort((a, b) => b.id - a.id).slice(0, 300)
  return (
    <Card title="Stock movements" actions={<select value={kind} onChange={e => setKind(e.target.value)}><option value="">All types</option>{[...new Set(db.inv_moves.map(m => m.kind))].map(k => <option key={k}>{k}</option>)}</select>}>
      <div className="tbl-wrap"><table className="tbl compact"><thead><tr><th>When</th><th>Type</th><th>Document</th><th>Item</th><th>Location</th><th className="num">Qty</th><th className="num">Unit cost</th><th>Reason</th><th>By</th></tr></thead><tbody>
        {list.map(m => <tr key={m.id}><td className="nowrap">{dt(m.at)}</td><td>{m.kind}</td><td>{m.doc_id}</td><td>{ix.items.get(m.item_id)?.name}</td><td>{ix.locations.get(m.location_id)?.name}</td>
          <td className={'num ' + (m.qty < 0 ? 'neg' : 'pos')}>{m.qty > 0 ? '+' : ''}{num(m.qty, 3)}</td><td className="num">{money(m.unit_cost)}</td><td>{m.reason || ''}</td><td className="nowrap small">{userName(db, m.user_id)}</td></tr>)}
      </tbody></table></div>
    </Card>
  )
}

function Labels() {
  const { db } = useData()
  const [sel, setSel] = useState(() => new Map(db.items.filter(i => i.item_type !== 'Component').slice(0, 6).map(i => [i.id, 1])))
  const toggle = id => { const m = new Map(sel); m.has(id) ? m.delete(id) : m.set(id, 1); setSel(m) }
  const labels = [...sel.entries()].flatMap(([id, n]) => Array(n).fill(db.items.find(i => i.id === id)))
  return <>
    <Card className="no-print" title="Choose labels" actions={<button className="btn primary" onClick={() => window.print()}>🖨 Print labels</button>} >
      <p className="muted">Barcodes are printed as <b>Code 128</b> with each item's real company barcode number (EAN column), so a USB scanner or phone camera reads them in POS, receiving and counts. Print at 100% scale and tape them to the physical items.</p>
      <div className="tbl-wrap"><table className="tbl compact no-print"><tbody>{db.items.filter(i => i.active).map(i => (
        <tr key={i.id}><td><input type="checkbox" checked={sel.has(i.id)} onChange={() => toggle(i.id)} /></td><td>{i.name}</td><td className="small">{i.ean}</td>
          <td>{sel.has(i.id) && <input type="number" min="1" max="50" style={{ width: 70 }} value={sel.get(i.id)} onChange={e => setSel(new Map(sel).set(i.id, Math.max(1, Number(e.target.value) || 1)))} />}</td></tr>))}</tbody></table></div>
    </Card>
    <div className="labels">{labels.map((i, k) => (
      <div className="label" key={k}><div className="lname">{i.name}</div><div className="lsub">{i.name_es}</div><Barcode value={i.ean} /><div className="lsub">{i.variant_sku || i.sku || i.id}{i.sale_price ? ` · S/ ${Number(i.sale_price).toFixed(2)}` : ''}</div></div>))}</div>
  </>
}
