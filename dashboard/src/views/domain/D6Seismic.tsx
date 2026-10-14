// 06 耐震：土壤液化潛勢 × 長者 × 搶救困難地區 × 消防栓 → 依分數優先健檢的里
import { useMemo } from 'react'
import { LineChart, Sparkline } from '../../components/Charts'
import { SymbolLegend, type LayerSpec } from '../../components/MapView'
import { Kpi, Panel, Prov } from '../../components/Panel'
import { useData, useLayer } from '../../lib/data'
import type { Domain } from '../../lib/domains'
import { fmtInt, fmtNum, fmtPct, fmtWan } from '../../lib/format'
import { impact6 } from '../../lib/impact'
import { DEFAULT_SCENARIO, useAppState } from '../../lib/state'
import type { Impact, Timeseries, VillageFC } from '../../lib/types'
import { DomainFrame, Hero, PetitionKpi, ScenarioPanel, Slider } from './Frame'
import { PETITION_KEYS, Schem, delta, useToggles } from './hooks'

const COLOR = '#d95926'
const LIQ = [
  { c: 3, label: '高潛勢', fill: 0.42, sym: 'rgba(217,89,38,0.8)' },
  { c: 2, label: '中潛勢', fill: 0.2, sym: 'rgba(217,89,38,0.45)' },
  { c: 1, label: '低潛勢', fill: 0.06, sym: 'rgba(217,89,38,0.18)' },
]

export default function D6({ d }: { d: Domain }) {
  const I = useData<Impact>('impact.json')
  const T = useData<Timeseries>('timeseries.json')
  const V = useData<VillageFC>('villages.geojson')
  const { scenario: s, setScenario } = useAppState()
  const [on, set] = useToggles({ liq: true, hyd: false })
  const hyd = useLayer(on.hyd ? 'hydrants' : null)

  const layers = useMemo<LayerSpec[]>(() => [
    {
      id: 'd6-liq', type: 'fill', data: '/data/poly/liquefaction.geojson', visible: on.liq,
      paint: { 'fill-color': COLOR, 'fill-opacity': ['match', ['get', 'c'], 3, LIQ[0].fill, 2, LIQ[1].fill, 1, LIQ[2].fill, 0] },
      tooltip: (p) => <div className="tip-title">土壤液化 {LIQ.find((l) => l.c === p.c)?.label ?? '—'}</div>,
    },
    {
      id: 'd6-liq-line', type: 'line', data: '/data/poly/liquefaction.geojson', visible: on.liq,
      paint: { 'line-color': COLOR, 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 0.5, 15, 1.2], 'line-opacity': ['match', ['get', 'c'], 3, 0.85, 2, 0.5, 0.25] },
    },
    {
      id: 'd6-hyd', type: 'circle', data: hyd, visible: on.hyd, minzoom: 14,
      paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 14, 1.8, 17, 4], 'circle-color': '#e8ecf0', 'circle-stroke-color': '#0d1014', 'circle-stroke-width': 0.6 },
      tooltip: () => <div className="tip-title">消防栓</div>,
    },
  ], [on, hyd])

  const D = I?.['6']
  const b = D?.baseline
  const curve = D?.curve
  const r = I ? impact6(I, s.inspect) : null
  // same order as the curve: s6 high → low (里 without a score last)
  const order = useMemo(
    () => (V ? [...V.features].sort((a, c) => (c.properties.s6 ?? -1) - (a.properties.s6 ?? -1)).map((f) => f.properties) : null),
    [V],
  )
  const picked = useMemo(() => order?.slice(0, s.inspect) ?? null, [order, s.inspect])
  const fireIn = picked?.reduce((a, p) => a + (p.fire ?? 0), 0)
  const old = T?.old_building_share.filter((x) => x[1] > 0)
  const alone = T?.elderly_alone
  const topDist = b ? Object.entries(b.elderly_alone).sort((x, y) => y[1] - x[1])[0] : null

  return (
    <DomainFrame d={d}
      pick={{ ids: picked ? picked.map((p) => p.i) : null, label: `優先健檢的里（前 ${s.inspect}）` }}
      kpiSources={['liquefaction', 'population_age', 'buildings_stats', 'fire_access', 'hydrants', 'elderly_alone', ...PETITION_KEYS]}
      kpis={
        <>
          <Kpi code="06" label="液化潛勢區的長者（加權）" value={b ? fmtWan(b.exposed_elderly) : '—'} unit="人" color={d.color}
            sub="65 歲以上人口 ×（高潛勢面積比 + 0.5 × 中潛勢）" />
          <Kpi label="屋齡 30 年以上建物" value={b ? fmtPct(b.old_building_share) : '—'} color={d.color}
            spark={old && <Sparkline values={old.map((x) => x[1])} times={old.map((x) => x[0])} fmt={(v) => fmtPct(v)} fmtT={(t) => `${t} 年`} width={132} height={20} color="var(--ink-2)" />}
            sub={b && <>{b.building_year}共 {fmtWan(b.buildings)} 棟</>} />
          <Kpi label="搶救困難地區" value={fmtInt(b?.fire_sites)} unit="處" color={d.color}
            sub={b && <>消防栓 {fmtInt(b.hydrants)} 支</>} />
          <Kpi label="獨居長者" value={alone ? fmtInt(alone[alone.length - 1][1]) : '—'} unit="人" color={d.color}
            spark={alone && <Sparkline values={alone.map((x) => x[1])} times={alone.map((x) => x[0])} fmt={(v) => `${fmtInt(v)} 人`} fmtT={(t) => String(t)} width={132} height={20} color="var(--ink-2)" />}
            sub={b && topDist && <>{b.elderly_alone_quarter} · 最多：{topDist[0]} {fmtInt(topDist[1])}</>} />
          <PetitionKpi d={d} T={T} />
        </>
      }
      layers={layers}
      toggles={[
        { id: 'liq', label: '土壤液化潛勢', sym: <i className="sym sym-square" style={{ ['--c' as string]: LIQ[0].sym }} />, on: on.liq, set: (v) => set('liq', v), n: b ? `${b.liq_polygons} 區` : undefined },
        { id: 'hyd', label: '消防栓', sym: <i className="sym sym-dot" style={{ ['--c' as string]: '#e8ecf0' }} />, on: on.hyd, set: (v) => set('hyd', v), n: 'z ≥ 14' },
      ]}
      legend={on.liq && <SymbolLegend items={LIQ.map((l) => ({ label: `液化${l.label}`, color: l.sym, shape: 'square' }))} />}
      mapSources={['village', 'liquefaction', 'population_age', 'fire_access', 'hydrants']}
      mapNote="液化潛勢為地質調查圖資，不代表個別建物的耐震能力"
      cardRows={(p) => [
        { k: '液化潛勢面積 · 高 / 中', v: `${fmtPct(p.liq3, 0)} / ${fmtPct(p.liq2, 0)}` },
        { k: '液化區長者（加權）', v: `${fmtInt(p.exp65)} 人` },
        { k: '搶救困難地區', v: `${fmtInt(p.fire)} 處` },
        { k: '消防栓 · 密度', v: `${fmtInt(p.hyd)} 支 · ${fmtNum(p.hyd_d, 0)} /km²` },
      ]}
      side={
        <>
          <ScenarioPanel
            schem={r && <Schem.Seismic inspected={r.share} captured={r.captured} />}
            controls={
              <Slider label="優先健檢的里（依分數由高到低）" value={s.inspect} min={5} max={r?.maxK ?? 456} step={1} fmt={(v) => `${fmtInt(v)} 里`}
                onChange={(v) => setScenario({ inspect: v })} marks={[{ v: 50, label: '50' }]} />
            }
            hero={r && (
              <Hero k="涵蓋的液化區長者" to={fmtPct(r.captured, 0)}
                d={delta(r.captured, r.share, (v) => `比平均多 ${fmtNum(v * 100, 0)} 個百分點`, false)} />
            )}
            results={r && b ? [
              { k: '涵蓋長者（加權）', to: `${fmtWan(r.elderly)} 人` },
              { k: '健檢的里占全市', to: fmtPct(r.share, 0) },
              { k: '集中效率（涵蓋 ÷ 里數占比）', to: `${fmtNum(r.captured / Math.max(r.share, 1e-9), 1)} 倍` },
              ...(fireIn != null ? [{ k: '範圍內的搶救困難地區', to: `${fmtInt(fireIn)} / ${fmtInt(b.fire_sites)} 處` }] : []),
            ] : []}
            onReset={() => setScenario({ inspect: DEFAULT_SCENARIO.inspect })}
            note="分數 = 液化潛勢 35% + 長者比例 25% + 搶救困難地區 20% + 消防栓密度低 20%（皆為 456 里百分位）；健檢範圍在地圖以虛線框標示。"
          />
          {curve && r && (
            <Panel tag="CH" title="健檢里數與涵蓋的液化區長者" className="ticks"
              foot={<Prov keys={['liquefaction', 'population_age']} compact note="每 5 里一點" />}>
              <div className="dp-chart">
                <LineChart x={curve.map((c) => c.share)} height={150}
                  series={[
                    { id: 'cap', label: '依分數排序', color: 'var(--d6)', values: curve.map((c) => c.captured), area: true },
                    { id: 'rnd', label: '平均分配', color: 'var(--ink-3)', values: curve.map((c) => c.share), dashed: true, width: 1.4 },
                  ]}
                  yDomain={[0, 1]} yFmt={(v) => fmtPct(v, 0)} xFmt={(v) => fmtPct(v, 0)} xLabel="健檢的里占比"
                  marker={r.share} markerLabel={`${s.inspect} 里 → ${fmtPct(r.captured, 0)}`} />
              </div>
            </Panel>
          )}
          {old && (
            <Panel tag="TR" title="屋齡 30 年以上建物比例" className="ticks"
              foot={<Prov keys={['buildings_stats']} compact />}>
              <div className="dp-chart">
                <LineChart x={old.map((x) => x[0])} height={120} legend={false}
                  series={[{ id: 'old', label: '30 年以上', color: 'var(--d6)', values: old.map((x) => x[1]), area: true }]}
                  yDomain={[0.5, 1]} yFmt={(v) => fmtPct(v, 0)} xFmt={(v) => String(v)} />
              </div>
            </Panel>
          )}
        </>
      }
    />
  )
}
