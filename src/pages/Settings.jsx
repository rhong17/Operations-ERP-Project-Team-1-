import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useData } from '../lib/data.jsx'
import { Page, Card, Btn, Badge } from '../components/ui.jsx'
import { dt } from '../lib/calc.js'

export default function Settings() {
  const { db, call, profile } = useData()
  const [vals, setVals] = useState({})
  const [code, setCode] = useState('')
  const [confirm, setConfirm] = useState('')
  return (
    <Page title="Settings & Users" subtitle="Planning parameters, team access and demo data"
      how={<p>These values are <b>stored in the database</b> and every calculation reads them live. Change the ordering cost or holding cost and the EOQ for every item changes immediately (Purchasing → Replenishment); change the service level z and every safety stock and reorder point moves.</p>}>
      <Card title="Planning and tax settings">
        <table className="tbl"><thead><tr><th>Setting</th><th>Value</th><th>Unit</th><th>Meaning</th><th></th></tr></thead><tbody>
          {db.settings.map(s => {
            const v = vals[s.key] ?? s.value
            return <tr key={s.key}><td><b>{s.label}</b></td>
              <td><input type="number" step="any" style={{ width: 120 }} value={v} onChange={e => setVals({ ...vals, [s.key]: e.target.value })} /></td>
              <td className="small">{s.unit}</td><td className="small muted wrap-cell">{s.description}</td>
              <td>{Number(v) !== Number(s.value) && <Btn small kind="primary" onClick={async () => { if (await call('save_setting', { p_key: s.key, p_value: Number(v) }, { success: `${s.label} saved`, showRipple: false })) setVals(x => { const y = { ...x }; delete y[s.key]; return y }) }}>Save</Btn>}</td></tr>
          })}
        </tbody></table>
        <p className="muted small">See the effect: <Link to="/purchasing?tab=replenish">Replenishment</Link> · <Link to="/mrp">MRP</Link></p>
      </Card>

      <Card title="Users and roles">
        <p className="muted">Teammates create their own login on the sign-in page with the <b>team code</b> and become staff. Everyone else who signs up is a customer of the pickup portal. You can change roles here.</p>
        <table className="tbl"><thead><tr><th>User</th><th>Role</th><th>Linked customer</th><th>Since</th><th></th></tr></thead><tbody>
          {db.profiles.map(u => <tr key={u.id}><td>{u.full_name}<div className="small muted">{u.email}</div></td><td><Badge tone={u.role === 'staff' ? 'brand' : 'grey'}>{u.role}</Badge></td>
            <td>{u.role === 'customer' ? <select value={u.customer_id || ''} onChange={e => call('set_user_role', { p_user: u.id, p_role: 'customer', p_customer: e.target.value }, { success: 'Customer link updated', showRipple: false })}>
              {db.customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select> : '—'}</td>
            <td className="nowrap">{dt(u.created_at)}</td>
            <td>{u.id !== profile.id && <Btn small onClick={() => call('set_user_role', { p_user: u.id, p_role: u.role === 'staff' ? 'customer' : 'staff' }, { success: 'Role changed', showRipple: false })}>{u.role === 'staff' ? 'Make customer' : 'Make staff'}</Btn>}</td></tr>)}
        </tbody></table>
        <div className="row gap wrap" style={{ marginTop: 12 }}>
          <input type="text" placeholder="New team code (min 6 characters)" style={{ maxWidth: 300 }} value={code} onChange={e => setCode(e.target.value)} />
          <Btn disabled={code.length < 6} onClick={async () => { if (await call('set_team_code', { p_code: code }, { success: 'Team code changed — share it privately with teammates', showRipple: false })) setCode('') }}>Change team code</Btn>
        </div>
      </Card>

      <Card title="Demo data">
        <p>Reset puts the database back to the starting dataset from the company workbook: real items, BOMs, stock count, 6 months of sales, suppliers, customers, plus generated PO and work-order history and fresh open orders dated from today. <b>Every transaction entered so far is erased.</b> Logins are kept. Use it before the demo.</p>
        <div className="row gap wrap">
          <input placeholder='Type RESET to confirm' style={{ maxWidth: 200 }} value={confirm} onChange={e => setConfirm(e.target.value)} />
          <Btn kind="danger" disabled={confirm !== 'RESET'} busyText="Reloading data…" onClick={async () => { if (await call('reset_demo', {}, { success: 'Demo data reloaded', showRipple: false })) setConfirm('') }}>Reset demo data</Btn>
        </div>
      </Card>
    </Page>
  )
}
