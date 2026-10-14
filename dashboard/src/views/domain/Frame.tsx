// Shared frame of the six problem modules (#/d/1–6): object header → KPI strip → map with the module's
// layers → right column (情境模擬 → 成效圖 → 跨題關聯 → 模型假設與來源). Each module supplies the content.
import { Suspense, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Sparkline } from '../../components/Charts'
import { DOMAIN_ICONS, IconArrow, IconClose, IconLayers } from '../../components/Icons'
import { edgeKey, fmtRho, isSupported } from '../../components/LinkGraph'
import MapView, { ClassLegend, type LayerSpec } from '../../components/MapView'
import { Kpi, MockBadge, Panel, Prov } from '../../components/Panel'
import { HOT, VillageCard } from '../../components/VillageCard'
import { useData } from '../../lib/data'
import { domain, type Domain } from '../../lib/domains'
import { fmtInt, fmtNum, fmtPct } from '../../lib/format'
import { villageProps } from '../../lib/geo'
import { EXTRA_ASSUMPTIONS } from '../../lib/impact'
import { go, href } from '../../lib/router'
import { quantileClasses } from '../../lib/scales'
import { useAppState } from '../../lib/state'
import type { Impact, LinkEdge, Links, ScoreKey, Timeseries, VillageFC, VillageProps } from '../../lib/types'
import { DIGITS, fmtMetric, type Delta } from './hooks'

/** 里 fill fades as you zoom in, so the module's point/line layers take over */
const FADE = ['interpolate', ['linear'], ['zoom'], 12.5, 0.82, 15, 0.28]

export interface LayerToggle {
  id: string
  label: string
  sym: ReactNode
  on: boolean
  set: (v: boolean) => void
  n?: string
  mock?: boolean
}

export interface CardRow {
  k: ReactNode
  v: ReactNode
}

/* ======================================================================= */
export function DomainFrame({ d, kpis, kpiSources, layers, toggles, legend, mapSources, mapNote, mapMock, cardRows, pick, focus, skeleton = true, side }: {
  d: Domain
  kpis: ReactNode
  kpiSources: string[]
  layers: LayerSpec[]
  toggles: LayerToggle[]
  legend?: ReactNode
  mapSources: string[]
  mapNote?: string
  mapMock?: boolean | string
  cardRows: (p: VillageProps) => CardRow[]
  /** 里 the scenario lever acts on, outlined on the map */
  pick?: { ids: number[] | null; label: string } | null
  /** map camera target; change `key` to fly again */
  focus?: { lon: number; lat: number; zoom: number; key: string | number } | null
  skeleton?: boolean
  side: ReactNode
}) {
  const V = useData<VillageFC>('villages.geojson')
  const L = useData<Links>('links.json')
  const I = useData<Impact>('impact.json')
  const { selected, select } = useAppState()
  const [metric, setMetric] = useState<keyof VillageProps | null>(d.score)
  const [edge, setEdge] = useState<LinkEdge | null>(null)
  const [showPick, setShowPick] = useState(true)

  const mdef = d.metrics.find((m) => m.key === metric) ?? null
  const classes = useMemo(
    () => (V && mdef ? quantileClasses(V.features.map((f) => f.properties[mdef.key] as number | null), mdef.invert) : null),
    [V, mdef],
  )
  const choro = useMemo(() => (classes && mdef ? { key: mdef.key as string, classes, opacity: FADE } : null), [classes, mdef])
  const coHot = useMemo(() => {
    if (!edge || !V) return null
    const a = `s${edge.a}` as ScoreKey
    const b = `s${edge.b}` as ScoreKey
    return V.features.filter((f) => (f.properties[a] ?? -1) >= HOT && (f.properties[b] ?? -1) >= HOT).map((f) => f.properties.i)
  }, [edge, V])
  const highlight = coHot ?? (showPick && pick?.ids ? pick.ids : null)
  const sel = villageProps(V, selected)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      select(null)
      setEdge(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [select])

  const allToggles: LayerToggle[] = pick
    ? [...toggles, { id: '__pick', label: pick.label, sym: <i className="sym sym-dashbox" />, on: showPick, set: setShowPick, n: pick.ids ? `${pick.ids.length} 里` : undefined }]
    : toggles

  return (
    <div className="view dp" style={{ ['--c' as string]: d.color }}>
      <DomainHeader d={d} hot={L?.hot_counts[String(d.id)]} />

      <div className="dp-kpis stagger">
        <div className="dp-kpi-grid">{kpis}</div>
        <div className="dp-kpi-prov"><Prov keys={kpiSources} compact /></div>
      </div>

      <Panel tag="MAP" title={`${d.code} ${d.short} · 里別與圖層`} className="dp-map ticks" bodyClass="dp-map-b"
        right={<span className="mono-tag">{V ? `${V.features.length} 里 · 人口 ${V.meta.population_period}` : ''}</span>}
        foot={<Prov keys={mapSources} compact note={mapNote} mock={mapMock} />}>
        <MapView villages={V} choro={choro} selected={selected} onSelect={select} layers={layers} highlight={highlight}
          focus={focus} skeleton={skeleton}
          villageTip={(p) => (
            <>
              <div className="tip-title">{p.v} <span className="muted">· {p.d}</span></div>
              {mdef && <div className="tip-row"><span className="k">{mdef.label}</span><span className="v">{fmtMetric(mdef, p[mdef.key])}</span></div>}
              {mdef?.key !== d.score && (
                <div className="tip-row"><span className="k">{d.scoreLabel}</span><span className="v">{p[d.score] == null ? '無資料' : fmtNum(p[d.score], 1)}</span></div>
              )}
              <div className="tip-row"><span className="k">人口 · 65 歲以上</span><span className="v">{fmtInt(p.pop)} · {fmtPct(p.r65, 0)}</span></div>
            </>
          )}>
          <div className="map-ov tl dp-ctrl">
            <div className="seg" role="tablist" aria-label="里別指標">
              {d.metrics.map((m) => (
                <button key={m.key} className={metric === m.key ? 'on' : ''} onClick={() => setMetric(m.key)}>{m.label}</button>
              ))}
              <button className={metric == null ? 'on' : ''} onClick={() => setMetric(null)} title="不填里別底色，只看圖層">關閉</button>
            </div>
            <LayerBox toggles={allToggles} />
            {edge && coHot && (
              <div className="ov-cohot">
                <span className="num">{domain(edge.a).code}</span> {domain(edge.a).short} × <span className="num">{domain(edge.b).code}</span> {domain(edge.b).short}
                <b className="num">{coHot.length}</b> 個共同熱點里（虛線框）
                <button onClick={() => setEdge(null)} aria-label="清除"><IconClose size={12} /></button>
              </div>
            )}
          </div>
          <div className="map-ov bl dp-legends">
            {legend}
            {classes && mdef && (
              <ClassLegend title={mdef.label} classes={classes} invert={mdef.invert}
                fmt={(v) => (mdef.pct ? fmtPct(v, 0) : fmtNum(v, DIGITS[mdef.key] ?? (Math.abs(v) >= 10 ? 0 : 1)))}
                note="分級：分位數 7 級 · 放大後淡出" />
            )}
          </div>
          {sel && (
            <div className="map-ov tr">
              <VillageCard p={sel} onClose={() => select(null)} focusDomain={d.id}
                onDomain={(id) => (id === d.id ? undefined : go({ name: 'domain', id: id as 1 }))}
                rows={cardRows(sel)}
                foot={<>點其他題的分數列切換模組（保留這個里）</>} />
            </div>
          )}
        </MapView>
      </Panel>

      <div className="dp-side scroll">
        {side}
        {L && <DomainLinks d={d} L={L} edge={edge} onEdge={setEdge} />}
        <Assumptions d={d} I={I} />
      </div>
    </div>
  )
}

/* ---------------- header ---------------- */
function DomainHeader({ d, hot }: { d: Domain; hot?: number }) {
  const Icon = DOMAIN_ICONS[d.id - 1]
  const prev = domain(((d.id + 4) % 6) + 1)
  const next = domain((d.id % 6) + 1)
  return (
    <header className="dp-head">
      <span className="dp-code num">{d.code}</span>
      <Icon size={24} className="dp-icon" />
      <div className="dp-titles">
        <h1 className="dp-title">
          {d.title}
          <span className="dp-kind">MODULE · {d.short}</span>
        </h1>
        <p className="dp-q">{d.question}</p>
      </div>
      <div className="dp-meta">
        <span className="dp-k">權責機關</span>
        <span className="dp-ag">{d.agencies.map((a) => <span key={a} className="chip">{a}</span>)}</span>
      </div>
      <div className="dp-meta dp-hot" title={`${d.scoreLabel} ≥ ${HOT} 的里`}>
        <span className="dp-k">熱點里（≥ {HOT}）</span>
        <b className="num">{hot ?? '—'}</b>
      </div>
      <nav className="dp-nav" aria-label="切換題目">
        <a className="btn" href={href({ name: 'domain', id: prev.id })} title={prev.title}>
          <IconArrow size={12} className="flip" /> <span className="num">{prev.code}</span> {prev.short}
        </a>
        <a className="btn" href={href({ name: 'domain', id: next.id })} title={next.title}>
          <span className="num">{next.code}</span> {next.short} <IconArrow size={12} />
        </a>
      </nav>
    </header>
  )
}

/* ---------------- layer toggles (each row doubles as the symbol legend) ---------------- */
function LayerBox({ toggles }: { toggles: LayerToggle[] }) {
  if (!toggles.length) return null
  return (
    <div className="layer-box">
      <div className="layer-box-h"><IconLayers size={11} /> 圖層</div>
      {toggles.map((t) => (
        <button key={t.id} className={`layer-toggle${t.on ? ' on' : ''}`} onClick={() => t.set(!t.on)} aria-pressed={t.on}>
          <span className="chk" />
          {t.sym}
          <span>{t.label}</span>
          {t.mock && <MockBadge />}
          {t.n && <span className="n num">{t.n}</span>}
        </button>
      ))}
    </div>
  )
}

/** continuous ramp legend for a module layer (e.g. 人行道遮蔭率) */
export function RampLegend({ title, colors, left, right, note }: { title: string; colors: string[]; left: string; right: string; note?: string }) {
  return (
    <div className="legend">
      <div className="legend-title">{title}</div>
      <div className="legend-grad" style={{ background: `linear-gradient(90deg, ${colors.join(', ')})` }} />
      <div className="legend-scale num"><span>{left}</span><span>{right}</span></div>
      {note && <div className="legend-note">{note}</div>}
    </div>
  )
}

/* ======================================================================= */
/* 右欄元件 */

export function ScenarioPanel({ schem, controls, hero, results, mock, onReset, note }: {
  schem: ReactNode
  controls: ReactNode
  hero: ReactNode
  results: ResultRow[]
  mock?: boolean
  onReset: () => void
  note?: ReactNode
}) {
  return (
    <Panel tag="SC" title="情境模擬" className="ticks dp-sc"
      right={<button className="btn btn-ghost" onClick={onReset} title="回到預設值">重設</button>}
      foot={<div className="dp-sc-foot">{note ?? '模型推估，用來比較方案，不是預測保證。假設列在最下方。'}{mock && <MockBadge />}</div>}>
      <div className="dp-schem">
        <Suspense fallback={<div className="schem-pending">LOADING</div>}>{schem}</Suspense>
      </div>
      <div className="dp-sc-ctrl">{controls}</div>
      {hero}
      <Results rows={results} />
    </Panel>
  )
}

export function Slider({ label, value, min, max, step, fmt, onChange, marks }: {
  label: ReactNode
  value: number
  min: number
  max: number
  step: number
  fmt: (v: number) => string
  onChange: (v: number) => void
  marks?: { v: number; label: string }[]
}) {
  const p = ((value - min) / (max - min || 1)) * 100
  return (
    <label className="sl">
      <span className="sl-h">
        <span className="sl-k">{label}</span>
        <span className="sl-v num">{fmt(value)}</span>
      </span>
      <input type="range" className="slider" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))} style={{ ['--p' as string]: `${p}%` }} />
      <span className="sl-scale num">
        <span>{fmt(min)}</span>
        {marks?.map((m) => (
          <span key={m.v} className="sl-mark" style={{ left: `${((m.v - min) / (max - min || 1)) * 100}%` }}>{m.label}</span>
        ))}
        <span>{fmt(max)}</span>
      </span>
    </label>
  )
}

export function DeltaTag({ d }: { d: Delta }) {
  return (
    <span className={`delta${d.good === undefined ? '' : d.good ? ' good' : ' bad'}`}>
      <i>{d.dir === 'up' ? '▲' : d.dir === 'down' ? '▼' : '■'}</i>
      {d.text}
    </span>
  )
}

export function Hero({ k, from, to, unit, d }: { k: ReactNode; from?: string; to: string; unit?: string; d?: Delta }) {
  return (
    <div className="dp-hero">
      <div className="dp-hero-k">{k}</div>
      <div className="dp-hero-v num">
        {from && <span className="dp-hero-from">{from}<i>→</i></span>}
        <b>{to}</b>
        {unit && <small>{unit}</small>}
        {d && <DeltaTag d={d} />}
      </div>
    </div>
  )
}

export interface ResultRow {
  k: ReactNode
  from?: string
  to: string
  d?: Delta
  mock?: boolean
}

export function Results({ rows }: { rows: ResultRow[] }) {
  return (
    <div className="res">
      {rows.map((r, i) => (
        <div key={i} className="res-row">
          <span className="res-k">{r.k}{r.mock && <MockBadge />}</span>
          <span className="res-v num">
            {r.from && <span className="res-from">{r.from} →</span>}
            <b>{r.to}</b>
          </span>
          <span className="res-d num">{r.d && <DeltaTag d={r.d} />}</span>
        </div>
      ))}
    </div>
  )
}

/** 1999 陳情 for this domain over the last 12 months */
export function PetitionKpi({ d, T }: { d: Domain; T?: Timeseries }) {
  const p = T?.petitions[String(d.id)]
  const top = p ? Object.entries(p.categories).sort((a, b) => b[1] - a[1])[0] : null
  return (
    <Kpi code="1999" label="市民陳情（近 12 月）" value={p ? fmtInt(p.total) : '—'} unit="件" color={d.color}
      spark={p && T && <Sparkline values={p.monthly} times={T.months} fmt={(v) => `${fmtInt(v)} 件`} fmtT={(t) => String(t)} width={132} height={20} color="var(--ink-2)" />}
      sub={p ? <>處理中位數 {p.median_days} 天 · 最多：{top?.[0]}</> : undefined} />
  )
}

/* ---------------- 跨題關聯 (edges touching this domain) ---------------- */
function DomainLinks({ d, L, edge, onEdge }: { d: Domain; L: Links; edge: LinkEdge | null; onEdge: (e: LinkEdge | null) => void }) {
  const edges = L.edges.filter((e) => e.a === d.id || e.b === d.id).sort((a, b) => Math.abs(b.rho) - Math.abs(a.rho))
  return (
    <Panel tag="LX" title="跨題關聯" className="ticks"
      right={<a className="btn btn-ghost" href={href({ name: 'links' })}>全部 <IconArrow size={12} /></a>}
      foot={<div className="dl-foot">點一列：地圖用虛線框標出兩題的共同熱點里（兩題分數都 ≥ {HOT}）。<b>資料支持</b> = 456 里分數的 |Spearman ρ| ≥ 0.2；<b>機制推論</b> = 機制合理但里別相關弱。</div>}>
      <div className="dl">
        {edges.map((e) => {
          const o = domain(e.a === d.id ? e.b : e.a)
          const Icon = DOMAIN_ICONS[o.id - 1]
          const sup = isSupported(e)
          const on = !!edge && edgeKey(edge) === edgeKey(e)
          return (
            <button key={edgeKey(e)} className={`dl-row${on ? ' on' : ''}`} style={{ ['--c' as string]: o.color }} onClick={() => onEdge(on ? null : e)} aria-pressed={on}>
              <span className="dl-h">
                <span className="dl-code num">{o.code}</span>
                <Icon size={13} className="dl-icon" />
                <span className="dl-name">{o.short}</span>
                <span className={`dl-tag${sup ? ' sup' : ''}`}>{sup ? '資料支持' : '機制推論'}</span>
                <span className="dl-fill" />
                <span className="dl-stat num" title="里分數 Spearman ρ">ρ {fmtRho(e.rho)}</span>
                <span className="dl-stat num" title="共同熱點里">共同熱點 {e.co_hot}</span>
              </span>
              <span className="dl-mech">{e.mechanism}</span>
              <span className="dl-ag">協作：{e.agencies.join('、')}</span>
            </button>
          )
        })}
      </div>
    </Panel>
  )
}

/* ---------------- 模型假設與來源 ---------------- */
function Assumptions({ d, I }: { d: Domain; I?: Impact }) {
  const D = I?.[String(d.id) as '1']
  const list = [...(D?.assumptions ?? []), ...(EXTRA_ASSUMPTIONS[d.id] ?? [])]
  return (
    <Panel tag="AS" title="模型假設與資料來源" className="ticks" foot={<Prov keys={d.sources} />}>
      <ol className="as">
        {list.map((a, i) => (
          <li key={i}><span className="num">{String(i + 1).padStart(2, '0')}</span>{a}</li>
        ))}
      </ol>
      {D?.mock && D.mock.length > 0 && (
        <div className="as-mock">
          {D.mock.map((m) => (
            <div key={m}><MockBadge /> {m}</div>
          ))}
        </div>
      )}
    </Panel>
  )
}
