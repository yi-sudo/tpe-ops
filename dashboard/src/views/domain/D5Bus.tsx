// 05 公車：與捷運高重疊的路線減班，省下的車公里改開 DRTS 小巴補公車冷區；即時車輛位置與到站
import { useMemo, useState } from 'react'
import type { FeatureCollection } from 'geojson'
import { BarList, LineChart, Sparkline } from '../../components/Charts'
import type { LayerSpec } from '../../components/MapView'
import { Kpi, Panel, Prov } from '../../components/Panel'
import { useData, useLayer, useLive, useSeries } from '../../lib/data'
import type { Domain } from '../../lib/domains'
import { fmtHM, fmtInt, fmtNum, fmtPct, fmtWan } from '../../lib/format'
import { bboxCenter } from '../../lib/geo'
import { impact5 } from '../../lib/impact'
import { busFC } from '../../lib/livegeo'
import { DEFAULT_SCENARIO, useAppState } from '../../lib/state'
import type { BusRoute, Impact, Timeseries } from '../../lib/types'
import { DomainFrame, Hero, PetitionKpi, ScenarioPanel, Slider } from './Frame'
import { PETITION_KEYS, Schem, useToggles } from './hooks'

const COLOR = '#3987e5'
const OVL = 0.6 // 與捷運重疊 ≥ 60% 視為高重疊（impact.json 假設）

export default function D5({ d }: { d: Domain }) {
  const I = useData<Impact>('impact.json')
  const T = useData<Timeseries>('timeseries.json')
  const R = useData<{ routes: BusRoute[]; is_mock: boolean }>('bus_routes.json')
  const routesFC = useData<FeatureCollection>('lines/bus_routes.geojson')
  const { bus, series } = useLive()
  const S = useSeries(series)
  const { scenario: s, setScenario } = useAppState()
  const [on, set] = useToggles({ routes: true, live: true, mrt: true, stops: true })
  const [selRoute, setSelRoute] = useState<number | null>(null)
  const [focus, setFocus] = useState<{ lon: number; lat: number; zoom: number; key: string } | null>(null)
  const stops = useLayer(on.stops ? 'bus_stops' : null)
  const mrt = useLayer('mrt')
  const buses = useMemo(() => busFC(bus), [bus])

  const layers = useMemo<LayerSpec[]>(() => {
    const sel = ['==', ['get', 'id'], selRoute ?? -1]
    const hi = ['>=', ['get', 'ovl'], OVL]
    const dim = selRoute != null ? 0.45 : 1
    return [
      {
        id: 'd5-routes', type: 'line', data: routesFC, visible: on.routes,
        layout: { 'line-join': 'round', 'line-cap': 'round', 'line-sort-key': ['case', sel, 2, hi, 1, 0] },
        paint: {
          'line-color': ['case', sel, '#f6f7f9', hi, COLOR, '#5f6b7c'],
          'line-width': ['interpolate', ['linear'], ['zoom'], 11, ['case', sel, 3.2, hi, 1.3, 0.6], 15, ['case', sel, 6, hi, 3, 1.4]],
          'line-opacity': ['case', sel, 1, hi, 0.6 * dim, 0.25 * dim],
        },
        tooltip: (p) => (
          <>
            <div className="tip-title">{String(p.name)} 路</div>
            <div className="tip-row"><span className="k">與捷運重疊</span><span className="v">{fmtPct(p.ovl as number, 0)}{(p.ovl as number) >= OVL ? ' · 高重疊' : ''}</span></div>
            <div className="tip-row"><span className="k">平日單向班次</span><span className="v">{fmtNum(p.trips as number, 0)}</span></div>
          </>
        ),
        onClick: (p) => setSelRoute((x) => (x === p.id ? null : (p.id as number))),
      },
      {
        id: 'd5-stops', type: 'circle', data: stops, visible: on.stops, minzoom: 14,
        paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 14, 2, 17, 4.5], 'circle-color': '#0d1014', 'circle-stroke-color': '#aab3bf', 'circle-stroke-width': 1 },
        tooltip: (p) => (
          <>
            <div className="tip-title">{String(p.name)}</div>
            <div className="tip-row"><span className="k">停靠路線</span><span className="v">{p.routes as number} 條</span></div>
            <div className="tip-row"><span className="k">平日每日班次</span><span className="v">{fmtInt(p.passes as number)}</span></div>
          </>
        ),
      },
      {
        id: 'd5-mrt', type: 'circle', data: mrt, visible: on.mrt,
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['sqrt', ['coalesce', ['get', 'daily'], 0]], 0, 2.5, 400, 13],
          'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': '#f6f7f9', 'circle-stroke-width': 1.3, 'circle-stroke-opacity': 0.85,
        },
        tooltip: (p) => (
          <>
            <div className="tip-title">捷運 {String(p.name)}</div>
            <div className="tip-row"><span className="k">日均進出人次</span><span className="v">{p.daily == null ? '—' : fmtInt(p.daily as number)}</span></div>
          </>
        ),
      },
      {
        id: 'd5-live', type: 'circle', data: buses, visible: on.live,
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 1.7, 16, 4.6],
          'circle-color': ['case', ['>', ['get', 'spd'], 0], '#f6f7f9', '#8f99a8'],
          'circle-stroke-color': '#0d1014', 'circle-stroke-width': 0.6,
        },
        tooltip: (p) => (
          <>
            <div className="tip-title">公車 · 路線代碼 {String(p.route)}</div>
            <div className="tip-row"><span className="k">車速</span><span className="v">{(p.spd as number) > 0 ? `${fmtInt(p.spd as number)} km/h` : '停靠或停等'}</span></div>
          </>
        ),
      },
    ]
  }, [on, routesFC, stops, mrt, buses, selRoute])

  const D = I?.['5']
  const b = D?.baseline
  const r = I ? impact5(I, s.cut) : null
  const pickIds = useMemo(() => (D && r ? D.cold_villages.slice(0, r.served) : null), [D, r?.served]) // eslint-disable-line react-hooks/exhaustive-deps
  const red = useMemo(() => (R ? R.routes.filter((x) => x.overlap >= OVL).sort((a, c) => c.vkm - a.vkm) : []), [R])
  const riders = T?.bus_daily_riders
  const used = r && D ? r.served * D.params.drts_hours_per_village : 0 // DRTS 車·時 / 日
  const left = r && D ? Math.max(0, r.vkmSaved - used * D.params.drts_speed) : 0 // 補完冷區後還剩的車公里

  const pickRoute = (id: number | string) => {
    const nid = Number(id)
    const next = selRoute === nid ? null : nid
    setSelRoute(next)
    const f = next != null ? routesFC?.features.find((x) => x.properties?.id === nid) : null
    if (f) {
      const [lon, lat] = bboxCenter(f.geometry)
      setFocus({ lon, lat, zoom: 12.4, key: `r${nid}-${Date.now()}` })
    }
  }

  return (
    <DomainFrame d={d} focus={focus} skeleton={false}
      pick={D && r ? { ids: pickIds, label: `DRTS 補足的冷區里（${r.served} / ${r.cold}）` } : null}
      kpiSources={['bus_live', 'bus_eta', 'bus_route', 'bus_shape', 'bus_timetable', 'metro_shape', ...PETITION_KEYS]}
      kpis={
        <>
          <Kpi code="05" label="營運中公車" value={bus ? fmtInt(bus.on_duty) : '—'} unit="輛" color={d.color} live
            spark={S && <Sparkline values={S.get('bus_on_duty')} times={S.t} fmt={(v) => `${fmtInt(v)} 輛`} fmtT={(t) => fmtHM(t)} width={132} height={20} color="var(--d5)" />}
            sub={bus && <>行駛中均速 {fmtNum(bus.moving_speed, 1)} km/h</>} />
          <Kpi label="站牌平均候車" value={bus ? fmtNum(bus.eta.mean_wait_min, 1) : '—'} unit="分" color={d.color} live
            spark={S && <Sparkline values={S.get('eta_wait')} times={S.t} fmt={(v) => `${fmtNum(v, 1)} 分`} fmtT={(t) => fmtHM(t)} width={132} height={20} color="var(--d5)" />}
            sub={bus && <>P90 {fmtNum(bus.eta.p90_wait_min, 0)} 分 · 3 分內到站 {fmtPct(bus.eta.within_3min, 0)}</>} />
          <Kpi label={`與捷運高重疊路線（≥ ${fmtPct(OVL, 0)}）`} value={fmtInt(b?.redundant_routes)} unit={b ? `/ ${fmtInt(b.routes)} 線` : undefined} color={d.color}
            sub={b && <>每日 {fmtWan(b.redundant_vkm)} 車公里 · 占全市 {fmtPct(b.redundant_vkm / b.vkm_day, 0)}</>} />
          <Kpi label="公車冷區里" value={D ? fmtInt(D.cold_villages.length) : '—'} unit="里" color={d.color}
            sub="班次少、離捷運遠、長者多（服務需求分數前 60）" />
          <PetitionKpi d={d} T={T} />
        </>
      }
      layers={layers}
      toggles={[
        { id: 'routes', label: `公車路線（藍 = 與捷運重疊 ≥ ${fmtPct(OVL, 0)}）`, sym: <i className="sym sym-line" style={{ ['--c' as string]: COLOR }} />, on: on.routes, set: (v) => set('routes', v), n: b ? fmtInt(b.routes) : undefined },
        { id: 'live', label: '即時公車位置', sym: <i className="sym sym-dot" style={{ ['--c' as string]: '#f6f7f9' }} />, on: on.live, set: (v) => set('live', v), n: bus ? fmtInt(bus.positions.length) : undefined },
        { id: 'mrt', label: '捷運站（大小 = 進出人次）', sym: <i className="sym sym-ring" style={{ ['--c' as string]: '#f6f7f9' }} />, on: on.mrt, set: (v) => set('mrt', v) },
        { id: 'stops', label: '公車站牌', sym: <i className="sym sym-ring" style={{ ['--c' as string]: '#aab3bf' }} />, on: on.stops, set: (v) => set('stops', v), n: 'z ≥ 14' },
      ]}
      mapSources={['village', 'bus_shape', 'bus_route', 'bus_timetable', 'bus_live', 'metro_station', 'mrt_ridership']}
      mapNote={bus ? `公車位置 ${fmtHM(bus.feeds.bus_live?.fetched_at)}（本機定時存檔）· 點路線可單獨標示` : '點路線可單獨標示'}
      cardRows={(p) => [
        { k: '公車站牌', v: `${fmtInt(p.stops)} 處` },
        { k: '平日每日班次通過', v: fmtInt(p.pass) },
        { k: '每千人每日班次', v: p.ppc == null ? '人口過少' : fmtNum(p.ppc, 0) },
        { k: '最近捷運站', v: `${fmtNum(p.mrt_km, 2)} km` },
      ]}
      side={
        <>
          <ScenarioPanel
            schem={r && <Schem.Bus cut={s.cut} villagesServed={r.served} coldTotal={r.cold} savedVkm={r.vkmSaved} />}
            controls={
              <Slider label={`高重疊路線減班（${b ? b.redundant_routes : '—'} 線）`} value={s.cut} min={0} max={1} step={0.05} fmt={(v) => fmtPct(v, 0)}
                onChange={(v) => setScenario({ cut: v })} />
            }
            hero={r && (
              <Hero k="DRTS 可補足的公車冷區里" to={fmtInt(r.served)} unit={`/ ${r.cold} 里`} />
            )}
            results={r && D ? [
              { k: '每日釋出車公里', to: fmtInt(r.vkmSaved), d: { dir: 'flat', text: `全市 ${fmtPct(r.share, 1)}` } },
              { k: 'DRTS 每日服務', to: `${fmtInt(used)} 車·時`, d: { dir: 'flat', text: `可用 ${fmtInt(r.hours)}` } },
              { k: '補完冷區後還剩', to: `${fmtInt(left)} 車公里 / 日` },
              { k: '剩餘部分每年可省', to: `${fmtWan(left * D.params.cost_per_vkm * 365)} 元` },
            ] : []}
            onReset={() => setScenario({ cut: DEFAULT_SCENARIO.cut })}
            note={D && <>減班省下的車公里以 {D.params.drts_speed} km/h 換成 DRTS 車小時，每個冷區里每天 {D.params.drts_hours_per_village} 車小時，依服務需求分數由高到低補（地圖虛線框）。</>}
          />
          <Panel tag="OV" title="與捷運高重疊的路線" className="ticks"
            foot={<div className="dp-note">依每日車公里排序。重疊率 = 路線軌跡落在捷運路線 300 m 內的比例。點一列在地圖標示這條路線。</div>}>
            <div className="dp-scrolllist scroll">
              <BarList fmt={(v) => fmtPct(v, 0)} color="var(--d5)" max={1} selected={selRoute} onClick={pickRoute}
                items={red.map((x) => ({
                  key: x.id,
                  label: <><b>{x.name}</b> <span className="muted">{x.from_}–{x.to}</span></>,
                  value: x.overlap,
                  sub: <>{fmtInt(x.vkm)} 車公里 / 日 · 單向 {fmtNum(x.trips_dir, 0)} 班</>,
                }))} />
            </div>
          </Panel>
          {riders && (
            <Panel tag="CH" title="聯營公車日均載客" className="ticks"
              foot={<Prov keys={['bus_stats']} compact />}>
              <div className="dp-chart">
                <LineChart x={riders.map((x) => x[0])} height={130} legend={false}
                  series={[{ id: 'r', label: '日均載客', color: 'var(--d5)', values: riders.map((x) => x[1]), area: true }]}
                  yFmt={(v) => fmtWan(v, 0)} xFmt={(v) => String(v)} />
              </div>
            </Panel>
          )}
        </>
      }
    />
  )
}
