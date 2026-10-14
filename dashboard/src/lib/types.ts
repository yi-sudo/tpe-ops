// Shapes of the files in public/data (written by pipeline/build.py and pipeline/live.py).
import type { Feature, FeatureCollection, Geometry, Point } from 'geojson'

export type ScoreKey = 's1' | 's2' | 's3' | 's4' | 's5' | 's6'

export interface VillageProps {
  i: number
  id: string
  v: string
  d: string
  km2: number
  pop: number
  p65: number
  r65: number
  dens: number
  // 01 樹蔭
  st: number
  pt: number
  sw: number
  shd: number | null
  gap: number
  slots: number
  park: number
  s1: number | null
  // 02 清潔箱
  bins: number
  dem: number
  cov: number | null
  ucd: number
  s2: number | null
  // 03 鼠患
  rats: number
  rat_d: number
  food: number
  trk: number
  mh: number
  mkt: number
  bi: number | null
  risk: number
  s3: number | null
  // 04 車流
  sec: number
  cong: number | null
  s4: number | null
  // 05 公車
  stops: number
  pass: number
  ppc: number | null
  mrt_km: number
  s5: number | null
  // 06 耐震
  liq3: number
  liq2: number
  fire: number
  hyd: number
  hyd_d: number
  exp65: number
  s6: number | null
  // fusion
  f: number | null
  hot: number
}

export type VillageFC = FeatureCollection<Geometry, VillageProps> & {
  meta: { population_period: string; hot_threshold: number; domains: Record<string, string> }
}

export interface Table {
  cols: string[]
  rows: (string | number | null)[][]
  [extra: string]: unknown
}

export type PointFC = FeatureCollection<Point, Record<string, string | number | null>>
export type AnyFeature = Feature<Geometry, Record<string, unknown>>

// impact.json
export interface CurvePoint { [k: string]: number }
export interface ImpactDomain {
  assumptions: string[]
  mock?: string[]
  baseline?: Record<string, unknown>
  curve?: CurvePoint[]
  lift?: { area: number; model: number; oracle: number }[]
  params?: Record<string, number>
  weights?: Record<string, number>
  [k: string]: unknown
}
/** records seen and dropped per rule on one cached day (pipeline/history.py read_day) */
export interface DayDrops {
  records: number
  status: number
  dup: number
  lane_minutes: number
  diag: number
  outlier: number
  expected: number
  missing: number
}
/** data-quality report of the real 內湖 profile; `rules` is the same text history.py applies */
export interface ProfileQuality {
  rules: string[]
  vd_total: number
  vd_panel: number
  vd_valid_per_day: Record<string, number>
  /** VD -> date -> reason ("no records" / "valid lanes 2/6"), days used in the profile only */
  vd_rejected: Record<string, Record<string, string>>
  vd_partial_lanes: string[]
  dropped_per_day: Record<string, DayDrops>
  excluded_days: Record<string, string>
  skipped_holidays: string[]
}
export interface PeakProfile {
  bins: string[]
  mult: number[]
  peak_vc: number
  is_mock: boolean
  shift_from: string[]
  shift_to: string[]
  source?: string
  days?: { date: string; vc: (number | null)[]; flow?: (number | null)[]; speed?: (number | null)[] }[]
  /** real profile only (TDX history): mean V/C, summed flow (veh/h) and mean speed of the VD panel */
  vc?: number[]
  flow?: number[]
  speed?: (number | null)[]
  vd_vc?: Record<string, (number | null)[]>
  period?: string
  quality?: ProfileQuality
}
export interface BprCalib {
  alpha: number
  v_free: number
  beta: number
  n: number
  rmse: number
  alpha0: number
  v_free0: number
}
export interface Impact {
  '1': ImpactDomain & { baseline: { street_trees: number; park_trees: number; tree_holes: number; sidewalk_km: number; shaded_km: number; plantable_slots: number }; curve: { n: number; shaded_km: number; added_km: number; city_shade: number; low_villages: number; low_elderly: number }[] }
  '2': ImpactDomain & { baseline: { bins: number; demand_points: number; covered: number; bus_stops: number; bus_stops_covered: number; busy_stops: number; busy_stops_uncovered: number; fixed_pickups: number; dynamic_pickups: number; overflow_bins_fixed: number }; curve: { k: number; covered: number }[] }
  '3': ImpactDomain & { baseline: { sightings: number; bait_reports: number; restaurants: number; truck_stops: number; manholes: number; markets: number; spearman_risk_reports: number; spearman_food_reports: number; top20_captured: number; efficacy: number; first_report: string; last_report: string }; lift: { area: number; model: number; oracle: number }[]; weights: Record<string, number> }
  '4': ImpactDomain & { params: { alpha: number; beta: number; v_free: number; km_per_vd: number; fuel_l_per_vh: number; co2_per_l: number; calib?: BprCalib }; neihu: { vd: number; cap_vph: number; sections: number; bus_routes: number }; profile: PeakProfile; snapshots: number }
  '5': ImpactDomain & { baseline: { routes: number; vkm_day: number; redundant_routes: number; redundant_vkm: number; stop_locations: number; mrt_stations: number; routes_through_congestion: number }; params: { cost_per_vkm: number; drts_speed: number; drts_hours_per_village: number; drive_block_h: number; rest_min: number; max_drive_h: number }; cold_villages: number[] }
  '6': ImpactDomain & { baseline: { liq_polygons: number; fire_sites: number; hydrants: number; old_building_share: number; buildings: number; building_year: string; exposed_elderly: number; elderly_alone_quarter: string; elderly_alone: Record<string, number> }; curve: { k: number; share: number; captured: number }[] }
  fusion: { top: { i: number; v: string; d: string; f: number; hot: number; s: (number | null)[] }[]; multi_hot: number; multi_hot_pop: number }
}

// links.json
export interface LinkEdge {
  a: number
  b: number
  rho: number
  jaccard: number
  co_hot: number
  mechanism: string
  agencies: string[]
  evidence: { label: string; value: number; unit?: string }[]
}
export interface Links {
  domains: Record<string, string>
  hot_threshold: number
  spearman: number[][]
  jaccard: number[][]
  hot_counts: Record<string, number>
  edges: LinkEdge[]
}

// timeseries.json
export interface Timeseries {
  months: string[]
  petitions_total: number[]
  petitions: Record<string, { monthly: number[]; total: number; median_days: number; categories: Record<string, number> }>
  bus_daily_riders: [number, number][]
  bus_vkm: [number, number][]
  old_building_share: [number, number][]
  mrt_entries: [number, number][]
  elderly_alone: [string, number][]
  rat_weekly: [string, number][]
}

// catalog.json
export interface CatalogSource {
  key: string
  group: string
  title: string
  agency: string
  problems: number[]
  source: string
  fetched_at: string | null
  record_count: number | null
  bytes: number | null
  url: string
  live: boolean
  interval: number | null
  is_mock: boolean
  /** monthly files carry a 民國 year-month number (11410); other sources a free-text period */
  period: string | number | null
}
/** a file under public/data; inputs are source groups (CatalogSource.group) or other output files */
export interface CatalogOutput {
  file: string
  inputs: string[]
  bytes: number | null
}
export interface CatalogMock {
  key: string
  title: string
  problems: number[]
  reason: string
  used_in: string[]
}
export interface Catalog {
  built_at: string
  sources: CatalogSource[]
  outputs: CatalogOutput[]
  mock: CatalogMock[]
}

export interface BusRoute {
  id: number
  name: string
  provider: string
  from_: string
  to: string
  km: number
  trips_dir: number
  trip_src: string
  vkm: number
  overlap: number
  first: string
  last: string
  cong: boolean
  departures: string[]
}

// live/*.json
export interface FeedTime { fetched_at: string; src_time?: string }
export interface LosCounts { A: number; B: number; C: number; D: number; E: number; F: number }
export interface LiveTraffic {
  fetched_at: string
  feeds: Record<string, FeedTime>
  cap_per_lane: Record<string, number>
  city: { n: number; mean_speed: number; congested_share: number; los: LosCounts }
  neihu: { n: number; mean_speed: number; congested_share: number; los: LosCounts; vd: number; flow_vph: number; vd_speed: number; occ_mean: number; vc_mean: number }
  sections: Record<string, [number, number]>
  vd: Record<string, [number, number, number, number]>
  is_mock: boolean
}
export interface LiveBus {
  fetched_at: string
  feeds: Record<string, FeedTime>
  on_duty: number
  moving_speed: number
  eta: { stops: number; with_eta: number; within_3min: number; mean_wait_min: number; p90_wait_min: number; not_departed: number; no_service: number }
  positions: [number, number, string, number, number][]
  is_mock: boolean
}
export interface LiveRain {
  fetched_at: string
  stations: { no: string; name: string; rain: number; time: string; stale: boolean }[]
  n: number
  fresh: number
  max_rain: number
  raining: number
  is_mock: boolean
}
export interface LiveSeries {
  cols: string[]
  rows: number[][]
  is_mock: boolean
}
export interface LiveStatus {
  updated_at: string
  feeds: Record<string, { title: string; interval: number; last_ok: string | null; last_error: string | null; error: string | null }>
}
