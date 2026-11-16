import { Component, useEffect, useState } from 'react'
import { HashRouter, NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { supabase, configured } from './lib/supabase.js'
import { DataProvider, useData } from './lib/data.jsx'
import { Toasts, RipplePanel, LiveDot } from './components/ui.jsx'
import Dashboard from './pages/Dashboard.jsx'
import POS from './pages/POS.jsx'
import SalesOrders from './pages/SalesOrders.jsx'
import Returns from './pages/Returns.jsx'
import Inventory from './pages/Inventory.jsx'
import Production from './pages/Production.jsx'
import Purchasing from './pages/Purchasing.jsx'
import MRP from './pages/MRP.jsx'
import Finance from './pages/Finance.jsx'
import Reports from './pages/Reports.jsx'
import Journal from './pages/Journal.jsx'
import Items from './pages/Items.jsx'
import Customers from './pages/Customers.jsx'
import Settings from './pages/Settings.jsx'
import About from './pages/About.jsx'
import Portal from './pages/Portal.jsx'
import Login from './pages/Login.jsx'

export default function App() {
  const [session, setSession] = useState(undefined)
  const [profile, setProfile] = useState(null)

  useEffect(() => {
    if (!configured) return
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!session) { setProfile(null); return }
    let tries = 0, stop = false
    const load = async () => {
      const { data } = await supabase.from('profiles').select('*').eq('id', session.user.id).maybeSingle()
      if (stop) return
      if (data) setProfile(data)
      else if (tries++ < 10) setTimeout(load, 500)   // the profile is created by a database trigger right after sign-up
      else setProfile({ id: session.user.id, role: 'missing', email: session.user.email })
    }
    load()
    return () => { stop = true }
  }, [session])

  if (!configured) return <NotConfigured />
  if (session === undefined) return <div className="auth">Loading…</div>
  if (!session) return <Login />
  if (!profile) return <div className="auth">Loading your profile…</div>
  if (profile.role === 'missing') return <div className="auth"><div className="auth-card"><h1>Profile not found</h1><p>Your login exists but has no ERP profile. Ask a teammate to re-run <code>02_logic.sql</code>, then sign up again.</p><button className="btn" onClick={() => supabase.auth.signOut()}>Sign out</button></div></div>

  return (
    <HashRouter>
      <DataProvider profile={profile}>
        <Shell profile={profile} onProfile={setProfile} />
      </DataProvider>
    </HashRouter>
  )
}

const STAFF_NAV = [
  ['Overview', [['/', 'Dashboard']]],
  ['Sell', [['/pos', 'Point of Sale'], ['/sales', 'Sales Orders', 'openSO'], ['/returns', 'Returns & Exchanges'], ['/portal-preview', 'Customer Portal']]],
  ['Make & Stock', [['/inventory', 'Inventory'], ['/production', 'Production Orders', 'openWO'], ['/mrp', 'MRP']]],
  ['Buy', [['/purchasing', 'Purchasing & Suppliers', 'openPO']]],
  ['Analyze', [['/finance', 'Financials'], ['/reports', 'Reports'], ['/journal', 'Accounting Journal']]],
  ['Master data', [['/items', 'Items & BOMs'], ['/customers', 'Customers'], ['/settings', 'Settings & Users'], ['/about', 'About this system']]],
]

function Shell({ profile }) {
  const { db, error, isStaff, setRipple } = useData()
  const [menu, setMenu] = useState(false)
  const loc = useLocation()
  useEffect(() => { setMenu(false); setRipple(null) }, [loc.pathname, setRipple])
  if (error && !db) return <div className="auth"><div className="auth-card"><h1>Can't load data</h1><p className="error-text">{error}</p><p>If this is a new Supabase project, run the three SQL files first (see <b>docs/SETUP.md</b>).</p><button className="btn" onClick={() => supabase.auth.signOut()}>Sign out</button></div></div>
  if (!db) return <div className="auth">Loading ERP data…</div>

  const counts = {}
  if (isStaff) {
    counts.openSO = db.sales.filter(s => s.kind === 'SO' && s.status === 'placed').length
    counts.openWO = db.work_orders.filter(w => ['planned', 'in_progress'].includes(w.status)).length
    counts.openPO = db.purchase_orders.filter(p => ['draft', 'sent', 'partial'].includes(p.status)).length
  }

  return (
    <div className="shell">
      <aside className={'side ' + (menu ? 'open' : '')}>
        <div className="brand"><div className="brand-logo">TM</div><div><strong>Textiles Move</strong><small>ERP · Lima, Perú</small></div></div>
        {isStaff ? STAFF_NAV.map(([g, links]) => (
          <div key={g}>
            <div className="nav-group">{g}</div>
            {links.map(([to, label, c]) => (
              <NavLink key={to} to={to} end={to === '/'}>{label}{c && counts[c] ? <span className="num-tag">{counts[c]}</span> : null}</NavLink>
            ))}
          </div>
        )) : <>
          <div className="nav-group">Customer portal</div>
          <NavLink to="/" end>Shop & pickup</NavLink>
          <NavLink to="/orders">My orders</NavLink>
        </>}
      </aside>
      <div className="main">
        <header className="topbar">
          <button className="btn small menu-btn" onClick={() => setMenu(!menu)}>☰ Menu</button>
          <LiveDot />
          <span className="who">{profile.full_name || profile.email} · <b>{isStaff ? 'Staff' : 'Customer'}</b></span>
          <button className="btn small" onClick={() => supabase.auth.signOut()}>Sign out</button>
        </header>
        <PageGuard key={loc.pathname}>
        {isStaff ? (
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/pos" element={<POS />} />
            <Route path="/sales" element={<SalesOrders />} />
            <Route path="/returns" element={<Returns />} />
            <Route path="/inventory" element={<Inventory />} />
            <Route path="/production" element={<Production />} />
            <Route path="/purchasing" element={<Purchasing />} />
            <Route path="/mrp" element={<MRP />} />
            <Route path="/finance" element={<Finance />} />
            <Route path="/reports" element={<Reports />} />
            <Route path="/journal" element={<Journal />} />
            <Route path="/items" element={<Items />} />
            <Route path="/customers" element={<Customers />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/about" element={<About />} />
            <Route path="/portal-preview" element={<Portal preview />} />
            <Route path="*" element={<Navigate to="/" />} />
          </Routes>
        ) : (
          <Routes>
            <Route path="/" element={<Portal />} />
            <Route path="/orders" element={<Portal tab="orders" />} />
            <Route path="*" element={<Navigate to="/" />} />
          </Routes>
        )}
        </PageGuard>
      </div>
      <Toasts />
      <RipplePanel />
    </div>
  )
}

function NotConfigured() {
  return (
    <div className="setup">
      <h1>Textiles Move ERP — almost ready</h1>
      <p>This copy of the app is not connected to a database yet. Put your Supabase project URL and anon key in <code>src/config.js</code> (or a <code>.env</code> file), then reload.</p>
      <p>Full steps: <b>docs/SETUP.md</b> in the GitHub repository.</p>
    </div>
  )
}

// If one page crashes, keep the menu working and show the error instead of a blank screen
class PageGuard extends Component {
  state = { err: null }
  static getDerivedStateFromError(err) { return { err } }
  render() {
    if (!this.state.err) return this.props.children
    return <div className="page"><div className="card"><h1>This page hit an error</h1><p className="error-text">{String(this.state.err.message || this.state.err)}</p>
      <p className="muted">Other pages still work. Tell the team (or paste this message to your AI assistant) so it can be fixed.</p>
      <button className="btn" onClick={() => this.setState({ err: null })}>Try again</button></div></div>
  }
}
