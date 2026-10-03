// Dashboard state. The merchant process records every room message it sends or receives here.
import { EventEmitter } from 'node:events'

export const hub = new EventEmitter()
hub.setMaxListeners(50)

export const visits = new Map() // roomId -> visit view
export let currentRoom = null

export function openVisit(roomId, shopper) {
  const v = {
    roomId, shopper, openedAt: Date.now(), status: 'open',
    feed: [], trust: { verdict: 'allow', risk: 0, reasons: ['No messages screened yet.'], history: [] },
    cart: null, approval: null, order: null, contact: 'approved',
  }
  visits.set(roomId, v)
  currentRoom = roomId
  emit()
  return v
}

export function feed(roomId, entry) {
  const v = visits.get(roomId)
  if (!v) return
  v.feed.push({ at: Date.now(), ...entry })
  emit()
}

export function update(roomId, patch) {
  const v = visits.get(roomId)
  if (!v) return
  Object.assign(v, patch)
  emit()
}

export function snapshot() {
  return {
    current: currentRoom,
    visits: [...visits.values()].sort((a, b) => b.openedAt - a.openedAt).slice(0, 8),
  }
}

export function reset() {
  visits.clear()
  currentRoom = null
  emit()
}

let pending = null
function emit() {
  if (pending) return
  pending = setTimeout(() => { pending = null; hub.emit('state', snapshot()) }, 50)
}
