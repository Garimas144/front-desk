// In-memory stand-in for Band with the same rules: mention-only delivery, bilateral contacts,
// rooms you can only join via contact (or same owner). Used for offline development and as a demo fallback.
import { EventEmitter } from 'node:events'

const ids = { n: 0 }
const nextId = (p) => `${p}_${++ids.n}`

export function createLocalTransport() {
  const identities = new Map() // id -> endpoint internals
  const byHandle = new Map()
  const rooms = new Map() // roomId -> { participants:Set<id>, log:[] }
  const contacts = new Set() // "idA|idB" sorted
  const requests = new Map() // reqId -> { from, to, message, status }
  const pair = (a, b) => [a, b].sort().join('|')

  function connect({ name, handle, owner }) {
    const id = nextId('agt')
    const ev = new EventEmitter()
    const self = { id, name, handle, owner, ev }
    identities.set(id, self)
    byHandle.set(handle, self)

    const canReach = (other) => other.owner === owner || contacts.has(pair(id, other.id))

    return {
      id, name, handle,
      onMessage: (cb) => ev.on('message', cb),
      onContactRequest: (cb) => ev.on('contact_request', cb),
      onContactAdded: (cb) => ev.on('contact_added', cb),
      onContactRemoved: (cb) => ev.on('contact_removed', cb),
      onRoomAdded: (cb) => ev.on('room_added', cb),
      onRoomRemoved: (cb) => ev.on('room_removed', cb),
      async start() {},
      async stop() {},

      async send(roomId, content, mentionHandles = []) {
        const room = rooms.get(roomId)
        if (!room || !room.participants.has(id)) throw new Error('Not a participant in this room (access revoked)')
        const targets = mentionHandles.map((h) => byHandle.get(h)).filter(Boolean)
        if (!targets.length) throw new Error('Band requires an @mention to route a message')
        const text = `${targets.map((t) => `@${t.name}`).join(' ')} ${content}`
        const msg = { id: nextId('msg'), roomId, content: text, from: { id, name, handle }, at: Date.now() }
        room.log.push(msg)
        for (const t of targets) if (t.id !== id && room.participants.has(t.id)) setImmediate(() => t.ev.emit('message', roomId, msg))
        return msg
      },

      async createRoom() {
        const roomId = nextId('room')
        rooms.set(roomId, { participants: new Set([id]), log: [] })
        return roomId
      },

      async addParticipant(roomId, otherHandle) {
        const other = byHandle.get(otherHandle)
        if (!other) throw new Error(`Unknown handle ${otherHandle}`)
        if (!canReach(other)) throw new Error(`No contact with ${otherHandle}; cannot add to room`)
        rooms.get(roomId).participants.add(other.id)
        setImmediate(() => other.ev.emit('room_added', roomId))
      },

      async removeParticipant(roomId, otherHandle) {
        const other = byHandle.get(otherHandle)
        rooms.get(roomId)?.participants.delete(other.id)
        setImmediate(() => other.ev.emit('room_removed', roomId))
      },

      async requestContact(toHandle, message) {
        const to = byHandle.get(toHandle)
        if (!to) throw new Error(`Handle ${toHandle} not found in registry`)
        const reqId = nextId('creq')
        requests.set(reqId, { from: self, to, message, status: 'pending' })
        setImmediate(() => to.ev.emit('contact_request', { id: reqId, fromHandle: handle, fromName: name, message }))
        return { status: 'pending', id: reqId }
      },

      async respondContact(req, action) {
        const r = requests.get(req.id)
        if (!r || r.to.id !== id) throw new Error('No such pending request')
        r.status = action === 'approve' ? 'approved' : 'rejected'
        if (r.status === 'approved') {
          contacts.add(pair(r.from.id, id))
          setImmediate(() => {
            r.from.ev.emit('contact_added', { handle, name })
            ev.emit('contact_added', { handle: r.from.handle, name: r.from.name })
          })
        }
      },

      async removeContact(otherHandle) {
        const other = byHandle.get(otherHandle)
        if (!other) return
        contacts.delete(pair(id, other.id))
        setImmediate(() => other.ev.emit('contact_removed', { handle }))
      },
    }
  }

  return { kind: 'local', connect }
}
