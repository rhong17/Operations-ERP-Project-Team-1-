import { useMemo, useState } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import { useData } from '../lib/data.jsx'
import { Page, Card, Field, ItemSearch, LocationSelect, Modal, Btn, StatusBadge, Tabs, Empty, Badge, Stat, useOpenParam, Steps, userName, ItemName, Icon } from '../components/ui.jsx'
import { money, qtyFmt, dt, dfmt, num, pct, supplierScorecard, inventoryPolicy, todayLima, addDays, daysBetween, sum, setting, groupBy } from '../lib/calc.js'
import { NewWO } from './Production.jsx'

export default function Purchasing() {
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') || 'pos'
  return (
    <Page title="Purchasing & Suppliers" subtitle="Purchase orders, receiving, supplier scorecards and reorder rules"
      how={<>
        <p><b>PO lifecycle:</b> Draft → <b>Order Sent</b> (the expected receipt date = sent date + the supplier's quoted lead time) → <b>Received</b> (partial receipts allowed; stock ↑ at the location you choose, Inventory and Accounts Payable posted, actual date recorded) → <b>Closed</b>. The system compares each actual receipt date to the expected date.</p>
        <p><b>Payment terms</b> (Net 15 / Net 30 / Prepaid) set the due date of each supplier invoice: first receipt date + terms days (prepaid = due when sent).</p>
        <p><b>Scorecard</b> numbers are computed from PO history, not typed in: on-time rate, actual vs quoted lead time, fill rate and money owed — combined into one score to decide whom to keep, watch or replace.</p>
      </>}>
      <Tabs value={tab} onChange={t => setParams({ tab: t })} tabs={[['pos', 'Purchase orders'], ['scorecard', 'Supplier scorecard'], ['replenish', 'Replenishment (ROP / EOQ)'], ['suppliers', 'Suppliers']]} />
      {tab === 'pos' && <POList />}
      {tab === 'scorecard' && <Scorecard />}
      {tab === 'replenish' && <Replenishment />}
      {tab === 'suppliers' && <Suppliers />}
    </Page>
  )
}

const poValue = (ix, id) => sum(ix.poLinesBy.get(id) || [], l => l.qty_ordered * l.unit_cost)

function POList() {
  const { db, ix } = useData()
  const [filter, setFilter] = useState('open')
  const [creating, setCreating] = useState(false)
  const [openId, setOpenId] = useState(null)
  useOpenParam(setOpenId)
  const list = db.purchase_orders.filter(p => filter === 'all' || (filter === 'open' ? ['draft', 'sent', 'partial'].includes(p.status) : p.status === filter)).sort((a, b) => b.id.localeCompare(a.id))
  const lastRec = groupBy(db.po_receipts, 'po_id')
  return <>
    <div className="row gap wrap" style={{ marginBottom: 10 }}>
      <select style={{ maxWidth: 220 }} value={filter} onChange={e => setFilter(e.target.value)}>
        <option value="open">Open (draft, sent, partly received)</option><option value="received">Received</option><option value="closed">Closed</option><option value="cancelled">Cancelled</option><option value="all">All</option>
      </select><div className="spacer" /><button className="btn primary" onClick={() => setCreating(true)}>+ New purchase order</button>
    </div>
    <Card>
      {list.length === 0 ? <Empty icon="truck" title="No purchase orders here" action={<button className="btn primary small" onClick={() => setCreating(true)}>+ New purchase order</button>}>Create one here, or from the Replenishment tab or an MRP suggestion.</Empty> : <div className="tbl-wrap"><table className="tbl"><thead><tr><th>PO</th><th>Supplier</th><th>Items</th><th>Sent</th><th>Expected</th><th>Received</th><th className="num">Value</th><th>Status</th></tr></thead><tbody>
        {list.map(p => {
          const recs = lastRec.get(p.id) || []
          const last = recs.map(r => r.received_date).sort().at(-1)
          const late = last ? daysBetween(p.expected_date, last) : (p.expected_date && p.expected_date < todayLima() && ['sent', 'partial'].includes(p.status) ? daysBetween(p.expected_date, todayLima()) : null)
          return <tr key={p.id} className="click" onClick={() => setOpenId(p.id)}>
            <td><b>{p.id}</b></td><td>{ix.suppliers.get(p.supplier_id)?.name}</td>
            <td className="small">{(ix.poLinesBy.get(p.id) || []).map(l => ix.items.get(l.item_id)?.name).join(', ').slice(0, 60)}</td>
            <td className="nowrap">{dfmt(p.sent_date)}</td><td className="nowrap">{dfmt(p.expected_date)}</td>
            <td>{last ? dfmt(last) : ''} {late !== null && late > 0 && <Badge tone="red">{late} d late</Badge>}{late !== null && late <= 0 && last && <Badge tone="green">on time</Badge>}</td>
            <td className="num">{money(poValue(ix, p.id))}</td><td><StatusBadge status={p.status} /></td></tr>
        })}
      </tbody></table></div>}
    </Card>
    {creating && <NewPO onClose={() => setCreating(false)} onCreated={id => { setCreating(false); setOpenId(id) }} />}
    {openId && <PODetail id={openId} onClose={() => setOpenId(null)} />}
  </>
}

export function NewPO({ onClose, onCreated, preset }) {
  const { db, ix, call } = useData()
  const [sup, setSup] = useState(preset?.supplier_id || db.suppliers[0]?.id)
  const [shipTo, setShipTo] = useState('LOC01')
  const [notes, setNotes] = useState(preset?.notes || '')
  const [lines, setLines] = useState(() => preset?.item_id ? [{ item: ix.items.get(preset.item_id), qty: preset.qty, cost: ix.items.get(preset.item_id)?.std_cost }] : [])
  const s = ix.suppliers.get(sup)
  const save = async send => {
    const r = await call('create_po', { p: { supplier_id: sup, ship_to_location_id: shipTo, notes, send, lines: lines.map(l => ({ item_id: l.item.id, qty: Number(l.qty), unit_cost: Number(l.cost) })) } },
      { success: r => `${r.id} ${send ? 'sent to supplier' : 'saved as draft'}`, showRipple: false })
    if (r) onCreated(r.id)
  }
  return (
    <Modal wide title="New purchase order" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><Btn onClick={() => save(false)} disabled={!lines.length}>Save draft</Btn><Btn kind="primary" onClick={() => save(true)} disabled={!lines.length}>Create & send</Btn></>}>
      <div className="form">
        <Field label="Supplier"><select value={sup} onChange={e => setSup(e.target.value)}>{db.suppliers.filter(x => x.active).map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
        <Field label="Ship to"><LocationSelect value={shipTo} onChange={setShipTo} /></Field>
        <Field label="Expected receipt if sent today" hint={`quoted lead time ${s?.lead_time_days} days · ${s?.payment_terms}`}><input disabled value={dfmt(addDays(todayLima(), s?.lead_time_days || 0))} /></Field>
        <Field label="Notes"><input value={notes} onChange={e => setNotes(e.target.value)} /></Field>
      </div>
      <div style={{ margin: '12px 0' }}><ItemSearch filter={i => i.make_or_buy === 'Buy'} onPick={item => setLines(ls => [...ls, { item, qty: 1, cost: item.std_cost }])} placeholder="Scan or search a material to buy…" /></div>
      {lines.length > 0 && <table className="tbl lines"><thead><tr><th>Item</th><th>Usual supplier</th><th className="num">Qty</th><th className="num">Unit cost</th><th className="num">Line</th><th></th></tr></thead><tbody>
        {lines.map((l, i) => <tr key={i}><td><ItemName item={l.item} /></td><td className="small">{l.item.supplier_id === sup ? '✓' : <span className="neg">{ix.suppliers.get(l.item.supplier_id)?.name || '—'}</span>}</td>
          <td className="num"><input type="number" min="0" step="any" value={l.qty} onChange={e => setLines(a => a.map((x, k) => k === i ? { ...x, qty: e.target.value } : x))} /> {l.item.uom}</td>
          <td className="num"><input type="number" min="0" step="0.01" value={l.cost} onChange={e => setLines(a => a.map((x, k) => k === i ? { ...x, cost: e.target.value } : x))} /></td>
          <td className="num">{money(l.qty * l.cost)}</td><td><button className="icon-btn" onClick={() => setLines(a => a.filter((_, k) => k !== i))}>✕</button></td></tr>)}
        <tr className="total"><td colSpan={4}>Total</td><td className="num">{money(sum(lines, l => l.qty * l.cost))}</td><td /></tr>
      </tbody></table>}
    </Modal>
  )
}

function PODetail({ id, onClose }) {
  const { db, ix, call } = useData()
  const p = ix.pos.get(id)
  const lines = ix.poLinesBy.get(id) || []
  const [loc, setLoc] = useState(p?.ship_to_location_id)
  const [date, setDate] = useState(todayLima())
  const [qtys, setQtys] = useState({})
  const [pay, setPay] = useState('')
  if (!p) return null
  const s = ix.suppliers.get(p.supplier_id)
  const recs = db.po_receipts.filter(r => r.po_id === id)
  const paid = sum(db.supplier_payments.filter(x => x.po_id === id), x => x.amount)
  const billed = p.payment_terms === 'Prepaid' ? sum(lines, l => l.qty_ordered * l.unit_cost) : sum(lines, l => l.qty_received * l.unit_cost)
  const receiving = ['sent', 'partial'].includes(p.status)
  const recMoves = db.inv_moves.filter(m => m.doc_id === id && m.kind === 'receipt')
  const lastRec = recs.map(r => r.received_date).sort().pop()
  const pays = db.supplier_payments.filter(x => x.po_id === id).map(x => x.paid_date).sort()
  const fullyPaid = billed > 0.005 && paid >= billed - 0.005
  const received = ['received', 'closed'].includes(p.status) && recs.length > 0
  const steps = [
    { label: 'Draft', at: p.is_history ? '' : dt(p.created_at), state: 'done' },
    ...(p.status === 'cancelled' ? [{ label: 'Cancelled', at: p.closed_at ? dt(p.closed_at) : '', state: 'cancelled' }] : [
      { label: 'Sent', at: p.sent_date ? dfmt(p.sent_date) : '', state: p.sent_date ? 'done' : 'current' },
      { label: p.status === 'partial' ? 'Partly received' : 'Received', at: lastRec ? dfmt(lastRec) : p.expected_date ? `expected ${dfmt(p.expected_date)}` : '',
        by: userName(db, recMoves[recMoves.length - 1]?.user_id), state: received ? 'done' : p.status === 'partial' || p.status === 'sent' ? 'current' : 'todo' },
      { label: fullyPaid ? 'Paid' : paid > 0 ? 'Partly paid' : 'Paid', at: pays.length ? dfmt(pays[pays.length - 1]) : '', state: fullyPaid ? 'done' : received || paid > 0 ? 'current' : 'todo' }])]
  const mailto = `mailto:${s?.email}?subject=${encodeURIComponent(`Orden de compra ${p.id} - Textiles Move`)}&body=${encodeURIComponent(`Estimado(a) ${s?.contact_name},\n\nAdjuntamos la orden de compra ${p.id}:\n\n${lines.map(l => `- ${ix.items.get(l.item_id)?.name}: ${l.qty_ordered} ${ix.items.get(l.item_id)?.uom} a S/ ${l.unit_cost}`).join('\n')}\n\nEntrega en: ${ix.locations.get(p.ship_to_location_id)?.name}, ${ix.locations.get(p.ship_to_location_id)?.address}\nFecha esperada: ${p.expected_date || '(al enviar)'}\nCondiciones: ${p.payment_terms}\n\nSaludos,\nTextiles Move`)}`
  return (
    <Modal wide title={`Purchase order ${id}`} onClose={onClose} footer={<>
      {p.status === 'draft' && <><Btn kind="danger" onClick={() => call('cancel_po', { p_id: id }, { success: 'PO cancelled' })}>Cancel</Btn><Btn kind="primary" onClick={() => call('send_po', { p_id: id }, { success: r => `Sent — expected ${dfmt(r.expected_date)}` })}>Mark as sent</Btn></>}
      {p.status === 'sent' && !recs.length && <Btn kind="danger" onClick={() => call('cancel_po', { p_id: id }, { success: 'PO cancelled' })}>Cancel PO</Btn>}
      {['received', 'partial'].includes(p.status) && <Btn onClick={() => call('close_po', { p_id: id }, { success: 'PO closed' })}>Close PO{p.status === 'partial' ? ' (short)' : ''}</Btn>}
      <a className="btn" href={mailto} title="Opens a draft in Spanish, since the suppliers are in Peru"><Icon name="mail" size={15} /> Email to supplier (Spanish)</a>
    </>}>
      <Steps steps={steps} />
      <div className="row gap wrap" style={{ marginBottom: 10 }}>
        <StatusBadge status={p.status} /><b>{s?.name}</b><span className="muted">{s?.contact_name} · {s?.phone} · {p.payment_terms}</span>
      </div>
      <div className="stats">
        <Stat label="Sent" value={dfmt(p.sent_date)} /><Stat label="Expected (sent + quoted LT)" value={dfmt(p.expected_date)} sub={`${s?.lead_time_days} day quoted lead time`} />
        <Stat label="Billed / paid" value={money(billed)} sub={`paid ${money(paid)} · owed ${money(billed - paid)}`} tone={billed - paid > 0.005 ? 'warn' : ''} />
      </div>
      <table className="tbl lines"><thead><tr><th>Item</th><th className="num">Ordered</th><th className="num">Received</th><th className="num">Unit cost</th>{receiving && <th className="num">Receive now</th>}</tr></thead><tbody>
        {lines.map(l => { const it = ix.items.get(l.item_id); return <tr key={l.id}><td><ItemName item={it} /></td><td className="num">{qtyFmt(l.qty_ordered, it?.uom)}</td><td className="num">{qtyFmt(l.qty_received, it?.uom)}</td><td className="num">{money(l.unit_cost)}</td>
          {receiving && <td className="num"><input type="number" min="0" step="any" placeholder={String(l.qty_ordered - l.qty_received)} value={qtys[l.id] ?? ''} onChange={e => setQtys({ ...qtys, [l.id]: e.target.value })} /></td>}</tr> })}
      </tbody></table>
      {receiving && <div className="row gap wrap" style={{ marginTop: 10 }}>
        <span className="muted">Receive into</span><div style={{ width: 240 }}><LocationSelect value={loc} onChange={setLoc} /></div>
        <span className="muted">on</span><input type="date" style={{ width: 160 }} value={date} max={todayLima()} onChange={e => setDate(e.target.value)} />
        <button className="btn small ghost" onClick={() => setQtys(Object.fromEntries(lines.map(l => [l.id, l.qty_ordered - l.qty_received])))}>Fill all open qty</button>
        <Btn kind="primary" disabled={!Object.values(qtys).some(v => Number(v) > 0)} onClick={async () => {
          const r = await call('receive_po', { p: { po_id: id, location_id: loc, received_date: date, lines: lines.map(l => ({ po_line_id: l.id, qty: Number(qtys[l.id] || 0) })) } },
            { success: r => `Received ${r.qty} · ${r.days_vs_expected > 0 ? `${r.days_vs_expected} days late` : r.days_vs_expected < 0 ? `${-r.days_vs_expected} days early` : 'on time'}` })
          if (r) setQtys({})
        }}>Receive</Btn>
      </div>}
      {recs.length > 0 && <><h3>Receipts</h3><table className="tbl compact"><tbody>{recs.map(r => <tr key={r.id}><td className="nowrap">{dfmt(r.received_date)}</td><td>{ix.items.get(r.item_id)?.name}</td><td className="num">{qtyFmt(r.qty)}</td><td>{ix.locations.get(r.location_id)?.name}</td>
        <td>{r.received_date > p.expected_date ? <Badge tone="red">{daysBetween(p.expected_date, r.received_date)} d late</Badge> : <Badge tone="green">on time</Badge>}</td></tr>)}</tbody></table></>}
      {billed - paid > 0.005 && <div className="row gap" style={{ marginTop: 10 }}>
        <span className="muted">Record payment</span><input type="number" style={{ width: 140 }} placeholder={(billed - paid).toFixed(2)} value={pay} onChange={e => setPay(e.target.value)} />
        <Btn onClick={async () => { if (await call('pay_po', { p_id: id, p_amount: Number(pay || (billed - paid).toFixed(2)) }, { success: 'Payment recorded' })) setPay('') }}>Pay</Btn>
      </div>}
    </Modal>
  )
}

function Scorecard() {
  const { db, ix } = useData()
  const sc = useMemo(() => supplierScorecard(db, ix), [db, ix])
  const [open, setOpen] = useState(null)
  return <>
    <Card title="Supplier scorecard — computed from purchase-order history">
      <p className="muted small">Score = 40% on-time delivery + 30% fill rate + 30% lead-time reliability (quoted ÷ actual, max 100%). <b>Keep</b> ≥ 90 · <b>Watch</b> 75–89 · <b>Replace</b> &lt; 75.</p>
      <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Supplier</th><th className="num">POs</th><th className="num">On-time</th><th className="num">Avg actual LT</th><th className="num">Quoted LT</th><th className="num">Fill rate</th><th className="num">Owed</th><th>Next due / overdue</th><th className="num">Score</th><th>Rating</th></tr></thead><tbody>
        {sc.map(s => <tr key={s.supplier.id} className="click" onClick={() => setOpen(s)}>
          <td><b>{s.supplier.name}</b><div className="small muted">{s.supplier.payment_terms} · {s.openPOs} open PO</div></td>
          <td className="num">{s.deliveredCount}/{s.poCount}</td><td className="num">{pct(s.onTimeRate, 0)}</td>
          <td className="num">{s.avgLT === null ? '—' : num(s.avgLT, 1) + ' d'}</td><td className="num">{s.quotedLT} d</td>
          <td className="num">{pct(s.fillRate)}</td><td className="num">{money(s.owed)}</td>
          <td>{s.overdue > 0 ? <Badge tone="red">{money(s.overdue)} overdue</Badge> : s.nextDue ? dfmt(s.nextDue) : '—'}</td>
          <td className="num"><b>{s.score ?? '—'}</b></td><td><StatusBadge status={s.rating} /></td></tr>)}
      </tbody></table></div>
    </Card>
    {open && <Modal wide title={`${open.supplier.name} — delivery history`} onClose={() => setOpen(null)}>
      <div className="stats"><Stat label="On-time" value={pct(open.onTimeRate, 0)} /><Stat label="Lead time actual vs quoted" value={`${num(open.avgLT, 1)} vs ${num(open.avgQuoted, 1)} d`} /><Stat label="Fill rate" value={pct(open.fillRate)} /><Stat label="Score" value={open.score} sub={open.rating} /></div>
      <table className="tbl compact"><thead><tr><th>PO</th><th>Sent</th><th>Expected</th><th>Received</th><th className="num">Actual LT</th><th className="num">Late</th></tr></thead><tbody>
        {open.delivered.map(d => <tr key={d.po.id}><td>{d.po.id}</td><td className="nowrap">{dfmt(d.po.sent_date)}</td><td className="nowrap">{dfmt(d.po.expected_date)}</td><td className="nowrap">{dfmt(d.last)}</td><td className="num">{d.actualLT} d</td><td className={'num ' + (d.lateDays ? 'neg' : 'pos')}>{d.lateDays ? `${d.lateDays} d` : 'on time'}</td></tr>)}
      </tbody></table>
      {open.payables.length > 0 && <><h3>Open invoices</h3><table className="tbl compact"><tbody>{open.payables.map(x => <tr key={x.po}><td>{x.po}</td><td>due {dfmt(x.due)}</td><td className="num">{money(x.owed)}</td><td>{x.overdue && <Badge tone="red">overdue</Badge>}</td></tr>)}</tbody></table></>}
    </Modal>}
  </>
}

function Replenishment() {
  const { db, ix } = useData()
  const [only, setOnly] = useState(true)
  const [po, setPo] = useState(null)
  const [wo, setWo] = useState(null)
  const [explain, setExplain] = useState(null)
  const rows = useMemo(() => inventoryPolicy(db, ix), [db, ix])
  const list = rows.filter(r => !only || r.belowRop).sort((a, b) => (a.orderBy || '9').localeCompare(b.orderBy || '9'))
  const S = setting(db, 'ordering_cost'), h = setting(db, 'holding_rate'), z = setting(db, 'service_z'), R = setting(db, 'review_period_days')
  return <>
    <Card title="Ordering rules" actions={<Link className="btn small" to="/settings">Edit settings</Link>}>
      <p>Average usage comes from the last <b>{rows[0]?.days}</b> working days of sales (since {dfmt(rows[0]?.from)}), exploded through the BOMs so fabric and labels get demand from tee sales. Settings: ordering cost <b>S = {money(S)}</b>, holding cost <b>H = {pct(h, 0)}</b> of unit cost per year, service level <b>z = {z}</b>, review every <b>R = {R}</b> days.</p>
      <div className="grid g3 small">
        <div><b>Reorder point (continuous review)</b><br /><span className="formula">ROP = d × LT + z × σ<sub>d</sub> × √LT</span><br />Order when inventory position ≤ ROP.</div>
        <div><b>Economic order quantity</b><br /><span className="formula">EOQ = √(2 · D · S ÷ H)</span><br />D = d × {setting(db, 'working_days_per_year')} days/yr.</div>
        <div><b>Periodic review (order-up-to)</b><br /><span className="formula">T = d(R+LT) + zσ√(R+LT)</span><br />Every R days order T − position.</div>
      </div>
      <p className="muted small">Inventory position = on hand (excl. Quality Hold) + on order (open POs / work orders) − committed to open sales orders.</p>
    </Card>
    <Card title={only ? 'Items at or below their reorder point' : 'All items'} actions={<label className="row gap small"><input type="checkbox" checked={only} onChange={e => setOnly(e.target.checked)} />Only items needing an order</label>}>
      {list.length === 0 ? <Empty icon="check" title="All stocked up">Nothing is at or below its reorder point right now.</Empty> : <div className="tbl-wrap"><table className="tbl compact"><thead><tr><th>Item</th><th className="num">d / day</th><th className="num">LT</th><th className="num">Safety stock</th><th className="num">ROP</th><th className="num">Position</th><th className="num">EOQ</th><th className="num">Suggested qty</th><th>Order by</th><th className="num">Periodic: order-up-to / qty</th><th></th></tr></thead><tbody>
        {list.map(r => <tr key={r.item.id}>
          <td><button className="btn ghost small" onClick={() => setExplain(r)}>{r.item.name}</button><div className="small muted">{r.item.make_or_buy === 'Make' ? 'made in-house' : ix.suppliers.get(r.item.supplier_id)?.name}</div></td>
          <td className="num">{num(r.d, 2)}</td><td className="num">{r.LT} d</td><td className="num">{num(r.ss, 1)}</td><td className="num"><b>{num(r.rop, 1)}</b></td>
          <td className={'num ' + (r.belowRop ? 'neg' : '')}>{num(r.position, 1)}</td><td className="num">{num(r.eoq, 1)}</td>
          <td className="num"><b>{r.suggest ? qtyFmt(r.suggest, r.item.uom) : '—'}</b>{r.item.lot_rule === 'FOQ' && <div className="small muted">lots of {r.item.lot_qty}</div>}</td>
          <td>{r.orderBy ? <span className={r.orderBy <= todayLima() ? 'neg' : ''}>{r.orderBy <= todayLima() ? 'Today' : dfmt(r.orderBy)}</span> : '—'}</td>
          <td className="num">{num(r.target, 1)} / {num(r.periodicQty, 1)}</td>
          <td>{r.suggest > 0 && (r.item.make_or_buy === 'Make'
            ? <button className="btn small" onClick={() => setWo({ item_id: r.item.id, qty: Math.ceil(r.suggest), notes: 'Replenishment (below ROP)' })}>Create WO</button>
            : <button className="btn small" onClick={() => setPo({ supplier_id: r.item.supplier_id, item_id: r.item.id, qty: r.suggest, notes: 'Replenishment (below ROP)' })}>Create PO</button>)}</td>
        </tr>)}
      </tbody></table></div>}
    </Card>
    {po && <NewPO preset={po} onClose={() => setPo(null)} onCreated={() => setPo(null)} />}
    {wo && <NewWO preset={wo} onClose={() => setWo(null)} onCreated={() => setWo(null)} />}
    {explain && <Modal title={`How ${explain.item.name} is calculated`} onClose={() => setExplain(null)}>
      <table className="tbl compact"><tbody>
        <tr><td>Demand in window ({explain.days} working days)</td><td className="num">{num(explain.totalDemand, 2)} {explain.item.uom}</td></tr>
        <tr><td>Average daily demand d</td><td className="num">{num(explain.d, 3)}</td></tr>
        <tr><td>Std. deviation of daily demand σ</td><td className="num">{num(explain.sd, 3)}</td></tr>
        <tr><td>Lead time LT</td><td className="num">{explain.LT} days</td></tr>
        <tr><td>Lead-time demand d × LT</td><td className="num">{num(explain.ltd, 2)}</td></tr>
        <tr><td>Safety stock z·σ·√LT = {explain.z} × {num(explain.sd, 2)} × √{explain.LT}</td><td className="num">{num(explain.ss, 2)}</td></tr>
        <tr className="sub"><td>Reorder point</td><td className="num">{num(explain.rop, 1)}</td></tr>
        <tr><td>Annual demand D = d × {setting(db, 'working_days_per_year')}</td><td className="num">{num(explain.D, 0)}</td></tr>
        <tr><td>Holding cost H = {pct(setting(db, 'holding_rate'), 0)} × {money(explain.item.avg_cost)}</td><td className="num">{money(explain.H)} / unit / yr</td></tr>
        <tr className="sub"><td>EOQ = √(2 × {num(explain.D, 0)} × {explain.S} ÷ {num(explain.H, 3)})</td><td className="num">{num(explain.eoq, 1)}</td></tr>
        <tr><td>On hand / on order / committed</td><td className="num">{num(explain.onHand, 1)} / {num(explain.onOrder, 1)} / {num(explain.committed, 1)}</td></tr>
        <tr className="sub"><td>Inventory position</td><td className="num">{num(explain.position, 1)}</td></tr>
      </tbody></table>
    </Modal>}
  </>
}

function Suppliers() {
  const { db, call } = useData()
  const [edit, setEdit] = useState(null)
  return <>
    <Card title="Suppliers" actions={<button className="btn primary" onClick={() => setEdit({ payment_terms: 'Net 30', lead_time_days: 7, country: 'Peru', active: true })}>+ Add supplier</button>}>
      <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Supplier</th><th>Contact</th><th>Supplies</th><th className="num">Quoted LT</th><th>Terms</th><th></th></tr></thead><tbody>
        {db.suppliers.map(s => <tr key={s.id} className={s.active ? '' : 'dim'}><td><b>{s.name}</b><div className="small muted">{s.id} · {s.supplier_type} · {s.city}, {s.country}</div></td>
          <td>{s.contact_name}<div className="small muted">{s.email} · {s.phone}</div></td><td className="small wrap-cell">{s.items_supplied}</td><td className="num">{s.lead_time_days} d</td><td>{s.payment_terms}</td>
          <td><button className="btn small" onClick={() => setEdit(s)}>Edit</button></td></tr>)}
      </tbody></table></div>
    </Card>
    {edit && <Modal title={edit.id ? `Edit ${edit.name}` : 'New supplier'} onClose={() => setEdit(null)} footer={<><button className="btn" onClick={() => setEdit(null)}>Cancel</button>
      <Btn kind="primary" onClick={async () => { if (await call('save_supplier', { p: edit }, { success: 'Supplier saved', showRipple: false })) setEdit(null) }}>Save</Btn></>}>
      <div className="form">
        {[['name', 'Name'], ['supplier_type', 'Type'], ['contact_name', 'Contact person'], ['email', 'Email'], ['phone', 'Phone'], ['city', 'City'], ['country', 'Country']].map(([k, l]) =>
          <Field key={k} label={l}><input value={edit[k] || ''} onChange={e => setEdit({ ...edit, [k]: e.target.value })} /></Field>)}
        <Field label="Quoted lead time (days)" hint="Sets the expected date on new POs and drives ROP / MRP"><input type="number" min="0" value={edit.lead_time_days} onChange={e => setEdit({ ...edit, lead_time_days: Number(e.target.value) })} /></Field>
        <Field label="Payment terms"><select value={edit.payment_terms} onChange={e => setEdit({ ...edit, payment_terms: e.target.value })}>{['Prepaid', 'Net 15', 'Net 30', 'Net 45', 'Net 60'].map(t => <option key={t}>{t}</option>)}</select></Field>
        <Field label="Items supplied" wide><input value={edit.items_supplied || ''} onChange={e => setEdit({ ...edit, items_supplied: e.target.value })} /></Field>
        <Field label="Active"><select value={String(edit.active)} onChange={e => setEdit({ ...edit, active: e.target.value === 'true' })}><option value="true">Active</option><option value="false">Inactive</option></select></Field>
      </div>
    </Modal>}
  </>
}
