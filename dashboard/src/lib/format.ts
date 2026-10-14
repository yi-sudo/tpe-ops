const TZ = 'Asia/Taipei'

const nf0 = new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 0 })
const nfCache = new Map<number, Intl.NumberFormat>()

export function fmtInt(n: number | null | undefined): string {
  return n == null || !Number.isFinite(n) ? '—' : nf0.format(Math.round(n))
}

export function fmtNum(n: number | null | undefined, digits = 1): string {
  if (n == null || !Number.isFinite(n)) return '—'
  let f = nfCache.get(digits)
  if (!f) {
    f = new Intl.NumberFormat('zh-TW', { minimumFractionDigits: digits, maximumFractionDigits: digits })
    nfCache.set(digits, f)
  }
  return f.format(n)
}

/** 0.2268 -> "22.7%" */
export function fmtPct(x: number | null | undefined, digits = 1): string {
  return x == null || !Number.isFinite(x) ? '—' : `${fmtNum(x * 100, digits)}%`
}

/** signed percentage-point or percent change, e.g. -0.35 -> "−35.0%" */
export function fmtDeltaPct(x: number | null | undefined, digits = 1): string {
  if (x == null || !Number.isFinite(x)) return '—'
  const s = fmtNum(Math.abs(x) * 100, digits)
  return `${x > 0 ? '+' : x < 0 ? '−' : ''}${s}%`
}

export function fmtSigned(n: number, digits = 0): string {
  const s = digits ? fmtNum(Math.abs(n), digits) : fmtInt(Math.abs(n))
  return `${n > 0 ? '+' : n < 0 ? '−' : ''}${s}`
}

/** compact large numbers with 萬 / 億 (Taiwan usage) */
export function fmtWan(n: number | null | undefined, digits = 1): string {
  if (n == null || !Number.isFinite(n)) return '—'
  const a = Math.abs(n)
  if (a >= 1e8) return `${fmtNum(n / 1e8, digits)} 億`
  if (a >= 1e4) return `${fmtNum(n / 1e4, digits)} 萬`
  return fmtInt(n)
}

const dtf = new Intl.DateTimeFormat('zh-TW', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
})
const tf = new Intl.DateTimeFormat('zh-TW', { timeZone: TZ, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
const hm = new Intl.DateTimeFormat('zh-TW', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false })
const df = new Intl.DateTimeFormat('zh-TW', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' })

function parts(f: Intl.DateTimeFormat, d: Date) {
  const o: Record<string, string> = {}
  for (const p of f.formatToParts(d)) o[p.type] = p.value
  return o
}

function toDate(t: string | number | Date): Date {
  return t instanceof Date ? t : typeof t === 'number' ? new Date(t < 1e12 ? t * 1000 : t) : new Date(t)
}

/** "2026-10-14 14:17" */
export function fmtDateTime(t: string | number | Date | null | undefined): string {
  if (t == null) return '—'
  const p = parts(dtf, toDate(t))
  return `${p.year}-${p.month}-${p.day} ${p.hour === '24' ? '00' : p.hour}:${p.minute}`
}

/** "14:17:18" */
export function fmtTime(t: string | number | Date | null | undefined): string {
  if (t == null) return '—'
  const p = parts(tf, toDate(t))
  return `${p.hour === '24' ? '00' : p.hour}:${p.minute}:${p.second}`
}

/** "14:17" */
export function fmtHM(t: string | number | Date | null | undefined): string {
  if (t == null) return '—'
  const p = parts(hm, toDate(t))
  return `${p.hour === '24' ? '00' : p.hour}:${p.minute}`
}

/** "2026/10/14（週三）" */
export function fmtDay(t: string | number | Date): string {
  const p = parts(df, toDate(t))
  return `${p.year}/${p.month}/${p.day}（${p.weekday}）`
}

/** seconds since an ISO time */
export function ageSec(iso: string | null | undefined, now = Date.now()): number {
  return iso ? (now - new Date(iso).getTime()) / 1000 : Infinity
}

export function fmtAge(sec: number): string {
  if (!Number.isFinite(sec)) return '—'
  if (sec < 90) return `${Math.max(0, Math.round(sec))} 秒前`
  if (sec < 5400) return `${Math.round(sec / 60)} 分鐘前`
  if (sec < 172800) return `${Math.round(sec / 3600)} 小時前`
  return `${Math.round(sec / 86400)} 天前`
}

export function fmtBytes(b: number | null | undefined): string {
  if (b == null) return '—'
  if (b >= 1 << 20) return `${fmtNum(b / (1 << 20), 1)} MB`
  if (b >= 1 << 10) return `${fmtNum(b / (1 << 10), 0)} KB`
  return `${b} B`
}

/** 11410 (民國年 + 月) -> "114/10"; other period texts pass through */
export const rocMonth = (p: string | number) => {
  const s = String(p)
  return /^\d{5}$/.test(s) ? `${s.slice(0, 3)}/${s.slice(3)}` : s
}

/** minutes since midnight for "HH:MM" */
export const hmToMin = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(-2))
export const minToHM = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(Math.round(m % 60)).padStart(2, '0')}`

/** current Taipei wall-clock minutes since midnight and weekday (0 = Sunday) */
export function taipeiNow(now = new Date()): { min: number; dow: number } {
  const p = parts(new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false }), now)
  const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday)
  return { min: (Number(p.hour) % 24) * 60 + Number(p.minute), dow }
}
