// Renders the demo video from the recorded live run: real dashboard frames (headless Chrome)
// + each line spoken in its character's macOS voice, stitched with ffmpeg. Output: demo/front-desk-demo.mp4
import fs from 'node:fs'
import { execFileSync, spawn } from 'node:child_process'
import WebSocket from 'ws'

const ROOT = decodeURIComponent(new URL('../', import.meta.url).pathname)
const WORK = process.env.WORK || `${ROOT}.state/video`
const OUT = `${ROOT}demo/front-desk-demo.mp4`
const RATE = process.env.RATE || '228'
const VOICE = { frontdesk: 'Samantha', stylist: 'Moira', security: 'Daniel', owner: 'Karen', napa: 'Tessa', bot: 'Fred', narrator: 'Rishi', host: 'Samantha' }
fs.rmSync(WORK, { recursive: true, force: true }); fs.mkdirSync(WORK, { recursive: true }); fs.mkdirSync(`${ROOT}demo`, { recursive: true })

// frame page = replay site with frame mode on
fs.writeFileSync(`${ROOT}site/frame.html`, fs.readFileSync(`${ROOT}site/index.html`, 'utf8').replace("window.FD_REPLAY = 'replay.json'", "window.FD_REPLAY = 'replay.json'\nwindow.FD_FRAME = true"))
const http = spawn('python3', ['-m', 'http.server', '4300'], { cwd: `${ROOT}site`, stdio: 'ignore' })
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--remote-debugging-port=9333', `--user-data-dir=${WORK}/chrome`, '--window-size=1600,1000', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
await sleep(2500)
const targets = await (await fetch('http://127.0.0.1:9333/json')).json()
const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl)
await new Promise((r) => ws.on('open', r))
let id = 0
const pending = new Map()
ws.on('message', (m) => { const d = JSON.parse(m); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id) } })
const cdp = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
const evaluate = async (expr) => (await cdp('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value

await cdp('Page.navigate', { url: 'http://localhost:4300/frame.html' })
for (let i = 0; i < 50 && !(await evaluate('window.FD_ready && FD_ready()')); i++) await sleep(200)
await cdp('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false })
await sleep(300)
console.log('viewport', await evaluate('JSON.stringify({w: innerWidth, html: document.documentElement.clientWidth, body: getComputedStyle(document.body).width, disp: getComputedStyle(document.body).display, htmlDisp: getComputedStyle(document.documentElement).display, cls: document.documentElement.className, parentOfBody: document.body.parentElement.tagName, firstEl: document.body.firstElementChild.tagName})'))
if (process.env.PROBE) { await evaluate(`FD_frame('Napa', 6)`); await sleep(800); const { result } = await cdp('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(`${WORK}/probe.png`, Buffer.from(result.data, 'base64')); ws.close(); chrome.kill(); http.kill(); process.exit(0) }

let n = 0
const segs = []
async function shot() {
  await sleep(700)
  const { result } = await cdp('Page.captureScreenshot', { format: 'png' })
  const f = `${WORK}/f${String(++n).padStart(3, '0')}.png`
  fs.writeFileSync(f, Buffer.from(result.data, 'base64'))
  return f
}
function voice(text, role) {
  const f = `${WORK}/a${String(n).padStart(3, '0')}.aiff`
  execFileSync('say', ['-v', VOICE[role] || 'Samantha', '-r', RATE, '-o', f, text])
  return f
}
async function segment(setup, text, role, pad = 0.35) {
  await evaluate(setup)
  const img = await shot()
  const aud = voice(text, role)
  segs.push({ img, aud, pad })
}

const host = (t) => t
// Intro over the closed door
await segment(`FD_frame('nobody', 0)`, host("Shoppers now send A.I. agents to shop for them, and some of those visitors are bots. Front Desk is a store's own A.I. team, built on ZooWork and connected through Band."), 'host', 0.6)
for (const [name, others, lead] of [['Napa', [], 'First, a real customer.'], ['Deal Hunter', ['Napa'], 'Now, a bad bot.']]) {
  await segment(`FD_frame('${name}', 0, ${JSON.stringify(others)})`, lead, 'host', 0.3)
  const lines = await evaluate(`FD_lines('${name}')`)
  // Keep the video under 3 minutes: the customer scene ends at the order; the bot's cart isn't the point of its scene.
  const end = name === 'Napa' ? lines.findIndex((l) => /^Order confirmed/i.test(l.say)) + 1 || lines.length : lines.length
  for (let k = 1; k <= end; k++) {
    if (name !== 'Napa' && /^Our stylist put/i.test(lines[k - 1].say)) continue
    await segment(`FD_frame('${name}', ${k}, ${JSON.stringify(others)})`, lines[k - 1].say, lines[k - 1].role)
  }
}
await segment(`FD_frame('Deal Hunter', 999, ['Napa'])`, host('Real shoppers get served in under a minute. Bad bots get caught, with reasons anyone can read, and every conversation is saved in Band. Front Desk: every shopper agent gets a welcome. Not every one gets in.'), 'host', 1.2)

ws.close(); chrome.kill(); http.kill()

// Stitch: each frame held for its line's audio plus a short pause
const list = []
for (const [i, s] of segs.entries()) {
  const out = `${WORK}/s${String(i).padStart(3, '0')}.mp4`
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-loop', '1', '-framerate', '25', '-i', s.img, '-i', s.aud,
    '-filter_complex', `[1:a]apad=pad_dur=${s.pad},aresample=44100[a]`, '-map', '0:v', '-map', '[a]',
    '-c:v', 'libx264', '-tune', 'stillimage', '-pix_fmt', 'yuv420p', '-r', '25', '-c:a', 'aac', '-b:a', '160k', '-ac', '2', '-shortest', out])
  list.push(`file '${out}'`)
}
fs.writeFileSync(`${WORK}/list.txt`, list.join('\n'))
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', `${WORK}/list.txt`, '-c', 'copy', '-movflags', '+faststart', OUT])
const dur = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', OUT]).toString().trim()
console.log(`wrote ${OUT} (${Math.round(dur)}s, ${segs.length} segments)`)
