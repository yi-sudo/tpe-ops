// Records every segment of the promo as JPEG frames via CDP screencast, then encodes each to a 30 fps mp4.
import { chromium } from 'playwright-core'
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
const BASE = 'http://127.0.0.1:5173/#/'
const CARDS = 'file://' + process.cwd() + '/cards/'
const only = process.argv[2] ? process.argv[2].split(',') : null
const b = await chromium.launch({ channel: 'chrome', args: ['--hide-scrollbars'] })
const ctx = await b.newContext({ viewport: { width: 1920, height: 1080 } })
const p = await ctx.newPage()
const cdp = await ctx.newCDPSession(p)
const sleep = (ms) => p.waitForTimeout(ms)

async function record(name, dur, act) {
  if (only && !only.includes(name)) return
  const dir = `frames/${name}`; fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true })
  const frames = []
  const on = async (f) => { frames.push(f.metadata.timestamp); fs.writeFileSync(`${dir}/${String(frames.length).padStart(5, '0')}.jpg`, Buffer.from(f.data, 'base64')); await cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {}) }
  cdp.on('Page.screencastFrame', on)
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 95, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 })
  const t0 = Date.now() / 1000
  await act()
  const rest = dur * 1000 - (Date.now() - t0 * 1000); if (rest > 0) await sleep(rest)
  await cdp.send('Page.stopScreencast'); cdp.off('Page.screencastFrame', on)
  // concat list: each frame lasts until the next one; the first starts at t0, the last runs to t0 + dur
  const ts = frames.map((t) => Math.max(t, t0)); const lines = []
  for (let i = 0; i < ts.length; i++) {
    const start = i === 0 ? t0 : ts[i]; const end = i + 1 < ts.length ? ts[i + 1] : t0 + dur
    lines.push(`file '${String(i + 1).padStart(5, '0')}.jpg'`, `duration ${Math.max(0.001, end - start).toFixed(4)}`)
  }
  lines.push(`file '${String(ts.length).padStart(5, '0')}.jpg'`)
  fs.writeFileSync(`${dir}/list.txt`, lines.join('\n'))
  fs.mkdirSync('seg', { recursive: true })
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', `${dir}/list.txt`, '-vf', 'fps=30,scale=1920:1080:flags=lanczos,format=yuv420p', '-t', String(dur), '-c:v', 'libx264', '-crf', '16', '-preset', 'medium', `seg/${name}.mp4`])
  console.log(name, frames.length, 'frames', (frames.length / dur).toFixed(1), 'fps')
}

const CAP_CSS = `.promo-cap{position:fixed;left:50%;bottom:64px;transform:translateX(-50%);z-index:9999;background:rgba(6,9,13,.9);border:1px solid #2a3542;border-left:6px solid var(--c);padding:18px 30px 18px 26px;min-width:900px;max-width:1500px;box-shadow:0 10px 40px rgba(0,0,0,.6);opacity:0;animation:pcin .6s .3s ease forwards;font-family:"PingFang TC","Noto Sans TC",sans-serif}
.promo-cap b{font:500 22px Menlo,monospace;color:#9fb3c8;margin-right:14px;letter-spacing:.06em}.promo-cap .t{font-size:36px;color:#fff;font-weight:500}.promo-cap .s{font-size:25px;color:#c9d6e2;margin-top:8px}
@keyframes pcin{from{opacity:0;transform:translate(-50%,14px)}to{opacity:1;transform:translate(-50%,0)}}`
async function caption(code, color, title, sub) {
  await p.evaluate(([css, code, color, title, sub]) => {
    document.querySelector('.promo-cap')?.remove()
    if (!document.getElementById('promo-css')) { const s = document.createElement('style'); s.id = 'promo-css'; s.textContent = css; document.head.append(s) }
    const d = document.createElement('div'); d.className = 'promo-cap'; d.style.setProperty('--c', color)
    d.innerHTML = `<div class="t"><b>${code}</b>${title}</div>${sub ? `<div class="s">${sub}</div>` : ''}`; document.body.append(d)
  }, [CAP_CSS, code, color, title, sub])
}
const clearCap = () => p.evaluate(() => { document.querySelector('.promo-cap')?.remove(); document.getElementById('promo-gal')?.remove() })

/** drag a range input from its value to `to` (fraction of track) and back */
async function wiggle(sel, to, ms = 1500) {
  const el = p.locator(sel).first(); const box = await el.boundingBox(); if (!box) return
  const [v, mn, mx] = await el.evaluate((e) => [Number(e.value), Number(e.min), Number(e.max)])
  const f0 = (v - mn) / (mx - mn); const y = box.y + box.height / 2; const x = (f) => box.x + 8 + (box.width - 16) * f
  await p.mouse.move(x(f0), y); await p.mouse.down()
  const steps = Math.round(ms / 40)
  for (let i = 1; i <= steps; i++) { await p.mouse.move(x(f0 + (to - f0) * i / steps), y); await sleep(40) }
  await sleep(500)
  for (let i = 1; i <= steps; i++) { await p.mouse.move(x(to + (f0 - to) * i / steps), y); await sleep(40) }
  await p.mouse.up(); await p.mouse.move(1900, 540)
}

const card = (n, dur) => record(n, dur, async () => { await p.goto(CARDS + n + '.html') })
const go = (r) => p.evaluate((r) => (location.hash = '#/' + r), r)
const at = async (t0, ms) => { const w = ms - (Date.now() - t0); if (w > 0) await sleep(w) }
await card('intro', 5)
await card('title', 3.5)

// warm up the app so every route renders from cache
await p.goto(BASE); await sleep(5000)
for (const r of ['d/1', 'd/2', 'd/3', 'd/4', 'd/5', 'd/6', 'links', 'lineage', 'schem', '']) { await go(r); await sleep(1800) }

await record('ov', 12, async () => {
  const t0 = Date.now()
  await caption('OV', '#8abbff', '全市總覽：456 里 × 六題，一眼找出優先處理的里', '16 個里同時是 3 題以上的熱點，住了 7.4 萬人')
  await at(t0, 1500); await p.locator('button:has-text("立體")').first().click()   // 3D extrusion of the fused score
  await at(t0, 5000); await p.locator('.pl-row').nth(1).click()                     // priority village → fly + object card
  await at(t0, 8500); await p.locator('.pl-row').nth(2).click()
})

const D = [
  [1, '#008300', '把三千棵樹種回來', '補植 3,000 棵 → 人行道遮蔭率 22.7% → 24.2%，缺蔭里 214 → 187', 0.85],
  [2, '#9085e9', '找回消失的垃圾桶', '新增 100 個清潔箱 → 人潮需求涵蓋率 27% → 53%', 0.75],
  [3, '#d55181', '鼠患風險地圖', '風險最高的 20% 面積，涵蓋 76% 的見鼠通報（932 筆真實通報驗證）', 0.6],
  [4, '#c98500', '內湖晨尖峰車流', '彈性工時 5% + 減量 5% → 晨峰延滯 −25.8%，每年省 2.2 萬車小時', 0.5],
  [5, '#3987e5', '公車動態路網', '84 條與捷運高重疊的路線減班 20%，省下的車小時可開 DRTS 補 60 個冷區里', 0.7],
  [6, '#d95926', '危老耐震風險評級', '先健檢前 50 個里（11%），涵蓋 21% 住在液化區的長者', 0.6],
]
const GAL = (n) => `.sc-gallery{position:fixed!important;inset:0;z-index:500;background:#0b0f14;display:flex;align-items:center;justify-content:center;overflow:hidden}
.sc-gallery-head{display:none}.sc-grid{display:block!important}.sc-card{display:none!important}
.sc-card:nth-child(${n}){display:block!important;zoom:2.35;width:444px}`
for (const [n, c, t, sub, to] of D) {
  await record(`d${n}`, 9, async () => {
    const t0 = Date.now()
    await clearCap(); await go('d/' + n); await sleep(500)
    await caption('0' + n, c, t, sub)
    await at(t0, 1500); await p.mouse.click(700, 520)          // village → object card with the six scores
    await at(t0, 3300); await wiggle('input.slider', to, 1100)  // scenario lever: map, KPIs and schematic follow
    await at(t0, 6900); await p.mouse.click(560, 560)
    await p.mouse.move(1900, 540)
  })
  await record(`s${n}`, 4, async () => {
    await clearCap(); await go('schem'); await sleep(200)
    await p.evaluate((css) => { const s = document.createElement('style'); s.id = 'promo-gal'; s.textContent = css; document.head.append(s) }, GAL(n))
    await sleep(700)
    await wiggle(`.sc-card:nth-child(${n}) input[type=range]`, to, 900)
  })
}
await record('links', 8.5, async () => {
  const t0 = Date.now()
  await clearCap(); await go('links'); await sleep(400)
  await caption('LX', '#8abbff', '跨題關聯：題目不是各自獨立的', '垃圾桶 × 鼠患最相關（ρ 0.59），可由同一組清運與防治行動一起處理')
  await at(t0, 1500); await p.locator('.px-row').nth(0).click()
  await at(t0, 4300); await p.locator('.px-row').nth(2).click()
  await at(t0, 6800); await p.mouse.click(700, 520)
})
await record('lineage', 9, async () => {
  const t0 = Date.now()
  await clearCap(); await go('lineage'); await sleep(400)
  await caption('DL', '#8abbff', '資料血緣：每個數字都追得到來源與擷取時間', '點任一個資料或畫面，就亮出它的上下游；模擬資料一律另外標示')
  await at(t0, 1500); await p.locator('.ln-n.ln-src').nth(4).click()
  await at(t0, 4300); await p.locator('.ln-n.ln-out').nth(3).click()
  await at(t0, 6800); await p.locator('.ln-n.ln-src').nth(20).click()
})
await clearCap()
await card('gaps', 11.5)
await card('end', 8)
await b.close()
