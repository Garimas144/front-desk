// Headless end-to-end run on the local transport: legit then bot, prints the room logs and asserts outcomes.
import 'dotenv/config'
import { createLocalTransport } from '../src/transport/local.js'
import { startMerchant } from '../src/merchant.js'
import { createShoppers } from '../src/shoppers.js'
import * as dash from '../src/hub.js'
const transport = createLocalTransport()
const fdh = '@marlow/front-desk'
const m = await startMerchant({ transport, frontdeskHandle: fdh })
const s = createShoppers({ transport, frontdeskHandle: fdh, log: () => {} })
// auto-approve as the owner after 1s, like the dashboard button
setInterval(() => { for (const v of dash.visits.values()) if (v.approval?.status === 'pending') m.deny(v.roomId) }, 1000)
const t0 = Date.now()
await s.runLegit()

await new Promise(r => setTimeout(r, 500))
let fail = 0
for (const v of dash.visits.values()) {
  console.log(`\n=== ${v.shopper.name}  status=${v.status} verdict=${v.trust.verdict} risk=${v.trust.risk} order=${v.order?.id||'-'} cart=$${v.cart?.total||0}`)
  for (const f of v.feed) console.log(`${f.internal?'   ·':''}${f.from}: ${f.text.replace(/\n/g,' | ').slice(0,230)}`)
  console.log('trust history:', v.trust.history?.map(h=>`${h.verdict}/${h.risk}`).join(' → '))
}
const [legit] = dash.snapshot().visits
if (legit.approval?.status !== "denied") { fail++; console.log("FAIL not denied") }

console.log(`\n${fail ? 'FAILED' : 'PASS'} in ${((Date.now()-t0)/1000).toFixed(1)}s`)
process.exit(fail ? 1 : 0)
