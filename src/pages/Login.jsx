import { useState } from 'react'
import { supabase } from '../lib/supabase.js'

// Photos: free to use under the Unsplash License (https://unsplash.com/license), loaded from Unsplash's CDN.
const img = (id, w) => `https://images.unsplash.com/${id}?auto=format&fit=crop&w=${w}&q=70`
const HERO = img('photo-1741176505800-caaa3a52631a', 1400)          // sewing floor
const TILES = [
  { src: img('photo-1759572095384-1a7e646d0d4f', 500), alt: 'Two folded cotton T-shirts with cotton bolls' },
  { src: img('photo-1606501126768-b78d4569d3f9', 500), alt: 'Hands guiding fabric through a sewing machine' },
  { src: img('photo-1562157873-818bc0726f68', 500), alt: 'Folded T-shirts in six colors' },
]

// Welcome page: sign in / create account. Teammates enter the team code to get staff access;
// anyone else who signs up becomes a customer of the online pickup portal.
export default function Login() {
  const [mode, setMode] = useState('signin')
  const [f, setF] = useState({ email: '', password: '', name: '', code: '' })
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)
  const set = k => e => setF({ ...f, [k]: e.target.value })
  const switchTo = m => { setMode(m); setMsg(null) }

  const submit = async e => {
    e.preventDefault(); setBusy(true); setMsg(null)
    if (mode === 'signin') {
      const { error } = await supabase.auth.signInWithPassword({ email: f.email.trim(), password: f.password })
      if (error) setMsg({ tone: 'error', text: error.message })
    } else {
      const { data, error } = await supabase.auth.signUp({
        email: f.email.trim(), password: f.password,
        options: { data: { full_name: f.name.trim(), team_code: f.code.trim() } },
      })
      if (error) setMsg({ tone: 'error', text: error.message })
      else if (!data.session) setMsg({ tone: 'ok', text: 'Account created. Check your email to confirm it, then sign in.' })
    }
    setBusy(false)
  }

  return (
    <div className="welcome">
      <section className="welcome-hero" style={{ '--hero': `url(${HERO})` }}>
        <div className="welcome-brand"><div className="brand-logo">TM</div><span>Textiles Move</span></div>
        <div className="welcome-copy">
          <div className="welcome-eyebrow">ERP · Lima, Perú</div>
          <h1>Peruvian cotton, <em>run on one system</em></h1>
          <p>Inventory, production, purchasing and sales for a knitwear maker in Lima — one shared database, updated live for every user.</p>
        </div>
        <ul className="welcome-facts">
          <li><b>2005</b><span>Founded</span></li>
          <li><b>20,000</b><span>Tees a month capacity</span></li>
          <li><b>100%</b><span>Made in Pachacámac</span></li>
        </ul>
        <div className="welcome-tiles">
          {TILES.map(t => <img key={t.src} src={t.src} alt={t.alt} loading="lazy" onError={e => { e.currentTarget.style.visibility = 'hidden' }} />)}
        </div>
        <a className="welcome-credit" href="https://unsplash.com/license" target="_blank" rel="noreferrer">Photos: Unsplash</a>
      </section>

      <section className="welcome-panel">
        <div className={'welcome-card' + (mode === 'signup' ? ' wide' : '')}>
          <h2>{mode === 'signin' ? 'Welcome back' : 'Create your account'}</h2>
          <p className="muted">{mode === 'signin' ? 'Sign in to the Textiles Move ERP.' : 'One login per person, so every transaction records who made it.'}</p>
          <div className="seg" role="tablist">
            <button type="button" role="tab" aria-selected={mode === 'signin'} className={mode === 'signin' ? 'on' : ''} onClick={() => switchTo('signin')}>Sign in</button>
            <button type="button" role="tab" aria-selected={mode === 'signup'} className={mode === 'signup' ? 'on' : ''} onClick={() => switchTo('signup')}>Create account</button>
          </div>
          <form onSubmit={submit} className={mode === 'signup' ? 'two' : ''}>
            {mode === 'signup' && <label className="field"><span className="field-label">Full name</span><input autoComplete="name" value={f.name} onChange={set('name')} required /></label>}
            <label className="field"><span className="field-label">Email</span><input type="email" autoComplete="email" value={f.email} onChange={set('email')} required /></label>
            <label className="field"><span className="field-label">Password</span><input type="password" autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} minLength={6} value={f.password} onChange={set('password')} required placeholder={mode === 'signup' ? 'At least 6 characters' : undefined} /></label>
            {mode === 'signup' && <>
              <label className="field"><span className="field-label">Team code <span className="muted">(staff only)</span></span>
                <input value={f.code} onChange={set('code')} placeholder="Blank if you're a customer" autoComplete="off" /></label>
              <div className="welcome-roles">
                <div><b>Teammates</b><span>enter the team code → full ERP access</span></div>
                <div><b>Customers</b><span>leave it blank → pickup portal</span></div>
              </div>
            </>}
            {msg && <p className={msg.tone === 'error' ? 'error-text' : 'pos'}>{msg.text}</p>}
            <button className="btn primary welcome-submit" disabled={busy}>{busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Create account'}</button>
          </form>
          <p className="muted small welcome-switch">
            {mode === 'signin' ? <>New here? <button type="button" className="link-btn" onClick={() => switchTo('signup')}>Create an account</button></>
              : <>Already have an account? <button type="button" className="link-btn" onClick={() => switchTo('signin')}>Sign in</button></>}
          </p>
        </div>
        <p className="muted small welcome-foot">Built by Team 1 · BYU GSCM</p>
      </section>
    </div>
  )
}
