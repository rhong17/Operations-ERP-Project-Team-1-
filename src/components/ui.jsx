// Shared building blocks used by every page.
import { useEffect, useMemo, useRef, useState } from 'react'
import JsBarcode from 'jsbarcode'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { useData } from '../lib/data.jsx'
import { money, qtyFmt, dt } from '../lib/calc.js'

// Page header: title, one-line subtitle, actions, and a small "How this works" button.
// The ERP explanation stays one click away instead of filling the top of every page.
export function Page({ title, subtitle, actions, how, children }) {
  const key = 'how:' + location.hash.split('?')[0]
  const [open, setOpen] = useState(() => { try { return localStorage.getItem(key) === 'open' } catch { return false } })
  const toggle = () => { setOpen(!open); try { localStorage.setItem(key, open ? 'closed' : 'open') } catch { /* ignore */ } }
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>{title}</h1>
          {subtitle && <p className="muted">{subtitle}</p>}
        </div>
        <div className="row gap wrap">
          {how && <button className={'how-btn ' + (open ? 'on' : '')} onClick={toggle} aria-expanded={open}>ⓘ How this works</button>}
          {actions}
        </div>
      </div>
      {how && open && <HowItWorks>{how}</HowItWorks>}
      {children}
    </div>
  )
}

// The explanation panel (also usable on its own inside a page)
export function HowItWorks({ children }) {
  return <div className="how"><div className="how-body">{children}</div></div>
}

export const Card = ({ title, actions, children, className = '' }) => (
  <section className={'card ' + className}>
    {(title || actions) && <div className="card-head"><h2>{title}</h2>{actions && <div className="row gap">{actions}</div>}</div>}
    {children}
  </section>
)

// "≈ US$ 1,234" for a soles amount, using the exchange rate stored in Settings (usd_rate)
export function useUsd() {
  const { db } = useData()
  const rate = Number(db?.settings?.find(s => s.key === 'usd_rate')?.value) || 0
  return n => (rate && n && !Number.isNaN(Number(n)))
    ? '≈ US$ ' + (Number(n) / rate).toLocaleString('en-US', { maximumFractionDigits: Math.abs(n / rate) < 100 ? 2 : 0 })
    : ''
}

export const Stat = ({ label, value, sub, tone, onClick, soles }) => {
  const usd = useUsd()
  return (
  <div className={'stat ' + (tone || '') + (onClick ? ' clickable' : '')} onClick={onClick}>
    <div className="stat-label">{label}</div>
    <div className="stat-value">{value}</div>
    {soles != null && usd(soles) && <div className="usd">{usd(soles)}</div>}
    {sub && <div className="stat-sub">{sub}</div>}
  </div>
  )
}

export const Badge = ({ tone = 'grey', children, title }) => <span className={'badge ' + tone} title={title}>{children}</span>

const STATUS = {
  completed: ['green', 'Completed'], placed: ['blue', 'Order Placed'], fulfilled: ['green', 'Fulfilled'], closed: ['grey', 'Closed'],
  cancelled: ['red', 'Cancelled'], draft: ['grey', 'Draft'], sent: ['blue', 'Order Sent'], partial: ['amber', 'Partly received'],
  received: ['green', 'Received'], planned: ['grey', 'Planned'], in_progress: ['amber', 'In progress'],
  Keep: ['green', 'Keep'], Watch: ['amber', 'Watch'], Replace: ['red', 'Replace'], 'No history': ['grey', 'No history'],
}
export const StatusBadge = ({ status }) => { const [t, l] = STATUS[status] || ['grey', status]; return <Badge tone={t}>{l}</Badge> }

export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map(([k, label]) => (
        <button key={k} role="tab" aria-selected={value === k} className={value === k ? 'active' : ''} onClick={() => onChange(k)}>{label}</button>
      ))}
    </div>
  )
}

export function Modal({ title, onClose, children, footer, wide }) {
  useEffect(() => {
    const k = e => e.key === 'Escape' && onClose?.()
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k)
  }, [onClose])
  return (
    <div className="modal-bg" onMouseDown={e => e.target === e.currentTarget && onClose?.()}>
      <div className={'modal ' + (wide ? 'wide' : '')} role="dialog" aria-label={title}>
        <div className="modal-head"><h2>{title}</h2><button className="icon-btn" onClick={onClose} aria-label="Close">✕</button></div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  )
}

export const Field = ({ label, hint, children, wide }) => (
  <label className={'field ' + (wide ? 'wide' : '')}>
    <span className="field-label">{label}</span>
    {children}
    {hint && <span className="field-hint">{hint}</span>}
  </label>
)

export function Btn({ children, onClick, kind = 'secondary', busyText, disabled, type = 'button', small, title }) {
  const [busy, setBusy] = useState(false)
  const run = async e => {
    if (!onClick) return
    setBusy(true)
    try { await onClick(e) } finally { setBusy(false) }
  }
  return <button type={type} title={title} className={`btn ${kind} ${small ? 'small' : ''}`} disabled={disabled || busy} onClick={run}>{busy ? (busyText || 'Working…') : children}</button>
}

// Fabric color swatch (item.color holds the company's Spanish color name)
const SWATCHES = { NEGRO: '#1b1b20', HUESO: '#e9dfc8', LILA: '#b9a0cf', CRISTAL: '#bfe0ea', SURTIDO: 'linear-gradient(135deg,#1b1b20 0 33%,#e9dfc8 33% 66%,#b9a0cf 66%)' }
const COLOR_EN = { NEGRO: 'Black', HUESO: 'Bone', LILA: 'Lilac', CRISTAL: 'Crystal blue', SURTIDO: 'Assorted' }
export const Swatch = ({ color }) => SWATCHES[color] ? <span className="swatch-chip" style={{ background: SWATCHES[color] }} title={COLOR_EN[color]} /> : null
export const ItemName = ({ item }) => item ? <span className="item-name"><Swatch color={item.color} />{item.name}</span> : null

// Opens a record when the URL has ?open=<id> (used by quick search), then removes the param.
export function useOpenParam(onOpen) {
  const [params, setParams] = useSearchParams()
  const id = params.get('open')
  useEffect(() => {
    if (!id) return
    onOpen(id)
    const next = new URLSearchParams(params); next.delete('open'); setParams(next, { replace: true })
  }, [id]) // eslint-disable-line react-hooks/exhaustive-deps
}

// Small line icons (stroke follows the text color). Keep the set tiny on purpose.
const ICONS = {
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-4.35-4.35',
  inbox: 'M22 12h-6l-2 3h-4l-2-3H2M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z',
  check: 'M22 11.08V12a10 10 0 1 1-5.93-9.14M22 4 12 14.01l-3-3',
  box: 'M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16zM3.3 7 12 12l8.7-5M12 22V12',
  file: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M8 13h8M8 17h5',
  cart: 'M9 22a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM20 22a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6',
  truck: 'M1 3h15v13H1zM16 8h4l3 3v5h-7zM5.5 21a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM18.5 21a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  user: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  page: 'M3 3h18v18H3zM3 9h18M9 21V9',
  scissors: 'M6 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM20 4 8.12 15.88M14.47 14.48 20 20M8.12 8.12 12 12',
  printer: 'M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v8H6z',
}
export const Icon = ({ name, size = 16 }) => (
  <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={ICONS[name] || ICONS.inbox} />
  </svg>
)

// Empty state: icon + message (+ optional title and action button)
export const Empty = ({ children, title, icon = 'inbox', action }) => (
  <div className="empty">
    <div className="empty-icon"><Icon name={icon} size={22} /></div>
    {title && <div className="empty-title">{title}</div>}
    <div>{children}</div>
    {action && <div className="empty-action">{action}</div>}
  </div>
)

// Grey placeholder shapes shown while the ERP data loads
export function LoadingScreen({ label = 'Loading ERP data…' }) {
  return (
    <div className="skel-shell" aria-busy="true" aria-label={label}>
      <div className="skel-side">
        <div className="skel skel-brand" />
        {Array.from({ length: 9 }, (_, i) => <div key={i} className="skel skel-nav" style={{ width: `${55 + ((i * 17) % 35)}%` }} />)}
      </div>
      <div className="skel-main">
        <div className="skel skel-title" />
        <div className="skel skel-sub" />
        <div className="skel-stats">{[0, 1, 2, 3].map(i => <div key={i} className="skel skel-stat" />)}</div>
        <div className="skel-grid"><div className="skel skel-card" /><div className="skel skel-card" /></div>
        <p className="skel-label muted small">{label}</p>
      </div>
    </div>
  )
}

export const LocationSelect = ({ value, onChange, includeQH = false, filter, allowAll }) => {
  const { db } = useData()
  return (
    <select value={value || ''} onChange={e => onChange(e.target.value)}>
      {allowAll && <option value="">All locations</option>}
      {db.locations.filter(l => (includeQH || !l.is_quality_hold) && (!filter || filter(l))).sort((a, b) => a.sort - b.sort)
        .map(l => <option key={l.id} value={l.id}>{l.id} · {l.name}</option>)}
    </select>
  )
}

// Item search box. Typing filters by name / SKU / barcode. A USB barcode scanner
// "types" the code and presses Enter, which adds the exact match immediately.
export function ItemSearch({ onPick, filter, placeholder = 'Scan barcode or search item…', autoFocus, showCamera = true, stockAt }) {
  const { db, ix, toast } = useData()
  const [q, setQ] = useState('')
  const [cam, setCam] = useState(false)
  const ref = useRef()
  const list = useMemo(() => db.items.filter(i => i.active && (!filter || filter(i))), [db.items, filter])
  const matches = useMemo(() => {
    const s = q.trim().toLowerCase(); if (!s) return []
    return list.filter(i => i.ean === s || i.name.toLowerCase().includes(s) || (i.name_es || '').toLowerCase().includes(s) || (i.sku || '').toLowerCase().includes(s) || i.id.toLowerCase() === s).slice(0, 8)
  }, [q, list])
  const [last, setLast] = useState(null)        // { item, n } — "✓ Added …" confirmation under the box
  const [pulse, setPulse] = useState(null)      // 'ok' | 'bad' flash on the scan box
  const lastTimer = useRef(), pulseTimer = useRef()
  useEffect(() => () => { clearTimeout(lastTimer.current); clearTimeout(pulseTimer.current) }, [])
  const confirm = (item, ok = true) => {
    clearTimeout(pulseTimer.current); setPulse(ok ? 'ok' : 'bad'); pulseTimer.current = setTimeout(() => setPulse(null), 700)
    if (!ok) return
    clearTimeout(lastTimer.current); setLast(l => ({ item, n: (l?.n || 0) + 1 })); lastTimer.current = setTimeout(() => setLast(null), 2600)
  }
  const findCode = code => { const c = String(code).trim(); return list.find(i => i.ean === c) || list.find(i => i.id.toLowerCase() === c.toLowerCase()) }
  const pickCode = code => {   // USB scanner or typed barcode + Enter
    const hit = findCode(code)
    scanFeedback(!!hit)
    if (hit) { onPick(hit); setQ(''); confirm(hit); return true }
    confirm(null, false); toast(`No item with barcode ${String(code).trim()}`, 'error'); return false
  }
  return (
    <div className="item-search">
      <div className="row gap">
        <input ref={ref} autoFocus={autoFocus} value={q} placeholder={placeholder} onChange={e => setQ(e.target.value)} className={pulse ? 'scan-pulse-' + pulse : ''}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); if (/^\d{6,}$/.test(q.trim())) pickCode(q); else if (matches[0]) { onPick(matches[0]); setQ('') } }
          }} />
        {showCamera && <button type="button" className="btn secondary" title="Scan with camera" onClick={() => setCam(true)}>📷 Camera</button>}
      </div>
      {matches.length > 0 && (
        <div className="dropdown">
          {matches.map(i => (
            <button type="button" key={i.id} onClick={() => { onPick(i); setQ(''); confirm(i); ref.current?.focus() }}>
              <span><ItemName item={i} /><span className="es">{i.name_es}</span></span>
              <span className="muted small">{i.ean}{stockAt ? ` · ${qtyFmt(ix.onHand(i.id, stockAt), i.uom)} here` : ''}</span>
            </button>
          ))}
        </div>
      )}
      {last && <div className="scan-added" key={last.n}><span className="scan-tick">✓</span> Added <ItemName item={last.item} /></div>}
      {cam && <CameraScanner title="Scan item" onClose={() => { setCam(false); ref.current?.focus() }}
        onResult={code => { const hit = findCode(code); if (hit) { onPick(hit); confirm(hit) } return hit ? { ok: true, item: hit } : { ok: false, text: `No item with barcode ${code}` } }} />}
    </div>
  )
}

// Scan feedback: a short beep (Web Audio, no sound files) + a vibration on phones.
// Sound can be switched off from the scanner window; the choice is remembered on this device.
let audioCtx = null
export function scanFeedback(ok) {
  try { navigator.vibrate?.(ok ? 40 : [70, 50, 70]) } catch { /* not supported */ }
  try { if (localStorage.getItem('scanSound') === 'off') return } catch { /* storage blocked */ }
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)()
    const t = audioCtx.currentTime
    const tone = (freq, from, len, type, vol) => {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain()
      o.type = type; o.frequency.value = freq
      g.gain.setValueAtTime(0.0001, t + from); g.gain.exponentialRampToValueAtTime(vol, t + from + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t + from + len)
      o.connect(g).connect(audioCtx.destination); o.start(t + from); o.stop(t + from + len + 0.02)
    }
    if (ok) { tone(1320, 0, 0.09, 'sine', 0.16); tone(1760, 0.07, 0.11, 'sine', 0.13) }   // bright two-note "beep-beep"
    else tone(170, 0, 0.32, 'square', 0.07)                                                 // low buzz
  } catch { /* audio not available */ }
}

// Phone / laptop camera scanning (Code 128, EAN, UPC, QR).
// onResult(code) returns { ok, item?, text? } (or true/false).
// continuous = keep the camera open and keep a running tally (POS); otherwise close after one good scan.
export function CameraScanner({ onResult, onClose, continuous = false, title = 'Scan barcode' }) {
  const video = useRef(), stage = useRef(), frame = useRef()
  const cb = useRef(onResult); cb.current = onResult
  const closeRef = useRef(onClose); closeRef.current = onClose
  const [err, setErr] = useState(null)
  const [ready, setReady] = useState(false)
  const [flash, setFlash] = useState(null)           // 'ok' | 'bad' | null
  const [status, setStatus] = useState({ kind: 'idle', text: 'Line up the barcode inside the box — it scans automatically.' })
  const [tally, setTally] = useState([])             // [{ key, item, label, count }]
  const [sound, setSound] = useState(() => { try { return localStorage.getItem('scanSound') !== 'off' } catch { return true } })
  const [engine, setEngine] = useState(null)        // 'fast' (built-in detector) | 'standard' (WebAssembly engine)
  const [torch, setTorch] = useState(null)          // { on, track } when the camera has a flashlight
  const total = tally.reduce((a, t) => a + t.count, 0)

  useEffect(() => {
    const k = e => e.key === 'Escape' && closeRef.current?.()
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k)
  }, [])
  useEffect(() => {
    let stream, raf, stopped = false, lastCode = '', lastAt = 0, flashTimer
    ;(async () => {
      try {
        // Sharper picture = faster reads: ask for HD from the back camera with continuous focus.
        stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: {
          facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 },
          advanced: [{ focusMode: 'continuous' }, { exposureMode: 'continuous' }] } })
        if (stopped) { stream.getTracks().forEach(t => t.stop()); return }
        const track = stream.getVideoTracks()[0]
        try { if (track.getCapabilities?.().focusMode?.includes('continuous')) await track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }) } catch { /* not supported */ }
        setTorch(track.getCapabilities?.().torch ? { on: false, track } : null)
        video.current.srcObject = stream
        await video.current.play().catch(() => {})
        // Barcode engine: the browser's built-in detector when it reads Code 128 (Chrome on Android / Mac /
        // Windows), otherwise the same API backed by zxing-cpp compiled to WebAssembly (Safari, iPhone,
        // Firefox). The .wasm file is bundled with the site, so nothing loads from outside.
        const fmts = ['code_128', 'ean_13', 'ean_8', 'upc_a', 'upc_e', 'qr_code']
        const native = 'BarcodeDetector' in window ? (await window.BarcodeDetector.getSupportedFormats().catch(() => [])).filter(f => fmts.includes(f)) : []
        let detector
        if (native.includes('code_128')) { detector = new window.BarcodeDetector({ formats: native }); setEngine('fast') }
        else {
          const [{ BarcodeDetector: Wasm, setZXingModuleOverrides }, { default: wasmUrl }] = await Promise.all([
            import('barcode-detector/ponyfill'), import('zxing-wasm/reader/zxing_reader.wasm?url')])
          setZXingModuleOverrides({ locateFile: (path, prefix) => path.endsWith('.wasm') ? wasmUrl : prefix + path })
          detector = new Wasm({ formats: fmts }); setEngine('standard')
        }
        if (stopped) return
        // Only the highlighted box is read: each frame, the part of the video under the box is copied to a
        // canvas and only that is searched — so a label elsewhere in view is ignored (and reads are faster).
        // For the WebAssembly engine, every other try also makes that crop grey and contrast-boosted:
        // rescues dim, slightly blurred or tilted labels (done in plain JS so older Safari works too).
        const cropCanvas = document.createElement('canvas'), cctx = cropCanvas.getContext('2d', { willReadFrequently: true })
        const boxCrop = (v, boost, maxW) => {
          const st = stage.current?.getBoundingClientRect(), fr = frame.current?.getBoundingClientRect()
          if (!st || !fr || !st.width) return v
          // the video is shown with object-fit: cover — undo that scale and offset to get video pixels
          const s = Math.max(st.width / v.videoWidth, st.height / v.videoHeight)
          const ox = (st.width - v.videoWidth * s) / 2, oy = (st.height - v.videoHeight * s) / 2
          const sx = Math.max(0, (fr.left - st.left - ox) / s), sy = Math.max(0, (fr.top - st.top - oy) / s)
          const sw = Math.min(v.videoWidth - sx, fr.width / s), sh = Math.min(v.videoHeight - sy, fr.height / s)
          const scale = Math.min(1, maxW / sw)
          cropCanvas.width = Math.max(1, Math.round(sw * scale)); cropCanvas.height = Math.max(1, Math.round(sh * scale))
          cctx.drawImage(v, sx, sy, sw, sh, 0, 0, cropCanvas.width, cropCanvas.height)
          if (!boost) return cropCanvas
          const img = cctx.getImageData(0, 0, cropCanvas.width, cropCanvas.height), d = img.data
          for (let i = 0; i < d.length; i += 4) {
            const g = Math.max(0, Math.min(255, (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2] - 128) * 1.7 + 128))
            d[i] = d[i + 1] = d[i + 2] = g
          }
          return img
        }
        const wasmEngine = !native.includes('code_128')
        let busy = false, lastRun = 0, flip = false
        const tick = async t => {
          if (stopped) return
          raf = requestAnimationFrame(tick)
          const v = video.current
          if (busy || t - lastRun < 70 || !v || v.readyState < 2 || !v.videoWidth) return      // up to ~14 reads per second
          busy = true; lastRun = t; flip = !flip
          try { const found = await detector.detect(boxCrop(v, wasmEngine && flip, wasmEngine ? 960 : 1280)); if (found[0]?.rawValue) handle(found[0].rawValue) } catch { /* frame not ready */ }
          busy = false
        }
        raf = requestAnimationFrame(tick)
        if (!stopped) setReady(true)
      } catch (e) {
        const denied = /denied|NotAllowed|Permission/i.test(`${e.name} ${e.message}`)
        const missing = /NotFound|Overconstrained|no camera|Requested device not found/i.test(`${e.name} ${e.message}`)
        setErr(denied ? 'Camera access is blocked. Click the camera icon in the address bar and choose Allow, then try again — or use a USB scanner / type the code.'
          : missing ? 'No camera found on this device. Use a USB scanner or type the barcode number instead.'
          : 'The camera could not start. Use a USB scanner or type the barcode number instead.')
      }
    })()
    function handle(code) {
          if (stopped) return
          const now = Date.now()
          // Same label still in front of the camera: keep ignoring it. It only counts again after it has
          // been out of view for a moment (move it away and back to add another one).
          if (code === lastCode && now - lastAt < 1200) { lastAt = now; return }
          lastCode = code; lastAt = now
          let r = cb.current(code); if (typeof r === 'boolean') r = { ok: r }
          const ok = !!r?.ok
          scanFeedback(ok)
          clearTimeout(flashTimer); setFlash(ok ? 'ok' : 'bad'); flashTimer = setTimeout(() => setFlash(null), ok ? 650 : 900)
          if (ok) {
            const label = r.text || r.item?.name || code
            setStatus({ kind: 'ok', text: continuous ? `Added ${label}` : label, item: r.item })
            if (continuous) setTally(t => {
              const key = r.item?.id || code, i = t.findIndex(x => x.key === key)
              const next = i >= 0 ? t.map((x, j) => j === i ? { ...x, count: x.count + 1 } : x) : [...t, { key, item: r.item, label, count: 1 }]
              return [next.find(x => x.key === key), ...next.filter(x => x.key !== key)]   // latest on top
            })
            else { stopped = true; setTimeout(() => closeRef.current?.(), 700) }
          } else setStatus({ kind: 'bad', text: r?.text || `Unknown barcode ${code}` })
    }
    if (import.meta.env.DEV) window.__scanTest = handle      // dev only: simulate a camera scan without a camera
    return () => { stopped = true; clearTimeout(flashTimer); cancelAnimationFrame(raf); stream?.getTracks().forEach(t => t.stop()); if (import.meta.env.DEV) delete window.__scanTest }
  }, [continuous])

  const toggleSound = () => { const on = !sound; setSound(on); try { localStorage.setItem('scanSound', on ? 'on' : 'off') } catch { /* ignore */ } }
  return (
    <div className="scan-bg" onMouseDown={e => e.target === e.currentTarget && onClose?.()}>
      <div className={'scan' + (flash ? ' ' + flash : '')} role="dialog" aria-label={title}>
        <div className="scan-head">
          <b>{title}</b>
          {continuous && <span className="scan-count">{total} scanned</span>}
          <span className="spacer" />
          {torch && <button type="button" className="scan-iconbtn" onClick={async () => { try { await torch.track.applyConstraints({ advanced: [{ torch: !torch.on }] }); setTorch({ ...torch, on: !torch.on }) } catch { /* no torch */ } }}>{torch.on ? 'Light off' : 'Light on'}</button>}
          <button type="button" className="scan-iconbtn" onClick={toggleSound} title={sound ? 'Sound on' : 'Sound off'}>{sound ? 'Sound on' : 'Sound off'}</button>
          <button type="button" className="scan-iconbtn" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="scan-stage" ref={stage}>
          <video ref={video} className="scan-video" muted playsInline />
          {!err && <div ref={frame} className={'scan-frame' + (ready ? ' live' : '')}><i /><i /><i /><i /><div className="scan-laser" /></div>}
          {flash === 'ok' && <div className="scan-burst"><span>✓</span></div>}
          {!ready && !err && <div className="scan-wait">Starting camera…</div>}
        </div>
        <div className={'scan-status ' + status.kind} aria-live="polite">
          {err ? <span className="error-text">{err}</span> : <>
            <span className="scan-dot" />
            {status.item ? <ItemName item={status.item} /> : null}
            <span>{status.item && status.kind === 'ok' ? 'added' : status.text}</span>
          </>}
        </div>
        {continuous && tally.length > 0 && <ul className="scan-list">{tally.map((t, k) => (
          <li key={t.key} className={k === 0 && flash === 'ok' ? 'fresh' : ''}>{t.item ? <ItemName item={t.item} /> : <span>{t.label}</span>}<b>× {t.count}</b></li>
        ))}</ul>}
        <div className="scan-foot">
          <span className="muted small">{continuous ? 'To add another of the same item, move the label away and back.' : 'Hold the label 10–20 cm away, flat and well lit.'}{engine === 'fast' ? ' · Fast scan' : ''}</span>
          <button type="button" className="btn primary" onClick={onClose}>{continuous ? 'Done' : 'Cancel'}</button>
        </div>
      </div>
    </div>
  )
}

export function Barcode({ value, height = 44, width = 1.6, fontSize = 12 }) {
  const ref = useRef()
  useEffect(() => {
    // Margin = the blank "quiet zone" scanners need on each side (Code 128 standard: 10 bar widths).
    // Without it, phone cameras (especially iPhone / Safari) often fail when the label sits on a dark shirt.
    try { JsBarcode(ref.current, value, { format: 'CODE128', height, width, fontSize, margin: Math.ceil(width * 11), background: '#ffffff' }) } catch { /* invalid */ }
  }, [value, height, width, fontSize])
  return <svg ref={ref} className="barcode" />
}

// Toasts + "ripple" panel showing every effect of the last transaction
export function Toasts() {
  const { toasts } = useData()
  const nav = useNavigate()
  return <div className="toasts">{toasts.map(t => <div key={t.id} className={'toast ' + t.tone}>
    {t.tone === 'live' && <span className="toast-live">Live</span>}<span>{t.msg}</span>{t.to && <button className="toast-open" onClick={() => nav(t.to)}>Open →</button>}
  </div>)}</div>
}

// Round initials badge for a person, colored consistently by their id
const AVATAR_COLORS = ['#2f5d8a', '#6b4e9b', '#2f7d6b', '#a0522d', '#8a2f5d', '#4e6b2f', '#7a5c1e', '#2f6b8a']
export function Avatar({ id = '', name = '', size = 26, title }) {
  const ini = (name || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase()).join('') || '?'
  let h = 0; for (const ch of String(id || name)) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return <span className="avatar" title={title ?? name} style={{ width: size, height: size, fontSize: size * 0.4, background: AVATAR_COLORS[h % AVATAR_COLORS.length] }}>{ini}</span>
}

// Top bar: who else is signed in right now (staff only), and which page each person is on
export function OnlineUsers({ pages = [] }) {
  const { online } = useData()
  const [open, setOpen] = useState(false)
  const ref = useRef()
  useEffect(() => {
    if (!open) return
    const close = e => { if (!ref.current?.contains(e.target)) setOpen(false) }
    window.addEventListener('mousedown', close); return () => window.removeEventListener('mousedown', close)
  }, [open])
  if (!online.length) return null
  const pageName = path => pages.find(([to]) => to === path)?.[1] || (path === '/activity' ? 'Activity' : 'Dashboard')
  const shown = online.slice(0, 4)
  return (
    <div className="online" ref={ref}>
      <button type="button" className="online-btn" onClick={() => setOpen(o => !o)} aria-expanded={open} aria-label={`${online.length} online`}>
        <span className="online-stack">{shown.map(u => <Avatar key={u.id} id={u.id} name={u.name} size={24} title="" />)}</span>
        {online.length > 4 && <span className="online-more">+{online.length - 4}</span>}
        <span className="online-label">{online.length} online</span>
      </button>
      {open && <div className="online-menu">
        <div className="online-head">Signed in now</div>
        {online.map(u => <div className="online-row" key={u.id}>
          <Avatar id={u.id} name={u.name} size={28} />
          <div><b>{u.name}{u.me ? ' (you)' : ''}</b><div className="muted small">on {pageName(u.page)}{u.tabs > 1 ? ` · ${u.tabs} tabs` : ''}</div></div>
          <span className="online-dot" />
        </div>)}
        <div className="muted small online-foot">Changes anyone makes show up on every screen within a second.</div>
      </div>}
    </div>
  )
}

// Display name of the login that made a change ('' if unknown)
export function userName(db, uid) {
  if (!uid) return ''
  const p = (db.profiles || []).find(x => x.id === uid)
  return p ? (p.full_name || p.email || '').trim() : ''
}

// Progress tracker for a document: [{ label, at, by, state: 'done' | 'current' | 'todo' | 'cancelled' }]
export function Steps({ steps }) {
  return (
    <ol className="steps">
      {steps.map((s, k) => (
        <li key={k} className={'step ' + s.state}>
          <span className="step-dot">{s.state === 'done' ? '✓' : s.state === 'cancelled' ? '✕' : k + 1}</span>
          <span className="step-text"><b>{s.label}</b>
            {s.at && <span className="step-sub">{s.at}</span>}
            {s.by && <span className="step-sub">by {s.by}</span>}
          </span>
        </li>
      ))}
    </ol>
  )
}

const FN_LABEL = {
  post_sale: 'Point-of-sale sale', fulfill_sales_order: 'Sales order fulfilment', process_return: 'Return / exchange',
  transfer_stock: 'Stock transfer', adjust_stock: 'Inventory adjustment', receive_po: 'PO receipt', issue_wo: 'Materials issued to production',
  complete_wo: 'Work order completed', cancel_wo: 'Work order cancelled', pay_po: 'Supplier payment',
}
export function RipplePanel() {
  const { ripple, setRipple, ix } = useData()
  const [expanded, setExpanded] = useState(false)
  useEffect(() => setExpanded(false), [ripple])
  if (!ripple || !ix) return null
  const dr = ripple.ledger.reduce((a, l) => a + Number(l.debit), 0), cr = ripple.ledger.reduce((a, l) => a + Number(l.credit), 0)
  const balanced = Math.abs(dr - cr) < 0.005
  // While a dialog is open on a smaller screen, the panel shrinks to this one-line summary at the top
  // (see .ripple-summary in styles.css) so it never covers the dialog's buttons.
  const summary = [ripple.moves.length ? `${ripple.moves.length} stock move${ripple.moves.length === 1 ? '' : 's'}` : null,
    ripple.ledger.length ? `journal ${money(dr)} ${balanced ? '✓ balanced' : '⚠'}` : null].filter(Boolean).join(' · ')
  return (
    <aside className={'ripple' + (expanded ? ' expanded' : '')}>
      <div className="ripple-head">
        <div><div className="eyebrow">What just happened across the ERP</div><strong>{FN_LABEL[ripple.fn] || ripple.fn} {ripple.data?.id}</strong>
          {summary && <div className="ripple-summary muted small">{summary}</div>}</div>
        <div className="row gap">
          <button className="btn small ripple-toggle" onClick={() => setExpanded(x => !x)}>{expanded ? 'Hide' : 'Details'}</button>
          <button className="icon-btn" onClick={() => setRipple(null)} aria-label="Close">✕</button>
        </div>
      </div>
      <div className="ripple-details">
      {ripple.moves.length > 0 && <>
        <h3>Inventory (stock by location)</h3>
        <table className="tbl compact"><tbody>
          {ripple.moves.map(m => {
            const it = ix.items.get(m.item_id)
            return <tr key={m.id}><td><ItemName item={it} /></td><td>{ix.locations.get(m.location_id)?.name}</td>
              <td className={'num ' + (m.qty < 0 ? 'neg' : 'pos')}>{m.qty > 0 ? '+' : ''}{qtyFmt(m.qty, it?.uom)}</td></tr>
          })}
        </tbody></table>
      </>}
      {ripple.ledger.length > 0 && <>
        <h3>Accounting journal (double entry)</h3>
        <table className="tbl compact"><thead><tr><th>Account</th><th className="num">Debit</th><th className="num">Credit</th></tr></thead><tbody>
          {ripple.ledger.map(l => <tr key={l.id}><td>{l.account}</td><td className="num">{Number(l.debit) ? money(l.debit) : ''}</td><td className="num">{Number(l.credit) ? money(l.credit) : ''}</td></tr>)}
          <tr className="total"><td>Total {balanced ? '✓ balanced' : '⚠'}</td><td className="num">{money(dr)}</td><td className="num">{money(cr)}</td></tr>
        </tbody></table>
      </>}
      <p className="muted small">Also updated automatically: on-hand by location, reorder suggestions, MRP plan, P&amp;L, inventory valuation and turnover — for every logged-in user.</p>
      </div>
    </aside>
  )
}

export function LiveDot() {
  const { live, lastSync } = useData()
  return <span className={'live ' + (live ? 'on' : '')} title={lastSync ? 'Last refresh ' + dt(lastSync) : ''}>{live ? 'Live' : 'Connecting…'}</span>
}

// Simple bar chart (no library): rows [{label, value}]
export function Bars({ rows, format = v => v, height = 180 }) {
  const max = Math.max(1, ...rows.map(r => r.value))
  return (
    <div className="bars" style={{ height }}>
      {rows.map((r, i) => (
        <div className="bar-col" key={i} title={`${r.label}: ${format(r.value)}`}>
          <div className="bar" style={{ height: `${(r.value / max) * 100}%` }} />
          <div className="bar-label">{r.label}</div>
        </div>
      ))}
    </div>
  )
}

export function DateRange({ from, to, onChange, presets = true }) {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Lima' })
  const minus = n => { const d = new Date(today + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10) }
  return (
    <div className="row gap wrap daterange">
      <input type="date" value={from} onChange={e => onChange(e.target.value, to)} aria-label="From date" />
      <span className="muted">to</span>
      <input type="date" value={to} onChange={e => onChange(from, e.target.value)} aria-label="To date" />
      {presets && <>
        <button className="btn small ghost" onClick={() => onChange(minus(29), today)}>Last 30 days</button>
        <button className="btn small ghost" onClick={() => onChange(today.slice(0, 8) + '01', today)}>This month</button>
        <button className="btn small ghost" onClick={() => onChange('2026-05-01', today)}>Since May 1</button>
      </>}
    </div>
  )
}
