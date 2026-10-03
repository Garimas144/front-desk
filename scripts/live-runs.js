// Live acceptance loop against running merchant (:4000) + shopper (:4001) processes on Band.
// Each round: legit (auto-approve as owner) then bot. Checks: legit checked out, bot blocked with reasons.
const N = Number(process.argv[2] || 5)
const api = (p, m = 'GET') => fetch('http://localhost:4000' + p, { method: m }).then((r) => r.json())
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function waitFor(pred, ms) { const t = Date.now(); while (Date.now() - t < ms) { const s = await api('/api/state'); const v = pred(s); if (v) return v; await sleep(1000) } return null }
let pass = 0
for (let i = 1; i <= N; i++) {
  await api('/api/reset', 'POST')
  let t = Date.now()
  await api('/api/run/legit', 'POST')
  const pending = await waitFor((s) => s.visits.find((v) => v.approval?.status === 'pending'), 120000)
  if (pending) await api(`/api/approve/${pending.roomId}`, 'POST')
  const legit = await waitFor((s) => s.visits.find((v) => v.order), 60000)
  const lt = (Date.now() - t) / 1000
  await sleep(6000)
  t = Date.now()
  await api('/api/run/bot', 'POST')
  const bot = await waitFor((s) => s.visits.find((v) => v.status === 'blocked'), 180000)
  const bt = (Date.now() - t) / 1000
  const ok = !!legit && !!bot && bot.trust.reasons.length > 0
  if (ok) pass++
  console.log(`round ${i}: legit ${legit ? 'checked out $' + legit.order.total : 'FAIL'} (${lt.toFixed(0)}s) | bot ${bot ? 'blocked: ' + bot.trust.history.map((h) => h.verdict[0]).join('') : 'FAIL'} (${bt.toFixed(0)}s)`)
  await sleep(8000) // let the bot script finish its rejected attempts
}
console.log(`${pass}/${N} rounds passed`)
