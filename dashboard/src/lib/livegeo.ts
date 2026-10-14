// Live feeds joined onto local static geometry. Both sides are files under public/data; the collector
// (pipeline.collect_live) rewrites live/*.json and LiveProvider reloads them.
import type { FeatureCollection } from 'geojson'
import { STATUS_COLOR } from './scales'
import type { LiveBus, LiveTraffic, PointFC } from './types'

/** road sections + live TDX congestion level (1–6 = A–F, −1 = no data) and speed (km/h, −1 = no data) */
export function joinRoads(fc: FeatureCollection | undefined, t: LiveTraffic | undefined): FeatureCollection | undefined {
  if (!fc) return undefined
  return {
    type: 'FeatureCollection',
    features: fc.features.map((f) => {
      const s = t?.sections[String(f.properties?.id)]
      return { ...f, properties: { ...f.properties, los: s ? s[0] : -1, spd: s ? s[1] : -1 } }
    }),
  }
}

/** VD points + live flow (輛/時), speed (km/h), occupancy (%), V/C */
export function joinVd(fc: PointFC | undefined, t: LiveTraffic | undefined): PointFC | undefined {
  if (!fc) return undefined
  return {
    type: 'FeatureCollection',
    features: fc.features.map((f) => {
      const v = t?.vd[String(f.properties.id)]
      const ok = (x: number | undefined) => (x != null && x >= 0 ? x : null)
      return { ...f, properties: { ...f.properties, flow: ok(v?.[0]), spd: ok(v?.[1]), occ: ok(v?.[2]), vc: ok(v?.[3]) } }
    }),
  }
}

/** live bus positions [lon, lat, routeID, speed, azimuth] -> points */
export function busFC(b: LiveBus | undefined): PointFC | undefined {
  if (!b) return undefined
  return {
    type: 'FeatureCollection',
    features: b.positions.map(([lon, lat, route, spd, az], id) => ({
      type: 'Feature',
      id,
      properties: { route, spd, az },
      geometry: { type: 'Point', coordinates: [lon, lat] },
    })),
  }
}

/** MapLibre color for a section's congestion level (status colors; legend always pairs glyph + label) */
export const LOS_COLOR_EXPR = [
  'match', ['get', 'los'],
  [1, 2], STATUS_COLOR.good,
  [3, 4], STATUS_COLOR.warning,
  5, STATUS_COLOR.serious,
  6, STATUS_COLOR.critical,
  '#4a525e',
]
