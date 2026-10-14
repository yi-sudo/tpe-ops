// Every file comes from public/data (built locally by the pipeline). The dashboard never calls an external API.
import { createContext, createElement, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Catalog, LiveBus, LiveRain, LiveSeries, LiveStatus, LiveTraffic, PointFC, Table } from './types'

export type SeriesView = NonNullable<ReturnType<typeof useSeries>>

const BASE = `${import.meta.env.BASE_URL}data/`
const cache = new Map<string, Promise<unknown>>()

export function load<T>(path: string): Promise<T> {
  let p = cache.get(path)
  if (!p) {
    p = fetch(BASE + path).then(async (r) => {
      if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`)
      return r.json()
    })
    p.catch(() => cache.delete(path))
    cache.set(path, p)
  }
  return p as Promise<T>
}

export function useData<T>(path: string | null): T | undefined {
  const [state, setState] = useState<{ path: string; value: T } | undefined>()
  useEffect(() => {
    if (!path) return
    let alive = true
    load<T>(path)
      .then((value) => alive && setState({ path, value }))
      .catch((e) => console.error('[data]', e))
    return () => {
      alive = false
    }
  }, [path])
  return state && state.path === path ? state.value : undefined
}

const fcCache = new WeakMap<Table, PointFC>()

/** {cols, rows} point table -> GeoJSON FeatureCollection (lon/lat columns become the geometry) */
export function tableToFC(t: Table): PointFC {
  let fc = fcCache.get(t)
  if (fc) return fc
  const li = t.cols.indexOf('lon')
  const ai = t.cols.indexOf('lat')
  fc = {
    type: 'FeatureCollection',
    features: t.rows.map((r, id) => {
      const props: Record<string, string | number | null> = {}
      t.cols.forEach((c, k) => {
        if (k !== li && k !== ai) props[c] = r[k]
      })
      return { type: 'Feature', id, properties: props, geometry: { type: 'Point', coordinates: [r[li] as number, r[ai] as number] } }
    }),
  }
  fcCache.set(t, fc)
  return fc
}

export function useLayer(name: string | null): PointFC | undefined {
  const t = useData<Table>(name ? `layers/${name}.json` : null)
  return useMemo(() => (t ? tableToFC(t) : undefined), [t])
}

/* ---------------- live feeds ---------------- */

export interface LiveState {
  traffic?: LiveTraffic
  bus?: LiveBus
  rain?: LiveRain
  series?: LiveSeries
  status?: LiveStatus
  polledAt?: number
  error?: string
}

const LiveCtx = createContext<LiveState>({})
const POLL_MS = 15_000

async function fetchLive<T>(name: string): Promise<T> {
  const r = await fetch(`${BASE}live/${name}.json?t=${Date.now()}`, { cache: 'no-store' })
  if (!r.ok) throw new Error(`live/${name}: HTTP ${r.status}`)
  return r.json() as Promise<T>
}

/** Polls live/status.json; when the collector has written new files, reloads the rest. */
export function LiveProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<LiveState>({})
  useEffect(() => {
    let alive = true
    let last = ''
    let timer: number | undefined
    const tick = async () => {
      try {
        const status = await fetchLive<LiveStatus>('status')
        if (status.updated_at !== last) {
          const [traffic, bus, rain, series] = await Promise.all([
            fetchLive<LiveTraffic>('traffic').catch(() => undefined),
            fetchLive<LiveBus>('bus').catch(() => undefined),
            fetchLive<LiveRain>('rain').catch(() => undefined),
            fetchLive<LiveSeries>('series').catch(() => undefined),
          ])
          last = status.updated_at
          if (alive)
            setState((s) => ({
              traffic: traffic ?? s.traffic,
              bus: bus ?? s.bus,
              rain: rain ?? s.rain,
              series: series ?? s.series,
              status,
              polledAt: Date.now(),
            }))
        } else if (alive) {
          setState((s) => ({ ...s, status, polledAt: Date.now(), error: undefined }))
        }
      } catch (e) {
        if (alive) setState((s) => ({ ...s, error: String(e), polledAt: Date.now() }))
      }
      if (alive) timer = window.setTimeout(tick, POLL_MS)
    }
    tick()
    return () => {
      alive = false
      window.clearTimeout(timer)
    }
  }, [])
  return createElement(LiveCtx.Provider, { value: state }, children)
}

export const useLive = () => useContext(LiveCtx)

/** column access into live/series.json (1 row per minute) + the row index ~1 hour before the latest */
export function useSeries(series: LiveSeries | undefined) {
  return useMemo(() => {
    if (!series || !series.rows.length) return null
    const idx: Record<string, number> = {}
    series.cols.forEach((c, i) => (idx[c] = i))
    const t = series.rows.map((r) => r[idx.t])
    const get = (c: string) => series.rows.map((r) => (r[idx[c]] ?? null) as number | null)
    const tLast = t[t.length - 1]
    // only when the buffer covers ≥ 50 minutes
    let ago: number | null = null
    if (tLast - t[0] >= 3000) {
      ago = 0
      for (let k = 0; k < t.length; k++) if (t[k] <= tLast - 3600) ago = k
    }
    return { t, get, ago, n: t.length }
  }, [series])
}

/* ---------------- catalog (provenance) ---------------- */

export function useCatalog(): Catalog | undefined {
  return useData<Catalog>('catalog.json')
}

/** ticking clock */
export function useNow(ms = 1000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), ms)
    return () => window.clearInterval(t)
  }, [ms])
  return now
}
