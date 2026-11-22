import { useMemo, useState } from 'react'
import { useData } from '../lib/data.jsx'
import { Page, Card, Badge, Empty, Modal } from '../components/ui.jsx'
import { runMRP, num, dfmt, dshort, qtyFmt, todayLima, addDays, effQty } from '../lib/calc.js'
import { NewPO } from './Purchasing.jsx'
import { NewWO } from './Production.jsx'

const ROWS = [
  ['gross', 'Gross Requirements'], ['sched', 'Scheduled Receipts'], ['poh', 'Projected On Hand'],
  ['net', 'Net Requirements'], ['por', 'Planned Order Receipts'], ['pol', 'Planned Order Releases'],
]

export default function MRP() {
  const { db, ix } = useData()
  const [weeks, setWeeks] = useState(4)
  const [show, setShow] = useState('active')
  const [focus, setFocus] = useState('')
  const [po, setPo] = useState(null)
  const [wo, setWo] = useState(null)
  const [bom, setBom] = useState(null)
  const mrp = useMemo(() => runMRP(db, ix, { today: todayLima(), weeks }), [db, ix, weeks])
  const records = mrp.records.filter(r => (show === 'all' || r.gross.some(x => x > 0) || r.sched.some(x => x > 0) || r.pastDueRelease > 0)
    && (!focus || r.item.id === focus || (ix.bomBy.get(focus) || []).some(b => b.component_id === r.item.id)))
  const levels = [...new Set(records.map(r => r.level))].sort()
  const fmt = (r, v) => (v ? num(v, r.item.uom === 'unit' || r.item.uom === 'pack' ? 0 : 2) : '')

  return (
    <Page title="Material Requirements Planning (MRP)" subtitle={`Weekly plan · week 1 starts ${dfmt(mrp.weekStarts[0])} · recalculates whenever orders, stock or POs change`}
      how={<>
        <p><b>MRP answers: what do we need to buy or make, how much, and when must we order it?</b> It starts from the <b>master production schedule</b> — the parent quantities on confirmed sales orders (Order Placed), placed in the week they are requested — then works down each bill of materials.</p>
        <p>Each item gets the record from class: <code>Net req. = Gross req. − Scheduled receipts − Projected on hand (prior week)</code>; a planned order covers the net requirement (<b>L4L</b> = exactly the net amount, <b>FOQ</b> = multiples of a fixed lot); it is <b>released</b> earlier by the item's lead time (days ÷ 7, rounded up to weeks). A parent's <b>planned order releases × quantity per</b> (incl. scrap allowance) become its components' <b>gross requirements</b> — that's dependent demand. Items are processed by level so each parent is planned before its components (the 3-pack kit is level 0, the tees inside it level 1, fabric level 2).</p>
        <p><b>Scheduled receipts</b> = open purchase orders (by expected date) and open work orders (by due date). Anything requested before this week counts in week 1. A release that would fall before week 1 is <b className="neg">past due</b>: the order-by date has already passed, so expedite it.</p>
      </>}>
      <Card>
        <div className="row gap wrap">
          <label className="row gap small">Horizon <select value={weeks} onChange={e => setWeeks(Number(e.target.value))} style={{ width: 110 }}>{[4, 6, 8].map(w => <option key={w} value={w}>{w} weeks</option>)}</select></label>
          <label className="row gap small">Show <select value={show} onChange={e => setShow(e.target.value)} style={{ width: 200 }}><option value="active">Items with requirements</option><option value="all">All items</option></select></label>
          <label className="row gap small">Focus on parent <select value={focus} onChange={e => setFocus(e.target.value)} style={{ width: 260 }}><option value="">All items</option>{db.items.filter(i => ix.bomBy.has(i.id)).map(i => <option key={i.id} value={i.id}>{i.name}</option>)}</select></label>
        </div>
      </Card>

      <Card title={`Planned orders — what to order and by when (${mrp.suggestions.length})`}>
        {mrp.suggestions.length === 0 ? <Empty icon="check" title="Everything is covered">Stock plus open orders cover every requirement in the horizon.</Empty> : <div className="tbl-wrap"><table className="tbl compact"><thead><tr><th>Item</th><th>Level</th><th className="num">Qty</th><th>Needed (week)</th><th className="num">Lead time</th><th>Order by</th><th>Action</th></tr></thead><tbody>
          {mrp.suggestions.map((s, k) => <tr key={k}>
            <td>{s.item.name}<div className="small muted">{s.item.id} · {s.item.lot_rule}{s.item.lot_rule === 'FOQ' ? ` ${s.item.lot_qty}` : ''}</div></td><td>{s.level}</td>
            <td className="num"><b>{qtyFmt(s.qty, s.item.uom)}</b></td><td className="nowrap">{dshort(s.needDate)} (wk {s.week})</td><td className="num">{s.item.lead_time_days} d</td>
            <td>{s.late ? <><Badge tone="red">Past due</Badge> <span className="neg">{dfmt(s.orderBy)}</span></> : dfmt(s.orderBy)}</td>
            <td>{s.action === 'Work order'
              ? <button className="btn small" onClick={() => setWo({ item_id: s.item.id, qty: Math.ceil(s.qty), due_date: s.needDate, notes: `MRP planned order, needed ${s.needDate}` })}>Create WO</button>
              : <button className="btn small" onClick={() => setPo({ supplier_id: s.item.supplier_id, item_id: s.item.id, qty: s.qty, notes: `MRP planned order, needed ${s.needDate}` })}>Create PO</button>}</td>
          </tr>)}
        </tbody></table></div>}
      </Card>

      {levels.map(level => (
        <div key={level}>
          <h3>Level {level} · {level === 0 ? 'parent items (master production schedule from sales orders)' : level === 1 ? 'components / sub-assemblies of level-0 items' : 'components of level-1 items'}</h3>
          {records.filter(r => r.level === level).map(r => (
            <Card key={r.item.id}>
              <div className="mrp-head">
                <h2>{r.item.name}</h2>
                <div className="mrp-meta">
                  <Badge>{r.item.id}</Badge><Badge tone="blue">LT = {r.item.lead_time_days} d → {r.ltWeeks} wk</Badge>
                  <Badge tone="brand">Q: {r.item.lot_rule}{r.item.lot_rule === 'FOQ' ? ' ' + r.item.lot_qty : ''}</Badge>
                  <Badge>{r.item.make_or_buy === 'Make' ? 'Make' : 'Buy · ' + (ix.suppliers.get(r.item.supplier_id)?.name || '')}</Badge>
                  {ix.bomBy.has(r.item.id) && <button className="btn small ghost" onClick={() => setBom(r.item)}>View BOM</button>}
                  {r.beyond > 0 && <Badge tone="amber">{r.beyond} more demand after horizon</Badge>}
                </div>
              </div>
              <div className="tbl-wrap"><table className="mrp">
                <thead><tr><th>Week</th><th>Start</th>{mrp.weekStarts.map((w, k) => <th key={w}>{k + 1}<div className="small muted" style={{ fontWeight: 400 }}>{dshort(w)}</div></th>)}{r.pastDueRelease > 0 && <th className="late">Past due</th>}</tr></thead>
                <tbody>{ROWS.map(([k, label]) => (
                  <tr key={k} className={k === 'net' ? 'hl' : k === 'pol' ? 'rel' : ''}>
                    <td>{label}</td>
                    <td>{k === 'poh' ? fmt(r, r.onHand) || '0' : ''}</td>
                    {r[k].map((v, t) => <td key={t}>{fmt(r, v)}</td>)}
                    {r.pastDueRelease > 0 && <td className="late">{k === 'pol' ? fmt(r, r.pastDueRelease) : ''}</td>}
                  </tr>))}
                </tbody>
              </table></div>
              {r.sources.length > 0 && <p className="small muted" style={{ marginBottom: 0 }}>Where the numbers come from: {r.sources.slice(0, 8).map(s => `${s.type} ${s.doc} wk${s.week}: ${num(s.qty, 2)}`).join(' · ')}{r.sources.length > 8 ? ' …' : ''}</p>}
            </Card>
          ))}
        </div>
      ))}
      {po && <NewPO preset={po} onClose={() => setPo(null)} onCreated={() => setPo(null)} />}
      {wo && <NewWO preset={wo} onClose={() => setWo(null)} onCreated={() => setWo(null)} />}
      {bom && <Modal title={`Bill of materials · ${bom.name}`} onClose={() => setBom(null)}>
        <table className="tbl compact"><thead><tr><th>Component</th><th className="num">Qty per</th><th className="num">Scrap %</th><th className="num">Effective qty</th><th className="num">Lead time</th></tr></thead><tbody>
          {(ix.bomBy.get(bom.id) || []).map(b => { const c = ix.items.get(b.component_id); return <tr key={b.component_id}><td>{c?.name}</td><td className="num">{b.qty_per} {c?.uom}</td><td className="num">{(b.scrap_pct * 100).toFixed(0)}%</td><td className="num">{num(effQty(b), 4)}</td><td className="num">{c?.lead_time_days} d</td></tr> })}
        </tbody></table>
        <p className="muted small">Planned releases of {bom.id} are multiplied by the effective quantity to get each component's gross requirement in the same week. Release dates use {dfmt(addDays(todayLima(), 0))} as today.</p>
      </Modal>}
    </Page>
  )
}
