import { DOMAINS, domain } from '../lib/domains'
import { ageSec, fmtDateTime, fmtDay, fmtTime } from '../lib/format'
import { useCatalog, useLive, useNow } from '../lib/data'
import { href, type Route } from '../lib/router'
import { DOMAIN_ICONS, IconLineage, IconLinks, IconOverview, StatusGlyph } from './Icons'

const FEEDS: { key: string; label: string }[] = [
  { key: 'vd_live', label: 'VD' },
  { key: 'road_live', label: '路況' },
  { key: 'bus_live', label: '公車' },
  { key: 'bus_eta', label: '到站' },
  { key: 'rain_live', label: '雨量' },
]

export type FeedState = 'good' | 'warning' | 'critical' | 'idle'

export function feedState(f: { interval: number; last_ok: string | null; last_error: string | null; error: string | null } | undefined, now: number): FeedState {
  if (!f || !f.last_ok) return f?.error ? 'critical' : 'idle'
  const age = ageSec(f.last_ok, now)
  if (f.error && f.last_error && f.last_error > f.last_ok) return age > f.interval * 3 ? 'critical' : 'warning'
  return age > f.interval * 3 ? 'warning' : 'good'
}

export const STATE_TEXT: Record<FeedState, string> = { good: '正常', warning: '延遲', critical: '失敗', idle: '未啟動' }

function Brand() {
  return (
    <div className="brand">
      <svg className="brand-glyph" width="26" height="26" viewBox="0 0 26 26" aria-hidden="true">
        <path d="M13 1.5 24.5 13 13 24.5 1.5 13Z" fill="none" stroke="currentColor" strokeWidth="1.2" />
        <path d="M13 6.5 19.5 13 13 19.5 6.5 13Z" fill="currentColor" opacity=".9" />
        <path d="M13 0v5M13 21v5M0 13h5M21 13h5" stroke="currentColor" strokeWidth="1.2" />
      </svg>
      <div className="wordmark">
        TPE<span className="slash">//</span>OPS
      </div>
      <div className="brand-sub">臺北市政營運中樞</div>
    </div>
  )
}

function crumb(route: Route): { code: string; text: string; color?: string } {
  switch (route.name) {
    case 'domain': {
      const d = domain(route.id)
      return { code: d.code, text: `${d.short}｜${d.title}`, color: d.color }
    }
    case 'links':
      return { code: 'LX', text: '跨題關聯' }
    case 'lineage':
      return { code: 'DL', text: '資料血緣' }
    case 'schem':
      return { code: 'SX', text: '示意圖' }
    default:
      return { code: 'OV', text: '全市總覽' }
  }
}

export function TopBar({ route }: { route: Route }) {
  const now = useNow(1000)
  const { status } = useLive()
  const c = crumb(route)
  const collectorAge = ageSec(status?.updated_at, now)
  return (
    <header className="topbar">
      <Brand />
      <span className="proto-tag" title="自行開發的原型，不是臺北市政府的官方系統">原型 · 非官方</span>
      <div className="crumb" style={c.color ? { ['--c' as string]: c.color } : undefined}>
        <span className="crumb-code num">{c.code}</span>
        <span className="crumb-text">{c.text}</span>
      </div>
      <div className="feeds" aria-label="即時資料狀態">
        {collectorAge > 600 && (
          <span className="feed feed-alert" title="live/status.json 超過 10 分鐘沒有更新，請確認 pipeline.collect_live 有在執行">
            <StatusGlyph status="warning" /> 收集程式未更新
          </span>
        )}
        {FEEDS.map(({ key, label }) => {
          const f = status?.feeds[key]
          const st = feedState(f, now)
          return (
            <span key={key} className={`feed feed-${st}`}
              title={`${f?.title ?? key}｜${STATE_TEXT[st]}｜每 ${f?.interval ?? '—'} 秒更新｜最後成功 ${fmtDateTime(f?.last_ok)}${f?.error ? `｜錯誤：${f.error}` : ''}`}>
              <StatusGlyph status={st} />
              <span className="feed-label">{label}</span>
              <span className="feed-time num">{f?.last_ok ? fmtTime(f.last_ok).slice(0, 5) : '—'}</span>
            </span>
          )
        })}
      </div>
      <div className="clock">
        <span className="clock-date">{fmtDay(now)}</span>
        <span className="clock-time num">{fmtTime(now)}</span>
        <span className="clock-tz">TPE</span>
      </div>
    </header>
  )
}

export function NavRail({ route }: { route: Route }) {
  const active = (r: Route) =>
    r.name === route.name && (r.name !== 'domain' || (route.name === 'domain' && r.id === route.id))
  return (
    <nav className="rail" aria-label="主選單">
      <a className={`rail-item${active({ name: 'overview' }) ? ' on' : ''}`} href={href({ name: 'overview' })}>
        <span className="rail-code num">OV</span>
        <IconOverview />
        <span className="rail-label">總覽</span>
      </a>
      <div className="rail-sep" />
      {DOMAINS.map((d) => {
        const Icon = DOMAIN_ICONS[d.id - 1]
        const r: Route = { name: 'domain', id: d.id }
        return (
          <a key={d.id} className={`rail-item${active(r) ? ' on' : ''}`} href={href(r)} style={{ ['--c' as string]: d.color }} title={`${d.code} ${d.short}｜${d.title}`}>
            <span className="rail-code num">{d.code}</span>
            <Icon />
            <span className="rail-label">{d.short}</span>
          </a>
        )
      })}
      <div className="rail-sep" />
      <a className={`rail-item${active({ name: 'links' }) ? ' on' : ''}`} href={href({ name: 'links' })}>
        <span className="rail-code num">LX</span>
        <IconLinks />
        <span className="rail-label">關聯</span>
      </a>
      <a className={`rail-item${active({ name: 'lineage' }) ? ' on' : ''}`} href={href({ name: 'lineage' })}>
        <span className="rail-code num">DL</span>
        <IconLineage />
        <span className="rail-label">血緣</span>
      </a>
    </nav>
  )
}

export function StatusBar() {
  const cat = useCatalog()
  const { status } = useLive()
  return (
    <footer className="statusbar">
      <span className="sb-item sb-proto">獨立開發原型，非臺北市政府官方系統</span>
      <span className="sb-item">資料：臺北市資料大平臺、交通部 TDX、臺北市交通局、北市府各局處開放資料（政府資料開放授權條款）</span>
      <span className="sb-fill" />
      <span className="sb-item">資料建置 <b className="num">{cat ? fmtDateTime(cat.built_at) : '—'}</b></span>
      <span className="sb-item">即時更新 <b className="num">{status ? fmtTime(status.updated_at) : '—'}</b></span>
      {cat && (
        <a className="sb-item sb-mock" href={href({ name: 'lineage' })} title={cat.mock.map((m) => `${m.title}：${m.reason}`).join('\n')}>
          <span className="mock-swatch" /> 模擬資料 {cat.mock.length} 項
        </a>
      )}
    </footer>
  )
}
