import { useMemo, useState } from 'react'
import { useData } from '../lib/data.jsx'
import { Page, Card, Field, LocationSelect, Modal, Btn, StatusBadge, Tabs, Empty, Badge, Stat, DateRange, Bars, useOpenParam, Barcode, Icon } from '../components/ui.jsx'
import { money, qtyFmt, dt, dfmt, num, pct, materialCheck, productionReport, todayLima, addDays, toLimaInput, fromLimaInput, groupBy, sum, limaDate } from '../lib/calc.js'
import { Transfer } from './Inventory.jsx'
import { NewPO } from './Purchasing.jsx'

export const QUALITY_REASONS = ['Seam failure', 'Fabric defect', 'Cutting error', 'Machine issue']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export const CANCEL_REASONS = ['Entered by mistake', 'Order cancelled', 'Materials needed elsewhere']

export default function Production() {
  const [tab, setTab] = useState('orders')
  return (
    <Page title="Production Orders" subtitle="Work orders: Planned → In progress (materials issued) → Completed, or Cancelled"
      how={<>
        <p>A <b>work order (WO)</b> tells the workshop to make an item: what, how many, where. Every parent item has a <b>bill of materials (BOM)</b> — e.g. one V-neck tee = 0.19 kg jersey + 0.01 kg rib + thread + 4 labels + hangtag + polybag, plus a scrap allowance.</p>
        <ul>
          <li><b>Create</b> reserves nothing yet, but shows a <b>material check</b> (fabric and thread can be partial kg / cones; labels, bags and boxes are rounded up to whole units): required vs. on hand at the workshop, with shortcuts to transfer stock or buy it.</li>
          <li><b>Issue materials</b> consumes every component per the BOM from the workshop location (stock ↓, value moves from Inventory to <i>Work in Process</i>). If anything is short, nothing is issued.</li>
          <li><b>Complete</b> records quantity good, scrapped and reworked (each with a quality reason code) and actual start/finish times. Good units are received into stock at a <b>rolled-up cost</b> = (components issued + cut &amp; sew labour) ÷ units started. Scrapped units' cost is expensed as <i>Scrap Expense</i>.</li>
          <li><b>Cancel</b> a planned WO (nothing to undo) or an in-progress WO (issued components go back to the shelf at their issued cost).</li>
        </ul>
      </>}>
      <Tabs value={tab} onChange={setTab} tabs={[['orders', 'Work orders'], ['report', 'Production & quality report']]} />
      {tab === 'orders' ? <Orders /> : <Report />}
    </Page>
  )
}

function Orders() {
  const { db, ix } = useData()
  const [filter, setFilter] = useState('open')
  const [creating, setCreating] = useState(false)
  const [openId, setOpenId] = useState(null)
  useOpenParam(setOpenId)
  const today = todayLima()
  const list = db.work_orders.filter(w => filter === 'all' || (filter === 'open' ? ['planned', 'in_progress'].includes(w.status) : w.status === filter))
    .sort((a, b) => b.id.localeCompare(a.id))
  return <>
    <div className="row gap wrap" style={{ marginBottom: 10 }}>
      <select style={{ maxWidth: 200 }} value={filter} onChange={e => setFilter(e.target.value)}>
        <option value="open">Open (planned + in progress)</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option><option value="all">All</option>
      </select>
      <div className="spacer" /><button className="btn primary" onClick={() => setCreating(true)}>+ New work order</button>
    </div>
    <Card>
      {list.length === 0 ? <Empty icon="scissors" title={filter === 'open' ? 'No open work orders' : 'No work orders here'} action={<button className="btn primary small" onClick={() => setCreating(true)}>+ New work order</button>}>Create one here, or from a suggestion on the MRP page.</Empty> : <div className="tbl-wrap"><table className="tbl"><thead><tr><th>WO</th><th>Item</th><th className="num">Qty started</th><th className="num">Good</th><th className="num">Scrap</th><th className="num">Rework</th><th>Due</th><th>Start → finish</th><th className="num">Unit cost</th><th>Status</th></tr></thead><tbody>
        {list.map(w => <tr key={w.id} className={'click ' + (w.status === 'cancelled' ? 'dim' : '')} onClick={() => setOpenId(w.id)}>
          <td><b>{w.id}</b></td><td>{ix.items.get(w.item_id)?.name}</td><td className="num">{w.qty_planned}</td><td className="num">{w.qty_good ?? ''}</td><td className="num">{w.qty_scrap || ''}</td><td className="num">{w.qty_rework || ''}</td>
          <td className="nowrap">{dfmt(w.due_date)}</td><td className="small">{w.started_at ? dt(w.started_at) : ''}{w.finished_at && w.status === 'completed' ? ' → ' + dt(w.finished_at) : ''}</td>
          <td className="num">{w.unit_cost ? money(w.unit_cost) : ''}</td>
          <td className="nowrap"><StatusBadge status={w.status} />{['planned', 'in_progress'].includes(w.status) && w.due_date < today && <> <Badge tone="red">late</Badge></>}</td></tr>)}
      </tbody></table></div>}
    </Card>
    {creating && <NewWO onClose={() => setCreating(false)} onCreated={id => { setCreating(false); setOpenId(id) }} />}
    {openId && <WODetail id={openId} onClose={() => setOpenId(null)} />}
  </>
}

// 45 min · 6.5 h · 3 d 4 h
const duration = ms => {
  const min = Math.round(ms / 60000)
  if (min < 60) return `${Math.max(min, 1)} min`
  if (min < 24 * 60) return `${num(min / 60, 1)} h`
  return `${Math.floor(min / 1440)} d ${Math.round((min % 1440) / 60)} h`
}

export function MaterialCheck({ itemId, qty, loc, onTransfer, onBuy }) {
  const { db, ix } = useData()
  const rows = materialCheck(db, ix, itemId, qty, loc)
  if (!rows.length) return null
  return <table className="tbl compact"><thead><tr><th>Component</th><th className="num">Required (incl. scrap %)</th><th className="num">At {ix.locations.get(loc)?.name}</th><th className="num">Short</th><th></th></tr></thead><tbody>
    {rows.map(r => <tr key={r.component.id}><td>{r.component.name}</td><td className="num">{qtyFmt(r.need, r.component.uom)}</td><td className="num">{qtyFmt(r.here, r.component.uom)}</td>
      <td className={'num ' + (r.short ? 'neg' : 'pos')}>{r.short ? qtyFmt(r.short, r.component.uom) : '✓'}</td>
      <td>{r.short > 0 && <div className="row gap">
        {r.elsewhere > 0 && onTransfer && <button className="btn small" onClick={() => onTransfer(r)}>Transfer {qtyFmt(Math.min(r.short, r.elsewhere), r.component.uom)}</button>}
        {r.short > r.elsewhere && onBuy && r.component.make_or_buy === 'Buy' && <button className="btn small" onClick={() => onBuy(r)}>Create PO</button>}
      </div>}</td></tr>)}
  </tbody></table>
}

export function NewWO({ onClose, onCreated, preset }) {
  const { db, ix, call } = useData()
  const parents = db.items.filter(i => ix.bomBy.has(i.id) && i.active)
  // Sewn items are made in the workshop; kits (3-packs) are assembled where the finished tees are stored.
  const makeAt = id => ix.items.get(id)?.item_type === 'Kit' ? 'LOC03' : 'LOC02'
  const startItem = preset?.item_id || 'FG02'
  const [f, setF] = useState({ item_id: startItem, qty: preset?.qty || 60, location_id: makeAt(startItem), output_location_id: 'LOC03', due_date: preset?.due_date || '', notes: preset?.notes || '' })
  const [transfer, setTransfer] = useState(null)
  const [buy, setBuy] = useState(null)
  const item = ix.items.get(f.item_id)
  const due = f.due_date || addDays(todayLima(), Number(item?.lead_time_days || 0))
  const pastDue = due < todayLima()
  const save = async () => {
    const r = await call('create_wo', { p: { ...f, qty: Number(f.qty), due_date: due } }, { success: r => `Work order ${r.id} created`, showRipple: false })
    if (r) onCreated(r.id)
  }
  return (
    <Modal wide title="New work order" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><Btn kind="primary" onClick={save} disabled={!(Number(f.qty) > 0)}>Create work order</Btn></>}>
      <div className="form">
        <Field label="Item to make"><select value={f.item_id} onChange={e => setF({ ...f, item_id: e.target.value, location_id: makeAt(e.target.value) })}>{parents.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}</select></Field>
        <Field label="Quantity"><input type="number" min="1" value={f.qty} onChange={e => setF({ ...f, qty: e.target.value })} /></Field>
        <Field label="Make at (components consumed here)"><LocationSelect value={f.location_id} onChange={v => setF({ ...f, location_id: v })} /></Field>
        <Field label="Receive finished goods into"><LocationSelect value={f.output_location_id} onChange={v => setF({ ...f, output_location_id: v })} /></Field>
        <Field label="Due date" hint={pastDue ? <span className="warn-text">This due date has already passed, so the order will show as late.</span> : preset?.due_date ? 'From MRP: the week this quantity is needed' : `Default = today + ${item?.lead_time_days} day production lead time`}><input type="date" value={due} onChange={e => setF({ ...f, due_date: e.target.value })} /></Field>
        <Field label="Notes"><input value={f.notes} onChange={e => setF({ ...f, notes: e.target.value })} /></Field>
      </div>
      <h3>Material availability check</h3>
      <MaterialCheck itemId={f.item_id} qty={Number(f.qty) || 0} loc={f.location_id}
        onTransfer={r => setTransfer({ item: r.component.id, from: Object.entries(ix.stockBy.get(r.component.id) || {}).filter(([l, q]) => l !== f.location_id && !ix.qh.has(l) && q > 0).sort((a, b) => b[1] - a[1])[0]?.[0], to: f.location_id, qty: Math.min(r.short, r.elsewhere) })}
        onBuy={r => setBuy({ supplier_id: r.component.supplier_id, item_id: r.component.id, qty: r.short - Math.max(0, r.elsewhere) })} />
      <p className="muted small">Short materials don't block creating the order, but <b>Issue materials</b> will refuse until everything is at the workshop.</p>
      {transfer && <Modal title="Transfer for this work order" onClose={() => setTransfer(null)}><Transfer preset={transfer} onDone={() => setTransfer(null)} /></Modal>}
      {buy && <NewPO preset={buy} onClose={() => setBuy(null)} onCreated={() => setBuy(null)} />}
    </Modal>
  )
}

function WODetail({ id, onClose }) {
  const { db, ix, call } = useData()
  const w = ix.wos.get(id)
  const [completing, setCompleting] = useState(false)
  const [cancelReason, setCancelReason] = useState('')
  const [transfer, setTransfer] = useState(null)
  const [buy, setBuy] = useState(null)
  if (!w) return null
  const item = ix.items.get(w.item_id)
  const comps = db.wo_components.filter(c => c.wo_id === id)
  const issues = db.wo_issues.filter(i => i.wo_id === id)
  const canCancel = ['planned', 'in_progress'].includes(w.status)
  return (
    <Modal wide title={`Work order ${id} · ${item?.name}`} onClose={onClose} footer={<>
      <button className="btn" onClick={() => window.print()} title="Print a one-page traveler for the workshop"><Icon name="printer" size={15} /> Print traveler</button>
      <div className="spacer" />
      {canCancel && <><select value={cancelReason} onChange={e => setCancelReason(e.target.value)} style={{ width: 220 }}><option value="">Cancel reason…</option>{CANCEL_REASONS.map(r => <option key={r}>{r}</option>)}</select>
        <Btn kind="danger" disabled={!cancelReason} onClick={() => call('cancel_wo', { p_id: id, p_reason: cancelReason }, { success: r => `Cancelled${r.returned_value ? `, ${money(r.returned_value)} of components returned` : ''}` })}>Cancel WO</Btn></>}
      {w.status === 'planned' && <Btn kind="primary" onClick={() => call('issue_wo', { p_id: id }, { success: r => `Materials issued: ${money(r.material_cost)}` })}>Issue materials</Btn>}
      {w.status === 'in_progress' && <Btn kind="primary" onClick={() => setCompleting(true)}>Complete…</Btn>}
    </>}>
      <Traveler w={w} item={item} comps={comps} issues={issues} />
      <div className="row gap wrap" style={{ marginBottom: 10 }}>
        <StatusBadge status={w.status} /><span>{w.qty_planned} units · make at {ix.locations.get(w.location_id)?.name} → {ix.locations.get(w.output_location_id)?.name} · due {dfmt(w.due_date)}</span>
        {w.cancel_reason && <Badge tone="red">{w.cancel_reason}</Badge>}
      </div>
      {w.notes && <p className="muted">{w.notes}</p>}
      {w.status === 'planned' ? <>
        <h3>Components needed (material check)</h3>
        <MaterialCheck itemId={w.item_id} qty={w.qty_planned} loc={w.location_id}
          onTransfer={r => setTransfer({ item: r.component.id, from: Object.entries(ix.stockBy.get(r.component.id) || {}).filter(([l, q]) => l !== w.location_id && !ix.qh.has(l) && q > 0).sort((a, b) => b[1] - a[1])[0]?.[0], to: w.location_id, qty: Math.min(r.short, r.elsewhere) })}
          onBuy={r => setBuy({ supplier_id: r.component.supplier_id, item_id: r.component.id, qty: r.short - Math.max(0, r.elsewhere) })} />
      </> : w.status === 'cancelled' && !comps.some(c => Number(c.qty_issued) > 0) ? <p className="muted">Cancelled before materials were issued — no stock or accounting was affected.</p> : <>
        <h3>{w.status === 'cancelled' ? 'Components issued, then returned to stock when cancelled' : `Components issued (bill of materials × ${w.qty_planned})`}</h3>
        <table className="tbl compact"><thead><tr><th>Component</th><th className="num">Issued</th><th className="num">Unit cost</th><th className="num">Value</th></tr></thead><tbody>
          {comps.map(c => { const it = ix.items.get(c.item_id); return <tr key={c.id}><td>{it?.name}</td><td className="num">{qtyFmt(c.qty_issued, it?.uom)}</td><td className="num">{c.unit_cost != null ? money(c.unit_cost) : ''}</td><td className="num">{c.unit_cost != null ? money(c.qty_issued * c.unit_cost) : ''}</td></tr> })}
        </tbody></table>
      </>}
      {w.status === 'completed' && <>
        <h3>Result and cost roll-up</h3>
        <div className="stats">
          <Stat label="Started" value={w.qty_planned} /><Stat label="Good" value={w.qty_good} tone="good" sub={`yield ${pct(w.qty_good / w.qty_planned)}`} />
          <Stat label="Scrapped" value={w.qty_scrap} tone={w.qty_scrap ? 'bad' : ''} /><Stat label="Reworked (incl. in good)" value={w.qty_rework} />
          <Stat label="Materials + labour" value={money(Number(w.material_cost) + Number(w.labor_cost))} sub={`${money(w.material_cost)} + ${money(w.labor_cost)}`} />
          <Stat label="Unit cost" value={money(w.unit_cost)} sub={`std ${money(item?.std_cost)}`} />
          <Stat label="Production time" value={duration(new Date(w.finished_at) - new Date(w.started_at))} sub={`${dt(w.started_at)} → ${dt(w.finished_at)}`} />
        </div>
        {issues.length > 0 && <table className="tbl compact"><thead><tr><th>Quality issue</th><th>Type</th><th className="num">Qty</th></tr></thead><tbody>{issues.map(i => <tr key={i.id}><td>{i.reason}</td><td>{i.kind}</td><td className="num">{i.qty}</td></tr>)}</tbody></table>}
      </>}
      {completing && <Complete w={w} onClose={() => setCompleting(false)} />}
      {transfer && <Modal title="Transfer for this work order" onClose={() => setTransfer(null)}><Transfer preset={transfer} onDone={() => setTransfer(null)} /></Modal>}
      {buy && <NewPO preset={buy} onClose={() => setBuy(null)} onCreated={() => setBuy(null)} />}
    </Modal>
  )
}

// One-page printout that travels with the batch through the workshop (print only; hidden on screen).
function Traveler({ w, item, comps, issues }) {
  const { ix } = useData()
  const done = w.status === 'completed'
  const reason = kind => issues.filter(i => i.kind === kind).map(i => `${i.qty} ${i.reason}`).join(', ')
  return (
    <div className="print-only traveler">
      <div className="tr-head">
        <div className="tr-brand"><div className="brand-logo">TM</div><div><b>TEXTILES MOVE</b><div className="tr-sub">Work order traveler · Taller de corte y confección</div></div></div>
        <div className="tr-code"><Barcode value={w.id} height={40} width={1.6} /></div>
      </div>
      <table className="tr-info"><tbody>
        <tr><th>Item</th><td colSpan={3}><b>{item?.name}</b><div className="tr-sub">{item?.name_es} · {item?.id} · {item?.ean}</div></td></tr>
        <tr><th>Quantity to make</th><td><b>{w.qty_planned}</b> units</td><th>Due</th><td><b>{dfmt(w.due_date)}</b></td></tr>
        <tr><th>Make at</th><td>{ix.locations.get(w.location_id)?.name}</td><th>Receive into</th><td>{ix.locations.get(w.output_location_id)?.name}</td></tr>
        <tr><th>Status</th><td>{w.status.replace('_', ' ')}</td><th>Created</th><td>{dt(w.created_at)}</td></tr>
        {w.notes && <tr><th>Notes</th><td colSpan={3}>{w.notes}</td></tr>}
      </tbody></table>

      <h3>1 · Materials to pick (bill of materials × {w.qty_planned}, incl. scrap allowance)</h3>
      <table className="tr-tbl"><thead><tr><th>Component</th><th>Barcode</th><th className="num">Required</th><th className="num">Issued</th><th className="ck">Picked</th></tr></thead><tbody>
        {comps.map(c => { const it = ix.items.get(c.item_id); return <tr key={c.id}><td>{it?.name}<div className="tr-sub">{it?.name_es}</div></td><td className="mono">{it?.ean}</td>
          <td className="num">{qtyFmt(c.qty_required, it?.uom)}</td><td className="num">{Number(c.qty_issued) ? qtyFmt(c.qty_issued, it?.uom) : ''}</td><td className="ck">☐</td></tr> })}
      </tbody></table>

      <h3>2 · Operations</h3>
      <table className="tr-tbl"><thead><tr><th>Step</th><th>Done by</th><th>Date / time</th><th className="ck">✓</th></tr></thead><tbody>
        {['Cut panels', 'Sew', 'Finish & press', 'Quality check', 'Tag & bag'].map(op => <tr key={op}><td>{op}</td><td /><td /><td className="ck">☐</td></tr>)}
      </tbody></table>

      <h3>3 · Result</h3>
      <table className="tr-tbl"><tbody>
        <tr><th>Good units</th><td className="fill">{done ? w.qty_good : ''}</td><th>Scrapped</th><td className="fill">{done ? `${w.qty_scrap}${reason('scrap') ? ` (${reason('scrap')})` : ''}` : ''}</td></tr>
        <tr><th>Reworked</th><td className="fill">{done ? `${w.qty_rework}${reason('rework') ? ` (${reason('rework')})` : ''}` : ''}</td><th>Supervisor sign-off</th><td className="fill" /></tr>
      </tbody></table>
      <p className="tr-sub">Scrap and rework need a reason code: Seam failure · Fabric defect · Cutting error · Machine issue. Enter results in the ERP under Production → {w.id} → Complete. Printed {dt(new Date())}.</p>
    </div>
  )
}

function Complete({ w, onClose }) {
  const { call } = useData()
  const [issues, setIssues] = useState([])
  const [start, setStart] = useState(toLimaInput(w.started_at))
  // The time inputs are to the minute, so if materials were issued this same minute,
  // default the finish one minute after the start (otherwise Complete stays disabled).
  const [finish, setFinish] = useState(() => {
    const now = toLimaInput(new Date()), st = toLimaInput(w.started_at)
    return now > st ? now : toLimaInput(new Date(w.started_at).getTime() + 60000)
  })
  const scrap = sum(issues.filter(i => i.kind === 'scrap'), i => Number(i.qty) || 0)
  const rework = sum(issues.filter(i => i.kind === 'rework'), i => Number(i.qty) || 0)
  // Every started unit ends up either good or scrapped, so good is always started − scrap.
  const good = Number(w.qty_planned) - scrap
  const ok = good >= 0 && rework <= good && issues.every(i => i.reason && Number(i.qty) > 0) && finish > start
  const save = async () => {
    const r = await call('complete_wo', { p: { id: w.id, qty_good: good, issues, started_at: fromLimaInput(start), finished_at: fromLimaInput(finish) } },
      { success: r => `Completed: ${r.good} good, ${r.scrap} scrapped · unit cost ${money(r.unit_cost)}` })
    if (r) onClose()
  }
  return (
    <Modal wide title={`Complete ${w.id}`} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Back</button><Btn kind="primary" disabled={!ok} onClick={save}>Complete work order</Btn></>}>
      <div className="form">
        <Field label="Quantity started"><input value={w.qty_planned} disabled /></Field>
        <Field label="Good units" hint="started − scrap (add scrap lines below)"><input value={good} disabled /></Field>
        <Field label="Actual start (Lima time)"><input type="datetime-local" value={start} onChange={e => setStart(e.target.value)} /></Field>
        <Field label="Actual finish (Lima time)"><input type="datetime-local" value={finish} onChange={e => setFinish(e.target.value)} /></Field>
      </div>
      <h3>Quality issues (scrap and rework, each with a reason code)</h3>
      <table className="tbl lines"><tbody>{issues.map((i, k) => (
        <tr key={k}>
          <td><select value={i.kind} onChange={e => setIssues(a => a.map((x, j) => j === k ? { ...x, kind: e.target.value } : x))}><option value="scrap">Scrap (unit lost)</option><option value="rework">Rework (fixed, still good)</option></select></td>
          <td><input type="number" min="1" value={i.qty} onChange={e => { const q = e.target.value; setIssues(a => a.map((x, j) => j === k ? { ...x, qty: q } : x)) }} /></td>
          <td><select value={i.reason} onChange={e => setIssues(a => a.map((x, j) => j === k ? { ...x, reason: e.target.value } : x))}><option value="">Reason…</option>{QUALITY_REASONS.map(r => <option key={r}>{r}</option>)}</select></td>
          <td><button className="icon-btn" onClick={() => setIssues(a => a.filter((_, j) => j !== k))}>✕</button></td>
        </tr>))}</tbody></table>
      <div className="row gap" style={{ marginTop: 8 }}>
        <button className="btn small" onClick={() => setIssues(a => [...a, { kind: 'scrap', qty: 1, reason: '' }])}>+ Scrap line</button>
        <button className="btn small" onClick={() => setIssues(a => [...a, { kind: 'rework', qty: 1, reason: '' }])}>+ Rework line</button>
      </div>
      <p className={ok ? 'muted' : 'error-text'}>Started {w.qty_planned} = good {good} + scrap {scrap}{good < 0 ? ' · scrap cannot exceed the quantity started' : ''} · rework {rework} (part of good){rework > good ? ' · rework cannot exceed good' : ''}{finish <= start ? ' · finish must be after start' : ''}{issues.some(i => !i.reason) ? ' · pick a reason for each line' : ''}</p>
    </Modal>
  )
}

function Report() {
  const { db, ix } = useData()
  const [from, setFrom] = useState('2026-05-01')
  const [to, setTo] = useState(todayLima())
  const r = useMemo(() => productionReport(db, ix, from, to), [db, ix, from, to])
  const byItem = [...groupBy(r.wos, 'item_id').entries()].map(([id, ws]) => ({ item: ix.items.get(id), n: ws.length, started: sum(ws, w => w.qty_planned), good: sum(ws, w => w.qty_good), scrap: sum(ws, w => w.qty_scrap), rework: sum(ws, w => w.qty_rework) }))
    .sort((a, b) => b.started - a.started)
  const byMonth = useMemo(() => {
    // one bar per month in the range, including months with no production (shown as 0)
    const g = groupBy(r.wos, w => limaDate(w.finished_at).slice(0, 7))
    const out = []
    if (!/^\d{4}-\d{2}/.test(from) || !/^\d{4}-\d{2}/.test(to)) return out
    for (let m = from.slice(0, 7); m <= to.slice(0, 7) && out.length < 120;) {
      const [y, mo] = m.split('-').map(Number)
      out.push({ label: `${MONTHS[mo - 1]} '${String(y).slice(2)}`, value: sum(g.get(m) || [], w => w.qty_good) })
      m = mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`
    }
    return out
  }, [r, from, to])
  return <>
    <Card><DateRange from={from} to={to} onChange={(a, b) => { setFrom(a); setTo(b) }} /></Card>
    <div className="stats">
      <Stat label="Work orders completed" value={r.count} sub={`${r.cancelled} cancelled`} />
      <Stat label="Yield (good ÷ started)" value={pct(r.yield)} sub={`${num(r.good)} of ${num(r.started)} units`} tone="good" />
      <Stat label="First-pass yield" value={pct(r.fpy)} sub="good without rework ÷ started" />
      <Stat label="Scrap rate" value={pct(r.scrapRate)} sub={`${num(r.scrap)} units · ${money(r.scrapCost)} expensed`} tone={r.scrapRate > 0.02 ? 'bad' : ''} />
      <Stat label="Rework rate" value={pct(r.reworkRate)} sub={`${num(r.rework)} units`} />
      <Stat label="On-time completion" value={pct(r.onTimeRate)} sub="finished on or before due date" tone={r.onTimeRate < 0.8 ? 'warn' : ''} />
      <Stat label="Avg cycle time" value={r.avgCycleHours === null ? '—' : `${num(r.avgCycleHours / 24, 1)} days`} sub="start → finish (elapsed)" />
      <Stat label="Throughput" value={`${num(r.throughputPerDay, 1)} / day`} sub="good units per working day" />
    </div>
    <div className="grid g2">
      <Card title="Good units completed by month"><Bars rows={byMonth} format={v => num(v)} /></Card>
      <Card title="Quality issues by reason (Pareto)">
        {r.reasons.length === 0 ? <Empty icon="check">No scrap or rework recorded in this period.</Empty> : <table className="tbl compact"><tbody>{r.reasons.map(x => (
          <tr key={x.reason + x.kind}><td>{x.reason}</td><td><Badge tone={x.kind === 'scrap' ? 'red' : 'amber'}>{x.kind}</Badge></td><td style={{ width: '40%' }}><div className="hbar"><div style={{ width: `${(x.qty / r.reasons[0].qty) * 100}%` }} /></div></td><td className="num">{x.qty}</td></tr>))}</tbody></table>}
      </Card>
    </div>
    <Card title="By item">
      <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Item</th><th className="num">WOs</th><th className="num">Started</th><th className="num">Good</th><th className="num">Scrap</th><th className="num">Rework</th><th className="num">Yield</th></tr></thead><tbody>
        {byItem.map(x => <tr key={x.item.id}><td>{x.item.name}</td><td className="num">{x.n}</td><td className="num">{x.started}</td><td className="num">{x.good}</td><td className="num">{x.scrap}</td><td className="num">{x.rework}</td><td className="num">{pct(x.good / x.started)}</td></tr>)}
      </tbody></table></div>
    </Card>
    <Card title={`Work orders finished ${dfmt(from)} – ${dfmt(to)}`}>
      <div className="tbl-wrap"><table className="tbl compact"><thead><tr><th>WO</th><th>Item</th><th>Start</th><th>Finish</th><th>Due</th><th className="num">Started</th><th className="num">Good</th><th className="num">Scrap</th><th className="num">Rework</th><th className="num">Unit cost</th></tr></thead><tbody>
        {[...r.wos].sort((a, b) => b.finished_at.localeCompare(a.finished_at)).map(w => <tr key={w.id}><td>{w.id}</td><td>{ix.items.get(w.item_id)?.name}</td><td className="nowrap">{dt(w.started_at)}</td><td className="nowrap">{dt(w.finished_at)}</td>
          <td className={limaDate(w.finished_at) > w.due_date ? 'neg' : ''}>{dfmt(w.due_date)}</td><td className="num">{w.qty_planned}</td><td className="num">{w.qty_good}</td><td className="num">{w.qty_scrap}</td><td className="num">{w.qty_rework}</td><td className="num">{money(w.unit_cost)}</td></tr>)}
      </tbody></table></div>
    </Card>
  </>
}
