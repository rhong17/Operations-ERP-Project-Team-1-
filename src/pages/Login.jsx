import { useState } from 'react'
import { supabase } from '../lib/supabase.js'

// Sign in / create account. Teammates enter the team code to get staff access;
// anyone else who signs up becomes a customer of the online pickup portal.
export default function Login() {
  const [mode, setMode] = useState('signin')
  const [f, setF] = useState({ email: '', password: '', name: '', code: '' })
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)
  const set = k => e => setF({ ...f, [k]: e.target.value })

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
    <div className="auth">
      <div className="auth-card">
        <div className="row gap"><div className="brand-logo">TM</div><div><h1>Textiles Move ERP</h1><div className="muted small">Lima, Perú · knitwear manufacturer</div></div></div>
        <div className="tabs" style={{ marginTop: 16 }}>
          <button className={mode === 'signin' ? 'active' : ''} onClick={() => setMode('signin')}>Sign in</button>
          <button className={mode === 'signup' ? 'active' : ''} onClick={() => setMode('signup')}>Create account</button>
        </div>
        <form onSubmit={submit}>
          {mode === 'signup' && <label className="field"><span className="field-label">Full name</span><input value={f.name} onChange={set('name')} required /></label>}
          <label className="field"><span className="field-label">Email</span><input type="email" autoComplete="email" value={f.email} onChange={set('email')} required /></label>
          <label className="field"><span className="field-label">Password</span><input type="password" autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} minLength={6} value={f.password} onChange={set('password')} required /></label>
          {mode === 'signup' && <label className="field"><span className="field-label">Team code (staff only)</span>
            <input value={f.code} onChange={set('code')} placeholder="Leave blank if you are a customer" />
            <span className="field-hint">Teammates: enter the code your team shared to get full ERP access. Customers: leave blank to use the pickup portal.</span></label>}
          {msg && <p className={msg.tone === 'error' ? 'error-text' : 'pos'}>{msg.text}</p>}
          <button className="btn primary" disabled={busy}>{busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Create account'}</button>
        </form>
      </div>
    </div>
  )
}
