// Builds the static replay site for Vercel: the live dashboard + a recorded run (site/replay.json).
//   node scripts/build-site.js --from http://localhost:4000   capture the state of a running live server
//   node scripts/build-site.js                                rebuild from the existing site/replay.json
import fs from 'node:fs'
const out = new URL('../site/', import.meta.url)
fs.mkdirSync(out, { recursive: true })
const i = process.argv.indexOf('--from')
if (i > 0) {
  const s = await (await fetch(process.argv[i + 1] + '/api/state')).json()
  const keep = s.visits.filter((v) => v.feed.length > 3)
  const pick = (re) => keep.filter((v) => re.test(v.shopper.name)).find((v) => v.order || v.status === 'blocked') || keep.find((v) => re.test(v.shopper.name))
  const visits = [pick(/Napa/i), pick(/Deal Hunter/i)].filter(Boolean)
  fs.writeFileSync(new URL('replay.json', out), JSON.stringify({ recordedAt: new Date().toISOString(), source: s.mode, merchant: s.merchant, visits }, null, 1))
  console.log(`captured ${visits.map((v) => `${v.shopper.name} (${v.status}, ${v.feed.length} messages)`).join(', ')}`)
}
const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8')
  .replace('<script>\n', "<script>\nwindow.FD_REPLAY = 'replay.json'\n")
fs.writeFileSync(new URL('index.html', out), html)
console.log('site/ ready')
