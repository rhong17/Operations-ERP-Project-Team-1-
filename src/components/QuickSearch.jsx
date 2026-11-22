// ⌘K / Ctrl+K quick search: jump to any page, item, order, customer or supplier.
// Results open the matching page; documents open their detail dialog via ?open=<id>.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useData } from '../lib/data.jsx'
import { Icon } from './ui.jsx'

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
export const shortcutLabel = isMac ? '⌘K' : 'Ctrl K'

// "wo36", "WO-36", "36" all match WO-00036
function idMatches(id, q) {
  const a = id.toLowerCase().replace(/[^a-z0-9]/g, ''), b = q.toLowerCase().replace(/[^a-z0-9]/g, '')
  if (!b) return false
  if (a.includes(b)) return true
  const [, p1, n1] = a.match(/^([a-z]*)(\d+)/) || [], [, p2, n2] = b.match(/^([a-z]*)(\d+)$/) || []
  return n1 !== undefined && n2 !== undefined && (!p2 || p1.startsWith(p2)) && Number(n1) === Number(n2)
}

// every word of the query starts a word in the text ("black m" matches "Tee · Black · M", not "Cotton")
const split = t => (t || '').toLowerCase().split(/[^a-z0-9áéíóúñü]+/).filter(Boolean)
const wordsMatch = (text, s) => { const words = split(text); return split(s).every(q => words.some(w => w.startsWith(q))) }
// rank: query words that are whole words of the English name count most ("black m" → the M size first)
const exactScore = (text, s) => { const words = split(text); return split(s).filter(q => words.includes(q)).length }

export function QuickSearch({ pages }) {
  const { db, ix } = useData()
  const nav = useNavigate()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef()

  useEffect(() => {
    const onKey = e => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setOpen(o => !o) }
    }
    const onOpen = () => setOpen(true)
    window.addEventListener('keydown', onKey)
    window.addEventListener('open-quick-search', onOpen)
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('open-quick-search', onOpen) }
  }, [])
  useEffect(() => { if (open) { setQ(''); setActive(0); setTimeout(() => inputRef.current?.focus(), 0) } }, [open])

  const results = useMemo(() => {
    const s = q.trim().toLowerCase()
    const out = []
    const add = (group, list) => list.forEach(r => out.push({ ...r, group }))
    const pageHits = pages.filter(([, label]) => !s || wordsMatch(label, s))
    add('Pages', pageHits.slice(0, s ? 4 : 8).map(([to, label]) => ({ key: 'p' + to, icon: 'page', label, to })))
    if (!s) return out
    add('Items', db.items.filter(i => i.ean === s || i.id.toLowerCase() === s || wordsMatch(`${i.name} ${i.name_es}`, s) || (s.length > 3 && `${i.sku || ''} ${i.variant_sku || ''}`.toLowerCase().includes(s)))
      .sort((a, b) => exactScore(b.name, s) - exactScore(a.name, s))
      .slice(0, 5).map(i => ({ key: 'i' + i.id, icon: i.item_type === 'Component' ? 'box' : 'scissors', label: i.name, sub: `${i.id} · ${i.ean}`, to: `/items?open=${i.id}` })))
    add('Work orders', db.work_orders.filter(w => idMatches(w.id, s) || (['planned', 'in_progress'].includes(w.status) && wordsMatch(ix.items.get(w.item_id)?.name, s)))
      .sort((a, b) => b.id.localeCompare(a.id)).slice(0, 4)
      .map(w => ({ key: 'w' + w.id, icon: 'scissors', label: `${w.id} · ${w.qty_planned} ${ix.items.get(w.item_id)?.name || ''}`, sub: w.status.replace('_', ' '), to: `/production?open=${w.id}` })))
    add('Sales', db.sales.filter(x => idMatches(x.id, s) || (x.status === 'placed' && wordsMatch(ix.customers.get(x.customer_id)?.name, s)))
      .sort((a, b) => (b.order_date || '').localeCompare(a.order_date || '')).slice(0, 4)
      .map(x => ({ key: 's' + x.id, icon: 'cart', label: `${x.id} · ${ix.customers.get(x.customer_id)?.name || ''}`, sub: x.status, to: `/sales?open=${x.id}` })))
    add('Purchase orders', db.purchase_orders.filter(p => idMatches(p.id, s) || (['draft', 'sent', 'partial'].includes(p.status) && wordsMatch(ix.suppliers.get(p.supplier_id)?.name, s)))
      .sort((a, b) => b.id.localeCompare(a.id)).slice(0, 4)
      .map(p => ({ key: 'o' + p.id, icon: 'truck', label: `${p.id} · ${ix.suppliers.get(p.supplier_id)?.name || ''}`, sub: p.status, to: `/purchasing?tab=pos&open=${p.id}` })))
    add('Customers', db.customers.filter(c => c.id.toLowerCase() === s || wordsMatch(c.name, s)).slice(0, 3)
      .map(c => ({ key: 'c' + c.id, icon: 'user', label: c.name, sub: `${c.id} · ${c.price_list}`, to: `/customers?open=${c.id}` })))
    add('Suppliers', db.suppliers.filter(x => wordsMatch(x.name, s)).slice(0, 3)
      .map(x => ({ key: 'u' + x.id, icon: 'truck', label: x.name, sub: `${x.id} · lead time ${x.lead_time_days} d`, to: '/purchasing?tab=suppliers' })))
    return out
  }, [q, db, ix, pages])

  useEffect(() => { setActive(0) }, [q])
  if (!open) return null
  const go = r => { if (!r) return; setOpen(false); nav(r.to) }
  const onKeyDown = e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, results.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); go(results[active]) }
    else if (e.key === 'Escape') setOpen(false)
  }
  let lastGroup = null
  return (
    <div className="qs-bg" onMouseDown={e => e.target === e.currentTarget && setOpen(false)}>
      <div className="qs" role="dialog" aria-label="Quick search">
        <div className="qs-input"><Icon name="search" size={18} />
          <input ref={inputRef} value={q} onChange={e => setQ(e.target.value)} onKeyDown={onKeyDown}
            placeholder="Search pages, items, WO-36, SO-2, customers, suppliers…" aria-label="Search" />
          <kbd>esc</kbd>
        </div>
        <div className="qs-list" role="listbox">
          {results.length === 0 && <div className="qs-empty muted">No matches for “{q}”.</div>}
          {results.map((r, k) => {
            const head = r.group !== lastGroup ? <div className="qs-group" key={'g' + r.group}>{r.group}</div> : null
            lastGroup = r.group
            return [head, (
              <div key={r.key} role="option" aria-selected={k === active} className={'qs-row' + (k === active ? ' on' : '')}
                onMouseEnter={() => setActive(k)} onMouseDown={e => { e.preventDefault(); go(r) }}>
                <span className="qs-ic"><Icon name={r.icon} /></span>
                <span className="qs-label">{r.label}</span>
                {r.sub && <span className="qs-sub muted small">{r.sub}</span>}
              </div>
            )]
          })}
        </div>
        <div className="qs-foot muted small"><span><kbd>↑</kbd><kbd>↓</kbd> move</span><span><kbd>↵</kbd> open</span><span><kbd>{shortcutLabel}</kbd> toggle</span></div>
      </div>
    </div>
  )
}

// Topbar trigger button
export function QuickSearchButton() {
  return (
    <button className="qs-trigger" onClick={() => window.dispatchEvent(new Event('open-quick-search'))}>
      <Icon name="search" size={15} /><span>Search…</span><kbd>{shortcutLabel}</kbd>
    </button>
  )
}

