// 01 樹蔭：人行道遮蔭率（行道樹樹冠推估）、缺蔭里、可補植樹位 → 補植情境
import { useMemo } from 'react'
import { LineChart } from '../../components/Charts'
import type { LayerSpec } from '../../components/MapView'
import { Kpi, Panel, Prov } from '../../components/Panel'
import { useData, useLayer } from '../../lib/data'
import type { Domain } from '../../lib/domains'
import { fmtInt, fmtNum, fmtPct, fmtWan } from '../../lib/format'
import { impact1 } from '../../lib/impact'
import { DEFAULT_SCENARIO, useAppState } from '../../lib/state'
import type { Impact, Timeseries } from '../../lib/types'
import { DomainFrame, Hero, PetitionKpi, RampLegend, ScenarioPanel, Slider } from './Frame'
import { PETITION_KEYS, Schem, delta, useToggles } from './hooks'

// gray = 曝曬, green = 有樹蔭 (one hue, light = more shade)
const SHADE_RAMP = ['#3a4049', '#1d6b1d', '#2fae2f', '#63e063']
const SHADE_EXPR = ['interpolate', ['linear'], ['get', 's'], 0, SHADE_RAMP[0], 0.33, SHADE_RAMP[1], 0.66, SHADE_RAMP[2], 1, SHADE_RAMP[3]]
// crown width cw (m) drawn to scale: px radius = cw / 2 / (m per px at 25°N)
const CROWN_R = ['interpolate', ['exponential', 2], ['zoom'], 13, ['max', 0.7, ['*', ['get', 'cw'], 0.0289]], 18, ['*', ['get', 'cw'], 0.924]]

const pad = (lo: number, hi: number, k = 0.08): [number, number] => [lo - (hi - lo) * k, hi + (hi - lo) * k]

export default function D1({ d }: { d: Domain }) {
  const I = useData<Impact>('impact.json')
  const T = useData<Timeseries>('timeseries.json')
  const { scenario: s, setScenario } = useAppState()
  const [on, set] = useToggles({ sw: true, trees: true, holes: false })
  const trees = useLayer(on.trees ? 'trees' : null)
  const holes = useLayer(on.holes ? 'tree_holes' : null)

  const layers = useMemo<LayerSpec[]>(() => [
    {
      id: 'd1-sw', type: 'fill', data: '/data/lines/sidewalks.geojson', visible: on.sw, minzoom: 12,
      paint: { 'fill-color': SHADE_EXPR, 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 12, 0.65, 15, 0.95] },
      tooltip: (p) => (
        <>
          <div className="tip-title">人行道</div>
          <div className="tip-row"><span className="k">遮蔭率</span><span className="v">{fmtPct(p.s as number, 0)}</span></div>
          <div className="tip-row"><span className="k">寬度</span><span className="v">{fmtNum(p.w as number, 1)} m</span></div>
          <div className="tip-row"><span className="k">可補植</span><span className="v">{(p.w as number) >= 3 && (p.s as number) < 1 ? '寬度足夠（≥ 3 m）' : '否'}</span></div>
        </>
      ),
    },
    {
      id: 'd1-trees', type: 'circle', data: trees, visible: on.trees, minzoom: 13,
      paint: { 'circle-color': '#1fbf1f', 'circle-opacity': 0.4, 'circle-radius': CROWN_R, 'circle-stroke-color': '#0d4f0d', 'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 15, 0, 17, 0.8] },
      tooltip: (p) => (
        <>
          <div className="tip-title">行道樹</div>
          <div className="tip-row"><span className="k">推估樹冠寬</span><span className="v">{fmtNum(p.cw as number, 0)} m</span></div>
        </>
      ),
    },
    {
      id: 'd1-holes', type: 'circle', data: holes, visible: on.holes,
      paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 1.6, 16, 4.5], 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': '#f6f7f9', 'circle-stroke-width': 1.2 },
      tooltip: () => <div className="tip-title">樹穴</div>,
    },
  ], [on, trees, holes])

  const b = I?.['1'].baseline
  const curve = I?.['1'].curve
  const c0 = curve?.[0]
  const r = I ? impact1(I, s.trees) : null

  return (
    <DomainFrame d={d}
      kpiSources={['trees_street', 'trees_park', 'tree_holes', 'sidewalk', 'population_age', ...PETITION_KEYS]}
      kpis={
        <>
          <Kpi code="01" label="全市人行道遮蔭率" value={c0 ? fmtPct(c0.city_shade) : '—'} color={d.color}
            sub={b && <>有樹蔭 {fmtNum(b.shaded_km, 1)} / {fmtNum(b.sidewalk_km, 1)} km</>} />
          <Kpi label="缺蔭里（遮蔭率 < 20%）" value={c0?.low_villages ?? '—'} unit="里" color={d.color}
            sub={c0 && <>住著 {fmtWan(c0.low_elderly)} 位 65 歲以上長者</>} />
          <Kpi label="可補植樹位" value={fmtInt(b?.plantable_slots)} unit="位" color={d.color} sub="人行道寬 ≥ 3 m 的無蔭段，每 8 m 一棵" />
          <Kpi label="行道樹" value={fmtInt(b?.street_trees)} unit="棵" color={d.color}
            sub={b && <>公園樹 {fmtInt(b.park_trees)} · 樹穴 {fmtInt(b.tree_holes)}</>} />
          <PetitionKpi d={d} T={T} />
        </>
      }
      layers={layers}
      toggles={[
        { id: 'sw', label: '人行道遮蔭率', sym: <i className="sym sym-square" style={{ ['--c' as string]: SHADE_RAMP[2] }} />, on: on.sw, set: (v) => set('sw', v), n: 'z ≥ 12' },
        { id: 'trees', label: '行道樹（樹冠等比例）', sym: <i className="sym sym-dot" style={{ ['--c' as string]: '#1fbf1f' }} />, on: on.trees, set: (v) => set('trees', v), n: 'z ≥ 13' },
        { id: 'holes', label: '樹穴', sym: <i className="sym sym-ring" style={{ ['--c' as string]: '#f6f7f9' }} />, on: on.holes, set: (v) => set('holes', v), n: b ? fmtInt(b.tree_holes) : undefined },
      ]}
      legend={on.sw && <RampLegend title="人行道遮蔭率（放大後顯示）" colors={SHADE_RAMP} left="0% 曝曬" right="100%" />}
      mapSources={['village', 'population_age', 'trees_street', 'tree_holes', 'sidewalk']}
      mapNote="樹冠寬由胸徑推估"
      cardRows={(p) => [
        { k: '人行道 · 遮蔭率', v: `${fmtNum(p.sw / 1000, 2)} km · ${fmtPct(p.shd)}` },
        { k: '未遮蔭人行道', v: `${fmtNum(p.gap / 1000, 2)} km` },
        { k: '可補植樹位', v: fmtInt(p.slots) },
        { k: '行道樹 · 公園樹', v: `${fmtInt(p.st)} · ${fmtInt(p.pt)}` },
      ]}
      side={
        <>
          <ScenarioPanel
            schem={r && <Schem.Shade baseShade={r.before.shade} shade={r.after.shade} addedTrees={s.trees} maxTrees={r.maxTrees} />}
            controls={
              <Slider label="補植行道樹" value={s.trees} min={0} max={r?.maxTrees ?? 5000} step={100} fmt={(v) => `${fmtInt(v)} 棵`}
                onChange={(v) => setScenario({ trees: v })} marks={[{ v: 3000, label: '題目 3,000' }]} />
            }
            hero={r && (
              <Hero k="全市人行道遮蔭率" from={fmtPct(r.before.shade)} to={fmtPct(r.after.shade)}
                d={delta(r.after.shade * 100, r.before.shade * 100, (v) => `${fmtNum(v, 1)} 個百分點`, false)} />
            )}
            results={r && b ? [
              { k: '缺蔭里', from: fmtInt(r.before.low), to: fmtInt(r.after.low), d: delta(r.after.low, r.before.low, fmtInt, true) },
              { k: '缺蔭里的長者', from: fmtWan(r.before.elderly), to: fmtWan(r.after.elderly), d: delta(r.after.elderly, r.before.elderly, (v) => fmtWan(v), true) },
              { k: '新增有樹蔭的人行道', to: `${fmtNum(r.addedKm, 1)} km`, d: delta(r.addedKm, 0, (v) => `${fmtPct(v / b.shaded_km, 1)}`, false) },
              { k: '用掉的可補植樹位', to: `${fmtInt(s.trees)} / ${fmtInt(b.plantable_slots)}`, d: { dir: 'flat', text: fmtPct(s.trees / b.plantable_slots, 1) } },
            ] : []}
            onReset={() => setScenario({ trees: DEFAULT_SCENARIO.trees })}
            note="依樹蔭需求分數由高到低的里，把新樹種在最寬、最曬的人行道段；新樹以成樹樹冠計。"
          />
          {curve && (
            <Panel tag="CH" title="補植棵數與成效" className="ticks"
              foot={<Prov keys={['trees_street', 'sidewalk', 'population_age']} compact note="每 100 棵重算一次" />}>
              <div className="dp-chart">
                <div className="dp-chart-k">全市人行道遮蔭率</div>
                <LineChart x={curve.map((c) => c.n)} legend={false} height={128}
                  series={[{ id: 'shade', label: '遮蔭率', color: 'var(--d1)', values: curve.map((c) => c.city_shade), area: true }]}
                  yDomain={pad(curve[0].city_shade, curve[curve.length - 1].city_shade, 0.3)}
                  yFmt={(v) => fmtPct(v, 1)} xFmt={(v) => fmtInt(v)} xLabel="補植棵數"
                  marker={s.trees} markerLabel={`${fmtInt(s.trees)} 棵`}
                  tipExtra={(i) => (
                    <div className="tip-row"><span className="k">缺蔭里</span><span className="v">{curve[i].low_villages}</span></div>
                  )} />
                <div className="dp-chart-k">缺蔭里數（遮蔭率 &lt; 20%）</div>
                <LineChart x={curve.map((c) => c.n)} legend={false} height={110}
                  series={[{ id: 'low', label: '缺蔭里', color: 'var(--d1)', values: curve.map((c) => c.low_villages) }]}
                  yDomain={pad(curve[curve.length - 1].low_villages, curve[0].low_villages, 0.3)}
                  yFmt={(v) => fmtInt(v)} xFmt={(v) => fmtInt(v)} marker={s.trees}
                  tipExtra={(i) => (
                    <div className="tip-row"><span className="k">缺蔭里長者</span><span className="v">{fmtInt(curve[i].low_elderly)}</span></div>
                  )} />
              </div>
            </Panel>
          )}
        </>
      }
    />
  )
}
