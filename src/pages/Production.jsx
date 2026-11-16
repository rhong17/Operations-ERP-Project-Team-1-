import { useMemo, useState } from 'react'
import { useData } from '../lib/data.jsx'
import { Page, Card, Field, LocationSelect, Modal, Btn, StatusBadge, Tabs, Empty, Badge, Stat, DateRange, Bars } from '../components/ui.jsx'
import { money, qtyFmt, dt, dfmt, num, pct, materialCheck, productionReport, todayLima, addDays, toLimaInput, fromLimaInput, groupBy, sum, limaDate } from '../lib/calc.js'
import { Transfer } from './Inventory.jsx'
import { NewPO } from './Purchasing.jsx'

export const QUALITY_REASONS = ['Seam failure', 'Fabric defect', 'Cutting error', 'Machine issue']
export const CANCEL_REASONS = ['Entered by mistake', 'Order cancelled', 'Materials needed elsewhere']

export default function Production() {
  const [tab, setTab] = useState('orders')
  return (
    <Page title="Production Orders" subtitle="Work orders: Planned → In progress (materials issued) → Completed, or Cancelled"
      how={<>
        <p>A <b>work order (WO)</b> tells the workshop to make an item: what, how many, where. Every parent item has a <b>bill of materials (BOM)</b> — e.g. one V-neck tee = 0.19 kg jersey + 0.01 kg rib + thread + 4 labels + hangtag + polybag, plus a scrap allowance.</p>
        <ul>
          <li><b>Create</b> reserves nothing yet, but shows a <b>material check</b>: required vs. on hand at the workshop, with shortcuts to transfer stock or buy it.</li>
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
      {list.length === 0 ? <Empty>No work orders here.</Empty> : <div className="tbl-wrap"><table className="tbl"><thead><tr><th>WO</th><th>Item</th><th className="num">Qty started</th><th className="num">Good</th><th className="num">Scrap</th><th className="num">Rework</th><th>Due</th><th>Start → finish</th><th className="num">Unit cost</th><th>Status</th></tr></thead><tbody>
        {list.map(w => <tr key={w.id} className={'click ' + (w.status === 'cancelled' ? 'dim' : '')} onClick={() => setOpenId(w.id)}>
          <td><b>{w.id}</b></td><td>{ix.items.get(w.item_id)?.name}</td><td className="num">{w.qty_planned}</td><td className="num">{w.qty_good ?? ''}</td><td className="num">{w.qty_scrap || ''}</td><td className="num">{w.qty_rework || ''}</td>
          <td className="nowrap">{dfmt(w.due_date)}</td><td className="small">{w.started_at ? dt(w.started_at) : ''}{w.finished_at && w.status === 'completed' ? ' → ' + dt(w.finished_at) : ''}</td>
          <td className="num">{w.unit_cost ? money(w.unit_cost) : ''}</td><td><StatusBadge status={w.status} /></td></tr>)}
      </tbody></table></div>}
    </Card>
    {creating && <NewWO onClose={() => setCreating(false)} onCreated={id => { setCreating(false); setOpenId(id) }} />}
    {openId && <WODetail id={openId} onClose={() => setOpenId(null)} />}
  </>
}

export function MaterialCheck({ itemId, qty, loc, onTransfer, onBuy }) {
  const { db, ix } = useData()
  const rows = materialCheck(db, ix, itemId, qty, loc)
  if (!rows.length) return null
  return <table className="tbl compact"><thead><tr><th>Component</th><th className="num">Required (incl. scrap %)</th><th className="num">At {ix.locations.get(loc)?.id}</th><th className="num">Short</th><th></th></tr></thead><tbody>
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
  const [f, setF] = useState({ item_id: preset?.item_id || 'FG02', qty: preset?.qty || 60, location_id: 'LOC02', output_location_id: 'LOC03', due_date: '', notes: preset?.notes || '' })
  const [transfer, setTransfer] = useState(null)
  const [buy, setBuy] = useState(null)
  const item = ix.items.get(f.item_id)
  const due = f.due_date || addDays(todayLima(), Number(item?.lead_time_days || 0))
  const save = async () => {
    const r = await call('create_wo', { p: { ...f, qty: Number(f.qty), due_date: due } }, { success: r => `Work order ${r.id} created`, showRipple: false })
    if (r) onCreated(r.id)
  }
  return (
    <Modal wide title="New work order" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><Btn kind="primary" onClick={save} disabled={!(Number(f.qty) > 0)}>Create work order</Btn></>}>
      <div className="form">
        <Field label="Item to make"><select value={f.item_id} onChange={e => setF({ ...f, item_id: e.target.value })}>{parents.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}</select></Field>
        <Field label="Quantity"><input type="number" min="1" value={f.qty} onChange={e => setF({ ...f, qty: e.target.value })} /></Field>
        <Field label="Make at (components consumed here)"><LocationSelect value={f.location_id} onChange={v => setF({ ...f, location_id: v })} /></Field>
        <Field label="Receive finished goods into"><LocationSelect value={f.output_location_id} onChange={v => setF({ ...f, output_location_id: v })} /></Field>
        <Field label="Due date" hint={`Default = today + ${item?.lead_time_days} day production lead time`}><input type="date" value={due} onChange={e => setF({ ...f, due_date: e.target.value })} /></Field>
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
  if (!w) return null
  const item = ix.items.get(w.item_id)
  const comps = db.wo_components.filter(c => c.wo_id === id)
  const issues = db.wo_issues.filter(i => i.wo_id === id)
  const canCancel = ['planned', 'in_progress'].includes(w.status)
  return (
    <Modal wide title={`Work order ${id} · ${item?.name}`} onClose={onClose} footer={<>
      {canCancel && <><select value={cancelReason} onChange={e => setCancelReason(e.target.value)} style={{ width: 220 }}><option value="">Cancel reason…</option>{CANCEL_REASONS.map(r => <option key={r}>{r}</option>)}</select>
        <Btn kind="danger" disabled={!cancelReason} onClick={() => call('cancel_wo', { p_id: id, p_reason: cancelReason }, { success: r => `Cancelled${r.returned_value ? `, ${money(r.returned_value)} of components returned` : ''}` })}>Cancel WO</Btn></>}
      {w.status === 'planned' && <Btn kind="primary" onClick={() => call('issue_wo', { p_id: id }, { success: r => `Materials issued: ${money(r.material_cost)}` })}>Issue materials</Btn>}
      {w.status === 'in_progress' && <Btn kind="primary" onClick={() => setCompleting(true)}>Complete…</Btn>}
    </>}>
      <div className="row gap wrap" style={{ marginBottom: 10 }}>
        <StatusBadge status={w.status} /><span>{w.qty_planned} units · make at {ix.locations.get(w.location_id)?.name} → {ix.locations.get(w.output_location_id)?.name} · due {dfmt(w.due_date)}</span>
        {w.cancel_reason && <Badge tone="red">{w.cancel_reason}</Badge>}
      </div>
      {w.notes && <p className="muted">{w.notes}</p>}
      {w.status === 'planned' ? <>
        <h3>Components needed (material check)</h3>
        <MaterialCheck itemId={w.item_id} qty={w.qty_planned} loc={w.location_id}
          onTransfer={r => setTransfer({ item: r.component.id, from: Object.entries(ix.stockBy.get(r.component.id) || {}).filter(([l, q]) => l !== w.location_id && !ix.qh.has(l) && q > 0).sort((a, b) => b[1] - a[1])[0]?.[0], to: w.location_id, qty: Math.min(r.short, r.elsewhere) })} />
      </> : <>
        <h3>Components issued (bill of materials × {w.qty_planned})</h3>
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
          <Stat label="Production time" value={`${num((new Date(w.finished_at) - new Date(w.started_at)) / 3600000, 1)} h`} sub={`${dt(w.started_at)} → ${dt(w.finished_at)}`} />
        </div>
        {issues.length > 0 && <table className="tbl compact"><thead><tr><th>Quality issue</th><th>Type</th><th className="num">Qty</th></tr></thead><tbody>{issues.map(i => <tr key={i.id}><td>{i.reason}</td><td>{i.kind}</td><td className="num">{i.qty}</td></tr>)}</tbody></table>}
      </>}
      {completing && <Complete w={w} onClose={() => setCompleting(false)} />}
      {transfer && <Modal title="Transfer for this work order" onClose={() => setTransfer(null)}><Transfer preset={transfer} onDone={() => setTransfer(null)} /></Modal>}
    </Modal>
  )
}

function Complete({ w, onClose }) {
  const { call } = useData()
  const [issues, setIssues] = useState([])
  const [good, setGood] = useState(w.qty_planned)
  const [start, setStart] = useState(toLimaInput(w.started_at))
  const [finish, setFinish] = useState(toLimaInput(new Date()))
  const scrap = sum(issues.filter(i => i.kind === 'scrap'), i => Number(i.qty) || 0)
  const rework = sum(issues.filter(i => i.kind === 'rework'), i => Number(i.qty) || 0)
  const ok = Number(good) + scrap === Number(w.qty_planned) && rework <= Number(good) && issues.every(i => i.reason && Number(i.qty) > 0) && finish > start
  const save = async () => {
    const r = await call('complete_wo', { p: { id: w.id, qty_good: Number(good), issues, started_at: fromLimaInput(start), finished_at: fromLimaInput(finish) } },
      { success: r => `Completed: ${r.good} good, ${r.scrap} scrapped · unit cost ${money(r.unit_cost)}` })
    if (r) onClose()
  }
  return (
    <Modal wide title={`Complete ${w.id}`} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Back</button><Btn kind="primary" disabled={!ok} onClick={save}>Complete work order</Btn></>}>
      <div className="form">
        <Field label="Quantity started"><input value={w.qty_planned} disabled /></Field>
        <Field label="Good units" hint="good + scrap must equal started"><input type="number" min="0" value={good} onChange={e => setGood(e.target.value)} /></Field>
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
        <button className="btn small" onClick={() => { setIssues(a => [...a, { kind: 'scrap', qty: 1, reason: '' }]); setGood(g => Math.max(0, Number(g) - 1)) }}>+ Scrap line</button>
        <button className="btn small" onClick={() => setIssues(a => [...a, { kind: 'rework', qty: 1, reason: '' }])}>+ Rework line</button>
      </div>
      <p className={ok ? 'muted' : 'error-text'}>Started {w.qty_planned} = good {good} + scrap {scrap}{Number(good) + scrap !== Number(w.qty_planned) ? ' ✗' : ' ✓'} · rework {rework} (part of good){finish <= start ? ' · finish must be after start' : ''}</p>
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
  const byMonth = [...groupBy(r.wos, w => limaDate(w.finished_at).slice(0, 7)).entries()].sort().map(([m, ws]) => ({ label: m, value: sum(ws, w => w.qty_good) }))
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
        {r.reasons.length === 0 ? <Empty>No issues recorded.</Empty> : <table className="tbl compact"><tbody>{r.reasons.map(x => (
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
