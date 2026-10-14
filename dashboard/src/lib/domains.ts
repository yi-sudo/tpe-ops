import type { ScoreKey, VillageProps } from './types'

export type DomainId = 1 | 2 | 3 | 4 | 5 | 6

export interface MapMetric {
  key: keyof VillageProps
  label: string
  unit?: string
  /** true when a high raw value means less need (e.g. 遮蔭率); the ramp is flipped so bright = need */
  invert?: boolean
  pct?: boolean
}

export interface Domain {
  id: DomainId
  code: string
  short: string
  title: string
  question: string
  agencies: string[]
  color: string
  hex: string
  score: ScoreKey
  scoreLabel: string
  metrics: MapMetric[]
  /** catalog keys feeding this module (for the provenance line) */
  sources: string[]
}

export const DOMAINS: Domain[] = [
  {
    id: 1,
    code: '01',
    short: '樹蔭',
    title: '把三千棵樹種回來',
    question: '哪些人行道最缺樹蔭、又住著最多長者？可以補植的空間在哪裡？',
    agencies: ['工務局公園處', '工務局新工處', '社會局'],
    color: 'var(--d1)',
    hex: '#008300',
    score: 's1',
    scoreLabel: '樹蔭需求分數',
    metrics: [
      { key: 's1', label: '樹蔭需求分數' },
      { key: 'shd', label: '人行道遮蔭率', invert: true, pct: true },
      { key: 'r65', label: '65 歲以上人口比例', pct: true },
    ],
    sources: ['trees_street', 'trees_park', 'tree_holes', 'sidewalk', 'parks', 'population_age'],
  },
  {
    id: 2,
    code: '02',
    short: '清潔箱',
    title: '找回消失的垃圾桶',
    question: '人潮在哪裡卻沒有清潔箱？新增的清潔箱放哪裡效益最高？清運能不能依滿溢度調度？',
    agencies: ['環保局'],
    color: 'var(--d2)',
    hex: '#9085e9',
    score: 's2',
    scoreLabel: '清潔箱缺口分數',
    metrics: [
      { key: 's2', label: '清潔箱缺口分數' },
      { key: 'cov', label: '需求涵蓋率', invert: true, pct: true },
      { key: 'ucd', label: '未涵蓋需求密度', unit: '/km²' },
    ],
    sources: ['bins', 'bus_stop', 'metro_station', 'mrt_ridership', 'restaurants', 'vendor_markets'],
  },
  {
    id: 3,
    code: '03',
    short: '鼠患',
    title: '鼠患風險地圖',
    question: '餐飲、垃圾清運點和下水道人孔疊在一起的地方，是不是老鼠最多？防治人力要先放哪裡？',
    agencies: ['環保局', '衛生局', '工務局衛工處', '產業局'],
    color: 'var(--d3)',
    hex: '#d55181',
    score: 's3',
    scoreLabel: '鼠患風險分數',
    metrics: [
      { key: 's3', label: '鼠患風險分數' },
      { key: 'risk', label: '風險模型指數' },
      { key: 'rat_d', label: '見鼠通報密度', unit: '件/km²' },
    ],
    sources: ['ratradar', 'restaurants', 'garbage_truck', 'rain_manholes', 'vendor_markets', 'dengue_vector'],
  },
  {
    id: 4,
    code: '04',
    short: '車流',
    title: '內湖晨尖峰車流',
    question: '平日 07:00–09:30 內科塞在哪裡？彈性工時分散尖峰，延滯能減少多少？',
    agencies: ['交通局', '產業局', '交通大隊'],
    color: 'var(--d4)',
    hex: '#c98500',
    score: 's4',
    scoreLabel: '壅塞分數',
    metrics: [
      { key: 's4', label: '壅塞分數' },
      { key: 'cong', label: '壅塞路段比例', pct: true },
    ],
    sources: ['vd_live', 'road_live', 'vd_static', 'road_section', 'road_section_shape', 'vd_hist'],
  },
  {
    id: 5,
    code: '05',
    short: '公車',
    title: '公車動態路網',
    question: '哪些里公車班次少又離捷運遠？和捷運重疊的路線減班，省下的車公里能補多少冷區？',
    agencies: ['公共運輸處', '交通局'],
    color: 'var(--d5)',
    hex: '#3987e5',
    score: 's5',
    scoreLabel: '公車冷區分數',
    metrics: [
      { key: 's5', label: '公車冷區分數' },
      { key: 'ppc', label: '每千人每日公車班次', invert: true },
      { key: 'mrt_km', label: '到最近捷運站距離', unit: 'km' },
    ],
    sources: ['bus_route', 'bus_stop', 'bus_timetable', 'bus_shape', 'bus_live', 'bus_eta', 'metro_station', 'metro_shape', 'road_live', 'population_age'],
  },
  {
    id: 6,
    code: '06',
    short: '耐震',
    title: '危老耐震風險評級',
    question: '液化潛勢高、長者多、救災不易的里在哪裡？健檢和都更要先從哪裡開始？',
    agencies: ['都發局', '建管處', '消防局', '社會局'],
    color: 'var(--d6)',
    hex: '#d95926',
    score: 's6',
    scoreLabel: '耐震風險分數',
    metrics: [
      { key: 's6', label: '耐震風險分數' },
      { key: 'exp65', label: '液化區長者人數', unit: '人' },
      { key: 'r65', label: '65 歲以上人口比例', pct: true },
    ],
    sources: ['liquefaction', 'fire_access', 'hydrants', 'buildings_stats', 'elderly_alone', 'population_age'],
  },
]

export const domain = (id: number): Domain => DOMAINS[id - 1]
