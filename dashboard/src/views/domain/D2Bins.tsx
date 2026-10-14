// 02 清潔箱：人潮需求涵蓋率、熱門公車站缺口、新增位置排序、依滿溢度清運（填滿速度是模擬資料）
import { useMemo, useState } from 'react'
import { BarList, LineChart } from '../../components/Charts'
import type { LayerSpec } from '../../components/MapView'
import { Kpi, MockBadge, Panel, Prov } from '../../components/Panel'
import { useData, useLayer } from '../../lib/data'
import type { Domain } from '../../lib/domains'
import { fmtInt, fmtNum, fmtPct } from '../../lib/format'
import { impact2 } from '../../lib/impact'
import { DEFAULT_SCENARIO, useAppState } from '../../lib/state'
import type { Impact, PointFC, Table, Timeseries } from '../../lib/types'
import { DomainFrame, Hero, PetitionKpi, ScenarioPanel, Slider } from './Frame'
import { PETITION_KEYS, Schem, delta, useToggles } from './hooks'

const RADIUS_M = 150 // 服務半徑 (impact.json 假設)
const BUSY_ROUTES = 10
const KIND: Record<string, string> = { food: '餐飲聚集', bus: '公車站', mrt: '捷運站', market: '攤販集中場' }
const COLOR = '#9085e9'

/** busy bus stops (≥ 10 routes): already within 150 m of a bin? else the best candidate rank that would cover it */
function useBusyStops(stops?: PointFC, bins?: PointFC, cands?: PointFC) {
  return useMemo(() => {
    if (!stops || !bins || !cands) return null
    const kx = 111320 * Math.cos((25.05 * Math.PI) / 180)
    const ky = 110540
    const r2 = RADIUS_M * RADIUS_M
    const within = (a: number[], b: number[]) => ((a[0] - b[0]) * kx) ** 2 + ((a[1] - b[1]) * ky) ** 2 <= r2
    const features = stops.features
      .filter((f) => (f.properties.routes as number) >= BUSY_ROUTES)
      .map((f) => {
        const c = f.geometry.coordinates
        const cov = bins.features.some((b) => within(c, b.geometry.coordinates))
        let rk = 1e9
        if (!cov) for (const b of cands.features) if ((b.properties.rank as number) < rk && within(c, b.geometry.coordinates)) rk = b.properties.rank as number
        return { ...f, properties: { ...f.properties, cov: cov ? 1 : 0, rk } }
      })
    const fc: PointFC = { type: 'FeatureCollection', features }
    const uncovered = (k: number) => features.filter((f) => !f.properties.cov && f.properties.rk > k).length
    return { fc, n: features.length, uncovered }
  }, [stops, bins, cands])
}

export default function D2({ d }: { d: Domain }) {
  const I = useData<Impact>('impact.json')
  const T = useData<Timeseries>('timeseries.json')
  const binsT = useData<Table>('layers/bins.json')
  const { scenario: s, setScenario } = useAppState()
  const [on, set] = useToggles({ bins: true, cands: true, busy: true })
  const [focus, setFocus] = useState<{ lon: number; lat: number; zoom: number; key: string } | null>(null)
  const bins = useLayer('bins')
  const cands = useLayer('bin_candidates')
  const stops = useLayer('bus_stops')
  const busy = useBusyStops(stops, bins, cands)
  const fillMock = !!binsT?.fill_is_mock

  const layers = useMemo<LayerSpec[]>(() => [
    {
      id: 'd2-busy', type: 'circle', data: busy?.fc, visible: on.busy,
      filter: ['all', ['==', ['get', 'cov'], 0], ['>', ['get', 'rk'], s.bins]],
      paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 1.8, 16, 4.5], 'circle-color': '#f6f7f9', 'circle-stroke-color': '#0d1014', 'circle-stroke-width': 0.8 },
      tooltip: (p) => (
        <>
          <div className="tip-title">{String(p.name)}</div>
          <div className="tip-row"><span className="k">停靠路線</span><span className="v">{p.routes as number} 條</span></div>
          <div className="tip-row"><span className="k">每日班次</span><span className="v">{fmtInt(p.passes as number)}</span></div>
          <div className="tip-row"><span className="k">{RADIUS_M} m 內清潔箱</span><span className="v">沒有</span></div>
        </>
      ),
    },
    {
      id: 'd2-bins', type: 'circle', data: bins, visible: on.bins,
      paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 2.2, 16, 6], 'circle-color': COLOR, 'circle-stroke-color': '#0d1014', 'circle-stroke-width': 1 },
      tooltip: (p) => (
        <>
          <div className="tip-title">行人專用清潔箱</div>
          <div className="tip-row"><span className="k">位置</span><span className="v">{String(p.addr)}</span></div>
          <div className="tip-row"><span className="k">每日填滿{fillMock ? '（模擬）' : ''}</span><span className="v">{fmtPct(p.fill_per_day as number, 0)}</span></div>
        </>
      ),
    },
    {
      id: 'd2-cands', type: 'circle', data: cands, visible: on.cands,
      filter: ['<=', ['get', 'rank'], s.bins],
      paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 3.2, 16, 8], 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': COLOR, 'circle-stroke-width': 1.6 },
      tooltip: (p) => (
        <>
          <div className="tip-title">建議新增 第 {p.rank as number} 名</div>
          <div className="tip-row"><span className="k">主要需求</span><span className="v">{KIND[String(p.kind)] ?? String(p.kind)}</span></div>
          <div className="tip-row"><span className="k">新增涵蓋需求</span><span className="v">{fmtNum(p.gain as number, 1)}</span></div>
        </>
      ),
    },
  ], [on, busy, bins, cands, s.bins, fillMock])

  const b = I?.['2'].baseline
  const curve = I?.['2'].curve
  const r = I ? impact2(I, s.bins) : null
  const dyn = s.binMode === 'dynamic'
  const unc0 = busy?.uncovered(0)
  const unc1 = busy?.uncovered(s.bins)
  const top = useMemo(
    () => (cands ? cands.features.filter((f) => (f.properties.rank as number) <= 10).sort((a, b) => (a.properties.rank as number) - (b.properties.rank as number)) : []),
    [cands],
  )

  return (
    <DomainFrame d={d} focus={focus}
      kpiSources={['bins', 'bus_stop', 'metro_station', 'mrt_ridership', 'restaurants', 'vendor_markets', ...PETITION_KEYS]}
      kpis={
        <>
          <Kpi code="02" label="人潮需求涵蓋率" value={b ? fmtPct(b.covered) : '—'} color={d.color}
            sub={b && <>需求點 {fmtInt(b.demand_points)} · 服務半徑 {RADIUS_M} m</>} />
          <Kpi label="行人專用清潔箱" value={fmtInt(b?.bins)} unit="個" color={d.color}
            sub={b && <>公車站 {RADIUS_M} m 內有箱 {fmtPct(b.bus_stops_covered, 0)}</>} />
          <Kpi label={`熱門公車站（≥ ${BUSY_ROUTES} 線）沒有清潔箱`} value={fmtInt(b?.busy_stops_uncovered)} unit={b ? `/ ${fmtInt(b.busy_stops)} 站` : undefined} color={d.color}
            sub="站牌 150 m 內找不到清潔箱" />
          <Kpi label="每日清運（固定排程）" value={fmtInt(b?.fixed_pickups)} unit="趟" color={d.color} mock
            sub={b && <>依滿溢度 {fmtInt(b.dynamic_pickups)} 趟 · 會滿溢 {fmtInt(b.overflow_bins_fixed)} 箱</>} />
          <PetitionKpi d={d} T={T} />
        </>
      }
      layers={layers}
      toggles={[
        { id: 'bins', label: '現有清潔箱', sym: <i className="sym sym-dot" style={{ ['--c' as string]: COLOR }} />, on: on.bins, set: (v) => set('bins', v), n: b ? fmtInt(b.bins) : undefined },
        { id: 'cands', label: `建議新增（前 ${s.bins} 名）`, sym: <i className="sym sym-ring" style={{ ['--c' as string]: COLOR }} />, on: on.cands, set: (v) => set('cands', v) },
        { id: 'busy', label: '熱門站仍沒有清潔箱', sym: <i className="sym sym-dot" style={{ ['--c' as string]: '#f6f7f9' }} />, on: on.busy, set: (v) => set('busy', v), n: unc1 != null ? fmtInt(unc1) : undefined },
      ]}
      mapSources={['village', 'bins', 'bus_stop', 'metro_station', 'mrt_ridership', 'restaurants', 'vendor_markets']}
      mapNote={`新增位置依涵蓋需求增益排序（貪婪法）`}
      mapMock={fillMock ? '清潔箱每日填滿速度是依周邊需求推估的模擬資料' : undefined}
      cardRows={(p) => [
        { k: '清潔箱', v: `${fmtInt(p.bins)} 個` },
        { k: '人潮需求（加權）', v: fmtNum(p.dem, 1) },
        { k: '需求涵蓋率', v: fmtPct(p.cov) },
        { k: '未涵蓋需求密度', v: `${fmtInt(p.ucd)} /km²` },
      ]}
      side={
        <>
          <ScenarioPanel
            schem={r && <Schem.Bins mode={s.binMode} newBins={s.bins} covered={r.covAfter} baseCovered={r.covBefore} maxNew={r.maxK} />}
            controls={
              <>
                <Slider label="新增清潔箱（依排序）" value={s.bins} min={0} max={r?.maxK ?? 300} step={10} fmt={(v) => `${fmtInt(v)} 個`}
                  onChange={(v) => setScenario({ bins: v })} />
                <div className="sl-row">
                  <span className="sl-k">清運方式</span>
                  <div className="seg">
                    <button className={!dyn ? 'on' : ''} onClick={() => setScenario({ binMode: 'fixed' })}>固定排程（每天 2 次）</button>
                    <button className={dyn ? 'on' : ''} onClick={() => setScenario({ binMode: 'dynamic' })}>依滿溢度</button>
                  </div>
                </div>
              </>
            }
            hero={r && (
              <Hero k="人潮需求涵蓋率" from={fmtPct(r.covBefore)} to={fmtPct(r.covAfter)}
                d={delta(r.covAfter * 100, r.covBefore * 100, (v) => `${fmtNum(v, 1)} 個百分點`, false)} />
            )}
            results={r ? [
              ...(unc0 != null && unc1 != null
                ? [{ k: `熱門公車站沒有清潔箱`, from: fmtInt(unc0), to: fmtInt(unc1), d: delta(unc1, unc0, fmtInt, true) }]
                : []),
              dyn
                ? { k: '每日清運趟次', from: fmtInt(r.pickupsFixed), to: fmtInt(r.pickupsDynamic), d: delta(r.pickupsDynamic, r.pickupsFixed, fmtInt, true), mock: true }
                : { k: '每日清運趟次', to: fmtInt(r.pickupsFixed), mock: true },
              dyn
                ? { k: '收運條件', to: '滿 80% 才收 · 至少 3 天一次' }
                : { k: '固定排程下會滿溢的箱子', to: `${fmtInt(r.overflowFixed)} 箱`, mock: true },
            ] : []}
            mock={dyn}
            onReset={() => setScenario({ bins: DEFAULT_SCENARIO.bins, binMode: DEFAULT_SCENARIO.binMode })}
            note="新增位置用貪婪法逐一挑選「新涵蓋需求最多」的點；清運趟次用模擬的填滿速度估算。"
          />
          {curve && (
            <Panel tag="CH" title="新增數量與涵蓋率" className="ticks"
              foot={<Prov keys={['bins', 'bus_stop', 'mrt_ridership', 'restaurants', 'vendor_markets']} compact note={`服務半徑 ${RADIUS_M} m`} />}>
              <div className="dp-chart">
                <LineChart x={curve.map((c) => c.k)} legend={false} height={140}
                  series={[{ id: 'cov', label: '需求涵蓋率', color: 'var(--d2)', values: curve.map((c) => c.covered), area: true }]}
                  yDomain={[0, 1]} yFmt={(v) => fmtPct(v, 0)} xFmt={(v) => fmtInt(v)} xLabel="新增個數"
                  marker={s.bins} markerLabel={`${fmtInt(s.bins)} 個 · ${r ? fmtPct(r.covAfter, 0) : ''}`} />
              </div>
            </Panel>
          )}
          <Panel tag="TOP" title="建議新增位置 前 10" className="ticks"
            foot={<div className="dp-note">點一列移動地圖。增益 = 這個點新涵蓋的需求權重（公車站 = 停靠路線數，捷運 = 日進站 ÷ 1000，餐飲 0.25 / 家）。</div>}>
            <BarList fmt={(v) => fmtNum(v, 0)} color="var(--d2)"
              items={top.map((f) => ({
                key: f.properties.rank as number,
                label: <><span className="num muted">#{f.properties.rank as number}</span> {KIND[String(f.properties.kind)] ?? String(f.properties.kind)}</>,
                value: f.properties.gain as number,
              }))}
              onClick={(k) => {
                const f = top.find((x) => x.properties.rank === k)
                if (f) setFocus({ lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1], zoom: 16, key: `c${k}-${Date.now()}` })
              }} />
          </Panel>
          {fillMock && (
            <div className="dp-mocknote"><MockBadge /> 清潔箱填滿速度、清運趟次與滿溢箱數依周邊需求推估，沒有對應的開放感測資料。</div>
          )}
        </>
      }
    />
  )
}
