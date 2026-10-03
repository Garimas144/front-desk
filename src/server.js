// Merchant server + dashboard. In TRANSPORT=local mode the shopper side runs in-process for development.
import 'dotenv/config'
process.on('unhandledRejection', (e) => console.error('[unhandled]', e?.message || e))
import express from 'express'
import { fileURLToPath } from 'node:url'
import { startMerchant } from './merchant.js'
import { createShoppers } from './shoppers.js'
import * as dash from './hub.js'
import { zooworkEnabled } from './zoowork.js'

const PORT = Number(process.env.PORT || 4000)
const mode = process.env.TRANSPORT || 'local'
const frontdeskHandle = process.env.BAND_FRONTDESK_HANDLE || '@marlow/front-desk'
// The owner is a real Band user, so only invite them on the live transport.
const ownerHandle = mode === 'band' ? process.env.BAND_OWNER_HANDLE || null : null

let transport
if (mode === 'band') transport = (await import('./transport/band.js')).createBandTransport()
else transport = (await import('./transport/local.js')).createLocalTransport()

const merchant = await startMerchant({ transport, frontdeskHandle, ownerHandle })

// Shopper control: in local mode in-process; in band mode the shopper process listens on SHOPPER_PORT.
let shoppers = null
if (mode === 'local') {
  shoppers = createShoppers({ transport, frontdeskHandle })
  await shoppers.start()
}
const SHOPPER_URL = process.env.SHOPPER_URL || 'http://localhost:4001'

const app = express()
app.use(express.json())
app.use(express.static(fileURLToPath(new URL('../public', import.meta.url))))

const meta = () => ({ mode, zoowork: zooworkEnabled(), merchant: merchant.handles })
app.get('/api/state', (_req, res) => res.json({ ...dash.snapshot(), ...meta() }))
app.get('/api/events', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
  res.flushHeaders()
  const send = (s) => res.write(`data: ${JSON.stringify({ ...s, ...meta() })}\n\n`)
  send(dash.snapshot())
  dash.hub.on('state', send)
  const ka = setInterval(() => res.write(': ka\n\n'), 15000)
  req.on('close', () => { dash.hub.off('state', send); clearInterval(ka) })
})
app.post('/api/approve/:room', async (req, res) => res.json({ ok: await merchant.approve(req.params.room) }))
app.post('/api/deny/:room', async (req, res) => res.json({ ok: await merchant.deny(req.params.room) }))
app.post('/api/reset', (_req, res) => { dash.reset(); res.json({ ok: true }) })
app.post('/api/run/:who', async (req, res) => {
  const who = req.params.who
  if (!['legit', 'bot'].includes(who)) return res.status(400).end()
  if (shoppers) {
    ;(who === 'legit' ? shoppers.runLegit() : shoppers.runBot()).catch((e) => console.error(e))
    return res.json({ ok: true })
  }
  try {
    const r = await fetch(`${SHOPPER_URL}/run/${who}`, { method: 'POST' })
    res.json({ ok: r.ok })
  } catch (e) {
    res.status(502).json({ ok: false, error: `Shopper process not reachable at ${SHOPPER_URL}` })
  }
})

app.listen(PORT, () => console.log(`Front Desk dashboard on http://localhost:${PORT} (transport=${mode}, zoowork=${zooworkEnabled()})`))
  .on('error', (e) => {
    // A second copy must not keep its Band agents online: it would steal room messages from the first.
    console.error(`Port ${PORT} is busy (${e.code}). Another Front Desk is already running. Stop it first (Ctrl+C in its window).`)
    process.exit(1)
  })
