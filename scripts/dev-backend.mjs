// Local stand-in for Supabase (auth + REST + RPC) on top of the local test database.
// ONLY for testing the app on a laptop with Postgres installed — the real site uses Supabase.
//   bash scripts/test/run.sh        # builds the tm_erp_test database
//   node scripts/dev-backend.mjs    # serves http://localhost:54321
//   VITE_SUPABASE_URL=http://localhost:54321 VITE_SUPABASE_ANON_KEY=dev npx vite
import http from 'node:http'
import pg from 'pg'

// Supabase (PostgREST) returns numeric and bigint as JSON numbers; do the same
pg.types.setTypeParser(1700, v => (v === null ? null : parseFloat(v)))
pg.types.setTypeParser(1082, v => v)   // date -> 'yyyy-mm-dd' like PostgREST
pg.types.setTypeParser(20, v => (v === null ? null : Number(v)))
const pool = new pg.Pool({ database: process.env.PGDATABASE || 'tm_erp_test' })
const PORT = 54321
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url')
const jwt = u => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: u.id, email: u.email, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 86400 })}.dev`
const userFromToken = h => { try { return JSON.parse(Buffer.from((h || '').replace('Bearer ', '').split('.')[1], 'base64url')).sub } catch { return null } }
const session = u => ({ access_token: jwt(u), token_type: 'bearer', expires_in: 86400, expires_at: Math.floor(Date.now() / 1000) + 86400, refresh_token: 'r-' + u.id,
  user: { id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email, user_metadata: u.raw_user_meta_data || {}, app_metadata: {}, created_at: new Date().toISOString() } })

async function asUser(uid, fn) {
  const c = await pool.connect()
  try {
    await c.query('begin')
    await c.query("select set_config('request.jwt.claim.sub', $1, true)", [uid || ''])
    await c.query('set local role authenticated')
    const r = await fn(c)
    await c.query('commit')
    return r
  } catch (e) { await c.query('rollback'); throw e } finally { c.release() }
}

const send = (res, code, body, headers = {}) => {
  res.writeHead(code, { 'content-type': 'application/json', ...cors, ...headers }); res.end(body === undefined ? '' : JSON.stringify(body))
}
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS', 'access-control-expose-headers': 'content-range' }
const body = req => new Promise(r => { let d = ''; req.on('data', c => (d += c)); req.on('end', () => r(d ? JSON.parse(d) : {})) })
const ident = s => '"' + s.replace(/"/g, '') + '"'

await pool.query('grant select on all tables in schema public to authenticated')

http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204)
  const url = new URL(req.url, 'http://x')
  try {
    // ---------- auth ----------
    if (url.pathname === '/auth/v1/signup') {
      const b = await body(req)
      const ex = await pool.query('select 1 from auth.users where email=$1', [b.email])
      if (ex.rowCount) return send(res, 422, { msg: 'User already registered', error_code: 'user_already_exists' })
      const u = (await pool.query('insert into auth.users(email, raw_user_meta_data) values ($1,$2) returning *', [b.email, b.data || {}])).rows[0]
      await pool.query('insert into auth.dev_passwords values ($1,$2)', [b.email, b.password])
      return send(res, 200, session(u))
    }
    if (url.pathname === '/auth/v1/token') {
      const b = await body(req)
      if (url.searchParams.get('grant_type') === 'refresh_token') {
        const u = (await pool.query('select * from auth.users where id=$1', [b.refresh_token.slice(2)])).rows[0]
        return u ? send(res, 200, session(u)) : send(res, 400, { error: 'invalid_grant', error_description: 'Invalid refresh token' })
      }
      const u = (await pool.query('select u.* from auth.users u join auth.dev_passwords p using (email) where u.email=$1 and p.password=$2', [b.email, b.password])).rows[0]
      return u ? send(res, 200, session(u)) : send(res, 400, { error: 'invalid_grant', error_description: 'Invalid login credentials', msg: 'Invalid login credentials' })
    }
    if (url.pathname === '/auth/v1/user') {
      const u = (await pool.query('select * from auth.users where id=$1', [userFromToken(req.headers.authorization)])).rows[0]
      return u ? send(res, 200, session(u).user) : send(res, 401, { msg: 'no user' })
    }
    if (url.pathname === '/auth/v1/logout') return send(res, 204)

    const uid = userFromToken(req.headers.authorization)
    // ---------- rpc ----------
    const rpc = url.pathname.match(/^\/rest\/v1\/rpc\/(\w+)$/)
    if (rpc) {
      const fn = rpc[1], args = await body(req)
      const meta = (await pool.query(`select proargnames, proretset, prorettype::regtype::text rt,
          array(select format_type(t, null) from unnest(proargtypes) t) types from pg_proc where proname=$1 and pronamespace='public'::regnamespace`, [fn])).rows[0]
      if (!meta) return send(res, 404, { message: `function ${fn} not found` })
      const names = meta.proargnames || []
      const used = names.map((n, i) => [n, meta.types[i]]).filter(([n]) => n in args)
      const call = `${ident(fn)}(${used.map(([n, t], i) => `${ident(n)} => $${i + 1}::${t}`).join(', ')})`
      const vals = used.map(([n, t]) => (t === 'jsonb' ? JSON.stringify(args[n]) : args[n]))
      const out = await asUser(uid, c => c.query(meta.proretset ? `select * from ${call}` : `select ${call} as v`, vals))
      if (meta.proretset) return send(res, 200, out.rows)
      return send(res, 200, meta.rt === 'void' ? null : out.rows[0].v)
    }
    // ---------- table select ----------
    const tbl = url.pathname.match(/^\/rest\/v1\/(\w+)$/)
    if (tbl && req.method === 'GET') {
      const where = [], vals = []
      let order = '', limit = '', offset = ''
      for (const [k, v] of url.searchParams) {
        if (k === 'select') continue
        if (k === 'order') { order = ' order by ' + v.split(',').map(o => { const [c, d] = o.split('.'); return ident(c) + (d === 'desc' ? ' desc' : '') }).join(','); continue }
        if (k === 'limit') { limit = ' limit ' + Number(v); continue }
        if (k === 'offset') { offset = ' offset ' + Number(v); continue }
        const [op, ...rest] = v.split('.'); const val = rest.join('.')
        if (op === 'in') { const list = val.replace(/^\(|\)$/g, '').split(',').map(x => x.replace(/^"|"$/g, '')); vals.push(list); where.push(`${ident(k)}::text = any($${vals.length})`) }
        else { const sql = { eq: '=', gt: '>', lt: '<', gte: '>=', lte: '<=', ilike: 'ilike', neq: '<>' }[op]; vals.push(val.replace(/\*/g, '%')); where.push(`${ident(k)}${['gt', 'lt', 'gte', 'lte'].includes(op) ? '' : '::text'} ${sql} $${vals.length}`) }
      }
      const r = await asUser(uid, c => c.query(`select * from ${ident(tbl[1])}${where.length ? ' where ' + where.join(' and ') : ''}${order}${limit}${offset}`, vals))
      if ((req.headers.accept || '').includes('vnd.pgrst.object')) return r.rows.length === 1 ? send(res, 200, r.rows[0]) : send(res, 406, { message: 'not one row' })
      return send(res, 200, r.rows)
    }
    send(res, 404, { message: 'not implemented in dev backend: ' + req.method + ' ' + url.pathname })
  } catch (e) {
    send(res, 400, { message: e.message, code: e.code })
  }
}).listen(PORT, () => console.log(`dev backend on http://localhost:${PORT} (database ${pool.options.database})`))
