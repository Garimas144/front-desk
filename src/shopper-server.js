// Shopper side as its own process (its own Band owner). The dashboard's run buttons call this over HTTP.
import 'dotenv/config'
import express from 'express'
import { createBandTransport } from './transport/band.js'
import { createShoppers } from './shoppers.js'

const frontdeskHandle = process.env.BAND_FRONTDESK_HANDLE
if (!frontdeskHandle) throw new Error('Set BAND_FRONTDESK_HANDLE (the merchant front desk handle, discovered from the Band registry)')
const shoppers = createShoppers({ transport: createBandTransport(), frontdeskHandle })
await shoppers.start()

let busy = false
const app = express()
app.post('/run/:who', (req, res) => {
  if (busy) return res.status(409).json({ ok: false, error: 'a shopper run is in progress' })
  const run = req.params.who === 'legit' ? shoppers.runLegit : req.params.who === 'bot' ? shoppers.runBot : null
  if (!run) return res.status(400).end()
  busy = true
  run().catch((e) => console.error(e)).finally(() => { busy = false })
  res.json({ ok: true })
})
const port = Number(process.env.SHOPPER_PORT || 4001)
app.listen(port, () => console.log(`Shopper agents ready on :${port} (contacting ${frontdeskHandle})`))
