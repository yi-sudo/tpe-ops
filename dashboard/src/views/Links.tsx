// 跨題關聯分析（#/links）：六題的里別分數兩兩比對，回答「哪些問題集中在同一批里、哪些局處要一起處理」。
// 左：關聯圖 + 15 組配對排行 │ 中：共同熱點地圖 + 多題疊加組合 │ 右：配對詳情 → 散布圖 → 里名單 → 方法。
// 資料支持 = 兩題里別分數 |Spearman ρ| ≥ 0.2；機制 = pipeline/build.py MECHANISMS 列的 8 組假設。相關不代表因果。
import { scaleLinear } from 'd3-scale'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useWidth } from '../components/Charts'
import { DOMAIN_ICONS, IconClose, IconLinks } from '../components/Icons'
import { LinkGraph, LinkLegend, SUPPORT_RHO, edgeKey, fmtRho } from '../components/LinkGraph'
import MapView, { ClassLegend } from '../components/MapView'
import { Panel, Prov } from '../components/Panel'
import { HOT, VillageCard } from '../components/VillageCard'
import { useData } from '../lib/data'
import { DOMAINS, domain, type Domain } from '../lib/domains'
import { fmtInt, fmtNum, fmtPct, fmtWan } from '../lib/format'
import { villageCenter } from '../lib/geo'
import { go, href } from '../lib/router'
import { DIV, SEQ, quantileClasses, type Classes } from '../lib/scales'
import { useAppState } from '../lib/state'
import type { LinkEdge, Links as LinkData, ScoreKey, VillageFC, VillageProps } from '../lib/types'

/* ---------------- model ---------------- */
type Kind = 'sup' | 'mech' | 'found' | 'none'
const KIND: Record<Kind, { tag: string; label: string; note: string }> = {
  sup: { tag: '支持', label: '資料支持', note: `有機制假設，里別分數 |ρ| ≥ ${SUPPORT_RHO}` },
  mech: { tag: '推論', label: '機制推論', note: `有機制假設，但里別分數 |ρ| < ${SUPPORT_RHO}` },
  found: { tag: '發現', label: '資料發現', note: `未列機制假設，但里別分數 |ρ| ≥ ${SUPPORT_RHO}` },
  none: { tag: '—', label: '無明顯關聯', note: `未列機制假設，里別分數 |ρ| < ${SUPPORT_RHO}` },
}

interface Pair {
  a: number
  b: number
  key: string
  rho: number
  jaccard: number
  /** 里 that have both scores */
  n: number
  hotA: number
  hotB: number
  /** co-hot 里 (both scores ≥ HOT), highest smaller score first */
  ids: number[]
  pop: number
  /** co-hot count expected if the two hot sets were independent */
  expected: number
  edge: LinkEdge | null
  kind: Kind
}

/** 里 that are hot in exactly this set of problems — each 里 is counted once */
interface Combo {
  key: string
  set: number[]
  ids: number[]
  pop: number
}

const sk = (id: number) => `s${id}` as ScoreKey

/** the smaller of the 里's scores on the given problems: high only when all of them are high */
function minScore(p: VillageProps, ids: number[]): number | null {
  let m = Infinity
  for (const id of ids) {
    const s = p[sk(id)]
    if (s == null) return null
    m = Math.min(m, s)
  }
  return m
}

function buildPairs(V: VillageFC, L: LinkData): Pair[] {
  const P = V.features.map((f) => f.properties)
  const out: Pair[] = []
  for (let a = 1; a <= 6; a++) {
    for (let b = a + 1; b <= 6; b++) {
      const ok = P.filter((p) => p[sk(a)] != null && p[sk(b)] != null)
      const hotA = ok.filter((p) => (p[sk(a)] as number) >= HOT).length
      const hotB = ok.filter((p) => (p[sk(b)] as number) >= HOT).length
      const co = ok
        .filter((p) => (minScore(p, [a, b]) as number) >= HOT)
        .sort((x, y) => (minScore(y, [a, b]) as number) - (minScore(x, [a, b]) as number))
      const rho = L.spearman[a - 1][b - 1]
      const edge = L.edges.find((e) => edgeKey(e) === `${a}-${b}`) ?? null
      const sup = Math.abs(rho) >= SUPPORT_RHO
      out.push({
        a, b, key: `${a}-${b}`, rho, jaccard: L.jaccard[a - 1][b - 1], n: ok.length, hotA, hotB,
        ids: co.map((p) => p.i),
        pop: co.reduce((s, p) => s + p.pop, 0),
        expected: ok.length ? (hotA * hotB) / ok.length : 0,
        edge,
        kind: edge ? (sup ? 'sup' : 'mech') : sup ? 'found' : 'none',
      })
    }
  }
  return out
}

function buildCombos(V: VillageFC): Combo[] {
  const m = new Map<string, { set: number[]; rows: VillageProps[] }>()
  for (const f of V.features) {
    const p = f.properties
    const set = DOMAINS.filter((d) => (p[d.score] ?? -1) >= HOT).map((d) => d.id)
    if (set.length < 2) continue
    const k = set.join('-')
    const c = m.get(k) ?? { set, rows: [] }
    c.rows.push(p)
    m.set(k, c)
  }
  return [...m.entries()]
    .map(([key, { set, rows }]) => ({
      key,
      set,
      ids: rows.sort((x, y) => (minScore(y, set) ?? 0) - (minScore(x, set) ?? 0)).map((p) => p.i),
      pop: rows.reduce((s, p) => s + p.pop, 0),
    }))
    .sort((x, y) => y.ids.length - x.ids.length || y.set.length - x.set.length || x.key.localeCompare(y.key))
}

const HOT_CLASSES: Classes = { breaks: [0.5, 1.5, 2.5], colors: [SEQ[0], SEQ[2], SEQ[4], SEQ[6]], min: 0, max: 3 }
/** ρ bars run from −RHO_MAX to +RHO_MAX (the strongest pair is .59) */
const RHO_MAX = 0.6
const ALL_SOURCES = ['village', 'population_age', 'trees_street', 'sidewalk', 'bins', 'ratradar', 'road_live', 'bus_timetable', 'liquefaction', 'fire_access']
/** why a 里 has no score for a problem (pipeline/build.py) */
const NO_SCORE: Record<number, string> = { 1: '人行道總長不足 200 m', 4: '經過的即時路況路段不足 50 m', 5: '人口不足 300 人' }

type Mode = 'pm' | 'a' | 'b' | 'hot'

const fmtScore = (v: number | null | undefined) => (v == null ? '無資料' : fmtNum(v, 1))
const pairSources = (A: Domain, B: Domain) => [...new Set(['village', ...A.sources, ...B.sources])]
const agenciesOf = (ids: number[]) => [...new Set(ids.flatMap((id) => domain(id).agencies))]
const comboName = (set: number[]) => set.map((id) => `${domain(id).code} ${domain(id).short}`).join(' + ')
/** evidence units: '%' = a 0–1 share, other text = a count, none = a Spearman ρ (the label already says so) */
const fmtEvidence = (e: { label: string; value: number | null; unit?: string }) =>
  e.value == null ? '—' : e.unit === '%' ? fmtPct(e.value, 0) : e.unit ? `${fmtInt(e.value)} ${e.unit}` : `${e.label.includes('ρ') ? '' : 'ρ '}${fmtRho(e.value)}`

/* ======================================================================= */
export default function Links() {
  const V = useData<VillageFC>('villages.geojson')
  const L = useData<LinkData>('links.json')
  const { selected, select } = useAppState()
  const [pairKey, setPairKey] = useState<string | null>(null)
  const [comboKey, setComboKey] = useState<string | null>(null)
  const [node, setNode] = useState<number | null>(null)
  const [mode, setMode] = useState<Mode>('pm')
  const [fly, setFly] = useState<{ lon: number; lat: number; zoom: number; key: string } | null>(null)
  const [gref, gw] = useWidth<HTMLDivElement>()

  const pairs = useMemo(() => (V && L ? buildPairs(V, L) : null), [V, L])
  const combos = useMemo(() => (V ? buildCombos(V) : null), [V])
  const byI = useMemo(() => new Map((V?.features ?? []).map((f) => [f.properties.i, f.properties])), [V])
  const totalPop = useMemo(() => (V ? V.features.reduce((s, f) => s + f.properties.pop, 0) : 0), [V])
  // default: the pair with the strongest village-level correlation
  const pair = pairs ? pairs.find((p) => p.key === pairKey) ?? pairs.reduce((m, p) => (Math.abs(p.rho) > Math.abs(m.rho) ? p : m)) : null
  const combo = combos?.find((c) => c.key === comboKey) ?? null
  const A = pair ? domain(pair.a) : null
  const B = pair ? domain(pair.b) : null

  // the map shows the smaller of the two scores as `pm`, so only 里 where both problems are high light up
  const fc = useMemo(() => {
    if (!V || !pair) return undefined
    const ids = [pair.a, pair.b]
    return { ...V, features: V.features.map((f) => ({ ...f, properties: { ...f.properties, pm: minScore(f.properties, ids) } })) } as VillageFC
  }, [V, pair])
  const key = !A || !B ? 'pm' : mode === 'a' ? A.score : mode === 'b' ? B.score : mode
  const classes = useMemo(
    () => (!fc ? null : key === 'hot' ? HOT_CLASSES : quantileClasses(fc.features.map((f) => (f.properties as unknown as Record<string, number | null>)[key]))),
    [fc, key],
  )
  const choro = useMemo(() => (classes ? { key, classes } : null), [key, classes])
  const highlight = combo?.ids ?? pair?.ids ?? null
  const sel = selected != null ? byI.get(selected) ?? null : null

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      select(null)
      if (comboKey) {
        setComboKey(null)
        setMode('pm')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [select, comboKey])

  const pick = (i: number) => {
    select(i)
    const c = V && villageCenter(V, i)
    if (c) setFly({ lon: c[0], lat: c[1], zoom: 13.8, key: `${i}-${Date.now()}` })
  }
  const pickPair = (k: string) => {
    setPairKey(k)
    setComboKey(null)
    if (mode === 'hot') setMode('pm')
  }
  // a combination is about how many problems pile up, so the map switches to the hot-count view while one is picked
  const pickCombo = (k: string | null) => {
    setComboKey(k)
    setMode(k ? 'hot' : 'pm')
  }

  const legendTitle = !A || !B ? '' : key === 'pm' ? `${A.code} × ${B.code} 兩題分數較小值` : key === 'hot' ? `高需求題數（分數 ≥ ${HOT}）` : key === A.score ? `${A.code} ${A.scoreLabel}` : `${B.code} ${B.scoreLabel}`

  return (
    <div className="view lx">
      <LxHeader pairs={pairs} V={V} />

      {/* ---------- left: graph + pair ranking ---------- */}
      <div className="lx-left scroll stagger">
        <Panel tag="LX" title="關聯圖" className="ticks" foot={<LinkLegend />}>
          <div className="ov-graph" ref={gref}>
            {L && pair ? (
              <>
                <LinkGraph links={L} width={Math.min(320, (gw || 320) - 4)} height={248} selected={pair.key} ghost={pair.edge ? null : pair}
                  onSelect={(e) => e && pickPair(edgeKey(e))} activeNode={node}
                  onNode={(id) => setNode((n) => (n === id ? null : id))} />
                <div className="ov-graph-hint">點連線選配對；點節點只看含該題的配對</div>
              </>
            ) : <div className="loading" style={{ height: 266, position: 'relative' }}>LOADING</div>}
          </div>
        </Panel>
        <Panel tag="PR" title="15 組配對排行" className="ticks"
          right={node != null ? <NodeChip id={node} onClear={() => setNode(null)} /> : undefined}
          foot={<KindLegend />}>
          {pairs && pair && <PairList pairs={pairs} selected={pair.key} node={node} onPick={pickPair} />}
        </Panel>
      </div>

      {/* ---------- center: co-hot map + combinations ---------- */}
      <div className="lx-center">
        <Panel tag="MAP" className="lx-map ticks" bodyClass="lx-map-b"
          title={combo
            ? <>多題組合地圖 · {combo.set.map((id, k) => <span key={id}>{k > 0 && ' + '}<span className="num muted">{domain(id).code}</span> {domain(id).short}</span>)}</>
            : A && B ? <>共同熱點地圖 · <span className="num muted">{A.code}</span> {A.short} × <span className="num muted">{B.code}</span> {B.short}</> : '共同熱點地圖'}
          right={<span className="mono-tag">{V ? `${V.features.length} 里 · 人口資料 ${V.meta.population_period}` : ''}</span>}
          foot={A && B ? <Prov keys={key === 'hot' ? ALL_SOURCES : pairSources(A, B)} compact note="分數 = 全市百分位加權（0–100）" /> : undefined}>
          <MapView villages={fc} choro={choro} selected={selected} onSelect={select} highlight={highlight} focus={fly} showExtrudeToggle={false}
            villageTip={(p) => A && B && <MapTip p={p} A={A} B={B} />}>
            {A && B && pair && (
              <div className="map-ov tl ov-ctrl">
                <div className="seg" role="tablist" aria-label="地圖指標">
                  <button className={mode === 'pm' ? 'on' : ''} onClick={() => setMode('pm')} title="兩題分數取較小值：兩題都高的里才會亮">兩題都高</button>
                  {[A, B].map((d, k) => (
                    <button key={d.id} className={mode === (k ? 'b' : 'a') ? 'on' : ''} onClick={() => setMode(k ? 'b' : 'a')} title={d.scoreLabel}
                      style={{ ['--c' as string]: d.color }}>
                      <i className="seg-sw" />
                      {d.code} {d.short}
                    </button>
                  ))}
                  <button className={mode === 'hot' ? 'on' : ''} onClick={() => setMode('hot')} title={`六題中分數 ≥ ${HOT} 的題數`}>疊加題數</button>
                </div>
                {combo ? (
                  <div className="ov-cohot">
                    組合 <span className="num">{combo.set.map((id) => domain(id).code).join(' + ')}</span>
                    <b className="num">{combo.ids.length}</b> 里（虛線框）
                    <button onClick={() => pickCombo(null)} aria-label="清除組合" title="清除組合（Esc）"><IconClose size={12} /></button>
                  </div>
                ) : (
                  <div className="ov-cohot lx-cohot">
                    <b className="num">{pair.ids.length}</b> 個共同熱點里（虛線框，兩題分數都 ≥ {HOT}）
                  </div>
                )}
              </div>
            )}
            {classes && legendTitle && (
              <div className="map-ov bl">
                <ClassLegend title={legendTitle} classes={classes} fmt={(v) => (key === 'hot' ? `${Math.round(v)} 題` : fmtNum(v, 0))}
                  note={key === 'pm' ? '兩題都高的里才會亮 · 分位數 7 級' : key === 'hot' ? undefined : '分級：分位數 7 級'} />
              </div>
            )}
            {sel && A && B && (
              <div className="map-ov tr">
                <VillageCard p={sel} onClose={() => select(null)} onDomain={(id) => go({ name: 'domain', id: id as 1 })}
                  rows={[
                    { k: `${A.code} × ${B.code} 兩題較小值`, v: fmtScore(minScore(sel, [A.id, B.id])) },
                    { k: `高需求題數（≥ ${HOT}）`, v: `${sel.hot} / 6` },
                  ]}
                  foot="點分數列開啟該題模組" />
              </div>
            )}
          </MapView>
        </Panel>
        <Panel tag="UP" title="多題疊加組合" className="lx-up ticks"
          right={<span className="lx-hint">每個里只算一次，歸入它剛好是熱點的那組題目 · 點一欄在地圖標出</span>}
          foot={<Prov keys={ALL_SOURCES} compact />}>
          {combos ? <UpSet combos={combos} byI={byI} hot={L?.hot_counts} selected={comboKey} onPick={pickCombo} />
            : <div className="loading" style={{ height: 150, position: 'relative' }}>LOADING</div>}
        </Panel>
      </div>

      {/* ---------- right: detail ---------- */}
      <div className="lx-right scroll stagger">
        {pair && A && B && V ? (
          <>
            <PairDetail p={pair} A={A} B={B} totalPop={totalPop} />
            <Panel tag="SC" title="散布圖 · 兩題里別分數" className="ticks"
              right={<span className="mono-tag">n {pair.n} 里</span>}
              foot={<Prov keys={pairSources(A, B)} compact note="點一點：在地圖定位這個里" />}>
              <Scatter p={pair} A={A} B={B} V={V} selected={selected} onPick={pick} />
            </Panel>
            {combo ? (
              <FocusList title={`組合里名單 · ${combo.set.map((id) => domain(id).code).join(' + ')}`} doms={combo.set} ids={combo.ids} byI={byI}
                totalPop={totalPop} selected={selected} onPick={pick} agencies={agenciesOf(combo.set)} revealKey={combo.key} />
            ) : (
              <FocusList title={`共同熱點里名單 · ${A.code} × ${B.code}`} doms={[A.id, B.id]} ids={pair.ids} byI={byI}
                totalPop={totalPop} selected={selected} onPick={pick}
                empty={`沒有里同時是兩題熱點${pair.expected >= 1 ? `（隨機期望 ${fmtNum(pair.expected, 1)} 里）` : ''}`} />
            )}
          </>
        ) : (
          <Panel tag="PAIR" title="配對詳情"><div className="loading" style={{ height: 200, position: 'relative' }}>LOADING</div></Panel>
        )}
        <Method V={V} />
      </div>
    </div>
  )
}

/* ---------------- header ---------------- */
function LxHeader({ pairs, V }: { pairs: Pair[] | null; V?: VillageFC }) {
  const sup = pairs?.filter((p) => Math.abs(p.rho) >= SUPPORT_RHO).length
  const pos = pairs?.reduce((m, p) => (p.rho > m.rho ? p : m))
  const neg = pairs?.reduce((m, p) => (p.rho < m.rho ? p : m))
  const multi = V?.features.filter((f) => f.properties.hot >= 2)
  const tri = V?.features.filter((f) => f.properties.hot >= 3).length
  const pairName = (p: Pair) => `${domain(p.a).short} × ${domain(p.b).short}`
  return (
    <header className="dp-head lx-head" style={{ ['--c' as string]: 'var(--focus)' }}>
      <span className="dp-code num">LX</span>
      <IconLinks size={24} className="dp-icon" />
      <div className="dp-titles">
        <h1 className="dp-title">
          跨題關聯分析
          <span className="dp-kind">ANALYSIS · 15 組配對 × {V?.features.length ?? '—'} 里</span>
        </h1>
        <p className="dp-q">哪些問題集中在同一批里？哪些局處要一起處理？</p>
      </div>
      <div className="dp-meta" title={`兩題里別分數 |Spearman ρ| ≥ ${SUPPORT_RHO}`}>
        <span className="dp-k">資料支持的配對（|ρ| ≥ {SUPPORT_RHO}）</span>
        <span><b className="num">{sup ?? '—'}</b><small>/ 15 組</small></span>
      </div>
      {pos && (
        <div className="dp-meta">
          <span className="dp-k">最強同向</span>
          <span><b className="num">{fmtRho(pos.rho)}</b><small>{pairName(pos)}</small></span>
        </div>
      )}
      {neg && neg.rho < 0 && (
        <div className="dp-meta">
          <span className="dp-k">最強反向</span>
          <span><b className="num">{fmtRho(neg.rho)}</b><small>{pairName(neg)}</small></span>
        </div>
      )}
      <div className="dp-meta" title={`六題中有 2 題以上分數 ≥ ${HOT} 的里`}>
        <span className="dp-k">2 題以上熱點的里</span>
        <span><b className="num">{multi?.length ?? '—'}</b><small>人口 {fmtWan(multi?.reduce((s, f) => s + f.properties.pop, 0))}</small></span>
      </div>
      <div className="dp-meta" title={`六題中有 3 題以上分數 ≥ ${HOT} 的里`}>
        <span className="dp-k">3 題以上</span>
        <span><b className="num">{tri ?? '—'}</b><small>里</small></span>
      </div>
    </header>
  )
}

/* ---------------- pair ranking ---------------- */
function DomainMark({ d }: { d: Domain }) {
  return (
    <span className="dm" style={{ ['--c' as string]: d.color }}>
      <i />
      <span className="num">{d.code}</span>
      {d.short}
    </span>
  )
}

/** diverging bar centered on ρ = 0 with ticks at ±SUPPORT_RHO */
function RhoBar({ rho, w = 56 }: { rho: number; w?: number }) {
  const x = (v: number) => w / 2 + (Math.max(-RHO_MAX, Math.min(RHO_MAX, v)) / RHO_MAX) * (w / 2 - 1)
  const x0 = x(0)
  const x1 = x(rho)
  return (
    <svg width={w} height={10} className="rb" aria-hidden="true">
      <rect x={0} y={4} width={w} height={2} className="rb-track" />
      {[-SUPPORT_RHO, SUPPORT_RHO].map((t) => <line key={t} x1={x(t)} x2={x(t)} y1={1.5} y2={8.5} className="rb-th" />)}
      <rect x={Math.min(x0, x1)} y={2} width={Math.max(1, Math.abs(x1 - x0))} height={6} rx={1} fill={rho >= 0 ? DIV.pos : DIV.neg} />
      <line x1={x0} x2={x0} y1={0} y2={10} className="rb-zero" />
    </svg>
  )
}

function PairList({ pairs, selected, node, onPick }: { pairs: Pair[]; selected: string; node: number | null; onPick: (k: string) => void }) {
  const [sort, setSort] = useState<'rho' | 'co'>('rho')
  const rows = pairs
    .filter((p) => node == null || p.a === node || p.b === node)
    .sort((x, y) => (sort === 'co' ? y.ids.length - x.ids.length : 0) || Math.abs(y.rho) - Math.abs(x.rho))
  return (
    <div className="px">
      <div className="px-row px-head">
        <span>配對</span>
        <button className={sort === 'rho' ? 'on' : ''} onClick={() => setSort('rho')} style={{ gridColumn: 'span 2' }} title="依兩題里別分數相關 |ρ| 排序">
          里分數 ρ{sort === 'rho' ? ' ▾' : ''}
        </button>
        <button className={sort === 'co' ? 'on' : ''} onClick={() => setSort('co')} title={`依共同熱點里數（兩題都 ≥ ${HOT}）排序`}>
          共同{sort === 'co' ? ' ▾' : ''}
        </button>
        <span>依據</span>
      </div>
      {rows.map((p) => {
        const A = domain(p.a)
        const B = domain(p.b)
        const on = p.key === selected
        return (
          <button key={p.key} className={`px-row${on ? ' on' : ''}`} onClick={() => onPick(p.key)} aria-pressed={on}
            title={`${A.code} ${A.short} × ${B.code} ${B.short}\n里分數 ρ ${fmtRho(p.rho)} · Jaccard ${fmtNum(p.jaccard, 2)} · 共同熱點 ${p.ids.length} 里\n${KIND[p.kind].label}：${KIND[p.kind].note}`}>
            <span className="px-name">
              <DomainMark d={A} />
              <span className="px-x">×</span>
              <DomainMark d={B} />
            </span>
            <RhoBar rho={p.rho} />
            <span className="px-rho num">{fmtRho(p.rho)}</span>
            <span className="px-co num">{p.ids.length}</span>
            <span className={`kt ${p.kind}`}>{KIND[p.kind].tag}</span>
          </button>
        )
      })}
    </div>
  )
}

function KindLegend() {
  return (
    <div className="kt-legend">
      {(Object.keys(KIND) as Kind[]).map((k) => (
        <span key={k}><span className={`kt ${k}`}>{KIND[k].tag}</span>{KIND[k].note}</span>
      ))}
      <span><RhoBar rho={0.4} w={40} />藍 = 同向、紅 = 反向；細刻度 = ±{SUPPORT_RHO}</span>
    </div>
  )
}

function NodeChip({ id, onClear }: { id: number; onClear: () => void }) {
  const d = domain(id)
  return (
    <span className="dchip lx-node" style={{ ['--c' as string]: d.color }}>
      只看 <span className="num">{d.code}</span> {d.short}
      <button onClick={onClear} aria-label="清除篩選" title="清除篩選"><IconClose size={11} /></button>
    </span>
  )
}

/* ---------------- map tooltip ---------------- */
function MapTip({ p, A, B }: { p: VillageProps; A: Domain; B: Domain }) {
  const m = minScore(p, [A.id, B.id])
  return (
    <>
      <div className="tip-title">{p.v} <span className="muted">· {p.d}</span></div>
      <div className="tip-row"><span className="k">{A.code} {A.scoreLabel}</span><span className="v">{fmtScore(p[A.score])}</span></div>
      <div className="tip-row"><span className="k">{B.code} {B.scoreLabel}</span><span className="v">{fmtScore(p[B.score])}</span></div>
      <div className="tip-row"><span className="k">兩題較小值</span><span className="v">{fmtScore(m)}{m != null && m >= HOT ? ' · 共同熱點' : ''}</span></div>
      <div className="tip-row"><span className="k">高需求題數</span><span className="v">{p.hot} / 6</span></div>
    </>
  )
}

/* ---------------- pair detail ---------------- */
function DomainLink({ d }: { d: Domain }) {
  const Icon = DOMAIN_ICONS[d.id - 1]
  return (
    <a className="pd-d" href={href({ name: 'domain', id: d.id })} style={{ ['--c' as string]: d.color }} title={`開啟 ${d.code} ${d.title}`}>
      <Icon size={15} className="pd-icon" />
      <span className="num">{d.code}</span>
      <b>{d.short}</b>
    </a>
  )
}

function PairDetail({ p, A, B, totalPop }: { p: Pair; A: Domain; B: Domain; totalPop: number }) {
  // the ratio is noisy when fewer than 2 co-hot 里 are expected, so it is only shown above that
  const lift = p.expected >= 2 ? p.ids.length / p.expected : null
  const dir = p.rho >= SUPPORT_RHO
    ? `${A.scoreLabel}高的里，${B.scoreLabel}也偏高`
    : p.rho <= -SUPPORT_RHO
      ? `${A.scoreLabel}高的里，${B.scoreLabel}反而偏低`
      : '兩題的里別分數幾乎無關'
  const agencies = p.edge?.agencies ?? agenciesOf([p.a, p.b])
  return (
    <Panel tag="PAIR" title="配對詳情" className="ticks"
      right={<span className={`kt ${p.kind}`} title={KIND[p.kind].note}>{KIND[p.kind].label}</span>}>
      <div className="pd">
        <div className="pd-h">
          <DomainLink d={A} />
          <span className="pd-x">×</span>
          <DomainLink d={B} />
        </div>
        <div className="pd-stats">
          <div className="pd-stat">
            <span className="k" title="兩題里別分數的 Spearman 等級相關">里分數相關 ρ</span>
            <span className="v num">{fmtRho(p.rho)}</span>
            <span className="s">n = {p.n} 里</span>
          </div>
          <div className="pd-stat">
            <span className="k">共同熱點里</span>
            <span className="v num">{p.ids.length}</span>
            <span className="s">隨機期望 {fmtNum(p.expected, 1)}</span>
          </div>
          <div className="pd-stat">
            <span className="k">熱點重疊 Jaccard</span>
            <span className="v num">{fmtNum(p.jaccard, 2)}</span>
            <span className="s">交集 ÷ 聯集</span>
          </div>
        </div>
        <p className="pd-read">
          {dir}。
          {p.ids.length > 0 ? (
            <>
              <b className="num">{p.ids.length}</b> 個里同時是兩題熱點，人口 <b className="num">{fmtWan(p.pop)}</b>（占全市 {fmtPct(p.pop / totalPop, 1)}）
              {lift != null && (lift >= 1.2
                ? <>，約為兩題互相獨立時期望值的 <b className="num">{fmtNum(lift, 1)}</b> 倍</>
                : lift <= 0.8
                  ? <>，少於兩題互相獨立時的期望值（{fmtNum(p.expected, 1)} 里）：兩題的熱點傾向落在不同的里</>
                  : <>，與兩題互相獨立時的期望值（{fmtNum(p.expected, 1)} 里）相當</>)}。
            </>
          ) : (
            <>沒有里同時是兩題熱點{p.expected >= 1 ? `（隨機期望 ${fmtNum(p.expected, 1)} 里）` : ''}。</>
          )}
        </p>
        <div className="pd-sec">
          <div className="pd-k">機制假設</div>
          {p.edge ? <p className="pd-mech">{p.edge.mechanism}</p> : <p className="pd-mech muted">未列入機制假設；上面的相關只描述分布，不代表兩題互相影響。</p>}
        </div>
        {p.edge && p.edge.evidence.length > 0 && (
          <div className="pd-sec">
            <div className="pd-k">佐證指標</div>
            {p.edge.evidence.map((e) => (
              <div key={e.label} className="pd-ev">
                <span>{e.label}</span>
                <span className="v num">{fmtEvidence(e)}</span>
              </div>
            ))}
          </div>
        )}
        <div className="pd-sec">
          <div className="pd-k">{p.edge ? '協作局處' : '兩題權責機關'}</div>
          <div className="pd-ag">{agencies.map((a) => <span key={a} className="chip">{a}</span>)}</div>
        </div>
      </div>
    </Panel>
  )
}

/* ---------------- scatter: score A vs score B for every 里 ---------------- */
function Scatter({ p, A, B, V, selected, onPick }: { p: Pair; A: Domain; B: Domain; V: VillageFC; selected: number | null; onPick: (i: number) => void }) {
  const [ref, w0] = useWidth<HTMLDivElement>()
  const w = w0 || 360
  const h = 236
  const M = { l: 34, r: 12, t: 20, b: 26 }
  const [hv, setHv] = useState<number | null>(null)
  const pts = useMemo(
    () => V.features
      .map((f) => f.properties)
      .filter((q) => q[A.score] != null && q[B.score] != null)
      .map((q) => {
        const x = q[A.score] as number
        const y = q[B.score] as number
        return { i: q.i, v: q.v, d: q.d, x, y, hot: x >= HOT && y >= HOT }
      }),
    [V, A, B],
  )
  const xs = scaleLinear().domain([0, 100]).range([M.l, w - M.r])
  const ys = scaleLinear().domain([0, 100]).range([h - M.b, M.t])
  const hp = hv != null ? pts[hv] ?? null : null
  const sp = selected != null ? pts.find((q) => q.i === selected) : undefined
  const nearest = (mx: number, my: number) => {
    let best: number | null = null
    let bd = 14 * 14
    pts.forEach((q, k) => {
      const d = (xs(q.x) - mx) ** 2 + (ys(q.y) - my) ** 2
      if (d < bd) {
        bd = d
        best = k
      }
    })
    return best
  }
  return (
    <div className="scx" ref={ref}>
      <svg width={w} height={h} className="scx-svg" role="img" aria-label={`${A.scoreLabel}與${B.scoreLabel}的里別散布圖`}
        style={{ cursor: hp ? 'pointer' : 'default' }}
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          setHv(nearest(e.clientX - r.left, e.clientY - r.top))
        }}
        onMouseLeave={() => setHv(null)}
        onClick={() => hp && onPick(hp.i)}>
        <rect x={xs(HOT)} y={ys(100)} width={xs(100) - xs(HOT)} height={ys(HOT) - ys(100)} className="scx-q" />
        {[0, 25, 50, 75, 100].map((t) => (
          <g key={t}>
            <line x1={xs(t)} x2={xs(t)} y1={ys(0)} y2={ys(100)} className="chart-grid" />
            <line x1={xs(0)} x2={xs(100)} y1={ys(t)} y2={ys(t)} className="chart-grid" />
            <text x={xs(t)} y={h - 13} textAnchor="middle" className="chart-tick">{t}</text>
            <text x={M.l - 5} y={ys(t) + 3.5} textAnchor="end" className="chart-tick">{t}</text>
          </g>
        ))}
        <line x1={xs(HOT)} x2={xs(HOT)} y1={ys(0)} y2={ys(100)} className="scx-th" />
        <line x1={xs(0)} x2={xs(100)} y1={ys(HOT)} y2={ys(HOT)} className="scx-th" />
        <text x={xs(100)} y={M.t - 5} textAnchor="end" className="scx-q-label">右上角 = 共同熱點 {p.ids.length} 里</text>
        {pts.map((q) => !q.hot && <circle key={q.i} cx={xs(q.x)} cy={ys(q.y)} r={2.4} className="scx-pt" />)}
        {pts.map((q) => q.hot && <circle key={q.i} cx={xs(q.x)} cy={ys(q.y)} r={3.2} className="scx-pt hot" />)}
        {sp && <circle cx={xs(sp.x)} cy={ys(sp.y)} r={6.5} className="scx-sel" />}
        {hp && <circle cx={xs(hp.x)} cy={ys(hp.y)} r={5} className="scx-hv" />}
        <text x={M.l} y={M.t - 5} className="chart-axis-label">↑ {B.code} {B.scoreLabel}</text>
        <text x={w - M.r} y={h - 1} textAnchor="end" className="chart-axis-label">{A.code} {A.scoreLabel} →</text>
      </svg>
      {hp && (
        <div className="tip" style={{ left: Math.min(xs(hp.x) + 14, w - 190), top: Math.max(0, ys(hp.y) - 76) }}>
          <div className="tip-title">{hp.v} <span className="muted">· {hp.d}</span></div>
          <div className="tip-row"><span className="k">{A.code} {A.short}</span><span className="v">{fmtNum(hp.x, 1)}</span></div>
          <div className="tip-row"><span className="k">{B.code} {B.short}</span><span className="v">{fmtNum(hp.y, 1)}</span></div>
          <div className="tip-row"><span className="k">共同熱點</span><span className="v">{hp.hot ? '是' : '否'}</span></div>
        </div>
      )}
    </div>
  )
}

/* ---------------- combinations (UpSet): which problems pile up in the same 里 ---------------- */
/** bar with a rounded data end at the top, square at the baseline */
function barPath(x: number, y: number, w: number, h: number, r = 2) {
  const k = Math.min(r, w / 2, h)
  return `M${x},${y + h}V${y + k}Q${x},${y} ${x + k},${y}H${x + w - k}Q${x + w},${y} ${x + w},${y + k}V${y + h}Z`
}

function UpSet({ combos, byI, hot, selected, onPick }: {
  combos: Combo[]
  byI: Map<number, VillageProps>
  hot?: Record<string, number>
  selected: string | null
  onPick: (k: string | null) => void
}) {
  const [ref, w0] = useWidth<HTMLDivElement>()
  const w = w0 || 640
  const [hv, setHv] = useState<Combo | null>(null)
  // label column (swatch · code · name · hot count) is LW wide and starts PL from the panel edge
  const PL = 10
  const LW = 114
  const RH = 14
  const BH = 46
  const T = 13
  const n = combos.length
  const cw = Math.max(16, Math.min(42, (w - LW - 12) / Math.max(n, 1)))
  const bw = Math.min(20, cw * 0.6)
  const max = Math.max(...combos.map((c) => c.ids.length), 1)
  const base = T + BH
  const y0 = base + 7
  const H = y0 + RH * DOMAINS.length + 1
  const cx = (k: number) => LW + k * cw + cw / 2
  const rowY = (id: number) => y0 + (id - 1) * RH + RH / 2
  const hk = hv ? combos.indexOf(hv) : -1
  const names = (c: Combo) => {
    const list = c.ids.slice(0, 6).map((i) => byI.get(i)).filter((q): q is VillageProps => !!q).map((q) => `${q.d}${q.v}`)
    return `${list.join('、')}${c.ids.length > 6 ? ` 等 ${c.ids.length} 里` : ''}`
  }
  return (
    <div className="up" ref={ref}>
      <svg width={w} height={H} className="up-svg" role="img" aria-label="多題熱點組合">
        <text x={LW - 9} y={T + 9} textAnchor="end" className="up-n">里數</text>
        <text x={LW - 9} y={y0 - 2} textAnchor="end" className="up-n">熱點里</text>
        {DOMAINS.map((d, r) => (
          <g key={d.id}>
            {r % 2 === 0 && <rect x={LW - 2} y={y0 + r * RH} width={n * cw + 4} height={RH} className="up-stripe" />}
            <rect x={PL} y={rowY(d.id) - 3.5} width={7} height={7} fill={d.hex} />
            <text x={PL + 13} y={rowY(d.id) + 3.5} className="up-code num">{d.code}</text>
            <text x={PL + 30} y={rowY(d.id) + 4} className="up-name">{d.short}</text>
            {hot && <text x={LW - 9} y={rowY(d.id) + 3.5} textAnchor="end" className="up-n num">{hot[String(d.id)]}</text>}
          </g>
        ))}
        <line x1={LW - 2} x2={LW + n * cw + 2} y1={base + 0.5} y2={base + 0.5} className="up-base" />
        {combos.map((c, k) => {
          const x = cx(k)
          const v = c.ids.length
          const top = base - (v / max) * BH
          const on = selected === c.key
          const ys = c.set.map(rowY)
          return (
            <g key={c.key} className={`up-col${on ? ' on' : ''}`} role="button" aria-pressed={on} aria-label={`${comboName(c.set)}：${v} 里`}
              onMouseEnter={() => setHv(c)} onMouseLeave={() => setHv(null)} onClick={() => onPick(on ? null : c.key)}>
              <rect x={x - cw / 2} y={0} width={cw} height={H} className="up-hit" />
              <path d={barPath(x - bw / 2, top, bw, base - top)} className="up-bar" />
              <text x={x} y={top - 3} textAnchor="middle" className="up-v num">{v}</text>
              {DOMAINS.map((d) => !c.set.includes(d.id) && <circle key={d.id} cx={x} cy={rowY(d.id)} r={2.5} className="up-off" />)}
              <line x1={x} x2={x} y1={Math.min(...ys)} y2={Math.max(...ys)} className="up-link" />
              {c.set.map((id) => <circle key={id} cx={x} cy={rowY(id)} r={4} className="up-dot" />)}
            </g>
          )
        })}
      </svg>
      {hv && hk >= 0 && (
        <div className="tip" style={{ left: Math.max(0, Math.min(cx(hk) + 16, w - 268)), top: 4, width: 260 }}>
          <div className="tip-title">{comboName(hv.set)}</div>
          <div className="tip-row"><span className="k">剛好是這 {hv.set.length} 題熱點的里</span><span className="v">{hv.ids.length}</span></div>
          <div className="tip-row"><span className="k">人口</span><span className="v">{fmtWan(hv.pop)}</span></div>
          <div className="tip-mech">{names(hv)}</div>
        </div>
      )}
    </div>
  )
}

/* ---------------- 里 list for the current selection ---------------- */
function FocusList({ title, doms, ids, byI, totalPop, selected, onPick, agencies, empty, revealKey }: {
  title: string
  doms: number[]
  ids: number[]
  byI: Map<number, VillageProps>
  totalPop: number
  selected: number | null
  onPick: (i: number) => void
  agencies?: string[]
  empty?: string
  /** scroll the list into view whenever this changes (a combination picked in the center) */
  revealKey?: string
}) {
  const top = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (revealKey) top.current?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }, [revealKey])
  const rows = ids.map((i) => byI.get(i)).filter((q): q is VillageProps => !!q)
  const pop = rows.reduce((s, q) => s + q.pop, 0)
  const cols = `22px minmax(0, 1fr) repeat(${doms.length}, 30px) 50px`
  return (
    <Panel tag="CH" title={title} className="ticks" right={<span className="mono-tag">{rows.length} 里</span>}>
      <div className="fl-sum" ref={top}>
        {rows.length ? <>人口 <b className="num">{fmtWan(pop)}</b>（占全市 {fmtPct(pop / totalPop, 1)}）· 依各題分數的較小值排序</> : empty}
      </div>
      {agencies && (
        <div className="fl-ag">
          <span className="k">權責機關</span>
          {agencies.map((a) => <span key={a} className="chip">{a}</span>)}
        </div>
      )}
      {rows.length > 0 && (
        <>
          <div className="pl-row pl-head" style={{ gridTemplateColumns: cols }}>
            <span className="pl-rank">#</span>
            <span className="pl-name">里</span>
            {doms.map((id) => (
              <span key={id} className="fl-s num" title={domain(id).scoreLabel}>
                <i className="fl-sw" style={{ ['--c' as string]: domain(id).color }} />
                {domain(id).code}
              </span>
            ))}
            <span className="fl-pop">人口</span>
          </div>
          <div className="fl-body scroll">
            {rows.map((q, k) => (
              <button key={q.i} className={`pl-row${selected === q.i ? ' on' : ''}`} style={{ gridTemplateColumns: cols }} onClick={() => onPick(q.i)}
                title={`${q.d}${q.v}：${doms.map((id) => `${domain(id).short} ${fmtScore(q[sk(id)])}`).join('、')}`}>
                <span className="pl-rank num">{k + 1}</span>
                <span className="pl-name">{q.v}<small>{q.d}</small></span>
                {doms.map((id) => <span key={id} className="fl-s num">{fmtInt(q[sk(id)])}</span>)}
                <span className="fl-pop num">{fmtInt(q.pop)}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </Panel>
  )
}

/* ---------------- method ---------------- */
function Method({ V }: { V?: VillageFC }) {
  const missing = DOMAINS.map((d) => ({ d, n: V ? V.features.filter((f) => f.properties[d.score] == null).length : 0 })).filter((x) => x.n > 0)
  const items: ReactNode[] = [
    <>里別分數：各題依全市百分位加權（0–100），分數 ≥ {HOT} 的里為該題「熱點」。</>,
    <>Spearman ρ：兩題里別分數的等級相關。|ρ| ≥ {SUPPORT_RHO} 視為資料支持；正值 = 一題高的里另一題也偏高，負值 = 反向。</>,
    <>共同熱點：兩題分數都 ≥ {HOT} 的里。隨機期望 = 熱點 A 里數 × 熱點 B 里數 ÷ 兩題都有分數的里數；期望不足 2 里時不顯示倍數。</>,
    <>Jaccard = 兩題熱點里的交集 ÷ 聯集。</>,
    ...(missing.length
      ? [<>沒有分數的里不列入該題的配對：{missing.map(({ d, n }) => `${d.code} ${d.short} ${n} 里（${NO_SCORE[d.id] ?? '缺資料'}）`).join('；')}。</>]
      : []),
    <>多題疊加組合：每個里只歸入它剛好是熱點的那組題目，不重複計算。</>,
    <>機制假設共 8 組，是本專案依業務常識列出的推論；資料只能說明兩題發生在同一批里，不能證明因果。</>,
  ]
  return (
    <Panel tag="AS" title="方法與資料來源" className="ticks" foot={<Prov keys={ALL_SOURCES} />}>
      <ol className="as">
        {items.map((it, i) => (
          <li key={i}><span className="num">{String(i + 1).padStart(2, '0')}</span><span>{it}</span></li>
        ))}
      </ol>
    </Panel>
  )
}
