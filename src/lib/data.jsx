// =====================================================================
// data.jsx — loads the ERP data from Supabase, keeps it live for every
// logged-in user (realtime), and runs business transactions (rpc calls).
// =====================================================================
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { supabase } from './supabase.js'
import { index } from './calc.js'

const STAFF_TABLES = ['settings', 'locations', 'suppliers', 'items', 'bom', 'stock', 'customers', 'profiles', 'sales', 'sales_lines',
  'returns', 'return_lines', 'purchase_orders', 'po_lines', 'po_receipts', 'supplier_payments', 'work_orders', 'wo_components',
  'wo_issues', 'inv_moves', 'activity']
const CUSTOMER_TABLES = ['settings', 'locations', 'items', 'bom', 'stock', 'customers', 'sales', 'sales_lines']

// Supabase returns at most 1000 rows per request, so page through big tables
// stable order is required for paging; most tables have an "id" column
const ORDER = { settings: ['key'], stock: ['item_id', 'location_id'], bom: ['parent_id', 'component_id'] }
async function fetchAll(table) {
  if (table === 'activity') {
    // the newest 400 lines are plenty for the Activity page; an older database without the
    // table (02_logic.sql not re-run yet) just shows an empty feed instead of breaking the app
    const { data, error } = await supabase.from('activity').select('*').order('id', { ascending: false }).limit(400)
    return error ? [] : data
  }
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

// Where each document type opens (used by the "Open" button on notifications)
export function docLink(id) {
  if (typeof id !== 'string') return null
  if (id.startsWith('WO-')) return `/production?open=${id}`
  if (id.startsWith('SO-') || id.startsWith('POS-')) return `/sales?open=${id}`
  if (id.startsWith('PO-')) return `/purchasing?tab=pos&open=${id}`
  if (id.startsWith('RT-')) return '/returns'
  if (id.startsWith('TR-') || id.startsWith('ADJ-')) return '/inventory?tab=moves'
  return null
}

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
  const [online, setOnline] = useState([])          // staff signed in right now: [{ id, name, page, me }]
  const dbRef = useRef(null); dbRef.current = db

  // to = optional link shown as an "Open" button on the notification
  const toast = useCallback((msg, tone = 'ok', to = null) => {
    const id = Math.random()
    setToasts(t => [...t, { id, msg, tone, to }])
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), tone === 'error' ? 9000 : to ? 7000 : 4500)
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

  // A teammate's transaction (a new activity line by someone else) → short notice on everyone else's screen.
  // Lines that arrive together (e.g. a return plus its exchange sale) become one notice.
  const pending = useRef([]), pendTimer = useRef(null)
  const teammateDid = useCallback(row => {
    if (!row || row.user_id === profile?.id) return
    pending.current.push(row)
    clearTimeout(pendTimer.current)
    pendTimer.current = setTimeout(() => {
      const rows = pending.current; pending.current = []
      const p = (dbRef.current?.profiles || []).find(x => x.id === rows[0].user_id)
      const who = (p?.full_name || p?.email || 'A teammate').trim()
      toast(`${who} ${rows[0].summary}${rows.length > 1 ? ` (+${rows.length - 1} more)` : ''}`, 'live', docLink(rows[0].doc_id) || '/activity')
    }, 700)
  }, [profile?.id, toast])

  // first load + realtime: any change by anyone triggers a refresh for everyone
  useEffect(() => {
    reload()
    let ch = supabase.channel('erp-live')
      .on('postgres_changes', { event: '*', schema: 'public' }, () => {
        clearTimeout(timer.current)
        timer.current = setTimeout(reload, 400)
      })
    if (isStaff) ch = ch.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'activity' }, ({ new: row }) => teammateDid(row))
    ch.subscribe(status => setLive(status === 'SUBSCRIBED'))
    if (import.meta.env.DEV) window.__teammateDid = teammateDid     // dev only: simulate a teammate's transaction
    return () => { clearTimeout(timer.current); supabase.removeChannel(ch) }
  }, [reload, isStaff, teammateDid])

  // Who's online: every staff screen joins a presence channel and says which page it's on.
  const page = useLocation().pathname
  const presence = useRef(null)
  useEffect(() => {
    if (!isStaff || !profile?.id) return
    const ch = supabase.channel('erp-presence', { config: { presence: { key: profile.id } } })
    const sync = () => {
      const state = ch.presenceState()
      setOnline(Object.entries(state).map(([id, metas]) => {
        const m = [...metas].sort((a, b) => (b.at || 0) - (a.at || 0))[0] || {}
        return { id, name: m.name || 'Teammate', page: m.page || '/', tabs: metas.length, me: id === profile.id }
      }).sort((a, b) => b.me - a.me || a.name.localeCompare(b.name)))
    }
    ch.on('presence', { event: 'sync' }, sync).subscribe(status => {
      if (status === 'SUBSCRIBED') { presence.current = ch; ch.track({ name: (profile.full_name || profile.email || '').trim(), page: location.hash.slice(1) || '/', at: Date.now() }) }
    })
    if (import.meta.env.DEV) window.__presence = list => setOnline(list)   // dev only: simulate teammates online
    return () => { presence.current = null; supabase.removeChannel(ch) }
  }, [isStaff, profile?.id, profile?.full_name, profile?.email])
  useEffect(() => {
    presence.current?.track({ name: (profile?.full_name || profile?.email || '').trim(), page, at: Date.now() })
  }, [page, profile?.full_name, profile?.email])

  // Run a business transaction. Shows the error in plain words if the database refuses it,
  // and (for staff) opens the "ripple" panel showing every module the transaction touched.
  const call = useCallback(async (fn, args, { success, showRipple = true } = {}) => {
    // remember the newest ledger / stock-move ids so we can show only what THIS transaction created
    const maxId = async t => (await supabase.from(t).select('id').order('id', { ascending: false }).limit(1)).data?.[0]?.id || 0
    const [gl0, mv0] = isStaff && showRipple ? await Promise.all([maxId('ledger'), maxId('inv_moves')]) : [0, 0]
    const { data, error } = await supabase.rpc(fn, args)
    if (error) { toast(error.message, 'error'); return null }
    if (success) toast(typeof success === 'function' ? success(data) : success, 'ok', docLink(data?.id))
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
  const value = { db, ix, version, reload, call, toast, toasts, ripple, setRipple, live, lastSync, error, profile, isStaff, online }
  return <DataCtx.Provider value={value}>{children}</DataCtx.Provider>
}
