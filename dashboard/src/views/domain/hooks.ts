import { createElement, lazy, useCallback, useMemo, useState, type ComponentType } from 'react'
import type { MapMetric } from '../../lib/domains'
import { fmtNum, fmtPct } from '../../lib/format'
import type { VillageFC, VillageProps } from '../../lib/types'
import type { BinsProps, BusProps, RatsProps, SeismicProps, ShadeProps, TrafficProps } from '../../schematics'

export const DIGITS: Partial<Record<keyof VillageProps, number>> = { exp65: 0, ucd: 0, rat_d: 1, mrt_km: 2, ppc: 1, risk: 2 }

export function fmtMetric(m: MapMetric, v: unknown): string {
  if (v == null || typeof v !== 'number' || !Number.isFinite(v)) return '無資料'
  if (m.pct) return fmtPct(v)
  const s = fmtNum(v, DIGITS[m.key] ?? 1)
  return m.unit ? `${s} ${m.unit}` : s
}

export interface Delta {
  dir: 'up' | 'down' | 'flat'
  text: string
  /** is this direction an improvement? (glyph colored good / critical, text stays ink) */
  good?: boolean
}

/** after − before as a Delta (`fmt` formats the absolute difference) */
export function delta(after: number, before: number, fmt: (v: number) => string, lowerIsBetter: boolean): Delta {
  const x = after - before
  const dir = Math.abs(x) < 1e-9 ? 'flat' : x > 0 ? 'up' : 'down'
  return { dir, text: fmt(Math.abs(x)), good: dir === 'flat' ? undefined : (x < 0) === lowerIsBetter }
}

/** 1999 陳情 source group; Prov expands it to every cached monthly file (build.py reads them all) */
export const PETITION_KEYS = ['petitions']

/** on/off state for a module's map layers */
export function useToggles<K extends string>(init: Record<K, boolean>) {
  const [on, setOn] = useState(init)
  const set = useCallback((k: K, v: boolean) => setOn((o) => ({ ...o, [k]: v })), [])
  return [on, set] as const
}

/**
 * 里 ids ranked by `rank` (desc) until the cumulative area reaches `share` of the city —
 * the set a scenario lever acts on (集中防治面積、優先健檢…), outlined on the map.
 */
export function useAreaPick(V: VillageFC | undefined, rank: (p: VillageFC['features'][number]['properties']) => number | null, share: number) {
  const sorted = useMemo(() => {
    if (!V) return null
    const rows = V.features.map((f) => ({ i: f.properties.i, r: rank(f.properties), a: f.properties.km2 })).filter((x) => x.r != null && Number.isFinite(x.r))
    rows.sort((a, b) => (b.r as number) - (a.r as number))
    const total = V.features.reduce((s, f) => s + f.properties.km2, 0)
    return { rows, total }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [V])
  return useMemo(() => {
    if (!sorted) return null
    const out: number[] = []
    let acc = 0
    for (const x of sorted.rows) {
      if (acc >= share * sorted.total) break
      out.push(x.i)
      acc += x.a
    }
    return out
  }, [sorted, share])
}

/* ---------- schematics (src/schematics, split into their own chunk and loaded with the first module) ---------- */
const mods = import.meta.glob<Record<string, unknown>>('../../schematics/index.ts')
const Pending = () => createElement('div', { className: 'schem-pending' }, '示意圖製作中')

function schematic<P>(name: string) {
  return lazy(async () => {
    const load = mods['../../schematics/index.ts']
    const m = load ? await load() : undefined
    const C = m?.[name] as ComponentType<P> | undefined
    return { default: C ?? (Pending as unknown as ComponentType<P>) }
  })
}

export const Schem = {
  Shade: schematic<ShadeProps>('ShadeSchematic'),
  Bins: schematic<BinsProps>('BinsSchematic'),
  Rats: schematic<RatsProps>('RatsSchematic'),
  Traffic: schematic<TrafficProps>('TrafficSchematic'),
  Bus: schematic<BusProps>('BusSchematic'),
  Seismic: schematic<SeismicProps>('SeismicSchematic'),
}
