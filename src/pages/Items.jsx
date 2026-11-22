import { useMemo, useState } from 'react'
import { useData } from '../lib/data.jsx'
import { Page, Card, Field, Modal, Btn, Badge, Barcode, useOpenParam } from '../components/ui.jsx'
import { money, num, qtyFmt, inventoryPolicy, effQty, sum } from '../lib/calc.js'

export default function Items() {
  const { db, ix } = useData()
  const [q, setQ] = useState('')
  const [type, setType] = useState('')
  const [edit, setEdit] = useState(null)
  useOpenParam(id => { const it = db.items.find(i => i.id === id); if (it) setEdit(it) })
  const [bom, setBom] = useState(null)
  const policy = useMemo(() => new Map(inventoryPolicy(db, ix).map(p => [p.item.id, p])), [db, ix])
  const list = db.items.filter(i => (!type || i.item_type === type) && (!q || (i.name + (i.name_es || '') + i.ean + i.id + (i.sku || '')).toLowerCase().includes(q.toLowerCase())))
  return (
    <Page title="Items & Bills of Materials" subtitle={`${db.items.length} items · ${new Set(db.bom.map(b => b.parent_id)).size} parent items with a BOM`}
      how={<>
        <p>Finished goods (FG) are real Textiles Move SKUs from the company's product sheet — the barcode numbers are the codes the company already uses. Components (C) are the fabric, rib, thread, labels and packaging they are made from; the kit (KIT01) is a 3-pack assembled from finished tees.</p>
        <p><b>Standard cost</b> is the BOM roll-up from the workbook (materials + cut &amp; sew labour). <b>Average cost</b> is the live weighted-average cost the ERP uses for COGS and valuation; it moves as POs are received and work orders complete. Reorder point and EOQ are calculated, not typed — see Purchasing → Replenishment.</p>
      </>}>
      <Card>
        <div className="row gap wrap" style={{ marginBottom: 10 }}>
          <input style={{ maxWidth: 280 }} placeholder="Search" value={q} onChange={e => setQ(e.target.value)} />
          <select style={{ maxWidth: 200 }} value={type} onChange={e => setType(e.target.value)}><option value="">All types</option><option>Finished Good</option><option>Kit</option><option>Component</option></select>
          <div className="spacer" /><button className="btn primary" onClick={() => setEdit({ item_type: 'Component', uom: 'unit', make_or_buy: 'Buy', lot_rule: 'L4L', active: true, lead_time_days: 7, std_cost: 0 })}>+ New item</button>
        </div>
        <div className="tbl-wrap"><table className="tbl compact"><thead><tr><th>Item</th><th>Barcode</th><th>Type</th><th className="num">Std cost</th><th className="num">Avg cost</th><th className="num">Retail (IGV incl.)</th><th className="num">Wholesale</th><th className="num">Lead time</th><th className="num">ROP</th><th className="num">EOQ</th><th>Lot rule</th><th className="num">On hand</th><th></th></tr></thead><tbody>
          {list.map(i => { const p = policy.get(i.id); return <tr key={i.id} className={i.active ? '' : 'dim'}>
            <td>{i.name}<span className="es">{i.name_es}</span><div className="small muted">{i.id} · {i.variant_sku || i.sku}</div></td><td className="small">{i.ean}</td><td>{i.item_type}</td>
            <td className="num">{money(i.std_cost)}</td><td className="num">{money(i.avg_cost)}</td><td className="num">{i.sale_price ? money(i.sale_price) : '—'}</td><td className="num">{i.wholesale_price ? money(i.wholesale_price) : '—'}</td>
            <td className="num">{i.lead_time_days} d</td><td className="num">{p ? num(p.rop, 1) : '—'}</td><td className="num">{p ? num(p.eoq, 0) : '—'}</td><td>{i.lot_rule}{i.lot_rule === 'FOQ' ? ' ' + i.lot_qty : ''}</td>
            <td className="num">{qtyFmt(ix.onHand(i.id), i.uom)}</td>
            <td className="row gap">{ix.bomBy.has(i.id) && <button className="btn small" onClick={() => setBom(i)}>BOM</button>}<button className="btn small" onClick={() => setEdit(i)}>Edit</button></td></tr> })}
        </tbody></table></div>
      </Card>
      {edit && <EditItem item={edit} onClose={() => setEdit(null)} />}
      {bom && <BomEditor parent={bom} onClose={() => setBom(null)} />}
    </Page>
  )
}

function EditItem({ item, onClose }) {
  const { db, call } = useData()
  // the form edits the stored names: name = company (Spanish) name, name_en = English display name
  const [f, setF] = useState(item.id ? { ...item, name: item.name_es, name_en: item.name_en || '' } : item)
  const set = k => e => setF({ ...f, [k]: e.target.value })
  return (
    <Modal wide title={item.id ? `Edit ${item.name_en || item.name}` : 'New item'} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button>
      <Btn kind="primary" onClick={async () => { if (await call('save_item', { p: f }, { success: 'Item saved', showRipple: false })) onClose() }}>Save</Btn></>}>
      <div className="form">
        <Field label="English name (shown in the app)" wide><input value={f.name_en || ''} onChange={set('name_en')} /></Field>
        <Field label="Company name (original, Spanish)" wide><input value={f.name || ''} onChange={set('name')} /></Field>
        <Field label="Barcode (EAN / internal code)"><input value={f.ean || ''} onChange={set('ean')} /></Field>
        {!item.id && <><Field label="Type"><select value={f.item_type} onChange={set('item_type')}><option>Component</option><option>Finished Good</option><option>Kit</option></select></Field>
          <Field label="Unit of measure"><select value={f.uom} onChange={set('uom')}><option>unit</option><option>kg</option><option>cone</option><option>pack</option></select></Field>
          <Field label="Make or buy"><select value={f.make_or_buy} onChange={set('make_or_buy')}><option>Buy</option><option>Make</option></select></Field></>}
        <Field label="Standard / purchase cost (S/)"><input type="number" step="0.01" value={f.std_cost ?? ''} onChange={set('std_cost')} /></Field>
        <Field label="Labour per unit (made items)"><input type="number" step="0.01" value={f.labor_cost ?? 0} onChange={set('labor_cost')} /></Field>
        <Field label="Retail price incl. IGV (S/)"><input type="number" step="0.01" value={f.sale_price ?? ''} onChange={set('sale_price')} /></Field>
        <Field label="Wholesale price excl. IGV (S/)"><input type="number" step="0.01" value={f.wholesale_price ?? ''} onChange={set('wholesale_price')} /></Field>
        <Field label="Supplier"><select value={f.supplier_id || ''} onChange={set('supplier_id')}><option value="">— made in-house —</option>{db.suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
        <Field label="Lead time (days)" hint="Production time for made items; supplier lead time for bought items"><input type="number" min="0" value={f.lead_time_days} onChange={set('lead_time_days')} /></Field>
        <Field label="MRP lot rule"><select value={f.lot_rule} onChange={set('lot_rule')}><option value="L4L">L4L (lot for lot)</option><option value="FOQ">FOQ (fixed order qty)</option></select></Field>
        {f.lot_rule === 'FOQ' && <Field label="Fixed order quantity"><input type="number" min="1" value={f.lot_qty ?? ''} onChange={set('lot_qty')} /></Field>}
        <Field label="Active"><select value={String(f.active)} onChange={e => setF({ ...f, active: e.target.value === 'true' })}><option value="true">Active</option><option value="false">Inactive</option></select></Field>
      </div>
      {f.ean && <div style={{ marginTop: 12 }}><Barcode value={f.ean} /></div>}
    </Modal>
  )
}

function BomEditor({ parent, onClose }) {
  const { db, ix, call } = useData()
  const lines = ix.bomBy.get(parent.id) || []
  const [add, setAdd] = useState({ component: '', qty: '', scrap: 0 })
  const material = sum(lines, b => effQty(b) * (ix.items.get(b.component_id)?.avg_cost || 0))
  return (
    <Modal wide title={`Bill of materials · ${parent.name}`} onClose={onClose}>
      <p className="muted">Quantity per ONE {parent.uom} of {parent.id}. The scrap allowance adds cutting / handling waste, so production and MRP use <code>qty × (1 + scrap %)</code>.</p>
      <table className="tbl lines"><thead><tr><th>Component</th><th className="num">Qty per</th><th className="num">Scrap %</th><th className="num">Effective</th><th className="num">Avg cost</th><th className="num">Extended</th><th></th></tr></thead><tbody>
        {lines.map(b => { const c = ix.items.get(b.component_id); return <BomRow key={b.component_id} b={b} c={c} onSave={(q, s) => call('save_bom_line', { p_parent: parent.id, p_component: b.component_id, p_qty: q, p_scrap: s }, { success: 'BOM updated', showRipple: false })} /> })}
        <tr className="sub"><td colSpan={5}>Material cost per unit (at average cost) + labour {money(parent.labor_cost)}</td><td className="num">{money(material + Number(parent.labor_cost))}</td><td /></tr>
      </tbody></table>
      <h3>Add component</h3>
      <div className="row gap wrap">
        <select style={{ maxWidth: 320 }} value={add.component} onChange={e => setAdd({ ...add, component: e.target.value })}><option value="">Choose…</option>{db.items.filter(i => i.id !== parent.id && !lines.some(l => l.component_id === i.id)).map(i => <option key={i.id} value={i.id}>{i.name}</option>)}</select>
        <input type="number" step="any" placeholder="Qty per" style={{ width: 110 }} value={add.qty} onChange={e => setAdd({ ...add, qty: e.target.value })} />
        <input type="number" step="any" placeholder="Scrap %" style={{ width: 100 }} value={add.scrap} onChange={e => setAdd({ ...add, scrap: e.target.value })} />
        <Btn disabled={!add.component || !(Number(add.qty) > 0)} onClick={async () => { if (await call('save_bom_line', { p_parent: parent.id, p_component: add.component, p_qty: Number(add.qty), p_scrap: Number(add.scrap) / 100 }, { success: 'Component added', showRipple: false })) setAdd({ component: '', qty: '', scrap: 0 }) }}>Add</Btn>
      </div>
    </Modal>
  )
}

function BomRow({ b, c, onSave }) {
  const [q, setQ] = useState(b.qty_per)
  const [s, setS] = useState(round1(b.scrap_pct * 100))
  const dirty = Number(q) !== Number(b.qty_per) || Number(s) !== round1(b.scrap_pct * 100)
  return <tr>
    <td>{c?.name} <Badge>{c?.uom}</Badge></td>
    <td className="num"><input type="number" step="any" value={q} onChange={e => setQ(e.target.value)} /></td>
    <td className="num"><input type="number" step="any" value={s} onChange={e => setS(e.target.value)} /></td>
    <td className="num">{num(effQty(b), 4)}</td><td className="num">{money(c?.avg_cost)}</td><td className="num">{money(effQty(b) * (c?.avg_cost || 0))}</td>
    <td className="row gap">{dirty && <Btn small kind="primary" onClick={() => onSave(Number(q), Number(s) / 100)}>Save</Btn>}<Btn small kind="danger" onClick={() => onSave(0, 0)}>Remove</Btn></td>
  </tr>
}
const round1 = x => Math.round(x * 10) / 10
