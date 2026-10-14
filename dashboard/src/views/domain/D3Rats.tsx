// 03 鼠患：見鼠通報 × 環境因子（餐飲、垃圾車停靠、人孔、攤販集中場、病媒蚊）→ 風險分數 → 集中防治情境
import { useMemo } from 'react'
import { BarList, LineChart, Sparkline } from '../../components/Charts'
import type { LayerSpec } from '../../components/MapView'
import { Kpi, Panel, Prov } from '../../components/Panel'
import { useData, useLayer } from '../../lib/data'
import type { Domain } from '../../lib/domains'
import { fmtInt, fmtNum, fmtPct } from '../../lib/format'
import { impact3 } from '../../lib/impact'
import { DEFAULT_SCENARIO, useAppState } from '../../lib/state'
import type { Impact, Timeseries, VillageFC } from '../../lib/types'
import { DomainFrame, Hero, PetitionKpi, ScenarioPanel, Slider } from './Frame'
import { PETITION_KEYS, Schem, delta, useAreaPick, useToggles } from './hooks'

const COLOR = '#d55181'
const WEIGHT_LABEL: Record<string, string> = {
  food: '餐飲業密度',
  truck: '垃圾車停靠點',
  manhole: '雨水下水道人孔',
  market: '攤販集中場',
  bi: '病媒蚊布氏指數',
  pop: '人口密度',
}

export default function D3({ d }: { d: Domain }) {
  const I = useData<Impact>('impact.json')
  const T = useData<Timeseries>('timeseries.json')
  const V = useData<VillageFC>('villages.geojson')
  const { scenario: s, setScenario } = useAppState()
  const [on, set] = useToggles({ rats: true, food: true, truck: false, mkt: true, mh: false })
  const rats = useLayer('rats')
  const food = useLayer(on.food ? 'restaurants' : null)
  const trucks = useLayer(on.truck ? 'garbage_truck' : null)
  const markets = useLayer('markets')
  const manholes = useLayer(on.mh ? 'manholes' : null)
  const pick = useAreaPick(V, (p) => p.risk, s.ratArea)

  const layers = useMemo<LayerSpec[]>(() => [
    {
      id: 'd3-food', type: 'heatmap', data: food, visible: on.food,
      paint: {
        'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 11, 7, 15, 24],
        'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 11, 0.3, 15, 0.9],
        'heatmap-color': ['interpolate', ['linear'], ['heatmap-density'], 0, 'rgba(246,247,249,0)', 0.25, 'rgba(246,247,249,0.08)', 0.6, 'rgba(246,247,249,0.22)', 1, 'rgba(246,247,249,0.4)'],
      },
    },
    {
      id: 'd3-mh', type: 'circle', data: manholes, visible: on.mh, minzoom: 14,
      paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 14, 1.4, 17, 3], 'circle-color': '#738091' },
      tooltip: () => <div className="tip-title">雨水下水道人孔</div>,
    },
    {
      id: 'd3-truck', type: 'circle', data: trucks, visible: on.truck, minzoom: 12,
      paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 1.6, 16, 4.5], 'circle-color': '#c5cbd3', 'circle-stroke-color': '#0d1014', 'circle-stroke-width': 0.6 },
      tooltip: (p) => (
        <>
          <div className="tip-title">垃圾車停靠點</div>
          <div className="tip-row"><span className="k">路線</span><span className="v">{String(p.route)}</span></div>
          <div className="tip-row"><span className="k">抵達 · 停留</span><span className="v">{String(p.arrive)} · {p.dwell as number} 分</span></div>
        </>
      ),
    },
    {
      id: 'd3-mkt', type: 'circle', data: markets, visible: on.mkt,
      paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 4.5, 16, 10], 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': '#f6f7f9', 'circle-stroke-width': 1.4 },
      tooltip: (p) => (
        <>
          <div className="tip-title">攤販集中場</div>
          <div className="tip-row"><span className="k">位置</span><span className="v">{String(p.name)}</span></div>
          <div className="tip-row"><span className="k">營業時間</span><span className="v">{String(p.hours)}</span></div>
        </>
      ),
    },
    {
      id: 'd3-rats', type: 'circle', data: rats, visible: on.rats,
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 2.4, 16, 6],
        'circle-color': ['match', ['get', 'type'], '毒餌', 'rgba(0,0,0,0)', COLOR],
        'circle-stroke-color': ['match', ['get', 'type'], '毒餌', COLOR, '#0d1014'],
        'circle-stroke-width': ['match', ['get', 'type'], '毒餌', 1.6, 0.8],
      },
      tooltip: (p) => (
        <>
          <div className="tip-title">見鼠通報 · {String(p.type)}</div>
          <div className="tip-row"><span className="k">通報時間</span><span className="v">{String(p.time)}</span></div>
        </>
      ),
    },
  ], [on, food, manholes, trucks, markets, rats])

  const b = I?.['3'].baseline
  const lift = I?.['3'].lift
  const weights = I?.['3'].weights
  const r = I ? impact3(I, s.ratArea) : null
  const weekly = T?.rat_weekly

  return (
    <DomainFrame d={d}
      pick={{ ids: pick, label: `集中防治範圍（風險最高 ${fmtPct(s.ratArea, 0)} 面積）` }}
      kpiSources={['ratradar', 'restaurants', 'garbage_truck', 'rain_manholes', 'vendor_markets', 'dengue_vector', ...PETITION_KEYS]}
      kpis={
        <>
          <Kpi code="03" label="見鼠通報（Rat Radar）" value={fmtInt(b?.sightings)} unit="件" color={d.color}
            spark={weekly && <Sparkline values={weekly.map((w) => w[1])} times={weekly.map((w) => w[0])} fmt={(v) => `${fmtInt(v)} 件`} fmtT={(t) => `${t} 當週`} width={132} height={20} color="var(--ink-2)" />}
            sub={b && <>{b.first_report.slice(0, 10)} 起 · 另有毒餌回報 {b.bait_reports} 件</>} />
          <Kpi label="風險分數與通報的相關" value={b ? `ρ ${fmtNum(b.spearman_risk_reports, 2)}` : '—'} color={d.color}
            sub={b && <>456 里 Spearman · 單看餐飲業 ρ {fmtNum(b.spearman_food_reports, 2)}</>} />
          <Kpi label="風險最高 20% 面積涵蓋的通報" value={b ? fmtPct(b.top20_captured, 0) : '—'} color={d.color}
            sub="平均分配同樣面積只涵蓋 20%" />
          <Kpi label="餐飲業" value={fmtInt(b?.restaurants)} unit="家" color={d.color}
            sub={b && <>垃圾車停靠 {fmtInt(b.truck_stops)} · 人孔 {fmtInt(b.manholes)} · 攤販場 {b.markets}</>} />
          <PetitionKpi d={d} T={T} />
        </>
      }
      layers={layers}
      toggles={[
        { id: 'rats', label: '見鼠通報（空心 = 毒餌）', sym: <i className="sym sym-dot" style={{ ['--c' as string]: COLOR }} />, on: on.rats, set: (v) => set('rats', v), n: rats ? fmtInt(rats.features.length) : undefined },
        { id: 'food', label: '餐飲業密度（熱區）', sym: <i className="sym sym-square" style={{ ['--c' as string]: 'rgba(246,247,249,0.45)' }} />, on: on.food, set: (v) => set('food', v), n: b ? fmtInt(b.restaurants) : undefined },
        { id: 'mkt', label: '攤販集中場', sym: <i className="sym sym-ring" style={{ ['--c' as string]: '#f6f7f9' }} />, on: on.mkt, set: (v) => set('mkt', v), n: b ? String(b.markets) : undefined },
        { id: 'truck', label: '垃圾車停靠點', sym: <i className="sym sym-dot" style={{ ['--c' as string]: '#c5cbd3' }} />, on: on.truck, set: (v) => set('truck', v), n: 'z ≥ 12' },
        { id: 'mh', label: '雨水下水道人孔', sym: <i className="sym sym-dot" style={{ ['--c' as string]: '#738091' }} />, on: on.mh, set: (v) => set('mh', v), n: 'z ≥ 14' },
      ]}
      mapSources={['village', 'ratradar', 'restaurants', 'garbage_truck', 'rain_manholes', 'vendor_markets']}
      mapNote="見鼠地圖為民眾自願通報，熱鬧地區通報較多"
      cardRows={(p) => [
        { k: '見鼠通報 · 密度', v: `${fmtInt(p.rats)} 件 · ${fmtNum(p.rat_d, 1)} /km²` },
        { k: '餐飲業', v: `${fmtInt(p.food)} 家` },
        { k: '垃圾車停靠 · 人孔', v: `${fmtInt(p.trk)} · ${fmtInt(p.mh)}` },
        { k: '攤販集中場', v: fmtInt(p.mkt) },
        { k: '病媒蚊布氏指數', v: p.bi == null ? '未調查' : fmtNum(p.bi, 1) },
        { k: '風險分數（0–1）', v: fmtNum(p.risk, 2) },
      ]}
      side={
        <>
          <ScenarioPanel
            schem={r && <Schem.Rats treatedArea={s.ratArea} reduction={r.reduction} captured={r.captured} />}
            controls={
              <Slider label="集中防治面積（依風險由高到低）" value={s.ratArea} min={0.02} max={0.6} step={0.02} fmt={(v) => fmtPct(v, 0)}
                onChange={(v) => setScenario({ ratArea: v })} marks={[{ v: 0.2, label: '20%' }]} />
            }
            hero={r && b && (
              <Hero k="預估見鼠通報（資料期間）" from={fmtInt(b.sightings)} to={fmtInt(b.sightings - r.avoided)} unit="件"
                d={delta(b.sightings - r.avoided, b.sightings, (v) => fmtPct(v / b.sightings), true)} />
            )}
            results={r && b ? [
              { k: '範圍內的通報 · 依風險排序', to: fmtPct(r.captured, 0), d: delta(r.captured, r.random, (v) => `比平均多 ${fmtNum(v * 100, 0)} 個百分點`, false) },
              { k: '範圍內的通報 · 平均分配', to: fmtPct(r.random, 0) },
              { k: '理論上限（事後已知通報位置）', to: fmtPct(r.oracle, 0) },
              { k: '預估減少的通報', to: `${fmtInt(r.avoided)} 件`, d: delta(r.avoided, b.sightings * r.randomReduction, (v) => `比平均多 ${fmtInt(v)} 件`, false) },
              { k: '集中效率（排序 ÷ 平均）', to: `${fmtNum(r.captured / Math.max(r.random, 1e-9), 1)} 倍` },
            ] : []}
            onReset={() => setScenario({ ratArea: DEFAULT_SCENARIO.ratArea })}
            note={b && <>依風險分數由高到低挑里，直到面積達到設定比例（地圖虛線框）；範圍內的通報假設減少 {fmtPct(b.efficacy, 0)}。</>}
          />
          {lift && r && (
            <Panel tag="CH" title="防治面積與涵蓋的通報（提升曲線）" className="ticks"
              foot={<Prov keys={['ratradar', 'restaurants', 'garbage_truck', 'rain_manholes', 'vendor_markets']} compact note="以 456 里計算" />}>
              <div className="dp-chart">
                <LineChart x={lift.map((l) => l.area)} height={160}
                  series={[
                    { id: 'model', label: '依風險分數排序', color: 'var(--d3)', values: lift.map((l) => l.model), area: true },
                    { id: 'oracle', label: '理論上限', color: 'var(--ink-2)', values: lift.map((l) => l.oracle), dashed: true, width: 1.4 },
                    { id: 'random', label: '平均分配', color: 'var(--ink-3)', values: lift.map((l) => l.area), dashed: true, width: 1.4 },
                  ]}
                  yDomain={[0, 1]} yFmt={(v) => fmtPct(v, 0)} xFmt={(v) => fmtPct(v, 0)} xLabel="防治面積占比"
                  marker={s.ratArea} markerLabel={`${fmtPct(s.ratArea, 0)} 面積 → ${fmtPct(r.captured, 0)} 通報`} />
              </div>
            </Panel>
          )}
          {weights && (
            <Panel tag="WT" title="風險分數的組成" className="ticks"
              foot={<div className="dp-note">各因子先換成 456 里的密度百分位，再依權重加總。權重是人為設定的假設；見鼠通報只拿來驗證，不參與擬合。</div>}>
              <BarList fmt={(v) => fmtPct(v, 0)} color="var(--d3)"
                items={Object.entries(weights).sort((x, y) => y[1] - x[1]).map(([k, v]) => ({ key: k, label: WEIGHT_LABEL[k] ?? k, value: v }))} />
            </Panel>
          )}
        </>
      }
    />
  )
}
