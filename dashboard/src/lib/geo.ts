import type { Geometry, Position } from 'geojson'
import type { VillageFC, VillageProps } from './types'

/** center of a geometry's bounding box (good enough to fly the map to a 里) */
export function bboxCenter(g: Geometry): [number, number] {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  const visit = (c: unknown) => {
    const a = c as unknown[]
    if (typeof a[0] === 'number') {
      const [x, y] = a as Position
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
    } else a.forEach(visit)
  }
  if (g.type === 'GeometryCollection') g.geometries.forEach((s) => visit([bboxCenter(s)]))
  else visit(g.coordinates)
  return [(x0 + x1) / 2, (y0 + y1) / 2]
}

const centers = new WeakMap<VillageFC, Map<number, [number, number]>>()

export function villageCenter(fc: VillageFC, i: number): [number, number] | null {
  let m = centers.get(fc)
  if (!m) {
    m = new Map()
    centers.set(fc, m)
  }
  const hit = m.get(i)
  if (hit) return hit
  const f = fc.features.find((x) => x.properties.i === i)
  if (!f) return null
  const c = bboxCenter(f.geometry)
  m.set(i, c)
  return c
}

export function villageProps(fc: VillageFC | undefined, i: number | null | undefined): VillageProps | null {
  if (!fc || i == null) return null
  return fc.features.find((x) => x.properties.i === i)?.properties ?? null
}
