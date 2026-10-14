import type { CSSProperties, ReactNode } from 'react'
import { useCatalog, useLive } from '../lib/data'
import { fmtDateTime, rocMonth } from '../lib/format'
import type { CatalogSource } from '../lib/types'

export function Panel({ title, tag, right, foot, children, className = '', style, bodyClass = '' }: {
  title?: ReactNode
  tag?: string
  right?: ReactNode
  foot?: ReactNode
  children?: ReactNode
  className?: string
  style?: CSSProperties
  bodyClass?: string
}) {
  return (
    <section className={`panel ${className}`} style={style}>
      {(title || tag || right) && (
        <header className="panel-h">
          {tag && <span className="panel-tag">{tag}</span>}
          {title && <h2 className="panel-title">{title}</h2>}
          <span className="panel-fill" />
          {right}
        </header>
      )}
      <div className={`panel-b ${bodyClass}`}>{children}</div>
      {foot && <footer className="panel-f">{foot}</footer>}
    </section>
  )
}

export function MockBadge({ title }: { title?: string }) {
  return (
    <span className="badge-mock" title={title ?? '這部分是模擬資料，沒有對應的開放資料'}>
      模擬資料
    </span>
  )
}

export function LiveBadge({ time }: { time?: string }) {
  return (
    <span className="badge-live" title="由 pipeline.collect_live 定期抓取並存在本機">
      <span className="live-dot" />
      即時{time ? <span className="num"> {time}</span> : null}
    </span>
  )
}

/** "2026-10-14 13:50" or "first ～ last" over a set of fetch times */
function span(ts: (string | null | undefined)[]): string {
  const v = ts.filter((t): t is string => !!t).sort()
  if (!v.length) return '—'
  const a = fmtDateTime(v[0])
  const b = fmtDateTime(v[v.length - 1])
  return a === b ? a : `${a} ～ ${b}`
}

/**
 * Provenance line required on every chart and map: 來源 + 資料擷取時間 (+ 模擬資料).
 * Live keys use the collector's last successful fetch; static keys use catalog.json.
 * A key may also be a source group (e.g. 'petitions'), which expands to every cached monthly file.
 */
export function Prov({ keys, mock, note, compact }: { keys: string[]; mock?: boolean | string; note?: string; compact?: boolean }) {
  const cat = useCatalog()
  const { status } = useLive()
  if (!cat) return null
  const src = [...new Set(keys.flatMap((k) => cat.sources.filter((s) => s.key === k || s.group === k)))]
  const at = (s: CatalogSource) => (s.live ? status?.feeds[s.key]?.last_ok ?? s.fetched_at : s.fetched_at)
  const when = span(src.map(at))
  const isMock = !!mock || src.some((s) => s.is_mock)
  const agencies = [...new Set(src.map((s) => s.agency))]
  const names = [...new Set(src.map((s) => s.title))]
  // one tooltip line per source; the monthly files of a source collapse into one line with their month range
  const tip = names.map((t) => {
    const g = src.filter((s) => s.title === t)
    const ps = g.map((s) => s.period).filter((p): p is number => typeof p === 'number').sort((a, b) => a - b)
    const months = ps.length > 1 ? ` ${rocMonth(ps[0])}–${rocMonth(ps[ps.length - 1])} 共 ${ps.length} 個月` : ps.length ? ` ${rocMonth(ps[0])}` : ''
    return `${t}${months}（${g[0].agency}）擷取 ${span(g.map(at))}`
  })
  return (
    <div className={`prov${compact ? ' prov-compact' : ''}`} title={tip.join('\n')}>
      <span className="prov-i"><span className="prov-k">來源</span><span className="prov-v">{compact ? agencies.join('、') : names.join('、')}</span></span>
      <span className="prov-i"><span className="prov-k">資料擷取時間</span><span className="prov-v num">{when}</span></span>
      {note && <span className="prov-i">{note}</span>}
      {isMock && <span className="prov-i"><MockBadge title={typeof mock === 'string' ? mock : undefined} /></span>}
    </div>
  )
}

export function Kpi({ label, value, unit, sub, color, delta, deltaGood, live, mock, spark, code }: {
  label: ReactNode
  value: ReactNode
  unit?: string
  sub?: ReactNode
  color?: string
  delta?: string
  deltaGood?: boolean
  live?: boolean
  mock?: boolean
  spark?: ReactNode
  code?: string
}) {
  return (
    <div className="kpi" style={color ? { ['--c' as string]: color } : undefined}>
      <div className="kpi-label">
        {code && <span className="kpi-code num">{code}</span>}
        <span>{label}</span>
        {live && <span className="live-dot" title="即時" />}
        {mock && <MockBadge />}
      </div>
      <div className="kpi-row">
        <span className="kpi-value num">{value}</span>
        {unit && <span className="kpi-unit">{unit}</span>}
        {delta && <span className={`kpi-delta num ${deltaGood === undefined ? '' : deltaGood ? 'up' : 'down'}`}>{delta}</span>}
      </div>
      {spark}
      {sub && <div className="kpi-sub">{sub}</div>}
    </div>
  )
}
