# 台北市政資料 API 清單（2026-10-14 實測）

> 所有抓到的資料都要先存到 `data/raw/`，前端只讀本機檔案，畫面上要顯示「資料擷取時間」。規則細節見 `CLAUDE.md` 的「資料快取規則」。

## 通用：data.taipei
- 資料集 metadata（含所有 resource 的 rid、url）：
  `https://data.taipei/api/frontstage/tpeod/dataset.view?id={資料集id}`
- 表格資料 API（有 datastore 的 resource 才能用，支援分頁）：
  `https://data.taipei/api/v1/dataset/{rid}?scope=resourceAquire&limit=1000&offset=0`
- 非表格檔案（SHP/JSON/GeoJSON）：
  `https://data.taipei/api/dataset/{資料集id}/resource/{rid}/download`

## 各題端點

| 題 | 資料 | 端點 | 狀態 |
|---|---|---|---|
| 1 | 行道樹 / 公園樹木 / 樹穴 | `https://tppkl.blob.core.windows.net/blobfs/TaipeiTree.json`、`TaipeiParkTree.json`、`TaipeiTreeHole.json`（也有 .csv/.xml） | 可下載 |
| 1 | 人行道範圍圖 | `https://data.taipei/api/dataset/715d3a83-8445-4496-b6bf-b0900538b7e7/resource/b11d6142-1d71-41d5-a843-7b7cfcea61ef/download`（約 24 MB，TWD97） | 可下載 |
| 1 | 公園基本資料 | `https://parks.gov.taipei/parks/api/` | JSON API |
| 2 | 行人專用清潔箱 | `https://data.taipei/api/dataset/a835f3ba-7f50-4b0d-91a6-9df128632d1c/resource/267d550f-c6ec-46e0-b8af-fd5a464eb098/download` | CSV |
| 2/4/7 | 捷運分時進出量 | rid `eb481f58-1238-4cff-8caa-fa7bb20cb4f4`（116 筆，每筆是每月 CSV 的 url） | API |
| 2/3 | 陳情系統類別 | rid `b57a0fa8-9507-438b-b2e1-676829a72aff`（11509，42,674 筆）；共 119 個月份 resource | API |
| 2/5 | 公車站牌位置 | `https://data.taipei/api/dataset/48aa5bca-2a4f-4fb7-a658-43cba51d5d56/resource/dfd68d8e-d3b9-44df-b614-8850c103239f/download`（SHP zip） | 可下載 |
| 3 | 污水下水道管線 | rid `88157465-4794-41a2-a409-6180b3952f6b`（77,603 筆） | API |
| 3 | 雨水下水道人孔 | rid `dcaebd40-45e1-48f6-9d2e-00e1c0283f8a`（19,443 筆，含 x/y 坐標） | API |
| 3 | 食品業者登錄數 | rid `2227c204-5f9f-4b20-8c6d-c6048eab6475`（只有 1 筆彙總） | API |
| 3 | Rat Radar 民眾通報 | `https://ratdar.taipei/reports/export`（約 1,577 筆，含經緯度；含外縣市） | CSV |
| 4 | VD 靜態 | `https://tcgbusfs.blob.core.windows.net/blobtisv/VD.xml` | XML |
| 4 | VD 即時（約每分鐘） | `https://tcgbusfs.blob.core.windows.net/blobtisv/GetVDDATA.xml.gz` | gzip XML，免金鑰 |
| 4/5 | TDX | 見下方「TDX」段落 | 需要金鑰 |
| 4 | TDX 歷史 VD（逐分鐘） | 見下方「TDX 歷史資料」段落 | 需要金鑰，每天約 1.1 GB |
| 5 | 公車路線軌跡 | `https://tcgbusfs.blob.core.windows.net/blobbus/GetBusShape.gz` | gzip JSON（WKT） |
| 5 | 公車預估到站 | `https://tcgbusfs.blob.core.windows.net/blobbus/GetEstimateTime.gz` | gzip JSON，即時 |
| 5 | 聯營公車業務統計 | `https://tsis.dbas.gov.taipei/statis/webMain.aspx?sys=220&ymf=5700&kind=21&type=0&funid=a05023701&cycle=4&outmode=12&compmode=0&outkind=1&deflst=2&nzo=1` | CSV |
| 6 | 土壤液化潛勢 | `https://soil.taipei/Taipei2019/Main/pages/TPLiquid_84.GeoJSON`（WGS84）/ `TPLiquid_97.GeoJSON` | GeoJSON |
| 6 | 各里年齡人口 | rid `c8f5b53d-ef3d-4321-ae8e-58cd2a5ee73c`（112 年起，63,315 筆） | API |
| 6 | 建物棟數（樓層別） | `https://tsis.dbas.gov.taipei/statis/webMain.aspx?sys=220&ymf=6500&kind=21&type=0&funid=a05019201&cycle=4&outmode=12&compmode=0&outkind=1&deflst=2&nzo=1` | CSV（全市彙總） |
| 6 | 消防通道清冊 | rid `351307e4-ffda-4660-ac72-1c4ef3808c38`（185 筆） | API |
| 7 | 雨量站即時 | `https://wic.gov.taipei/OpenData/API/Rain/Get?stationNo=&loginId=open_rain&dataKey=85452C1D`（42 站） | JSON API，公開 key |
| 7 | 雨水下水道水位站 | rid `586e5233-aa60-4680-8ac1-cbb9ef7f7fde`（233 站位置） | API |

## TDX 運輸資料流通服務

### 認證
1. 從 `.env` 讀 `TDX_CLIENT_ID` / `TDX_CLIENT_SECRET`。**不要印出或提交。**
2. POST 到 `https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token`
   - Body：`grant_type=client_credentials&client_id=...&client_secret=...`
   - Header：`Content-Type: application/x-www-form-urlencoded`
3. 回傳的 `access_token` 有效 86400 秒（24 小時）。**要快取起來重複用，不要每次呼叫都換新的。**
4. 呼叫 API 時帶 `Authorization: Bearer {access_token}`。

### 限制
- **每分鐘 5 次。** 超過會回 429，header 有 `Retry-After`（秒數）。程式要做節流、快取和 429 重試。
- 不帶金鑰的匿名呼叫，第 2 次就回 401。

### 共用查詢參數
- `$format=JSON`
- `$top=N`
- `$skip=N`
- `$select=欄位1,欄位2`
- `$filter=...`（OData 語法）

### 已測通的端點
Base：`https://tdx.transportdata.tw/api/basic`

| 用途 | 路徑 | 主要欄位 |
|---|---|---|
| 公車路線 | `/v2/Bus/Route/City/Taipei` | RouteUID, SubRoutes, Operators |
| 公車站序 | `/v2/Bus/StopOfRoute/City/Taipei` | RouteUID, Direction, Stops |
| 公車站牌 | `/v2/Bus/Stop/City/Taipei` | StopUID, StopName, StopPosition |
| 公車即時到站 | `/v2/Bus/EstimatedTimeOfArrival/City/Taipei` | StopUID, RouteUID, EstimateTime, StopStatus |
| 公車即時位置 | `/v2/Bus/RealTimeByFrequency/City/Taipei` | PlateNumb, RouteUID, BusPosition |
| 公車路線線型 | `/v2/Bus/Shape/City/Taipei` | Geometry (WKT), EncodedPolyline |
| 公車班表 | `/v2/Bus/Schedule/City/Taipei` | RouteUID, Direction, Frequencys / Timetables |
| 北市 VD 靜態 | `/v2/Road/Traffic/VD/City/Taipei` | VDID, DetectionLinks, PositionLon/Lat |
| 北市 VD 即時 | `/v2/Road/Traffic/Live/VD/City/Taipei` | VDID, LinkFlows（車道流量、速度、佔有率）, DataCollectTime |
| 北市路段即時 | `/v2/Road/Traffic/Live/City/Taipei` | SectionID, TravelTime, TravelSpeed, CongestionLevel |
| 國道 VD 即時 | `/v2/Road/Traffic/Live/VD/Freeway` | VDID, LinkFlows |
| 台北捷運站 | `/v2/Rail/Metro/Station/TRTC` | StationUID, StationName, StationPosition |

驗證腳本：`python3 tdx_check.py`

### TDX 歷史資料（VD 逐分鐘）
題目 4 的內湖晨峰曲線用這個端點，程式在 `pipeline/history.py`。

- **端點：** `https://tdx.transportdata.tw/api/historical/v2/Historical/Road/Traffic/Live/VD/City/Taipei?Dates=YYYY-MM-DD&$format=JSON`
  - 認證和每分鐘 5 次的限制都和上面相同
- **回應：**
  - 一次回一整天全臺北約 650 支 VD 的逐分鐘資料
  - 格式是 NDJSON（一行一筆，開頭有 BOM），約 93 萬筆、1.1 GB，下載約 100 秒
- **查詢參數：**
  - `$filter`、`$select`、`$skip` 都被忽略，只有 `$top` 有效
  - 所以不能只抓內湖或晨峰，每天只能整份下載，再在本機篩選
- **時間：**
  - 時間欄位（`DataCollectTime` 等）是 UTC（`+00:00`），要轉成台北時間
  - 紀錄沒有依時間排序，同一分鐘的紀錄最晚約 2 小時後才出現，所以不能讀到 09:45 就中斷連線
  - 前一天的資料隔天清晨才發布（2026-10-13 的紀錄 `UpdateTime` 是 10-14 05:21），當天抓不到當天
- **欄位：**
  - 每筆：`VDID`、`Status`、`DataCollectTime`、`LinkFlows[]`
  - 每個車道：`LinkFlows[].Lanes[]` 有 `LaneID`、`Speed`、`Occupancy`、`ErrorDiags`
  - `Vehicles[]` 依車種代碼（S、L、T、M）分列這 1 分鐘的 `Volume` 和 `Speed`。本專案的流量是所有車種加總
- **車道診斷碼 `ErrorDiags`：** 沒找到公開定義，以下是 2026-09-29～10-13 實測：
  - `diag0`：正常
  - `diag102`、`diag106`：所有數值都是 −99（缺值）
  - `diag201`、`diag203`、`diag205`：有車數，但車速和佔有率是 0
  - `diag202`：有車速，但車數是 0
  - `diag107`：只和 2026-10-02 的時間戳異常一起出現
  - `diag303`：整支 VD 整天被標記，但數值和同一車道未標記的日子一致，所以保留
- **已知異常：** 2026-10-02 的 `DataCollectTime` 停在 07:01 約 1 小時，每支 VD 同一分鐘有 60 筆。這一天不納入平均
- **本專案的快取：**
  - 每天 1 個請求，只留內湖 VD、台北時間 06:45–09:45 的原始紀錄
  - 存成 `data/raw/tdx/vd_hist_{YYYYMMDD}.ndjson.gz`，約 0.6 MB／天、1 萬筆
  - 歷史資料不會變，已存的日期不重抓
  - 跳過週末和平日的國定假日
- **資料品質規則：** 狀態碼、診斷碼、異常值、有效車道、異常日的完整規則寫在 `history.py` 的 `RULES`，同樣的文字會顯示在 04 模組

## 沒有找到的
- 「市長，你給我聽好了」市民痛點資料（taipeispeaksup.org）：沒有公開 API。這份資料只提供給黑客松參加者使用，**本專案不能使用**。
- data.gov.tw 166031（縣市即時路況）：API 回傳 Not Available；北市 VD 即時可改用上面的 GetVDDATA。
