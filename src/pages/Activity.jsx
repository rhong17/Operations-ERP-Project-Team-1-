import { useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useData, docLink } from '../lib/data.jsx'
import { Page, Card, Badge, Empty, Stat, Avatar, userName } from '../components/ui.jsx'
import { limaDate, todayLima, dfmt, TZ } from '../lib/calc.js'

// What each kind of activity line is about (the database writes the kind with each line)
export const AREAS = {
  sale: ['Point of sale', 'green'], order: ['Sales orders', 'blue'], return: ['Returns', 'amber'],
  inventory: ['Inventory', 'grey'], purchasing: ['Purchasing', 'brand'], production: ['Production', 'brand'],
  master: ['Master data', 'grey'], admin: ['Admin', 'red'],
}
const time = ts => new Date(ts).toLocaleTimeString('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' })

// Multi-user audit trail: every transaction anyone makes, who made it and when, updated live.
export default function Activity() {
  const { db, online } = useData()
  const nav = useNavigate()
  const [who, setWho] = useState('')
  const [area, setArea] = useState('')
  const [q, setQ] = useState('')
  const rows = db.activity || []
  // lines that arrive while the page is open get a short highlight
  const firstSeen = useRef(null); if (firstSeen.current === null) firstSeen.current = rows[0]?.id ?? 0
  const name = id => userName(db, id) || 'Someone'
  const role = id => (db.profiles || []).find(p => p.id === id)?.role

  const people = useMemo(() => [...new Set(rows.map(r => r.user_id).filter(Boolean))].map(id => ({ id, name: name(id) })).sort((a, b) => a.name.localeCompare(b.name)), [rows, db.profiles])
  const shown = rows.filter(r => (!who || r.user_id === who) && (!area || r.kind === area) &&
    (!q || `${name(r.user_id)} ${r.summary} ${r.doc_id || ''}`.toLowerCase().includes(q.toLowerCase())))
  const today = todayLima()
  const todays = rows.filter(r => limaDate(r.at) === today)
  const days = []
  for (const r of shown) { const d = limaDate(r.at); if (!days.length || days[days.length - 1][0] !== d) days.push([d, []]); days[days.length - 1][1].push(r) }

  return (
    <Page title="Activity" subtitle="Every transaction, who made it and when, live for every user"
      how={<>
        <p><b>This is the multi-user side of the ERP.</b> Everyone signs in with their own login, and every transaction function in the database writes one line here with the user who ran it. Nobody types these lines, and nobody can edit or delete them.</p>
        <p>All logins share one database. When anyone posts a sale, receipt, transfer or work order, every open screen refreshes within about a second. Other staff also get a short <b>Live</b> notice, and the avatars in the top bar show who is signed in right now and which page they're on.</p>
      </>}>
      <div className="stats">
        <Stat label="Transactions today" value={todays.length} sub={todays.length ? `last at ${time(todays[0].at)}` : 'none yet today'} />
        <Stat label="People active today" value={new Set(todays.map(r => r.user_id)).size} sub="made at least one change" />
        <Stat label="Online now" value={online.length} sub={online.map(u => u.name.split(' ')[0]).join(', ') || '—'} />
      </div>
      <Card>
        <div className="row gap wrap">
          <input placeholder="Search activity…" value={q} onChange={e => setQ(e.target.value)} style={{ flex: '1 1 220px' }} />
          <select value={who} onChange={e => setWho(e.target.value)} style={{ width: 200 }}><option value="">Everyone</option>{people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
          <select value={area} onChange={e => setArea(e.target.value)} style={{ width: 180 }}><option value="">All areas</option>{Object.entries(AREAS).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}</select>
        </div>
      </Card>
      <Card>
        {shown.length === 0 ? <Empty icon="inbox" title={rows.length ? 'No matches' : 'No activity yet'}>
          {rows.length ? 'Try a different person, area or search.' : 'Transactions show up here as soon as anyone makes one: a sale, a receipt, a transfer, a work order.'}</Empty>
          : days.map(([d, list]) => <div key={d} className="act-day">
            <div className="act-date">{d === today ? 'Today' : dfmt(d)}</div>
            {list.map(r => { const to = docLink(r.doc_id); return (
              <div key={r.id} className={'act-row' + (r.id > firstSeen.current ? ' new' : '')}>
                <span className="act-time">{time(r.at)}</span>
                <Avatar id={r.user_id || 'system'} name={r.user_id ? name(r.user_id) : 'System'} size={28} />
                <div className="act-text"><b>{r.user_id ? name(r.user_id) : 'System'}</b>{role(r.user_id) === 'customer' && <span className="muted small"> (customer)</span>} {r.summary}</div>
                <Badge tone={AREAS[r.kind]?.[1] || 'grey'}>{AREAS[r.kind]?.[0] || r.kind}</Badge>
                {to ? <button className="btn small" onClick={() => nav(to)}>{r.doc_id}</button> : <span className="act-doc muted small">{r.doc_id || ''}</span>}
              </div>) })}
          </div>)}
        {rows.length >= 400 && <p className="muted small" style={{ marginTop: 10 }}>Showing the latest 400 lines.</p>}
      </Card>
    </Page>
  )
}
