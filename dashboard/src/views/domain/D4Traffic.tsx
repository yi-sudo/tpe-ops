// 04 車流：內湖科技園區晨峰。TDX 即時路況（服務水準）+ VD 車流 → 彈性工時 / 減量情境（以實測車速校準的路網 BPR 延滯）
import { useMemo, useState } from 'react'
import type { FeatureCollection } from 'geojson'
import { LineChart, ShareBar, Sparkline } from '../../components/Charts'
import { StatusGlyph } from '../../components/Icons'
import type { LayerSpec } from '../../components/MapView'
import { Kpi, LiveBadge, Panel, Prov } from '../../components/Panel'
import { useData, useLayer, useLive, useSeries } from '../../lib/data'
import type { Domain } from '../../lib/domains'
import { fmtDeltaPct, fmtHM, fmtInt, fmtNum, fmtPct, fmtTime, fmtWan, hmToMin, minToHM } from '../../lib/format'
import { bboxCenter } from '../../lib/geo'
import { impact4, shiftCurve } from '../../lib/impact'
import { LOS_COLOR_EXPR, joinRoads, joinVd } from '../../lib/livegeo'
import { LOS } from '../../lib/scales'
import { DEFAULT_SCENARIO, useAppState } from '../../lib/state'
import type { DayDrops, Impact, PeakProfile, Timeseries } from '../../lib/types'
import { DomainFrame, Hero, PetitionKpi, ScenarioPanel, Slider } from './Frame'
import { PETITION_KEYS, Schem, delta, useToggles } from './hooks'

const COLOR = '#c98500'
const NEIHU = { lon: 121.585, lat: 25.075, zoom: 13.2 }
const NH = ['==', ['get', 'nh'], 1]
const LOS_GROUPS = (['good', 'warning', 'serious', 'critical'] as const).map((st) => ({
  st,
  label: LOS.filter((l) => l.status === st)[0].label,
  keys: LOS.filter((l) => l.status === st).map((l) => l.key).join(''),
  color: LOS.filter((l) => l.status === st)[0].color,
}))
const shortName = (s: unknown) => String(s ?? '').replace(/\(.*\)$/, '')

const WD = ['日', '一', '二', '三', '四', '五', '六']
const wd = (d: string) => WD[new Date(`${d}T00:00:00Z`).getUTCDay()]
const md = (d: string) => `${+d.slice(5, 7)}/${+d.slice(8, 10)}`
/** every weekday from a to b (YYYY-MM-DD, inclusive) */
function weekdays(a: string, b: string): string[] {
  const out: string[] = []
  for (let t = Date.parse(`${a}T00:00:00Z`), end = Date.parse(`${b}T00:00:00Z`); t <= end; t += 864e5) {
    const day = new Date(t)
    if (day.getUTCDay() % 6) out.push(day.toISOString().slice(0, 10))
  }
  return out
}
/** history.py writes its per-VD reasons in English */
const why = (r: string) => (r === 'no records' ? '沒有資料' : r.replace(/^valid lanes /, '有效車道 '))

/** 晨峰曲線的資料品質：快取期間每個平日採用或排除、捨棄多少、處理規則（pipeline/history.py 的 RULES） */
function QualityPanel({ p }: { p: PeakProfile }) {
  const q = p.quality
  if (!q) return null
  const cached = Object.keys(q.vd_valid_per_day).sort()
  const used = (p.days ?? []).map((x) => x.date)
  const hol = new Set(q.skipped_holidays)
  const days = cached.length ? weekdays(cached[0], cached[cached.length - 1]) : []
  const sum = (k: keyof DayDrops) => used.reduce((a, x) => a + (q.dropped_per_day[x]?.[k] ?? 0), 0)
  const laneMin = sum('lane_minutes')
  const left = Object.entries(q.vd_rejected)
  return (
    <Panel tag="QA" title="晨峰資料品質" className="ticks"
      right={<span className="mono-tag">{used.length}/{cached.length} 天 · {q.vd_panel}/{q.vd_total} 支 VD</span>}
      foot={<Prov keys={['vd_hist']} compact note="滑鼠移到日期看細節" />}>
      <div className="qa-days">
        {days.map((x, i) => {
          const n = q.vd_valid_per_day[x]
          const ex = q.excluded_days[x]
          const kind = hol.has(x) ? 'hol' : n == null ? 'none' : ex ? 'out' : 'use'
          const tip = `${x}（${wd(x)}）\n` + (kind === 'hol' ? '國定假日，晨峰不具代表性，不抓' : kind === 'none' ? '沒有抓取'
            : `有效 VD ${n}/${q.vd_total}\n${ex ? `排除：${ex}` : '採用'}`)
          return (
            <div key={x} className={`qa-day ${kind}${i > 0 && wd(x) === '一' ? ' wk' : ''}`} title={tip}>
              <span className="qa-d num">{md(x)}</span>
              <span className="qa-bar">
                {kind === 'use' ? <i style={{ height: `${(100 * n) / q.vd_total}%` }} /> : kind === 'out' ? <StatusGlyph status="warning" size={9} /> : null}
              </span>
              <span className="qa-n num">{kind === 'use' ? n : kind === 'out' ? '排除' : kind === 'hol' ? '假日' : '—'}</span>
            </div>
          )
        })}
      </div>
      <ul className="dp-insight">
        <li>採用 <b>{used.length}</b> 個平日，只用每天都有效的 <b>{q.vd_panel}</b> 支 VD（固定樣本），各天、各時段才能比較。</li>
        {Object.entries(q.excluded_days).map(([x, r]) => <li key={x}>排除 {md(x)}：{r}。</li>)}
        <li>採用日共 <b>{fmtWan(laneMin)}</b> 個車道分鐘，診斷碼異常捨棄 <b>{fmtPct(sum('diag') / Math.max(laneMin, 1))}</b>，超量異常值 <b>{fmtInt(sum('outlier'))}</b> 筆。</li>
        <li title={left.map(([v, r]) => `${v}：${Object.keys(r).length} 天 · ${why(Object.values(r)[0])}`).join('\n')}>
          <b>{q.vd_total - q.vd_panel}</b> 支 VD 至少一天沒有資料或有效車道不到一半，沒有納入；另有 <b>{q.vd_partial_lanes.length}</b> 支部分車道無效，以有效車道推估全斷面。
        </li>
      </ul>
      <details className="qa-rules">
        <summary>處理規則（{q.rules.length} 條）</summary>
        <ol>{q.rules.map((r) => <li key={r}>{r}</li>)}</ol>
      </details>
    </Panel>
  )
}

export default function D4({ d }: { d: Domain }) {
  const I = useData<Impact>('impact.json')
  const T = useData<Timeseries>('timeseries.json')
  const roadsFC = useData<FeatureCollection>('lines/road_sections.geojson')
  const vdFC = useLayer('vd')
  const { traffic, series } = useLive()
  const S = useSeries(series)
  const { scenario: s, setScenario } = useAppState()
  const [on, set] = useToggles({ roads: true, vd: true })
  const [focus, setFocus] = useState<{ lon: number; lat: number; zoom: number; key: string }>({ ...NEIHU, key: 'neihu' })

  const roads = useMemo(() => joinRoads(roadsFC, traffic), [roadsFC, traffic])
  const vd = useMemo(() => joinVd(vdFC, traffic), [vdFC, traffic])

  const layers = useMemo<LayerSpec[]>(() => [
    {
      id: 'd4-roads', type: 'line', data: roads, visible: on.roads,
      layout: { 'line-join': 'round', 'line-cap': 'round', 'line-sort-key': ['get', 'los'] },
      paint: {
        'line-color': LOS_COLOR_EXPR,
        'line-width': ['interpolate', ['linear'], ['zoom'], 11, ['case', NH, 2.6, 1.3], 15, ['case', NH, 6.5, 3.6]],
        'line-opacity': ['case', ['==', ['get', 'los'], -1], 0.4, 0.92],
      },
      tooltip: (p) => {
        const L = LOS[(p.los as number) - 1]
        return (
          <>
            <div className="tip-title">{shortName(p.name)} {String(p.dir ?? '')}{p.nh === 1 && <span className="muted"> · 內科</span>}</div>
            {p.vill ? <div className="tip-row"><span className="k">位置</span><span className="v">{String(p.vill)}</span></div> : null}
            <div className="tip-row"><span className="k">服務水準</span><span className="v">{L ? <><StatusGlyph status={L.status} size={9} /> {L.key} 級 {L.label}</> : '無資料'}</span></div>
            <div className="tip-row"><span className="k">即時車速</span><span className="v">{(p.spd as number) >= 0 ? `${fmtNum(p.spd as number, 0)} km/h` : '—'}</span></div>
            <div className="tip-row"><span className="k">路段長</span><span className="v">{fmtNum(p.km as number, 2)} km</span></div>
          </>
        )
      },
    },
    {
      id: 'd4-vd', type: 'circle', data: vd, visible: on.vd,
      layout: { 'circle-sort-key': ['coalesce', ['get', 'flow'], 0] },
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'],
          11, ['interpolate', ['linear'], ['coalesce', ['get', 'flow'], 0], 0, 1.8, 4000, 6.5],
          15, ['interpolate', ['linear'], ['coalesce', ['get', 'flow'], 0], 0, 3.5, 4000, 14]],
        'circle-color': ['case', ['==', ['get', 'flow'], null], '#4a525e', COLOR],
        'circle-opacity': 0.82,
        'circle-stroke-color': ['case', ['==', ['get', 'neihu'], 1], '#f6f7f9', '#0d1014'],
        'circle-stroke-width': ['case', ['==', ['get', 'neihu'], 1], 1.4, 0.6],
      },
      tooltip: (p) => (
        <>
          <div className="tip-title">VD {String(p.id)}{p.neihu === 1 && <span className="muted"> · 內科</span>}</div>
          <div className="tip-row"><span className="k">道路 · 車道</span><span className="v">{String(p.road)} · {p.lanes as number}</span></div>
          <div className="tip-row"><span className="k">車流</span><span className="v">{p.flow == null ? '—' : `${fmtInt(p.flow as number)} 輛/時`}</span></div>
          <div className="tip-row"><span className="k">車速 · 佔有率</span><span className="v">{p.spd == null ? '—' : `${fmtNum(p.spd as number, 0)} km/h`} · {p.occ == null ? '—' : `${fmtNum(p.occ as number, 1)}%`}</span></div>
          <div className="tip-row"><span className="k">V/C</span><span className="v">{p.vc == null ? '—' : fmtNum(p.vc as number, 2)}</span></div>
        </>
      ),
    },
  ], [on, roads, vd])

  const nh = traffic?.neihu
  const D = I?.['4']
  const r = useMemo(() => (I ? impact4(I, s.shift, s.carCut) : null), [I, s.shift, s.carCut])
  const curve = useMemo(() => (I ? shiftCurve(I, s.carCut) : null), [I, s.carCut])
  const cutOnly = I ? impact4(I, 0, 0.05).reduction : null
  const flexOnly = useMemo(() => (I ? shiftCurve(I, 0).best : null), [I])
  const isMock = !!r && !r.real
  const cal = D?.params.calib
  const iFrom = r && D ? D.profile.shift_from.map((b) => r.bins.indexOf(b)).filter((i) => i >= 0) : []
  const winFrom = D?.profile.shift_from[0]
  const winTo = D ? minToHM(hmToMin(D.profile.shift_from[D.profile.shift_from.length - 1]) + 15) : ''
  const win = r ? `${r.bins[0]}–${minToHM(hmToMin(r.bins[r.bins.length - 1]) + 15)}` : ''
  const days = D?.profile.days?.length
  const lever = [s.shift > 0 && `彈性工時 ${fmtPct(s.shift, 0)}`, s.carCut > 0 && `減量 ${fmtPct(s.carCut, 0)}`].filter(Boolean).join(' + ') || '現況'
  const saved = r && r.vhYear >= 0
  // speeds sit in a narrow band (≈ 40–47 km/h): zoom the axis to it, in 5 km/h steps
  const speedDomain = useMemo<[number, number] | undefined>(() => {
    if (!r) return undefined
    const v = [...r.speedBefore, ...r.speedAfter, ...(r.speedObs ?? [])].filter((x): x is number => x != null && Number.isFinite(x))
    return [Math.floor(Math.min(...v) / 5) * 5 - 5, Math.ceil(Math.max(...v) / 5) * 5]
  }, [r])
  // the bins around the peak that stay within 85% of it
  const plateau = useMemo(() => {
    if (!r) return null
    const v = r.vcBefore
    const th = 0.85 * r.peakBefore
    let a = v.indexOf(r.peakBefore)
    let b = a
    while (a > 0 && v[a - 1] >= th) a--
    while (b < v.length - 1 && v[b + 1] >= th) b++
    return { from: r.bins[a], to: minToHM(hmToMin(r.bins[b]) + 15), lo: Math.min(...v.slice(a, b + 1)) }
  }, [r])

  // 內科路段：最壅塞的排前面
  const nhList = useMemo(
    () => (roads ? roads.features.filter((f) => f.properties?.nh === 1).sort((a, b) => (b.properties?.los ?? -1) - (a.properties?.los ?? -1)) : []),
    [roads],
  )
  const spark = (col: string, fmt: (v: number) => string) =>
    S && <Sparkline values={S.get(col)} times={S.t} fmt={fmt} fmtT={(t) => fmtHM(t)} width={132} height={20} color="var(--d4)" />

  return (
    <DomainFrame d={d} focus={focus}
      kpiSources={['road_live', 'vd_live', 'vd_static', 'road_section', ...PETITION_KEYS]}
      kpis={
        <>
          <Kpi code="04" label="內科壅塞路段比例" value={nh ? fmtPct(nh.congested_share) : '—'} color={d.color} live
            spark={spark('neihu_cong', (v) => fmtPct(v))}
            sub={nh && traffic && <>{nh.n} 段有資料 · 全市 {fmtPct(traffic.city.congested_share)}</>} />
          <Kpi label="內科 VD 平均 V/C" value={nh ? fmtNum(nh.vc_mean, 2) : '—'} color={d.color} live
            spark={spark('neihu_vc', (v) => fmtNum(v, 2))}
            sub={nh && <>{nh.vd} 支 VD · 平均佔有率 {fmtNum(nh.occ_mean, 1)}%</>} />
          <Kpi label="內科路段均速" value={nh ? fmtNum(nh.mean_speed, 1) : '—'} unit="km/h" color={d.color} live
            spark={spark('neihu_speed', (v) => `${fmtNum(v, 1)} km/h`)}
            sub={nh && traffic && <>VD 均速 {fmtNum(nh.vd_speed, 1)} · 全市路段 {fmtNum(traffic.city.mean_speed, 1)}</>} />
          <Kpi label="內科 VD 總車流" value={nh ? fmtInt(nh.flow_vph) : '—'} unit="輛/時" color={d.color} live
            spark={spark('neihu_flow', (v) => `${fmtInt(v)} 輛/時`)}
            sub={D && <>容量約 {fmtInt(D.neihu.cap_vph)} 輛/時（{D.neihu.vd} 支 VD）</>} />
          <PetitionKpi d={d} T={T} />
        </>
      }
      layers={layers}
      toggles={[
        { id: 'roads', label: '即時路況（粗線 = 內科）', sym: <i className="sym sym-line" style={{ ['--c' as string]: LOS_GROUPS[1].color }} />, on: on.roads, set: (v) => set('roads', v), n: roadsFC ? fmtInt(roadsFC.features.length) : undefined },
        { id: 'vd', label: 'VD 偵測器（大小 = 車流）', sym: <i className="sym sym-dot" style={{ ['--c' as string]: COLOR }} />, on: on.vd, set: (v) => set('vd', v), n: vdFC ? fmtInt(vdFC.features.length) : undefined },
      ]}
      legend={on.roads && (
        <div className="legend legend-sym">
          <div className="legend-title">路段服務水準（TDX 即時）</div>
          {LOS_GROUPS.map((g) => (
            <div key={g.st} className="legend-item">
              <i className="sym sym-line" style={{ ['--c' as string]: g.color }} />
              <StatusGlyph status={g.st} size={9} />
              <span>{g.label}</span>
              <span className="muted num">{g.keys}</span>
            </div>
          ))}
          <div className="legend-item"><i className="sym sym-line" style={{ ['--c' as string]: '#4a525e' }} /><span className="muted">無資料</span></div>
        </div>
      )}
      mapSources={['village', 'road_live', 'road_section_shape', 'vd_live', 'vd_static']}
      mapNote={traffic ? `路況 ${fmtHM(traffic.feeds.road_live?.src_time)} · VD ${fmtHM(traffic.feeds.vd_live?.src_time)}（本機定時存檔）` : undefined}
      cardRows={(p) => [
        { k: '有即時資料的路段', v: `${fmtInt(p.sec)} 段` },
        { k: '壅塞路段比例（E–F）', v: p.cong == null ? '無路段' : fmtPct(p.cong) },
      ]}
      side={
        <>
          <ScenarioPanel
            schem={r && D && (
              <Schem.Traffic bins={r.bins} vcBefore={r.vcBefore} vcAfter={r.vcAfter} vFree={D.params.v_free} alpha={D.params.alpha} beta={D.params.beta}
                speedBefore={r.speedBefore} speedAfter={r.speedAfter} reduction={r.reduction} isMock={isMock} afterLabel="情境" />
            )}
            controls={
              <>
                <Slider label={`彈性工時：${winFrom ?? ''}–${winTo} 的車流移到前後時段`} value={s.shift} min={0} max={0.3} step={0.01} fmt={(v) => fmtPct(v, 0)}
                  onChange={(v) => setScenario({ shift: v })}
                  marks={curve && curve.best.shift > 0 ? [{ v: curve.best.shift, label: `最佳 ${fmtPct(curve.best.shift, 0)}` }] : undefined} />
                <Slider label="減量：每個時段進入內湖的車流減少（交通車、共乘、轉乘）" value={s.carCut} min={0} max={0.2} step={0.01} fmt={(v) => fmtPct(v, 0)}
                  onChange={(v) => setScenario({ carCut: v })} />
              </>
            }
            hero={r && (
              <Hero k={`內科晨峰總延滯（${win}）`} from={fmtInt(r.delayBefore)} to={fmtInt(r.delayAfter)} unit="車·時 / 日"
                d={delta(r.delayAfter, r.delayBefore, (v) => fmtPct(v / Math.max(r.delayBefore, 1e-9)), true)} />
            )}
            results={r ? [
              { k: '尖峰 V/C', from: fmtNum(r.peakBefore, 2), to: fmtNum(r.peakAfter, 2), d: delta(r.peakAfter, r.peakBefore, (v) => fmtNum(v, 2), true), mock: isMock },
              { k: '最慢時段車速（校準模型）', from: fmtNum(Math.min(...r.speedBefore), 1), to: `${fmtNum(Math.min(...r.speedAfter), 1)} km/h`, d: delta(Math.min(...r.speedAfter), Math.min(...r.speedBefore), (v) => fmtNum(v, 1), false), mock: isMock },
              { k: saved ? '每年省下的延滯' : '每年增加的延滯', to: `${fmtWan(Math.abs(r.vhYear))} 車·時`, mock: isMock },
              { k: saved ? '每年省油' : '每年多耗油', to: `${fmtWan(Math.abs(r.fuelYear))} 公升`, mock: isMock },
              { k: saved ? '每年減碳' : '每年增碳', to: `${fmtInt(Math.abs(r.co2Year))} 公噸 CO₂`, mock: isMock },
            ] : []}
            mock={isMock}
            onReset={() => setScenario({ shift: DEFAULT_SCENARIO.shift, carCut: DEFAULT_SCENARIO.carCut })}
            note={r && (r.real
              ? <>以 {r.vdCount} 支內科 VD{days ? `、${days} 個平日` : ''}的實測晨峰計算；延滯函數以實測車速校準{cal ? `（α = ${fmtNum(cal.alpha, 2)}、自由車速 ${fmtNum(cal.v_free, 1)} km/h，誤差 ${fmtNum(cal.rmse, 1)} km/h）` : ''}。</>
              : <>晨峰 15 分鐘曲線目前是模擬資料，執行 pipeline.history 抓 TDX 歷史 VD 後會自動改用真實資料。</>)}
          />
          {curve && r && (
            <Panel tag="OPT" title="彈性工時比例與延滯變化" className="ticks"
              foot={<Prov keys={['vd_hist', 'vd_static']} compact note={`減量 ${fmtPct(s.carCut, 0)} 時，每 1% 一點`} mock={isMock} />}>
              <div className="dp-chart">
                <div className="dp-chart-k">晨峰總延滯變化（減量 {fmtPct(s.carCut, 0)} 時；低於 0 = 改善）</div>
                <LineChart x={curve.pts.map((p) => p.shift)} height={130} legend={false}
                  series={[{ id: 'chg', label: '延滯變化', color: 'var(--d4)', values: curve.pts.map((p) => -p.reduction) }]}
                  yFmt={(v) => fmtDeltaPct(v, 0)} xFmt={(v) => fmtPct(v, 0)} xLabel="移出比例"
                  marker={s.shift} markerLabel={`${fmtPct(s.shift, 0)} → ${fmtDeltaPct(-r.reduction)}`} />
              </div>
              {r.real && plateau && (
                <ul className="dp-insight">
                  <li>內科晨峰不是一個尖峰，而是平台：{plateau.from}–{plateau.to} 都在最高值的 85% 以上（V/C {fmtNum(plateau.lo, 2)}–{fmtNum(r.peakBefore, 2)}），前後時段能接的空間很少。</li>
                  {flexOnly && <li>只靠彈性工時，移出約 <b>{fmtPct(flexOnly.shift, 0)}</b> 效果最好，延滯也只減少 <b>{fmtPct(flexOnly.reduction)}</b>；移出更多會把 {r.bins[0]}–{winFrom} 與 {winTo}–{win.split('–')[1]} 塞滿，延滯反而增加。</li>}
                  {cutOnly != null && <li>減量的效果大得多：每個時段少 5% 車流，延滯就減少約 <b>{fmtPct(cutOnly, 0)}</b>，因為車速對流量的反應是非線性的。</li>}
                </ul>
              )}
            </Panel>
          )}
          {r && (
            <Panel tag="CH" title="晨峰每 15 分鐘 V/C 與車速" className="ticks"
              foot={<Prov keys={['vd_hist', 'vd_static']} compact note={r.real ? `${r.vdCount} 支 VD${days ? ` · ${days} 個平日平均` : ''}` : '模擬曲線'} mock={isMock} />}>
              <div className="dp-chart">
                <div className="dp-chart-k">V/C（流量 ÷ 容量）</div>
                <LineChart x={r.bins.map((_, i) => i)} height={130}
                  series={[
                    { id: 'b', label: '現況', color: 'var(--ink-3)', values: r.vcBefore, dashed: true, width: 1.6 },
                    { id: 'a', label: lever, color: 'var(--d4)', values: r.vcAfter },
                  ]}
                  yDomain={[0, Math.max(1, r.peakBefore * 1.1)]} yFmt={(v) => fmtNum(v, 1)} xFmt={(i) => r.bins[i] ?? ''} xTicks={[0, 2, 4, 6, 8].filter((i) => i < r.bins.length)}
                  bands={iFrom.length ? [{ from: iFrom[0], to: iFrom[iFrom.length - 1], label: '移出時段' }] : undefined} />
                <div className="dp-chart-k">平均車速（km/h）{r.speedObs && '：實測與校準模型'}</div>
                <LineChart x={r.bins.map((_, i) => i)} height={130}
                  series={[
                    ...(r.speedObs ? [{ id: 'o', label: '實測', color: 'var(--ink-1)', values: r.speedObs, width: 1.4 }] : []),
                    { id: 'b', label: '模型 · 現況', color: 'var(--ink-3)', values: r.speedBefore, dashed: true, width: 1.6 },
                    { id: 'a', label: `模型 · ${lever}`, color: 'var(--d4)', values: r.speedAfter },
                  ]}
                  yDomain={speedDomain} yFmt={(v) => fmtNum(v, 0)} xFmt={(i) => r.bins[i] ?? ''} xTicks={[0, 2, 4, 6, 8].filter((i) => i < r.bins.length)}
                  bands={iFrom.length ? [{ from: iFrom[0], to: iFrom[iFrom.length - 1] }] : undefined} />
              </div>
            </Panel>
          )}
          {D?.profile.quality && <QualityPanel p={D.profile} />}
          <Panel tag="RT" title="內科路段即時狀況" className="ticks"
            right={traffic ? <LiveBadge time={fmtTime(traffic.fetched_at)} /> : undefined}
            foot={<Prov keys={['road_live', 'road_section']} compact note="點一列移動地圖" mock={traffic?.is_mock} />}>
            {nh && (
              <div className="los">
                <div className="los-h">
                  <span>內科 {nh.n} 段服務水準</span>
                  <button className="btn btn-ghost" onClick={() => setFocus({ ...NEIHU, key: `neihu-${Date.now()}` })}>定位內科</button>
                </div>
                <ShareBar height={9} parts={LOS.map((l) => ({ key: l.key, value: nh.los[l.key], color: l.color, label: `${l.key} 級 ${l.label}` }))} />
              </div>
            )}
            <div className="nh-list">
              {nhList.map((f) => {
                const p = f.properties ?? {}
                const L = LOS[(p.los as number) - 1]
                return (
                  <button key={String(p.id)} className="nh-row"
                    onClick={() => {
                      const [lon, lat] = bboxCenter(f.geometry)
                      setFocus({ lon, lat, zoom: 15.5, key: `${p.id}-${Date.now()}` })
                    }}>
                    <span className="nh-st">{L ? <StatusGlyph status={L.status} size={9} /> : <StatusGlyph status="idle" size={9} />}</span>
                    <span className="nh-name">{shortName(p.name)}{p.dir ? <span className="muted"> {String(p.dir)}{p.vill ? ` · ${String(p.vill)}` : ''}</span> : null}</span>
                    <span className="nh-los num">{L ? `${L.key} ${L.label}` : '無資料'}</span>
                    <span className="nh-spd num">{(p.spd as number) >= 0 ? `${fmtNum(p.spd as number, 0)} km/h` : '—'}</span>
                  </button>
                )
              })}
            </div>
          </Panel>
        </>
      }
    />
  )
}
