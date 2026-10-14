// 全市總覽：六題現況 → 里別需求地圖 → 跨題關聯 → 優先處理里 → 即時監看 → 情境成效
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { ShareBar, Sparkline } from '../components/Charts'
import { DOMAIN_ICONS, IconArrow, IconClose, IconCube, StatusGlyph } from '../components/Icons'
import { LinkGraph, LinkLegend, edgeKey } from '../components/LinkGraph'
import MapView, { ClassLegend } from '../components/MapView'
import { LiveBadge, MockBadge, Panel, Prov } from '../components/Panel'
import { HOT, VillageCard } from '../components/VillageCard'
import { useData, useLive, useSeries } from '../lib/data'
import { DOMAINS, domain, type Domain } from '../lib/domains'
import { fmtDeltaPct, fmtHM, fmtInt, fmtNum, fmtPct, fmtTime, fmtWan } from '../lib/format'
import { villageCenter, villageProps } from '../lib/geo'
import { impact1, impact2, impact3, impact4, impact5, impact6 } from '../lib/impact'
import { go, href } from '../lib/router'
import { LOS, NA_FILL, SEQ, quantileClasses, seqColor, type Classes } from '../lib/scales'
import { useAppState } from '../lib/state'
import type { Impact, LinkEdge, Links, ScoreKey, VillageFC, VillageProps } from '../lib/types'

/* ---------------- map metrics ---------------- */
type MetricKey = 'f' | 'hot' | ScoreKey
interface MetricDef {
  key: MetricKey
  short: string
  label: string
  domain?: Domain
}
const METRICS: MetricDef[] = [
  { key: 'f', short: '綜合', label: '綜合需求分數（六題平均）' },
  { key: 'hot', short: '熱點數', label: `高需求題數（分數 ≥ ${HOT}）` },
  ...DOMAINS.map((d) => ({ key: d.score, short: d.code, label: `${d.code} ${d.scoreLabel}`, domain: d })),
]
const HOT_CLASSES: Classes = { breaks: [0.5, 1.5, 2.5], colors: [SEQ[0], SEQ[2], SEQ[4], SEQ[6]], min: 0, max: 3 }

const MAP_SOURCES = ['village', 'population_age', 'trees_street', 'sidewalk', 'bins', 'ratradar', 'road_live', 'bus_timetable', 'liquefaction', 'fire_access']

/* ======================================================================= */
export default function Overview() {
  const V = useData<VillageFC>('villages.geojson')
  const I = useData<Impact>('impact.json')
  const L = useData<Links>('links.json')
  const { selected, select } = useAppState()
  const [metric, setMetric] = useState<MetricKey>('f')
  const [ext, setExt] = useState(false)
  const [edge, setEdge] = useState<LinkEdge | null>(null)
  const [fly, setFly] = useState<{ lon: number; lat: number; zoom: number; key: string } | null>(null)

  const m = METRICS.find((x) => x.key === metric)!
  const classes = useMemo(
    () => (!V ? null : metric === 'hot' ? HOT_CLASSES : quantileClasses(V.features.map((f) => f.properties[metric]))),
    [V, metric],
  )
  const choro = useMemo(() => (classes ? { key: metric, classes } : null), [metric, classes])
  const extrude = useMemo(() => (ext ? { key: metric, scale: metric === 'hot' ? 650 : 26 } : null), [ext, metric])
  const coHot = useMemo(() => {
    if (!edge || !V) return null
    const a = `s${edge.a}` as ScoreKey
    const b = `s${edge.b}` as ScoreKey
    return V.features.filter((f) => (f.properties[a] ?? -1) >= HOT && (f.properties[b] ?? -1) >= HOT).map((f) => f.properties.i)
  }, [edge, V])
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

  const pick = (i: number) => {
    select(i)
    const c = V && villageCenter(V, i)
    if (c) setFly({ lon: c[0], lat: c[1], zoom: 13.8, key: `${i}-${Date.now()}` })
  }

  const fmtMetric = (v: number | null | undefined) => (v == null ? '無資料' : metric === 'hot' ? `${v} 題` : fmtNum(v, 1))

  return (
    <div className="view ov">
      <DomainTiles I={I} L={L} />

      {/* ---------- left: link graph + priority list ---------- */}
      <div className="ov-left stagger">
        <Panel tag="LX" title="跨題關聯" className="ticks"
          right={<a className="btn btn-ghost" href={href({ name: 'links' })}>詳細 <IconArrow size={12} /></a>}
          foot={<LinkLegend />}>
          {L ? (
            <div className="ov-graph">
              <LinkGraph links={L} selected={edge ? edgeKey(edge) : null} onSelect={setEdge}
                activeNode={m.domain?.id ?? null}
                onNode={(id) => setMetric(domain(id).score)} />
              <div className="ov-graph-hint">點連線看共同熱點里；點節點切換地圖指標</div>
            </div>
          ) : <div className="loading" style={{ height: 232, position: 'relative' }}>LOADING</div>}
        </Panel>
        <Panel tag="P1" title="優先處理里" className="ov-pl"
          right={<span className="mono-tag">綜合分數前 {I?.fusion.top.length ?? '—'}</span>}
          foot={<div className="pl-legend"><span>格色 = 該題分數（亮 = 需求高）</span><span><i className="pl-dot" /> 熱點 ≥ {HOT}</span></div>}>
          {I && <PriorityList top={I.fusion.top} selected={selected} onPick={pick} />}
        </Panel>
      </div>

      {/* ---------- center: map ---------- */}
      <Panel tag="MAP" title="里別需求地圖" className="ov-map ticks" bodyClass="ov-map-b"
        right={<span className="mono-tag">{V ? `${V.features.length} 里 · 人口 ${V.meta.population_period}` : ''}</span>}
        foot={<Prov keys={MAP_SOURCES} compact note="分數 = 全市百分位加權；綜合 = 六題平均" />}>
        <MapView villages={V} choro={choro} extrude={extrude} selected={selected} onSelect={select}
          highlight={coHot} focus={fly} showExtrudeToggle={false}
          villageTip={(p) => <VillageTip p={p} label={m.label} value={fmtMetric(p[metric] as number | null)} />}>
          <div className="map-ov tl ov-ctrl">
            <div className="seg" role="tablist" aria-label="地圖指標">
              {METRICS.map((x) => (
                <button key={x.key} className={metric === x.key ? 'on' : ''} onClick={() => setMetric(x.key)} title={x.label}
                  style={x.domain ? { ['--c' as string]: x.domain.color } : undefined}>
                  {x.domain && <i className="seg-sw" />}
                  {x.short}
                </button>
              ))}
            </div>
            <button className={`btn${ext ? ' on' : ''}`} onClick={() => setExt((v) => !v)} title="以高度表示分數（可拖曳右鍵旋轉）">
              <IconCube size={13} /> 立體
            </button>
            {edge && coHot && (
              <div className="ov-cohot">
                <span className="num">{domain(edge.a).code}</span> {domain(edge.a).short} × <span className="num">{domain(edge.b).code}</span> {domain(edge.b).short}
                <b className="num">{coHot.length}</b> 個共同熱點里（虛線框）
                <button onClick={() => setEdge(null)} aria-label="清除"><IconClose size={12} /></button>
              </div>
            )}
          </div>
          {classes && (
            <div className="map-ov bl">
              <ClassLegend title={m.label} classes={classes} fmt={(v) => (metric === 'hot' ? `${Math.round(v)} 題` : fmtNum(v, 0))}
                note={metric === 'hot' ? undefined : '分級：分位數 7 級'} />
            </div>
          )}
          {sel && (
            <div className="map-ov tr">
              <VillageCard p={sel} onClose={() => select(null)} onDomain={(id) => go({ name: 'domain', id: id as 1 })}
                focusDomain={m.domain?.id}
                rows={[
                  { k: `高需求題數（≥ ${HOT}）`, v: `${sel.hot} / 6` },
                  { k: '面積 · 人口密度', v: `${fmtNum(sel.km2, 2)} km² · ${fmtInt(sel.dens)} 人/km²` },
                ]}
                foot="點分數列開啟該題模組，地圖會保留這個里" />
            </div>
          )}
        </MapView>
      </Panel>

      {/* ---------- right: live watch + scenario ---------- */}
      <div className="ov-right scroll stagger">
        <LiveWatch />
        {I && <ScenarioSummary I={I} />}
      </div>
    </div>
  )
}

/* ---------------- map tooltip ---------------- */
function VillageTip({ p, label, value }: { p: VillageProps; label: string; value: string }) {
  return (
    <>
      <div className="tip-title">
        {p.v} <span className="muted">· {p.d}</span>
      </div>
      <div className="tip-row"><span className="k">{label}</span><span className="v">{value}</span></div>
      <div className="tip-row"><span className="k">高需求題數</span><span className="v">{p.hot} / 6</span></div>
      <div className="tip-row"><span className="k">人口 · 65 歲以上</span><span className="v">{fmtInt(p.pop)} · {fmtPct(p.r65, 0)}</span></div>
    </>
  )
}

/* ======================================================================= */
/* 六題現況 */
function DomainTiles({ I, L }: { I?: Impact; L?: Links }) {
  const { traffic, bus, series } = useLive()
  const S = useSeries(series)
  const tiles: Record<number, { k: string; v: ReactNode; u?: string; sub: ReactNode; live?: boolean; spark?: ReactNode; mock?: boolean }> = {}
  if (I) {
    const b1 = I['1'].baseline
    const c0 = I['1'].curve[0]
    tiles[1] = { k: '人行道遮蔭率', v: fmtPct(c0.city_shade), sub: <>缺蔭里 <b>{c0.low_villages}</b> · 可補植樹位 <b>{fmtInt(b1.plantable_slots)}</b></> }
    const b2 = I['2'].baseline
    tiles[2] = { k: '人潮需求涵蓋率', v: fmtPct(b2.covered), sub: <>≥10 線公車站沒有清潔箱 <b>{fmtInt(b2.busy_stops_uncovered)}</b> 站</> }
    const b3 = I['3'].baseline
    tiles[3] = { k: '見鼠通報', v: fmtInt(b3.sightings), u: '件', sub: <>風險前 20% 里涵蓋 <b>{fmtPct(b3.top20_captured, 0)}</b> 通報</> }
    const b6 = I['6'].baseline
    tiles[6] = { k: '液化潛勢區長者（面積加權）', v: fmtNum(b6.exposed_elderly / 1e4, 1), u: '萬人', sub: <>屋齡 30 年以上建物 <b>{fmtPct(b6.old_building_share, 0)}</b>（{b6.building_year}）</> }
  }
  if (traffic) {
    const n = traffic.neihu
    tiles[4] = {
      k: '內湖路段壅塞比例', v: fmtPct(n.congested_share), live: true,
      spark: S && <Sparkline values={S.get('neihu_cong')} times={S.t} fmt={(v) => fmtPct(v)} fmtT={(t) => fmtHM(t)} color="var(--d4)" width={84} height={24} />,
      sub: <>VD 平均 V/C <b>{fmtNum(n.vc_mean, 2)}</b> · 均速 <b>{fmtNum(n.mean_speed, 1)}</b> km/h</>,
    }
  }
  if (bus) {
    tiles[5] = {
      k: '營運中公車', v: fmtInt(bus.on_duty), u: '輛', live: true,
      spark: S && <Sparkline values={S.get('bus_on_duty')} times={S.t} fmt={(v) => `${fmtInt(v)} 輛`} fmtT={(t) => fmtHM(t)} color="var(--d5)" width={84} height={24} />,
      sub: <>平均候車 <b>{fmtNum(bus.eta.mean_wait_min, 1)}</b> 分 · 3 分內到站 <b>{fmtPct(bus.eta.within_3min, 0)}</b></>,
    }
  }
  return (
    <div className="ov-tiles stagger">
      {DOMAINS.map((d) => {
        const t = tiles[d.id]
        const Icon = DOMAIN_ICONS[d.id - 1]
        return (
          <a key={d.id} className="dtile" href={href({ name: 'domain', id: d.id })} style={{ ['--c' as string]: d.color }} title={`${d.code} ${d.title}：${d.question}`}>
            <span className="dtile-h">
              <span className="num dtile-code">{d.code}</span>
              <Icon size={14} className="dtile-icon" />
              <span className="dtile-name">{d.short}</span>
              {t?.live && <span className="live-dot" title="即時" />}
              <span className="dtile-hot num" title={`${d.scoreLabel} ≥ ${HOT} 的里`}>熱點 {L ? L.hot_counts[String(d.id)] : '—'} 里</span>
            </span>
            <span className="dtile-k">{t?.k ?? '—'}</span>
            <span className="dtile-row">
              <span className="dtile-v num">{t?.v ?? '—'}</span>
              {t?.u && <span className="dtile-u">{t.u}</span>}
              {t?.spark && <span className="dtile-spark">{t.spark}</span>}
            </span>
            <span className="dtile-sub">{t?.sub ?? ''}</span>
            <span className="dtile-go"><IconArrow size={12} /></span>
          </a>
        )
      })}
    </div>
  )
}

/* ======================================================================= */
/* 優先處理里 */
function PriorityList({ top, selected, onPick }: { top: Impact['fusion']['top']; selected: number | null; onPick: (i: number) => void }) {
  return (
    <div className="pl">
      <div className="pl-row pl-head">
        <span className="pl-rank">#</span>
        <span className="pl-name">里</span>
        <span className="pl-cells">
          {DOMAINS.map((d) => (
            <span key={d.id} className="num" title={`${d.code} ${d.short}`}>{d.code}</span>
          ))}
        </span>
        <span className="pl-f">綜合</span>
      </div>
      <div className="pl-body scroll">
        {top.map((t, k) => (
          <button key={t.i} className={`pl-row${selected === t.i ? ' on' : ''}`} onClick={() => onPick(t.i)} title={`${t.d}${t.v}：綜合 ${fmtNum(t.f, 1)}，${t.hot} 題 ≥ ${HOT}`}>
            <span className="pl-rank num">{k + 1}</span>
            <span className="pl-name">
              {t.v}
              <small>{t.d}</small>
            </span>
            <span className="pl-cells">
              {t.s.map((s, j) => (
                <i key={j} className={s != null && s >= HOT ? 'hot' : undefined}
                  style={{ background: s == null ? NA_FILL : seqColor(s / 100) }}
                  title={`${DOMAINS[j].code} ${DOMAINS[j].short}：${s == null ? '無資料' : s}`} />
              ))}
            </span>
            <span className="pl-f num">{fmtNum(t.f, 1)}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

/* ======================================================================= */
/* 即時監看 */
const WATCH: { col: string; label: string; unit?: string; fmt: (v: number) => string; feed: string; dfmt?: (v: number) => string }[] = [
  { col: 'city_speed', label: '全市路段均速', unit: 'km/h', fmt: (v) => fmtNum(v, 1), feed: 'road_live' },
  { col: 'city_cong', label: '全市壅塞比例', fmt: (v) => fmtPct(v), feed: 'road_live', dfmt: (v) => `${fmtNum(v * 100, 1)}pt` },
  { col: 'neihu_cong', label: '內湖壅塞比例', fmt: (v) => fmtPct(v), feed: 'road_live', dfmt: (v) => `${fmtNum(v * 100, 1)}pt` },
  { col: 'neihu_vc', label: '內湖 VD V/C', fmt: (v) => fmtNum(v, 2), feed: 'vd_live' },
  { col: 'neihu_flow', label: '內湖 VD 車流', unit: '輛/時', fmt: (v) => fmtInt(v), feed: 'vd_live' },
  { col: 'bus_on_duty', label: '營運中公車', unit: '輛', fmt: (v) => fmtInt(v), feed: 'bus_live' },
  { col: 'bus_speed', label: '公車行駛均速', unit: 'km/h', fmt: (v) => fmtNum(v, 1), feed: 'bus_live' },
  { col: 'eta_wait', label: '平均候車', unit: '分', fmt: (v) => fmtNum(v, 1), feed: 'bus_eta' },
  { col: 'rain_max', label: '雨量站最大值', unit: 'mm', fmt: (v) => fmtNum(v, 1), feed: 'rain_live' },
]

function LiveWatch() {
  const { traffic, series, status } = useLive()
  const S = useSeries(series)
  const los = traffic?.city.los
  const groups = los
    ? (['good', 'warning', 'serious', 'critical'] as const).map((st) => ({
        st,
        label: LOS.filter((l) => l.status === st).map((l) => l.label)[0],
        keys: LOS.filter((l) => l.status === st).map((l) => l.key).join(''),
        n: LOS.filter((l) => l.status === st).reduce((a, l) => a + los[l.key], 0),
      }))
    : []
  return (
    <Panel tag="RT" title="即時監看" className="ticks"
      right={status ? <LiveBadge time={fmtTime(status.updated_at)} /> : undefined}
      foot={<Prov keys={['vd_live', 'road_live', 'bus_live', 'bus_eta', 'rain_live']} compact note={S ? `走勢 ${S.n} 點 · 每分鐘` : undefined} mock={series?.is_mock} />}>
      {traffic && los && (
        <div className="los">
          <div className="los-h">
            <span>全市路段服務水準</span>
            <span className="num muted">{traffic.city.n} 段 · 路況 {fmtHM(traffic.feeds.road_live?.src_time)}</span>
          </div>
          <ShareBar height={9} parts={LOS.map((l) => ({ key: l.key, value: los[l.key], color: l.color, label: `${l.key} 級 ${l.label}` }))} />
          <div className="los-legend">
            {groups.map((g) => (
              <span key={g.st} className="st">
                <StatusGlyph status={g.st} size={9} />
                {g.label}
                <span className="muted num">{g.keys}</span>
                <b className="num">{g.n}</b>
              </span>
            ))}
          </div>
        </div>
      )}
      <div className="wl">
        {WATCH.map((w) => {
          const vals = S?.get(w.col) ?? []
          const last = vals.length ? vals[vals.length - 1] : null
          const prev = S && S.ago != null ? vals[S.ago] : null
          const d = last != null && prev != null ? last - prev : null
          return (
            <div key={w.col} className="wl-row" title={`${w.label}｜每分鐘記錄一次，存在 live/series.json`}>
              <span className="wl-k">{w.label}{w.unit && <small>{w.unit}</small>}</span>
              <span className="wl-spark">
                {S && <Sparkline values={vals} times={S.t} fmt={(v) => `${w.fmt(v)}${w.unit ? ` ${w.unit}` : ''}`} fmtT={(t) => fmtHM(t)} width={84} height={22} color="var(--ink-2)" />}
              </span>
              <span className="wl-v num">
                {last == null ? '—' : w.fmt(last)}
                {d != null && (
                  <small title="與 1 小時前相比">{d > 0 ? '▲' : d < 0 ? '▼' : '■'} {(w.dfmt ?? w.fmt)(Math.abs(d))}</small>
                )}
              </span>
            </div>
          )
        })}
      </div>
    </Panel>
  )
}

/* ======================================================================= */
/* 情境成效 */
function ScenarioSummary({ I }: { I: Impact }) {
  const { scenario: s, resetScenario } = useAppState()
  const r1 = impact1(I, s.trees)
  const r2 = impact2(I, s.bins)
  const r3 = impact3(I, s.ratArea)
  const r4 = impact4(I, s.shift, s.carCut)
  const r5 = impact5(I, s.cut)
  const r6 = impact6(I, s.inspect)
  const peakMock = !r4.real
  const lever4 = [s.shift > 0 && `彈性工時 ${fmtPct(s.shift, 0)}`, s.carCut > 0 && `減量 ${fmtPct(s.carCut, 0)}`].filter(Boolean).join(' + ') || '不介入'
  const saved4 = r4.vhYear >= 0
  const rows: { id: number; lever: string; k: string; from?: string; to: string; sub: ReactNode; mock?: boolean }[] = [
    {
      id: 1, lever: `補植 ${fmtInt(s.trees)} 棵行道樹`, k: '人行道遮蔭率', from: fmtPct(r1.before.shade), to: fmtPct(r1.after.shade),
      sub: <>缺蔭里 {fmtInt(r1.before.low)} → <b>{fmtInt(r1.after.low)}</b> · 新增遮蔭 <b>{fmtNum(r1.addedKm, 1)}</b> km</>,
    },
    {
      id: 2, lever: `新增 ${fmtInt(s.bins)} 個清潔箱 · ${s.binMode === 'dynamic' ? '依滿溢度清運' : '固定排程清運'}`, k: '人潮需求涵蓋率',
      from: fmtPct(r2.covBefore), to: fmtPct(r2.covAfter), mock: s.binMode === 'dynamic',
      sub: s.binMode === 'dynamic'
        ? <>每日清運 {fmtInt(r2.pickupsFixed)} → <b>{fmtInt(r2.pickupsDynamic)}</b> 趟（−{fmtPct(1 - r2.pickupsDynamic / r2.pickupsFixed, 0)}）</>
        : <>每日清運 <b>{fmtInt(r2.pickupsFixed)}</b> 趟 · 滿溢箱 {fmtInt(r2.overflowFixed)} 個</>,
    },
    {
      id: 3, lever: `集中防治 ${fmtPct(s.ratArea, 0)} 面積（依風險排序）`, k: '見鼠通報預估', to: `−${fmtPct(r3.reduction)}`,
      sub: <>涵蓋 <b>{fmtPct(r3.captured, 0)}</b> 通報 · 平均分配只減 {fmtPct(r3.randomReduction)}</>,
    },
    {
      id: 4, lever: lever4, k: '內科晨峰延滯', to: fmtDeltaPct(-r4.reduction), mock: peakMock,
      sub: <>每年{saved4 ? '少' : '多'} <b>{fmtWan(Math.abs(r4.vhYear))}</b> 車小時 · {saved4 ? '減碳' : '增碳'} <b>{fmtInt(Math.abs(r4.co2Year))}</b> 噸</>,
    },
    {
      id: 5, lever: `高重疊路線減班 ${fmtPct(s.cut, 0)}`, k: '釋出車公里 / 日', to: fmtInt(r5.vkmSaved),
      sub: <>改開 DRTS <b>{fmtInt(r5.hours)}</b> 車小時 · 補 <b>{r5.served}</b>/{r5.cold} 個冷區里</>,
    },
    {
      id: 6, lever: `優先健檢 ${fmtInt(s.inspect)} 個里`, k: '涵蓋液化區長者', to: fmtPct(r6.captured, 0),
      sub: <>約 <b>{fmtWan(r6.elderly)}</b> 人 · 只占全市 {fmtPct(r6.share, 0)} 的里</>,
    },
  ]
  return (
    <Panel tag="SC" title="情境成效" className="ticks"
      right={<button className="btn btn-ghost" onClick={resetScenario} title="回到預設情境">重設</button>}
      foot={<div className="sc-foot">在各題模組拖曳滑桿調整情境；這裡同步顯示。成效為模型推估，假設列在各模組。</div>}>
      <div className="sc">
        {rows.map((r) => {
          const d = domain(r.id)
          const Icon = DOMAIN_ICONS[r.id - 1]
          return (
            <a key={r.id} className="sc-row" href={href({ name: 'domain', id: d.id })} style={{ ['--c' as string]: d.color }}>
              <span className="sc-h">
                <span className="num sc-code">{d.code}</span>
                <Icon size={13} className="sc-icon" />
                <span className="sc-lever">{r.lever}</span>
                {r.mock && <MockBadge />}
              </span>
              <span className="sc-main">
                <span className="sc-k">{r.k}</span>
                <span className="sc-v num">
                  {r.from && <span className="sc-from">{r.from} →</span>}
                  {r.to}
                </span>
              </span>
              <span className="sc-sub">{r.sub}</span>
            </a>
          )
        })}
      </div>
    </Panel>
  )
}
