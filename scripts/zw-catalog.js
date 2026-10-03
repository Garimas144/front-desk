import 'dotenv/config'
import { ensureAgent, ask } from '../src/zoowork.js'
import { candidates, parseNeed } from '../src/catalog.js'
await ensureAgent('catalog', 'You are a stylist. Answer only JSON.')
const text = 'My customer needs an outfit for a wedding in Napa next month: size M, shoe size 8, earth tones, budget up to $550. A dress, shoes, and a light layer for the evening.'
const need = parseNeed(text); const c = candidates(need)
const t = Date.now()
const r = await ask('catalog', 'cat-test-' + Date.now(), `Shopper need: ${text}\nPick a dress, shoes, a light layer. Answer ONLY JSON {"items":[{"id":"MP-1xx","reason":"<15 words"}]}\nCANDIDATES:\n${c.map(p=>`${p.id} | ${p.name} | ${p.category} | $${p.price}`).join('\n')}`, { timeoutMs: 60000 })
console.log((Date.now()-t)/1000, 's', r); process.exit(0)
