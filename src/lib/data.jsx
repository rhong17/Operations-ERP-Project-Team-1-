// =====================================================================
// data.jsx — loads the ERP data from Supabase, keeps it live for every
// logged-in user (realtime), and runs business transactions (rpc calls).
// =====================================================================
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from './supabase.js'
import { index } from './calc.js'

const STAFF_TABLES = ['settings', 'locations', 'suppliers', 'items', 'bom', 'stock', 'customers', 'profiles', 'sales', 'sales_lines',
  'returns', 'return_lines', 'purchase_orders', 'po_lines', 'po_receipts', 'supplier_payments', 'work_orders', 'wo_components',
  'wo_issues', 'inv_moves']
const CUSTOMER_TABLES = ['settings', 'locations', 'items', 'bom', 'stock', 'customers', 'sales', 'sales_lines']

// Supabase returns at most 1000 rows per request, so page through big tables
// stable order is required for paging; most tables have an "id" column
const ORDER = { settings: ['key'], stock: ['item_id', 'location_id'], bom: ['parent_id', 'component_id'] }
async function fetchAll(table) {
  const out = []
  for (let from = 0; ; from += 1000) {
    let q = supabase.from(table).select('*')
    for (const col of ORDER[table] || ['id']) q = q.order(col)
    const { data, error } = await q.range(from, from + 999)
    if (error) throw new Error(`${table}: ${error.message}`)
    out.push(...data)
    if (data.length < 1000) return out
  }
}

const DataCtx = createContext(null)
export const useData = () => useContext(DataCtx)

export function DataProvider({ profile, children }) {
  const [db, setDb] = useState(null)
  const [error, setError] = useState(null)
  const [version, setVersion] = useState(0)        // bumps on every reload (reports re-run on change)
  const [toasts, setToasts] = useState([])
  const [ripple, setRipple] = useState(null)
  const [live, setLive] = useState(false)
  const [lastSync, setLastSync] = useState(null)
  const timer = useRef(null)
  const isStaff = profile?.role === 'staff'

  const toast = useCallback((msg, tone = 'ok') => {
    const id = Math.random()
    setToasts(t => [...t, { id, msg, tone }])
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), tone === 'error' ? 9000 : 4500)
  }, [])

  const reload = useCallback(async () => {
    try {
      const tables = isStaff ? STAFF_TABLES : CUSTOMER_TABLES
      const results = await Promise.all(tables.map(fetchAll))
      const next = Object.fromEntries(tables.map((t, i) => [t, results[i]]))
      // Show English names everywhere; keep the company's original Spanish name as name_es
      for (const t of ['items', 'locations']) for (const r of next[t] || []) { r.name_es = r.name; r.name = r.name_en || r.name }
      setDb(next); setVersion(v => v + 1); setLastSync(new Date()); setError(null)
    } catch (e) { setError(e.message) }
  }, [isStaff])

  // first load + realtime: any change by anyone triggers a refresh for everyone
  useEffect(() => {
    reload()
    const ch = supabase.channel('erp-live')
      .on('postgres_changes', { event: '*', schema: 'public' }, () => {
        clearTimeout(timer.current)
        timer.current = setTimeout(reload, 400)
      })
      .subscribe(status => setLive(status === 'SUBSCRIBED'))
    return () => { clearTimeout(timer.current); supabase.removeChannel(ch) }
  }, [reload])

  // Run a business transaction. Shows the error in plain words if the database refuses it,
  // and (for staff) opens the "ripple" panel showing every module the transaction touched.
  const call = useCallback(async (fn, args, { success, showRipple = true } = {}) => {
    // remember the newest ledger / stock-move ids so we can show only what THIS transaction created
    const maxId = async t => (await supabase.from(t).select('id').order('id', { ascending: false }).limit(1)).data?.[0]?.id || 0
    const [gl0, mv0] = isStaff && showRipple ? await Promise.all([maxId('ledger'), maxId('inv_moves')]) : [0, 0]
    const { data, error } = await supabase.rpc(fn, args)
    if (error) { toast(error.message, 'error'); return null }
    if (success) toast(typeof success === 'function' ? success(data) : success)
    await reload()
    if (isStaff && showRipple) {
      const [mv, gl] = await Promise.all([
        supabase.from('inv_moves').select('*').gt('id', mv0).order('id').limit(60),
        supabase.from('ledger').select('*').gt('id', gl0).order('id').limit(60),
      ])
      if ((mv.data || []).length || (gl.data || []).length) setRipple({ fn, data, moves: mv.data || [], ledger: gl.data || [] })
    }
    return data ?? true
  }, [reload, toast, isStaff])

  const ix = useMemo(() => (db ? index(db) : null), [db])
  const value = { db, ix, version, reload, call, toast, toasts, ripple, setRipple, live, lastSync, error, profile, isStaff }
  return <DataCtx.Provider value={value}>{children}</DataCtx.Provider>
}
