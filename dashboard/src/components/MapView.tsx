// MapLibre map with a self-built, offline base (行政區、里界、公車路網骨架、捷運) — no external tiles or glyphs.
// Domain layers are passed declaratively as `layers` and diffed onto the map.
import { Map as MLMap, Marker, type GeoJSONSource, type MapGeoJSONFeature, type StyleSpecification } from 'maplibre-gl'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { FeatureCollection } from 'geojson'
import '../lib/maplibre'
import { useData } from '../lib/data'
import { classExpr, type Classes } from '../lib/scales'
import type { VillageFC, VillageProps } from '../lib/types'
import { IconCube, IconTarget } from './Icons'

export interface LayerSpec {
  id: string
  type: 'circle' | 'line' | 'fill' | 'fill-extrusion' | 'heatmap'
  /** GeoJSON object or a URL under public/ (e.g. '/data/lines/mrt.geojson') */
  data: FeatureCollection | string | undefined
  paint?: Record<string, unknown>
  layout?: Record<string, unknown>
  filter?: unknown
  minzoom?: number
  visible?: boolean
  tooltip?: (p: Record<string, unknown>) => ReactNode
  onClick?: (p: Record<string, unknown>, lngLat: [number, number]) => void
}

export interface MapViewProps {
  villages?: VillageFC
  /** opacity may be a zoom expression (e.g. fade the 里 fill when zoomed in to point layers) */
  choro?: { key: string; classes: Classes; opacity?: number | unknown[] } | null
  extrude?: { key: string; scale: number } | null
  selected?: number | null
  onSelect?: (i: number | null) => void
  villageTip?: (p: VillageProps) => ReactNode
  layers?: LayerSpec[]
  skeleton?: boolean
  focus?: { lon: number; lat: number; zoom?: number; key: string | number } | null
  highlight?: number[] | null
  children?: ReactNode
  showExtrudeToggle?: boolean
}

const TAIPEI: [[number, number], [number, number]] = [[121.457, 24.96], [121.666, 25.21]]
const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] }
const BASE = `${import.meta.env.BASE_URL}data/`
const url = (p: string) => (p.startsWith('/') ? `${BASE}${p.replace(/^\/data\//, '')}` : p)

const STYLE: StyleSpecification = { version: 8, sources: {}, layers: [] }

type Tip = { x: number; y: number; node: ReactNode } | null

export default function MapView(props: MapViewProps) {
  const { villages, choro, extrude, selected, layers = [], skeleton = true, focus, highlight, children, showExtrudeToggle } = props
  const box = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MLMap | null>(null)
  const propsRef = useRef(props)
  propsRef.current = props
  const [ready, setReady] = useState(false)
  const [tip, setTip] = useState<Tip>(null)
  const [cursor, setCursor] = useState<{ lon: number; lat: number; z: number } | null>(null)
  const [is3d, set3d] = useState(false)
  const districts = useData<FeatureCollection>('districts.geojson')
  const applied = useRef(new Map<string, { data: unknown; paint: string; layout: string; filter: string; visible: boolean }>())

  /* ---------- create map ---------- */
  useEffect(() => {
    if (!box.current) return
    const map = new MLMap({
      container: box.current,
      style: STYLE,
      bounds: TAIPEI,
      fitBoundsOptions: { padding: 24 },
      attributionControl: false,
      dragRotate: true,
      maxPitch: 65,
      minZoom: 9.5,
      maxZoom: 18.5,
    })
    mapRef.current = map
    const appliedMap = applied.current
    map.on('load', () => {
      map.addSource('villages', { type: 'geojson', data: EMPTY })
      map.addSource('districts', { type: 'geojson', data: url('/data/districts.geojson') })
      map.addSource('bus-skel', { type: 'geojson', data: url('/data/lines/bus_routes.geojson') })
      map.addSource('mrt', { type: 'geojson', data: url('/data/lines/mrt.geojson') })
      map.addLayer({ id: 'vill-fill', type: 'fill', source: 'villages', paint: { 'fill-color': '#1f242b', 'fill-opacity': 0.88 } })
      map.addLayer({
        id: 'vill-ext', type: 'fill-extrusion', source: 'villages', layout: { visibility: 'none' },
        paint: { 'fill-extrusion-color': '#3987e5', 'fill-extrusion-height': 0, 'fill-extrusion-opacity': 0.92, 'fill-extrusion-vertical-gradient': true },
      })
      map.addLayer({ id: 'vill-line', type: 'line', source: 'villages', paint: { 'line-color': '#0d1014', 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 0.3, 15, 1.2], 'line-opacity': 0.9 } })
      map.addLayer({
        id: 'bus-skel', type: 'line', source: 'bus-skel', layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': '#c5cbd3', 'line-opacity': ['interpolate', ['linear'], ['zoom'], 10, 0.07, 14, 0.16], 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.4, 15, 1.4] },
      })
      map.addLayer({ id: 'dist-line', type: 'line', source: 'districts', paint: { 'line-color': '#8f99a8', 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.7, 14, 1.6], 'line-opacity': 0.55 } })
      map.addLayer({
        id: 'mrt-casing', type: 'line', source: 'mrt', layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': '#0d1014', 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 2.4, 15, 5], 'line-opacity': 0.7 },
      })
      map.addLayer({
        id: 'mrt-line', type: 'line', source: 'mrt', layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': '#d3d8de', 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.9, 15, 2.2], 'line-opacity': 0.55, 'line-dasharray': [3, 1.5] },
      })
      map.addLayer({ id: 'vill-hl', type: 'line', source: 'villages', filter: ['in', ['get', 'i'], ['literal', []]], paint: { 'line-color': '#f6f7f9', 'line-width': 1.2, 'line-opacity': 0.75, 'line-dasharray': [2, 1.5] } })
      map.addLayer({ id: 'vill-hover', type: 'line', source: 'villages', filter: ['==', ['get', 'i'], -1], paint: { 'line-color': '#abb3bf', 'line-width': 1.4 } })
      map.addLayer({ id: 'vill-sel', type: 'line', source: 'villages', filter: ['==', ['get', 'i'], -1], paint: { 'line-color': '#f6f7f9', 'line-width': 2.4 } })
      setReady(true)
    })

    /* hover + click, with point layers taking precedence over 里 polygons */
    const interactive = () => {
      const ids = (propsRef.current.layers ?? []).filter((l) => (l.tooltip || l.onClick) && l.visible !== false && map.getLayer(l.id)).map((l) => l.id)
      return [...ids.reverse(), 'vill-fill']
    }
    let raf = 0
    map.on('mousemove', (e) => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        if (!map.getLayer('vill-fill')) return
        setCursor({ lon: e.lngLat.lng, lat: e.lngLat.lat, z: map.getZoom() })
        const hit: MapGeoJSONFeature | undefined = map.queryRenderedFeatures(e.point, { layers: interactive() })[0]
        const p = propsRef.current
        if (!hit) {
          map.setFilter('vill-hover', ['==', ['get', 'i'], -1])
          map.getCanvas().style.cursor = ''
          setTip(null)
          return
        }
        if (hit.layer.id === 'vill-fill') {
          const vp = hit.properties as unknown as VillageProps
          map.setFilter('vill-hover', ['==', ['get', 'i'], vp.i])
          map.getCanvas().style.cursor = 'pointer'
          setTip(p.villageTip ? { x: e.point.x, y: e.point.y, node: p.villageTip(vp) } : null)
        } else {
          map.setFilter('vill-hover', ['==', ['get', 'i'], -1])
          const spec = p.layers?.find((l) => l.id === hit.layer.id)
          map.getCanvas().style.cursor = spec?.onClick ? 'pointer' : 'crosshair'
          setTip(spec?.tooltip ? { x: e.point.x, y: e.point.y, node: spec.tooltip(hit.properties) } : null)
        }
      })
    })
    map.getCanvasContainer().addEventListener('mouseleave', () => {
      cancelAnimationFrame(raf)
      setTip(null)
      setCursor(null)
      if (map.getLayer('vill-hover')) map.setFilter('vill-hover', ['==', ['get', 'i'], -1])
    })
    map.on('click', (e) => {
      if (!map.getLayer('vill-fill')) return
      const hit = map.queryRenderedFeatures(e.point, { layers: interactive() })[0]
      const p = propsRef.current
      if (!hit) return p.onSelect?.(null)
      if (hit.layer.id === 'vill-fill') return p.onSelect?.((hit.properties as unknown as VillageProps).i)
      p.layers?.find((l) => l.id === hit.layer.id)?.onClick?.(hit.properties, [e.lngLat.lng, e.lngLat.lat])
    })
    map.on('pitchend', () => set3d(map.getPitch() > 5))

    const ro = new ResizeObserver(() => map.resize())
    ro.observe(box.current)
    return () => {
      ro.disconnect()
      cancelAnimationFrame(raf)
      appliedMap.clear()
      map.remove()
      mapRef.current = null
      setReady(false)
    }
  }, [])

  /* ---------- village data ---------- */
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map || !villages) return
    ;(map.getSource('villages') as GeoJSONSource).setData(villages)
  }, [ready, villages])

  /* ---------- choropleth ---------- */
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    if (choro) {
      map.setPaintProperty('vill-fill', 'fill-color', classExpr(choro.key, choro.classes) as never)
      map.setPaintProperty('vill-fill', 'fill-opacity', (choro.opacity ?? 0.88) as never)
    } else {
      map.setPaintProperty('vill-fill', 'fill-color', '#1c2127')
      map.setPaintProperty('vill-fill', 'fill-opacity', 0.9)
    }
  }, [ready, choro])

  /* ---------- 3D extrusion ---------- */
  const wasExtruded = useRef(false)
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    if (extrude && choro) {
      map.setLayoutProperty('vill-ext', 'visibility', 'visible')
      map.setPaintProperty('vill-ext', 'fill-extrusion-color', classExpr(choro.key, choro.classes) as never)
      map.setPaintProperty('vill-ext', 'fill-extrusion-height', ['*', ['to-number', ['coalesce', ['get', extrude.key], 0]], extrude.scale] as never)
      map.setPaintProperty('vill-fill', 'fill-opacity', 0.25)
      if (!wasExtruded.current && map.getPitch() < 20) map.easeTo({ pitch: 52, bearing: -18, duration: 900 })
      wasExtruded.current = true
    } else {
      map.setLayoutProperty('vill-ext', 'visibility', 'none')
      map.setPaintProperty('vill-fill', 'fill-opacity', (choro ? choro.opacity ?? 0.88 : 0.9) as never)
      if (wasExtruded.current && map.getPitch() > 5) map.easeTo({ pitch: 0, bearing: 0, duration: 700 })
      wasExtruded.current = false
    }
  }, [ready, extrude, choro])

  /* ---------- selection / highlight ---------- */
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    map.setFilter('vill-sel', ['==', ['get', 'i'], selected ?? -1])
  }, [ready, selected])
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    map.setFilter('vill-hl', ['in', ['get', 'i'], ['literal', highlight ?? []]])
  }, [ready, highlight])

  /* ---------- skeleton toggle ---------- */
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    map.setLayoutProperty('bus-skel', 'visibility', skeleton ? 'visible' : 'none')
  }, [ready, skeleton])

  /* ---------- focus ---------- */
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map || !focus) return
    map.flyTo({ center: [focus.lon, focus.lat], zoom: focus.zoom ?? Math.max(map.getZoom(), 13.6), duration: 1100, essential: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, focus?.key])

  /* ---------- domain layers (diff) ---------- */
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    const seen = new Set<string>()
    for (const l of layers) {
      seen.add(l.id)
      const src = `src-${l.id}`
      const data = typeof l.data === 'string' ? url(l.data) : l.data ?? EMPTY
      const paint = JSON.stringify(l.paint ?? {})
      const layout = JSON.stringify(l.layout ?? {})
      const filter = JSON.stringify(l.filter ?? null)
      const visible = l.visible !== false
      const prev = applied.current.get(l.id)
      if (!prev) {
        if (!map.getSource(src)) map.addSource(src, { type: 'geojson', data: data as never })
        map.addLayer(
          {
            id: l.id,
            type: l.type,
            source: src,
            paint: (l.paint ?? {}) as never,
            layout: { ...(l.layout ?? {}), visibility: visible ? 'visible' : 'none' } as never,
            ...(l.filter ? { filter: l.filter as never } : {}),
            ...(l.minzoom != null ? { minzoom: l.minzoom } : {}),
          } as never,
          'vill-hl',
        )
      } else {
        if (prev.data !== data) (map.getSource(src) as GeoJSONSource).setData(data as never)
        if (prev.paint !== paint) for (const [k, v] of Object.entries(l.paint ?? {})) map.setPaintProperty(l.id, k as never, v as never)
        if (prev.layout !== layout) for (const [k, v] of Object.entries(l.layout ?? {})) map.setLayoutProperty(l.id, k as never, v as never)
        if (prev.filter !== filter) map.setFilter(l.id, (l.filter ?? null) as never)
        if (prev.visible !== visible) map.setLayoutProperty(l.id, 'visibility', visible ? 'visible' : 'none')
      }
      applied.current.set(l.id, { data, paint, layout, filter, visible })
    }
    for (const id of [...applied.current.keys()]) {
      if (seen.has(id)) continue
      if (map.getLayer(id)) map.removeLayer(id)
      if (map.getSource(`src-${id}`)) map.removeSource(`src-${id}`)
      applied.current.delete(id)
    }
  }, [ready, layers])

  /* ---------- district labels (HTML markers, no glyph server needed) ---------- */
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map || !districts) return
    const ms = districts.features.map((f) => {
      const p = f.properties as { name: string; lon: number; lat: number }
      const el = document.createElement('div')
      el.className = 'map-label'
      el.textContent = p.name
      return new Marker({ element: el, anchor: 'center' }).setLngLat([p.lon, p.lat]).addTo(map)
    })
    return () => ms.forEach((m) => m.remove())
  }, [ready, districts])

  const reset = () => mapRef.current?.fitBounds(TAIPEI, { padding: 24, pitch: 0, bearing: 0, duration: 800 })
  const toggle3d = () => {
    const map = mapRef.current
    if (!map) return
    map.easeTo(is3d ? { pitch: 0, bearing: 0, duration: 700 } : { pitch: 55, bearing: -18, duration: 900 })
  }

  return (
    <div className="map-wrap">
      <div ref={box} className="map-canvas" />
      {!ready && <div className="loading">MAP</div>}
      <div className="map-hud-r">
        <button className="map-btn" onClick={() => mapRef.current?.zoomIn()} title="放大" aria-label="放大">+</button>
        <button className="map-btn" onClick={() => mapRef.current?.zoomOut()} title="縮小" aria-label="縮小">−</button>
        <button className="map-btn" onClick={reset} title="回到全市" aria-label="回到全市"><IconTarget size={14} /></button>
        {showExtrudeToggle !== false && (
          <button className={`map-btn${is3d ? ' on' : ''}`} onClick={toggle3d} title="傾斜視角" aria-label="傾斜視角"><IconCube size={14} /></button>
        )}
      </div>
      {cursor && (
        <div className="map-coord num">
          {cursor.lon.toFixed(4)}°E {cursor.lat.toFixed(4)}°N · z{cursor.z.toFixed(1)}
        </div>
      )}
      {tip && (
        <div className="tip" style={{ left: Math.min(tip.x + 14, (box.current?.clientWidth ?? 800) - 250), top: tip.y + 14 }}>
          {tip.node}
        </div>
      )}
      {children}
    </div>
  )
}

/* ---------- legends ---------- */
export function ClassLegend({ title, classes, fmt, invert, note }: { title: string; classes: Classes; fmt: (v: number) => string; invert?: boolean; note?: string }) {
  if (!classes.breaks.length) return null
  const labels = [classes.min, classes.breaks[2], classes.breaks[classes.breaks.length - 1], classes.max]
  return (
    <div className="legend">
      <div className="legend-title">{title}</div>
      <div className="legend-ramp">
        {classes.colors.map((c, i) => (
          <span key={i} style={{ background: c }} />
        ))}
      </div>
      <div className="legend-scale num">
        <span>{fmt(labels[0])}</span>
        <span>{fmt(labels[3])}</span>
      </div>
      <div className="legend-note">
        {invert ? '亮色 = 數值低（需求高）' : '亮色 = 數值高'}
        <span className="legend-na"><i /> 無資料</span>
      </div>
      {note && <div className="legend-note">{note}</div>}
    </div>
  )
}

export function SymbolLegend({ items }: { items: { label: string; color: string; shape?: 'dot' | 'line' | 'ring' | 'dash' | 'square'; glyph?: ReactNode }[] }) {
  return (
    <div className="legend legend-sym">
      {items.map((it) => (
        <div key={it.label} className="legend-item">
          {it.glyph ?? <i className={`sym sym-${it.shape ?? 'dot'}`} style={{ ['--c' as string]: it.color }} />}
          <span>{it.label}</span>
        </div>
      ))}
    </div>
  )
}
