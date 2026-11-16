import { useEffect, useState } from 'react'
import { useData } from '../lib/data.jsx'
import { supabase } from '../lib/supabase.js'
import { Page, Card, Tabs } from '../components/ui.jsx'
import { money, dt, groupBy, sum, todayLima } from '../lib/calc.js'

// The double-entry journal behind every number in Financials.
export default function Journal() {
  const { version } = useData()
  const [tab, setTab] = useState('recent')
  const [rows, setRows] = useState([])
  const [tb, setTb] = useState([])
  const [q, setQ] = useState('')
  useEffect(() => {
    let stop = false
    const query = supabase.from('ledger').select('*').order('id', { ascending: false }).limit(400)
    ;(q ? query.ilike('doc_id', `%${q}%`) : query).then(r => !stop && setRows(r.data || []))
    supabase.rpc('ledger_totals', { p_from: '2000-01-01', p_to: todayLima() }).then(r => !stop && setTb(r.data || []))
    return () => { stop = true }
  }, [version, q])
  const docs = [...groupBy(rows, 'doc_id').entries()]
  const order = ['Cash', 'Inventory', 'WIP', 'Accounts Payable', 'IGV Payable', 'Wages Payable', 'Opening Balance Equity', 'Sales Revenue', 'Sales Discounts', 'Sales Returns', 'COGS', 'Scrap Expense', 'Inventory Adjustments']
  const tbs = [...tb].sort((a, b) => order.indexOf(a.account) - order.indexOf(b.account))
  const dr = sum(tbs, t => Math.max(0, t.debit - t.credit)), cr = sum(tbs, t => Math.max(0, t.credit - t.debit))
  return (
    <Page title="Accounting Journal" subtitle="Every business event becomes balanced debits and credits — the source of the P&L"
      how={<>
        <p>This is the "single source of truth" idea of an ERP: the warehouse, the store and the workshop never type accounting entries — their transactions <b>create</b> them. Examples:</p>
        <ul>
          <li>POS sale: Dr Cash, Dr Sales Discounts, Cr Sales Revenue, Cr IGV Payable · Dr COGS, Cr Inventory</li>
          <li>PO receipt: Dr Inventory, Cr Accounts Payable · Payment: Dr Accounts Payable, Cr Cash</li>
          <li>Issue materials: Dr WIP, Cr Inventory · Complete WO: Dr Inventory (good), Dr Scrap Expense, Cr WIP, Cr Wages Payable (labour)</li>
          <li>Return: Dr Sales Returns, Dr IGV Payable, Cr Cash · Dr Inventory, Cr COGS</li>
        </ul>
        <p>The trial balance proves total debits = total credits.</p>
      </>}>
      <Tabs value={tab} onChange={setTab} tabs={[['recent', 'Journal entries'], ['tb', 'Trial balance']]} />
      {tab === 'recent' && <Card title="Latest entries (grouped by document)" actions={<input placeholder="Filter by document, e.g. POS-" value={q} onChange={e => setQ(e.target.value)} style={{ width: 220 }} />}>
        <div className="tbl-wrap"><table className="tbl compact"><thead><tr><th>When</th><th>Document</th><th>Account</th><th className="num">Debit</th><th className="num">Credit</th><th>Memo</th></tr></thead><tbody>
          {docs.slice(0, 80).flatMap(([doc, ls]) => ls.sort((a, b) => a.id - b.id).map((l, k) => <tr key={l.id} className={k === 0 ? '' : ''}>
            <td>{k === 0 ? dt(l.at) : ''}</td><td>{k === 0 ? <b>{doc}</b> : ''}</td><td style={{ paddingLeft: l.credit > 0 ? 28 : 8 }}>{l.account}</td>
            <td className="num">{Number(l.debit) ? money(l.debit) : ''}</td><td className="num">{Number(l.credit) ? money(l.credit) : ''}</td><td className="small muted">{k === 0 ? l.memo : ''}</td></tr>))}
        </tbody></table></div>
      </Card>}
      {tab === 'tb' && <Card title={`Trial balance as of ${todayLima()}`}>
        <table className="tbl" style={{ maxWidth: 640 }}><thead><tr><th>Account</th><th className="num">Debit balance</th><th className="num">Credit balance</th></tr></thead><tbody>
          {tbs.map(t => { const b = t.debit - t.credit; return <tr key={t.account}><td>{t.account}</td><td className="num">{b > 0.004 ? money(b) : ''}</td><td className="num">{b < -0.004 ? money(-b) : ''}</td></tr> })}
          <tr className="total"><td>Total {Math.abs(dr - cr) < 0.01 ? '✓ balanced' : '⚠ out of balance'}</td><td className="num">{money(dr)}</td><td className="num">{money(cr)}</td></tr>
        </tbody></table>
      </Card>}
    </Page>
  )
}
