// Impact models evaluated in the browser from impact.json. Every assumption shown in the UI comes from
// impact.json["N"].assumptions; the extra ones used only here are listed in EXTRA_ASSUMPTIONS.
import type { Impact } from './types'

export const WORKDAYS = 250

export const EXTRA_ASSUMPTIONS: Record<number, string[]> = {
  4: [`年化以每年 ${WORKDAYS} 個工作日計算`, '移出的車流依目標時段的剩餘容量（V/C 與 1 的差距）分配；同時減量時先減量再移出'],
  5: ['DRTS 使用減班省下的同一份車公里預算（成本中性重新配置）'],
}

/** linear interpolation of `yKey` at x over a curve sorted by `xKey` */
export function interp<T extends Record<string, number>>(curve: T[], xKey: keyof T, x: number, yKey: keyof T): number {
  if (!curve.length) return NaN
  if (x <= curve[0][xKey]) return curve[0][yKey]
  for (let i = 1; i < curve.length; i++) {
    const a = curve[i - 1]
    const b = curve[i]
    if (x <= b[xKey]) {
      const t = (x - a[xKey]) / (b[xKey] - a[xKey] || 1)
      return a[yKey] + t * (b[yKey] - a[yKey])
    }
  }
  return curve[curve.length - 1][yKey]
}

/* 01 樹蔭：補植 n 棵 */
export function impact1(I: Impact, trees: number) {
  const c = I['1'].curve
  const at = (n: number) => ({
    shade: interp(c, 'n', n, 'city_shade'),
    low: interp(c, 'n', n, 'low_villages'),
    elderly: interp(c, 'n', n, 'low_elderly'),
    km: interp(c, 'n', n, 'shaded_km'),
  })
  const before = at(0)
  const after = at(trees)
  return { before, after, addedKm: after.km - before.km, maxTrees: c[c.length - 1].n }
}

/* 02 清潔箱：新增 k 個 */
export function impact2(I: Impact, k: number) {
  const c = I['2'].curve
  const b = I['2'].baseline
  return {
    covBefore: b.covered,
    covAfter: interp(c, 'k', k, 'covered'),
    maxK: c[c.length - 1].k,
    pickupsFixed: b.fixed_pickups,
    pickupsDynamic: b.dynamic_pickups,
    overflowFixed: b.overflow_bins_fixed,
  }
}

/* 03 鼠患：集中防治 area 比例的面積 */
export function impact3(I: Impact, area: number) {
  const D = I['3']
  const lift = D.lift
  const model = interp(lift, 'area', area, 'model')
  const oracle = interp(lift, 'area', area, 'oracle')
  const eff = D.baseline.efficacy
  return {
    captured: model,
    oracle,
    random: area,
    reduction: model * eff,
    randomReduction: area * eff,
    avoided: D.baseline.sightings * model * eff,
    efficacy: eff,
  }
}

/* 04 車流：彈性工時（尖峰車流移到前後時段）+ 減量（每個時段等比例少開車），路網層級 BPR 延滯 */
export interface Peak {
  bins: string[]
  vcBefore: number[]
  vcAfter: number[]
  /** model speed (km/h) from the calibrated BPR */
  speedBefore: number[]
  speedAfter: number[]
  /** measured mean speed of the VD panel (TDX history); null on the mock profile */
  speedObs: (number | null)[] | null
  flowBefore: number[] // veh/h summed over the VD panel
  flowAfter: number[]
  delayBefore: number // vehicle-hours per weekday morning (07:00–09:30)
  delayAfter: number
  /** (before − after) / before; negative = the scenario adds delay */
  reduction: number
  peakBefore: number
  peakAfter: number
  /** vehicle-hours saved per year (negative = more delay) */
  vhYear: number
  fuelYear: number // liters saved
  co2Year: number // tonnes saved
  real: boolean
  calibrated: boolean
  vdCount: number
}

export function impact4(I: Impact, shift: number, cut = 0): Peak {
  const D = I['4']
  const P = D.params
  const prof = D.profile
  const from = prof.shift_from.map((b) => prof.bins.indexOf(b)).filter((i) => i >= 0)
  const to = prof.shift_to.map((b) => prof.bins.indexOf(b)).filter((i) => i >= 0)
  const real = !prof.is_mock && !!prof.vc?.length && !!prof.flow?.length
  // real: the VD panel as one network (mean V/C, total flow) — the level the BPR was calibrated at
  const x = real ? prof.vc! : prof.mult.map((m) => m * prof.peak_vc)
  const q = real ? prof.flow! : x.map((v) => v * D.neihu.cap_vph)

  const x2 = x.map((v) => v * (1 - cut))
  let moved = 0
  for (const b of from) {
    moved += x2[b] * shift
    x2[b] *= 1 - shift
  }
  const spare = to.map((b) => Math.max(0, 1 - x2[b]))
  const ssum = spare.reduce((a, b) => a + b, 0)
  to.forEach((b, k) => {
    x2[b] += moved * (ssum > 0 ? spare[k] / ssum : 1 / to.length)
  })
  const q2 = q.map((f, b) => (x[b] > 0 ? (f * x2[b]) / x[b] : 0))

  const speed = (v: number) => P.v_free / (1 + P.alpha * Math.pow(Math.max(0, v), P.beta))
  // veh/h × 0.25 h × km × (1/v − 1/v_free) h/km
  const delay = (qq: number[], xx: number[]) => qq.reduce((s, f, b) => s + f * 0.25 * P.km_per_vd * (1 / speed(xx[b]) - 1 / P.v_free), 0)
  const delayB = delay(q, x)
  const delayA = delay(q2, x2)
  const vhYear = (delayB - delayA) * WORKDAYS
  const fuelYear = vhYear * P.fuel_l_per_vh
  return {
    bins: prof.bins,
    vcBefore: x,
    vcAfter: x2,
    speedBefore: x.map(speed),
    speedAfter: x2.map(speed),
    speedObs: real && prof.speed?.length ? prof.speed : null,
    flowBefore: q,
    flowAfter: q2,
    delayBefore: delayB,
    delayAfter: delayA,
    reduction: delayB > 0 ? (delayB - delayA) / delayB : 0,
    peakBefore: Math.max(...x),
    peakAfter: Math.max(...x2),
    vhYear,
    fuelYear,
    co2Year: (fuelYear * P.co2_per_l) / 1000,
    real,
    calibrated: !!P.calib,
    vdCount: real && prof.vd_vc ? Object.keys(prof.vd_vc).length : D.neihu.vd,
  }
}

/** delay change over the flex-work share 0–max (step 0.01) at a fixed cut, and the best share */
export function shiftCurve(I: Impact, cut: number, max = 0.3) {
  const pts = Array.from({ length: Math.round(max * 100) + 1 }, (_, i) => {
    const shift = i / 100
    return { shift, reduction: impact4(I, shift, cut).reduction }
  })
  const best = pts.reduce((a, b) => (b.reduction > a.reduction ? b : a), pts[0])
  return { pts, best }
}

/* 05 公車：高重疊路線減班 → DRTS */
export function impact5(I: Impact, cut: number) {
  const D = I['5']
  const vkmSaved = D.baseline.redundant_vkm * cut
  const hours = vkmSaved / D.params.drts_speed
  const cold = D.cold_villages.length
  const served = Math.min(cold, Math.floor(hours / D.params.drts_hours_per_village))
  return {
    vkmSaved,
    costDay: vkmSaved * D.params.cost_per_vkm,
    costYear: vkmSaved * D.params.cost_per_vkm * 365,
    hours,
    served,
    cold,
    share: vkmSaved / D.baseline.vkm_day,
  }
}

/* 06 耐震：優先健檢 k 個里 */
export function impact6(I: Impact, k: number) {
  const c = I['6'].curve
  return {
    share: interp(c, 'k', k, 'share'),
    captured: interp(c, 'k', k, 'captured'),
    elderly: I['6'].baseline.exposed_elderly * interp(c, 'k', k, 'captured'),
    maxK: c[c.length - 1].k,
  }
}
