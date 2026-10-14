"""Registry of every data source used by the dashboard.

kind:
  url       plain GET of `url`
  dt        data.taipei resource download (pid + rid)
  dt_multi  newest `count` resources of a data.taipei dataset (monthly files)
  tdx       TDX API `path` (token + 5 req/min throttle handled in common.py)
  tdx_hist  TDX historical VD, one file per weekday for the last `days` weekdays (pipeline/history.py; cached days never refetched)
live sources are refreshed by collect_live.py every `interval` seconds and keep every snapshot.
problems: which of the 6 problems (1-6) the source feeds; 0 = shared (base map, overview, top-bar feed status).
"""

DT = "https://data.taipei/api/dataset/{pid}/resource/{rid}/download"
TCG = "https://tcgbusfs.blob.core.windows.net"

SOURCES = [
    # ---------------------------------------------------------------- base layers
    dict(key="village", source="data_taipei", title="臺北市里界圖", agency="民政局", problems=[0],
         kind="dt", pid="6b17b31d-4e16-495e-95b1-9fd1f47c80d8", rid="145e30da-58f3-45db-a125-8adc3fde2620", ext="zip"),
    dict(key="district", source="data_taipei", title="臺北市區界圖", agency="民政局", problems=[0],
         kind="dt", pid="1601ef3a-c253-4988-b047-943d9e786143", rid="d8b7eb29-136f-49fc-b14b-3489d3656122", ext="zip"),
    dict(key="population_age", source="data_taipei", title="臺北市各里人口數按年齡分（112年迄今）", agency="民政局", problems=[0, 1, 5, 6],
         kind="dt", pid="a6394e3f-3514-4542-87bd-de4310a40db3", rid="c8f5b53d-ef3d-4321-ae8e-58cd2a5ee73c", ext="csv"),
    dict(key="petitions", source="data_taipei", title="臺北市陳情系統類別資料", agency="研考會", problems=[1, 2, 3, 4, 5, 6],
         kind="dt_multi", pid="cb423c17-88eb-4231-a725-f1b93247d1bf", count=12, ext="csv"),

    # ---------------------------------------------------------------- 1 樹蔭
    dict(key="trees_street", source="tppkl", title="臺北市行道樹", agency="工務局公園處", problems=[1],
         kind="url", url="https://tppkl.blob.core.windows.net/blobfs/TaipeiTree.csv", ext="csv"),
    dict(key="trees_park", source="tppkl", title="臺北市公園樹木", agency="工務局公園處", problems=[1],
         kind="url", url="https://tppkl.blob.core.windows.net/blobfs/TaipeiParkTree.csv", ext="csv"),
    dict(key="tree_holes", source="tppkl", title="臺北市樹穴", agency="工務局公園處", problems=[1],
         kind="url", url="https://tppkl.blob.core.windows.net/blobfs/TaipeiTreeHole.csv", ext="csv"),
    dict(key="sidewalk", source="data_taipei", title="臺北市人行道範圍圖", agency="工務局新工處", problems=[1],
         kind="dt", pid="715d3a83-8445-4496-b6bf-b0900538b7e7", rid="b11d6142-1d71-41d5-a843-7b7cfcea61ef", ext="json"),
    dict(key="parks", source="parks", title="臺北市公園基本資料", agency="工務局公園處", problems=[1],
         kind="url", url="https://parks.gov.taipei/parks/api/", ext="json"),

    # ---------------------------------------------------------------- 2 垃圾桶
    dict(key="bins", source="data_taipei", title="臺北市行人專用清潔箱", agency="環保局", problems=[2],
         kind="dt", pid="a835f3ba-7f50-4b0d-91a6-9df128632d1c", rid="267d550f-c6ec-46e0-b8af-fd5a464eb098", ext="csv"),
    dict(key="mrt_ridership", source="tsis", title="臺北捷運各站進出人次", agency="捷運公司／主計處", problems=[2, 5],
         kind="url", url="https://tsis.dbas.gov.taipei/statis/webMain.aspx?sys=220&ymf=8500&kind=21&type=0&funid=a05023601&cycle=4&outmode=12&compmode=0&outkind=1&deflst=2&nzo=1", ext="csv"),

    # ---------------------------------------------------------------- 3 鼠患
    dict(key="restaurants", source="data_taipei", title="設址臺北市所營事業含餐館業清冊", agency="產業局", problems=[3, 2],
         kind="dt", pid="178abc4e-fe32-4fc9-af3a-7baf1c15082c", rid="e94a712a-be5b-4d8b-89c9-30a5ee21f25d", ext="csv"),
    dict(key="vendor_markets", source="data_taipei", title="臺北市攤販集中場", agency="市場處", problems=[3, 2],
         kind="dt", pid="c013d9ec-a550-46bd-ac60-45f085930706", rid="4874f750-b972-4c42-ad76-986960670c70", ext="csv"),
    dict(key="garbage_truck", source="data_taipei", title="臺北市垃圾車點位路線資訊", agency="環保局", problems=[3],
         kind="dt", pid="6bb3304b-4f46-4bb0-8cd1-60c66dcd1cae", rid="a6e90031-7ec4-4089-afb5-361a4efe7202", ext="csv"),
    dict(key="rain_manholes", source="data_taipei", title="臺北市雨水下水道人孔", agency="工務局水利處", problems=[3],
         kind="dt", pid="3e62c860-0753-4c79-8fe1-bcb3e0243534", rid="dcaebd40-45e1-48f6-9d2e-00e1c0283f8a", ext="csv"),
    dict(key="sewer_lines", source="data_taipei", title="臺北市污水下水道管線", agency="工務局衛工處", problems=[3],
         kind="dt", pid="af1e6e42-5ffc-4be0-983f-51c03d5d1b17", rid="88157465-4794-41a2-a409-6180b3952f6b", ext="csv"),
    dict(key="ratradar", source="ratdar", title="見鼠地圖 Rat Radar 民眾通報", agency="民間", problems=[3],
         kind="url", url="https://ratdar.taipei/reports/export", ext="csv"),
    dict(key="dengue_vector", source="data_taipei", title="臺北市登革熱病媒蚊密度調查", agency="衛生局", problems=[3],
         kind="dt_multi", pid="1ec5170f-8507-48ad-ad91-c50cb1493119", count=3, ext="csv"),

    # ---------------------------------------------------------------- 4 車流
    dict(key="vd_static", source="tcgbusfs", title="臺北市車輛偵測器（VD）靜態", agency="交通局", problems=[4],
         kind="url", url=f"{TCG}/blobtisv/VD.xml", ext="xml"),
    dict(key="road_section", source="tdx", title="TDX 臺北市路段基本資料", agency="交通部", problems=[4],
         kind="tdx", path="/v2/Road/Traffic/Section/City/Taipei?$format=JSON", ext="json"),
    dict(key="road_section_shape", source="tdx", title="TDX 臺北市路段線型", agency="交通部", problems=[4, 5],
         kind="tdx", path="/v2/Road/Traffic/SectionShape/City/Taipei?$format=JSON", ext="json"),
    dict(key="congestion_levels", source="tdx", title="TDX 臺北市壅塞等級定義", agency="交通部", problems=[4],
         kind="tdx", path="/v2/Road/Traffic/CongestionLevel/City/Taipei?$format=JSON", ext="json"),
    dict(key="vd_hist", source="tdx", title="TDX 歷史 VD（內湖晨峰）", agency="交通部", problems=[4],
         kind="tdx_hist", ext="ndjson.gz", days=10),

    # ---------------------------------------------------------------- 5 公車
    dict(key="bus_route", source="tcgbusfs", title="臺北市公車路線", agency="公運處", problems=[5],
         kind="url", url=f"{TCG}/blobbus/GetRoute.gz", ext="json.gz"),
    dict(key="bus_stop", source="tcgbusfs", title="臺北市公車站牌", agency="公運處", problems=[5, 2],
         kind="url", url=f"{TCG}/blobbus/GetStop.gz", ext="json.gz"),
    dict(key="bus_shape", source="tcgbusfs", title="臺北市公車路線軌跡", agency="公運處", problems=[0, 5],
         kind="url", url=f"{TCG}/blobbus/GetBusShape.gz", ext="json.gz"),
    dict(key="bus_timetable", source="tcgbusfs", title="臺北市公車時刻表", agency="公運處", problems=[5],
         kind="url", url=f"{TCG}/blobbus/GetTimeTable.gz", ext="json.gz"),
    dict(key="bus_stats", source="tsis", title="臺北市聯營公車業務統計", agency="公運處／主計處", problems=[5],
         kind="url", url="https://tsis.dbas.gov.taipei/statis/webMain.aspx?sys=220&ymf=5700&kind=21&type=0&funid=a05023701&cycle=4&outmode=12&compmode=0&outkind=1&deflst=2&nzo=1", ext="csv"),
    dict(key="metro_station", source="tdx", title="TDX 臺北捷運車站", agency="交通部", problems=[5, 2],
         kind="tdx", path="/v2/Rail/Metro/Station/TRTC?$format=JSON", ext="json"),
    dict(key="metro_shape", source="tdx", title="TDX 臺北捷運路線線型", agency="交通部", problems=[0, 5],
         kind="tdx", path="/v2/Rail/Metro/Shape/TRTC?$format=JSON", ext="json"),

    # ---------------------------------------------------------------- 6 耐震
    dict(key="liquefaction", source="soil", title="臺北市土壤液化潛勢", agency="工務局大地處", problems=[6],
         kind="url", url="https://soil.taipei/Taipei2019/Main/pages/TPLiquid_84.GeoJSON", ext="geojson"),
    dict(key="fire_access", source="data_taipei", title="臺北市消防通道清冊（搶救困難地區）", agency="消防局", problems=[6],
         kind="dt", pid="7a800e92-eb22-461f-b29d-8def2127a1bc", rid="351307e4-ffda-4660-ac72-1c4ef3808c38", ext="csv"),
    dict(key="hydrants", source="data_taipei", title="大臺北地區消防栓點位", agency="北水處", problems=[6],
         kind="dt", pid="c106a00b-5a21-4393-b213-475a0ece9f2b", rid="b9f8154d-c627-48a8-b3ef-512ed9cde9e7", ext="csv"),
    dict(key="buildings_stats", source="tsis", title="臺北市現有營造建築物棟數", agency="都發局／主計處", problems=[6],
         kind="url", url="https://tsis.dbas.gov.taipei/statis/webMain.aspx?sys=220&ymf=6500&kind=21&type=0&funid=a05019201&cycle=4&outmode=12&compmode=0&outkind=1&deflst=2&nzo=1", ext="csv"),
    dict(key="elderly_alone", source="data_taipei", title="臺北市獨居老人人數（行政區）", agency="社會局", problems=[6],
         kind="dt", pid="b84b4354-2298-4805-87fa-f75405ce46b4", rid="31f2de9b-c900-427b-a0eb-8f769629459f", ext="csv"),

    # ---------------------------------------------------------------- live feeds (collect_live.py)
    dict(key="vd_live", source="tcgbusfs", title="臺北市 VD 即時車流", agency="交通局", problems=[4],
         kind="url", url=f"{TCG}/blobtisv/GetVDDATA.xml.gz", ext="xml.gz", live=True, interval=60),
    dict(key="bus_live", source="tcgbusfs", title="臺北市公車即時位置", agency="公運處", problems=[5],
         kind="url", url=f"{TCG}/blobbus/GetBusData.gz", ext="json.gz", live=True, interval=60),
    dict(key="bus_eta", source="tcgbusfs", title="臺北市公車預估到站", agency="公運處", problems=[5],
         kind="url", url=f"{TCG}/blobbus/GetEstimateTime.gz", ext="json.gz", live=True, interval=300),
    dict(key="rain_live", source="wic", title="臺北市雨量站即時", agency="工務局水利處", problems=[0],
         kind="url", url="https://wic.gov.taipei/OpenData/API/Rain/Get?stationNo=&loginId=open_rain&dataKey=85452C1D", ext="json", live=True, interval=600),
    dict(key="road_live", source="tdx", title="TDX 臺北市路段即時路況", agency="交通部", problems=[4, 5],
         kind="tdx", path="/v2/Road/Traffic/Live/City/Taipei?$format=JSON", ext="json", live=True, interval=300),
]

BY_KEY = {s["key"]: s for s in SOURCES}
