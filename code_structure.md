# 程式結構

## 資料流

```
外部來源（data.taipei、TDX、tcgbusfs、tppkl、parks、ratdar、tsis、soil、wic）
   │  pipeline/fetch.py         靜態資料，超過 7 天才重抓
   │  pipeline/history.py       TDX 歷史 VD（內湖晨峰），已存的日期不重抓
   │  pipeline/collect_live.py  即時資料，依各來源的 interval 輪詢（常駐）
   ▼
data/raw/{來源}/            原始快照 + latest + meta.json（只有這一步會打外部 API）
   │  pipeline/build.py         全部重建，約 6 秒
   │  pipeline/live.py          collect_live 每輪只重建 live/*.json
   ▼
dashboard/public/data/     處理後的 GeoJSON／JSON（前端只讀這裡）
   │  fetch()；live/status.json 每 15 秒輪詢一次
   ▼
dashboard/src/             React 儀表板
```

## 目錄

```
taipei_gogo/
├── CLAUDE.md               專案說明與規則
├── README.md               執行方式、畫面、真實／模擬資料對照
├── code_structure.md       本檔：程式結構
├── task.json               排程與進度
├── api.md                  API 端點、rid、TDX 認證與限制、TDX 歷史資料
├── tdx_check.py            TDX 金鑰驗證
├── requirements.txt        Python 套件版本
├── .env.example            .env 範本（TDX_CLIENT_ID、TDX_CLIENT_SECRET）
├── LICENSE                 MIT
├── .env                    TDX 金鑰（不可提交）
├── .gitignore
├── .venv/                  Python 虛擬環境（requests、numpy、pandas、shapely、pyproj、pyshp）
├── pipeline/               Python 資料管線
│   ├── common.py           HTTP 節流、429 重試、TDX token 快取、save_raw、prune_snapshots
│   ├── sources.py          資料源登錄表 SOURCES（靜態 + TDX 歷史 + 即時）
│   ├── fetch.py            抓取 CLI：靜態超過 7 天才重抓；--live 抓一次即時；vd_hist 轉給 history.py
│   ├── history.py          TDX 歷史 VD → 內湖平日晨峰 15 分鐘曲線（資料品質規則 RULES 也顯示在 UI）
│   ├── geo.py              TWD97 ↔ WGS84、里界、點落里、精簡 JSON 輸出
│   ├── build.py            raw → dashboard/public/data/（六題指標、成效模型、關聯、資料目錄）
│   ├── live.py             即時快照 → live/*.json（build.py 和 collect_live.py 共用）
│   └── collect_live.py     常駐收集即時資料，更新 live/*.json 和 live/status.json
├── data/                   （不提交）
│   ├── raw/{來源}/          {名稱}_{YYYYMMDD-HHMM}.{副檔名}、{名稱}_latest.{副檔名}、{名稱}.meta.json
│   │                       來源資料夾：data_taipei、tdx、tcgbusfs、tppkl、parks、ratdar、tsis、soil、wic
│   │                       TDX 歷史：tdx/vd_hist_{YYYYMMDD}.ndjson.gz + .meta.json，總表 tdx/vd_hist.meta.json
│   └── .cache/             TDX token 快取
└── dashboard/              Vite 8 + React 19 + TypeScript 6 + MapLibre 6 + d3（scale／shape／array／interpolate）
    ├── package.json        dev、build（tsc -b + vite build）、lint（oxlint）、preview
    ├── vite.config.ts
    ├── index.html
    ├── README.md           前端指令（專案說明看根目錄 README.md）
    ├── public/data/        build.py 和 live.py 的輸出（見下方「public/data」）
    └── src/
        ├── main.tsx        進入點：字型、CSS（順序見「前端重點」）
        ├── App.tsx         外框（頂列、左側導覽、狀態列）+ hash 路由切換畫面
        ├── lib/
        │   ├── data.ts     讀檔 hooks：useData、useLayer、useCatalog、useNow；LiveProvider／useLive／useSeries
        │   ├── types.ts    public/data 每個檔案的型別
        │   ├── domains.ts  六題定義：代碼、名稱、問題、負責局處、顏色、分數、地圖指標、來源
        │   ├── impact.ts   成效模型 impact1–6（在瀏覽器依 impact.json 計算情境）
        │   ├── state.ts    全域狀態：選取的里、情境參數（DEFAULT_SCENARIO）
        │   ├── router.ts   hash 路由：#/、#/d/1–6、#/links、#/lineage、#/schem
        │   ├── format.ts   數字、時間、期間格式化
        │   ├── scales.ts   順序色階、發散色、服務水準（LOS）、狀態色
        │   ├── geo.ts      幾何中心等小工具
        │   ├── livegeo.ts  即時資料接到本機路段／VD 幾何、公車位置
        │   └── maplibre.ts MapLibre worker 路徑修正
        ├── components/
        │   ├── Shell.tsx       頂列（即時串流狀態）、左側導覽、狀態列；feedState、STATE_TEXT
        │   ├── Panel.tsx       面板外框、來源與資料擷取時間（Prov）、模擬資料／即時標章、KPI 磚
        │   ├── MapView.tsx     MapLibre 地圖，離線底圖（區界、里界、公車路網、捷運），不用外部圖磚
        │   ├── Charts.tsx      SVG 小圖：走勢線、折線圖、橫條排行、比例條（都有 hover 提示）；useWidth
        │   ├── LinkGraph.tsx   六題六角形關聯圖（邊寬 = Spearman ρ）
        │   ├── VillageCard.tsx 里的物件卡：人口與六題分數
        │   └── Icons.tsx       16px 線條圖示、狀態圖示 StatusGlyph
        ├── schematics/     SVG 動畫示意圖（每題一張，viewBox 480×240）
        │   ├── Shade.tsx、Bins.tsx、Rats.tsx、Traffic.tsx、Bus.tsx、Seismic.tsx
        │   ├── common.tsx      共用外框、示意圖標籤、模擬資料標章、斜線底紋
        │   ├── index.ts        匯出
        │   ├── Gallery.tsx     示意圖庫（#/schem，開發用，lazy 載入）
        │   └── schematics.css  示意圖樣式與 @keyframes
        ├── styles/
        │   ├── tokens.css      設計 token（深色、ink、line、focus、狀態色）
        │   ├── app.css         版面格線、頂列、導覽、狀態列、面板、來源標示與標章、KPI、控制項、提示框、進場動畫
        │   ├── components.css  圖表、檢視器（里物件卡）
        │   ├── map.css         地圖、圖層開關、圖例
        │   ├── views.css       總覽、關聯圖、跨題關聯頁（.lx）、資料血緣頁（.ln）
        │   └── domain.css      題目模組（#/d/1–6），含題目關聯面板（.dl）
        └── views/
            ├── Overview.tsx    OV 全市總覽：六題現況、里別需求地圖、關聯、優先處理里、即時監看、情境成效
            ├── DomainPage.tsx  #/d/1–6 的入口
            ├── domain/
            │   ├── Frame.tsx   六個模組共用外框：物件標頭 → KPI → 地圖 → 檢視器 → 情境
            │   ├── hooks.ts    模組共用：指標格式、前後差異、圖層開關、依分數圈選里
            │   └── D1Shade、D2Bins、D3Rats、D4Traffic、D5Bus、D6Seismic（.tsx）
            ├── Links.tsx       LX 跨題關聯：相關矩陣、共同熱點、機制與局處、證據
            └── Lineage.tsx     DL 資料血緣：原始資料 → 輸出檔 → 畫面，資料清冊、即時串流、模擬資料
```

## pipeline 重點

- `sources.py` 每筆資料源的欄位：
  - `key`、`source`（存放資料夾）、`title`、`agency`、`problems`（對應題目 1–6；0 = 共用：底圖、總覽、頂列串流狀態）。資料血緣頁的題目標記來自這裡，要和程式實際用途一致
  - `kind`：`url`（直接下載）、`dt`（data.taipei 單一資源）、`dt_multi`（data.taipei 最新 N 個月檔）、`tdx`、`tdx_hist`（TDX 歷史 VD，交給 `history.py`）
  - 即時資料另有 `live=True` 和 `interval`（秒）：vd_live 60、bus_live 60、bus_eta 300、road_live 300、rain_live 600
- `common.py`：
  - 同一主機的最小請求間隔記在 `HOST_INTERVAL`，TDX 是 13 秒（每分鐘 5 次）
  - `save_raw()` 一次寫入快照、latest 和 meta.json；抓取失敗不會動到舊檔
- `history.py`：
  - 每天 1 個請求，串流讀完整天（約 1.1 GB），只留內湖 VD、06:45–09:45 的紀錄
  - 跳過週末和平日的國定假日（`HOLIDAYS`）；已存的日期不重抓
  - 資料品質規則寫在 `RULES`，同一段文字會顯示在 04 模組的「晨峰資料品質」面板（`D4Traffic.tsx` 的 `QualityPanel`，讀 `impact.json` 的 `profile.quality`）
  - `profile()` 產生 10 個 15 分鐘時段（07:00–09:30）的 V/C、流量、車速；`build.py` 有這份資料時就取代模擬曲線
- `build.py`：
  - 只讀本機檔案
  - 六題的里別分數 `s1`–`s6` 先四捨五入到小數 1 位（和輸出的值相同），再算熱點（≥ 75）、共同熱點和相關係數。這樣用 `villages.geojson` 重算的結果會和 `links.json`、`impact.json` 一致
  - `calibrate_bpr()`：用歷史 VD 每天每時段的 V/C 和車速，以最小平方法校準 BPR 的 α 和自由車速（β = 4）
  - `catalog()` 寫 `catalog.json`：每個原始檔的擷取時間、筆數、大小、期間、是否即時；`outputs` 列出 28 個輸出檔各自的輸入（原始資料群組或其他輸出檔）；`mock` 列出模擬資料和用到它的檔案
  - 新增或改動輸出檔時，要同步更新 `main()` 最後的 `outputs` 清單
- `live.py` / `collect_live.py`：
  - 每個即時來源依自己的 interval 抓取並存原始快照，再重建 `live/traffic.json`、`bus.json`、`rain.json`、`series.json`、`status.json`
  - 原始即時快照預設保留 3 天（`--keep-days`）
  - 平日 07:00–09:30 另外累積 `live/peak.json`（前端目前沒有讀；內湖晨峰曲線改用 TDX 歷史 VD）
- 指令（都在專案根目錄執行）：
  - `.venv/bin/python -m pipeline.fetch`：抓所有超過 7 天的靜態資料
  - `.venv/bin/python -m pipeline.fetch --only bins,parks`：只抓指定資料
  - `.venv/bin/python -m pipeline.fetch --only vd_hist`：補抓 TDX 歷史 VD 缺少的日期
  - `.venv/bin/python -m pipeline.fetch --force`：強制重抓
  - `.venv/bin/python -m pipeline.fetch --live`：抓一次所有即時資料
  - `.venv/bin/python -m pipeline.history --days 10`：最近 10 個平日的 TDX 歷史 VD
  - `.venv/bin/python -m pipeline.history --dates 2026-10-13`：指定日期
  - `.venv/bin/python -m pipeline.history --summary`：只彙整已存的日期，不連網
  - `.venv/bin/python -m pipeline.build`：重建 `dashboard/public/data/`
  - `.venv/bin/python -u -m pipeline.collect_live`：常駐收集即時資料（`--once` 只跑一輪，`--keep-days 3`）

## public/data

| 檔案 | 內容 |
|---|---|
| `villages.geojson` | 456 里：人口、六題指標、分數 `s1`–`s6`、融合指數 `f`、熱點數 `hot` |
| `districts.geojson` | 12 區界和標籤點 |
| `links.json` | 跨題關聯：Spearman、Jaccard、共同熱點、機制、局處、證據 |
| `impact.json` | 六個成效模型的基準值、情境曲線、假設、模擬資料標記；`fusion` 是優先處理里 |
| `timeseries.json` | 陳情月趨勢、公車／建物／捷運年統計、獨居長者、見鼠週趨勢 |
| `bus_routes.json` | 公車路線表（車公里、與捷運重疊、平日發車時刻） |
| `lines/*.geojson` | `bus_routes`、`mrt`、`road_sections`、`sidewalks`（含遮蔭率） |
| `poly/liquefaction.geojson` | 土壤液化潛勢 |
| `layers/*.json` | 點圖層 `{cols, rows}`：trees、tree_holes、bins、bin_candidates、rats、restaurants、garbage_truck、markets、manholes、vd、bus_stops、mrt、hydrants |
| `live/*.json` | `traffic`、`bus`、`rain`、`series`（走勢線環狀緩衝）、`status`（各串流最後成功時間與錯誤） |
| `catalog.json` | 資料血緣與清冊：`sources`、`outputs`、`mock`、`built_at` |

## 前端重點

- **讀資料：**
  - 只讀 `public/data`，不直接打外部 API
  - `useData` 在同一次頁面載入內快取，重新跑 `pipeline.build` 後要重新整理頁面
  - `LiveProvider` 每 15 秒讀 `live/status.json`，有變動時重新載入 traffic、bus、rain、series
- **CSS：**
  - 載入順序：tokens → app → components → map → views → domain，後載入的會覆蓋前面
  - class 前綴不能重複：`.dl-*` 是 domain.css 的題目關聯面板，所以資料血緣頁用 `.ln-*`，跨題關聯頁用 `.lx-*`，04 晨峰資料品質面板用 `.qa-*`
- **顏色規則：**
  - 題目色只用來識別題目，文字一律用 ink token
  - `--focus` 用在互動和選取
  - 狀態色（正常／延遲／失敗）只表示狀態，一定搭配圖示和文字
  - 模擬資料用斜線底紋（`.mock-swatch`、`.badge-mock`）
- **來源標示（`Prov`，在 `components/Panel.tsx`）：**
  - 每個圖表和地圖的 foot 都放 `<Prov keys={[...]} />`，顯示來源和資料擷取時間；即時來源用收集程式最後成功的時間
  - key 可以是 `catalog.json` 的原始檔 key，或資料群組名稱：`petitions`、`dengue_vector` 會展開成所有快取的月份檔，不要寫死月份
  - 各題的來源清單在 `lib/domains.ts` 的 `sources`（模型假設面板、關聯頁使用）；KPI 列和地圖的來源在各模組的 `kpiSources`／`mapSources`
- **資料血緣頁（`views/Lineage.tsx`）：**
  - 原始資料和輸出檔的關係來自 `catalog.json`
  - 輸出檔和畫面的對應寫在 `SCREENS`，要跟各頁的 `useData`／`useLayer`／`useLive` 同步
- **情境預設值**在 `lib/state.ts` 的 `DEFAULT_SCENARIO`，例如 04 彈性工時 5%、減量 5%

## 前端指令

- `cd dashboard && npm run dev`：開發伺服器（http://127.0.0.1:5173/）
- `cd dashboard && npx tsc --noEmit -p tsconfig.app.json`：只做型別檢查
- `cd dashboard && npm run build`：型別檢查 + 打包到 `dashboard/dist/`
- `cd dashboard && npm run lint`：oxlint
