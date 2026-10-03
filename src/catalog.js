import fs from 'node:fs'

export const catalog = JSON.parse(fs.readFileSync(new URL('../data/catalog.json', import.meta.url)))
export const policy = JSON.parse(fs.readFileSync(new URL('../data/policy.json', import.meta.url)))

const norm = (s) => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ')

// Find catalog items a message names explicitly (by full product name or a strong partial).
export function findMentionedProducts(text) {
  const t = norm(text)
  return catalog.filter((p) => {
    const n = norm(p.name)
    if (t.includes(n)) return true
    const words = n.split(' ').filter((w) => w.length > 3)
    return words.length >= 2 && words.filter((w) => t.includes(w)).length >= Math.min(3, words.length)
  })
}

export function parseNeed(text) {
  const t = text.toLowerCase()
  const size = (t.match(/\bsize\s+(xs|s|m|l|xl)\b/) || [])[1]?.toUpperCase()
  const shoe = (t.match(/shoe size\s+(\d{1,2})/) || [])[1]
  const budget = Number((t.match(/(?:under|up to|budget(?: of| around| is)?|max(?:imum)?)\s*\$?\s*(\d{2,5})/) || [])[1]) || null
  const earth = /earth|terracotta|rust|olive|sage|neutral/.test(t)
  const occasion = /wedding/.test(t) ? 'wedding guest' : /garden/.test(t) ? 'garden party' : /cocktail/.test(t) ? 'cocktail' : null
  return { size, shoe, budget, earth, occasion }
}

function score(p, need) {
  let s = 0
  if (need.occasion && p.tags.includes(need.occasion)) s += 5
  if (need.earth && p.tags.includes('earth tone')) s += 4
  if (p.tags.includes('vineyard') || p.tags.includes('vineyard-friendly')) s += 1
  if (p.tags.includes('evening') || p.tags.includes('layer')) s += 1
  if (p.stock <= 0) s -= 100
  return s
}

const fitsSize = (p, need) =>
  p.sizes.includes('One Size') ||
  (p.category === 'shoes' ? !need.shoe || p.sizes.includes(need.shoe) : !need.size || p.sizes.includes(need.size))

// Candidates handed to the catalog LLM, so it can only choose from real, in-stock, in-size items.
export function candidates(need, limit = 14) {
  return catalog
    .filter((p) => p.stock > 0 && fitsSize(p, need))
    .map((p) => ({ p, s: score(p, need) }))
    .sort((a, b) => b.s - a.s || a.p.price - b.p.price)
    .slice(0, limit)
    .map(({ p }) => p)
}

// Deterministic cart: one hero piece per slot, within budget. Used as the fallback and to validate LLM picks.
// Dress and shoes must suit the occasion; if the budget is tight, a cheaper dress is chosen so shoes still fit.
export function buildCartDeterministic(need) {
  const pool = candidates(need, 40)
  const suits = (p) => !need.occasion || p.tags.includes(need.occasion) || p.tags.includes('evening') || p.tags.includes('earth tone')
  const budget = need.budget || 600
  const dresses = pool.filter((p) => p.category === 'dresses' && suits(p))
  const shoes = pool.filter((p) => p.category === 'shoes' && suits(p) && !p.tags.includes('sneaker'))
  let dress = null, shoe = null
  for (const d of dresses) {
    const s = shoes.find((x) => d.price + x.price <= budget)
    if (s) { dress = d; shoe = s; break }
  }
  const items = []
  let total = 0
  const add = (p, why) => { items.push({ id: p.id, name: p.name, price: p.price, size: sizeFor(p, need), reason: why }); total += p.price }
  if (dress) add(dress, 'The hero piece: matches the occasion and the palette')
  if (shoe) add(shoe, 'Comfortable heel that works on lawns and terraces')
  for (const [cat, why] of [['outerwear', 'Light layer for the evening chill after sunset'], ['bags', 'Small enough to carry all evening'], ['jewelry', 'Finishing touch in a warm metal']]) {
    const pick = pool.find((p) => p.category === cat && total + p.price <= budget)
    if (pick) add(pick, why)
  }
  return { items, total }
}

export function sizeFor(p, need) {
  if (p.sizes.includes('One Size')) return 'One Size'
  // Never guess a size the visitor did not give us: flag it for the shopper to confirm instead.
  if (p.category === 'shoes') return need.shoe && p.sizes.includes(need.shoe) ? need.shoe : 'size to confirm'
  return need.size && p.sizes.includes(need.size) ? need.size : 'size to confirm'
}

export const byId = (id) => catalog.find((p) => p.id === id)
