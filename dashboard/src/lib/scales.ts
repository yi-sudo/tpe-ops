import { quantileSorted } from 'd3-array'
import { interpolateLab } from 'd3-interpolate'

/** sequential blue for the dark surface: index 0 = low (dark) … 6 = high (light) */
export const SEQ = ['#0d366b', '#184f95', '#256abf', '#3987e5', '#6da7ec', '#9ec5f4', '#cde2fb']
export const NA_FILL = '#1f242b'

export const DIV = { neg: '#e66767', mid: '#383835', pos: '#6da7ec' }

/** -1..1 -> diverging color with gray midpoint */
export function divColor(v: number): string {
  const t = Math.max(-1, Math.min(1, v))
  return t >= 0 ? interpolateLab(DIV.mid, DIV.pos)(t) : interpolateLab(DIV.mid, DIV.neg)(-t)
}

/** 0..1 on the sequential ramp */
export function seqColor(t: number): string {
  const x = Math.max(0, Math.min(1, t)) * (SEQ.length - 1)
  const i = Math.min(SEQ.length - 2, Math.floor(x))
  return interpolateLab(SEQ[i], SEQ[i + 1])(x - i)
}

export interface Classes {
  breaks: number[] // length SEQ.length - 1, ascending
  colors: string[] // length SEQ.length; colors[0] is used below breaks[0]
  min: number
  max: number
}

/** quantile classes over the finite values; colors flipped when `invert` so bright = need */
export function quantileClasses(values: (number | null | undefined)[], invert = false, k = SEQ.length): Classes {
  const v = values.filter((x): x is number => x != null && Number.isFinite(x)).sort((a, b) => a - b)
  const colors = invert ? [...SEQ].reverse() : [...SEQ]
  if (!v.length) return { breaks: [], colors, min: 0, max: 0 }
  const breaks: number[] = []
  for (let i = 1; i < k; i++) {
    const q = quantileSorted(v, i / k) as number
    breaks.push(breaks.length && q <= breaks[breaks.length - 1] ? breaks[breaks.length - 1] + 1e-9 : q)
  }
  return { breaks, colors, min: v[0], max: v[v.length - 1] }
}

/** MapLibre expression for a classed fill on a numeric property; missing values get NA_FILL */
export function classExpr(key: string, c: Classes): unknown {
  if (!c.breaks.length) return NA_FILL
  const step: unknown[] = ['step', ['to-number', ['get', key]], c.colors[0]]
  c.breaks.forEach((b, i) => step.push(b, c.colors[i + 1]))
  return ['case', ['==', ['typeof', ['get', key]], 'number'], step, NA_FILL]
}

/* ---- TDX congestion level (1–6 = A–F) -> status ---- */
export interface LosClass {
  key: 'A' | 'B' | 'C' | 'D' | 'E' | 'F'
  label: string
  status: 'good' | 'warning' | 'serious' | 'critical'
  color: string
}
export const STATUS_COLOR = { good: '#0ca30c', warning: '#fab219', serious: '#ec835a', critical: '#d03b3b' }
export const LOS: LosClass[] = [
  { key: 'A', label: '順暢', status: 'good', color: STATUS_COLOR.good },
  { key: 'B', label: '順暢', status: 'good', color: STATUS_COLOR.good },
  { key: 'C', label: '車多', status: 'warning', color: STATUS_COLOR.warning },
  { key: 'D', label: '車多', status: 'warning', color: STATUS_COLOR.warning },
  { key: 'E', label: '壅塞', status: 'serious', color: STATUS_COLOR.serious },
  { key: 'F', label: '嚴重壅塞', status: 'critical', color: STATUS_COLOR.critical },
]

/** mix a hex color toward the surface (for dimmed variants of domain colors) */
export function mix(a: string, b: string, t: number): string {
  return interpolateLab(a, b)(t)
}
