// Real Band transport: each identity is a Band Remote Agent. Receives over the SDK's WebSocket runtime,
// sends and manages rooms/contacts over the typed Agent REST API.
import { Agent, GenericAdapter } from '@band-ai/sdk'
import { BandClient } from '@band-ai/rest-client'
import { EventEmitter } from 'node:events'

const ENV = {
  frontdesk: ['BAND_FRONTDESK_ID', 'BAND_FRONTDESK_KEY'],
  catalog: ['BAND_CATALOG_ID', 'BAND_CATALOG_KEY'],
  trust: ['BAND_TRUST_ID', 'BAND_TRUST_KEY'],
  'shopper-legit': ['BAND_SHOPPER_LEGIT_ID', 'BAND_SHOPPER_LEGIT_KEY'],
  'shopper-bot': ['BAND_SHOPPER_BOT_ID', 'BAND_SHOPPER_BOT_KEY'],
}

// id <-> handle registry shared by all identities in this process
const handleById = new Map()
const idByHandle = new Map()
const norm = (h) => (h ? String(h).replace(/^@/, '') : h)
const remember = (id, handle) => { if (id && handle) { handleById.set(id, norm(handle)); idByHandle.set(norm(handle), id) } }

export function createBandTransport() {
  function connect({ role, name, handle }) {
    const [idVar, keyVar] = ENV[role]
    const agentId = process.env[idVar]
    const apiKey = process.env[keyVar]
    if (!agentId || !apiKey) throw new Error(`Missing ${idVar}/${keyVar} in .env`)
    const ev = new EventEmitter()
    const rest = new BandClient({ apiKey })
    const self = { id: agentId, name, handle: norm(handle) }
    remember(agentId, handle)

    const adapter = new GenericAdapter(async ({ message, roomId }) => {
      const from = { id: message.senderId, name: message.senderName, type: message.senderType, handle: handleById.get(message.senderId) || null }
      ev.emit('message', roomId || message.roomId, { id: message.id, roomId, content: message.content, from, at: Date.now() })
    })

    const agent = Agent.create({
      adapter,
      agentId,
      apiKey,
      agentConfig: { autoSubscribeExistingRooms: true },
      contactConfig: {
        strategy: 'callback',
        onEvent: async (e) => {
          const p = e.payload || {}
          if (e.type === 'contact_request_received') { console.log(`[band] ${name} got contact request`, JSON.stringify(p)); ev.emit('contact_request', { id: p.id, fromHandle: norm(p.from_handle), fromName: p.from_name, message: p.message }) }
          else if (e.type === 'contact_added') { console.log(`[band] ${name} contact added`, JSON.stringify(p)); ev.emit('contact_added', { id: p.id, handle: norm(p.handle), name: p.name }) }
          else if (e.type === 'contact_removed') ev.emit('contact_removed', { id: p.id })
        },
      },
      onParticipantAdded: (roomId, participant) => { remember(participant.id, participant.handle); if (participant.id === agentId) ev.emit('room_added', roomId) },
      onParticipantRemoved: (roomId, pid) => { if (pid === agentId) ev.emit('room_removed', roomId) },
    })

    // Resolve a participant's agent/user id from its handle via the peers registry
    // (contact records have their own ids, which rooms do not accept).
    async function resolveId(h) {
      h = norm(h)
      if (idByHandle.has(h)) return idByHandle.get(h)
      try {
        for (let page = 1; page <= 5; page++) {
          const r = await rest.agentApiPeers.listAgentPeers({ page })
          const rows = r.data || []
          for (const p of rows) remember(p.id, p.handle)
          if (idByHandle.has(h) || rows.length === 0 || page >= (r.metadata?.total_pages || 1)) break
        }
      } catch (e) { console.warn('[band] listPeers', e.message) }
      return idByHandle.get(h)
    }

    const api = {
      id: agentId,
      name,
      onMessage: (cb) => ev.on('message', cb),
      onContactRequest: (cb) => ev.on('contact_request', cb),
      onContactAdded: (cb) => ev.on('contact_added', cb),
      onContactRemoved: (cb) => ev.on('contact_removed', cb),
      onRoomAdded: (cb) => ev.on('room_added', cb),
      onRoomRemoved: (cb) => ev.on('room_removed', cb),
      async start() {
        const me = await rest.agentApiIdentity.getAgentMe()
        const d = me.data || me
        if (d.handle) { self.handle = norm(d.handle); remember(agentId, d.handle) }
        console.log(`[band] ${name} online as ${self.handle}`)
        agent.start().catch((e) => console.error(`[band] ${name} runtime failed`, e))
      },
      async stop() { await agent.stop() },

      async send(roomId, content, mentionHandles = []) {
        const mentions = await Promise.all(
          mentionHandles.map(async (h) => {
            const id = idByHandle.get(norm(h))
            return id ? { id } : { handle: norm(h) }
          }),
        )
        return rest.agentApiMessages.createAgentChatMessage(roomId, { message: { content, mentions } })
      },
      async createRoom(title) {
        const r = await rest.agentApiChats.createAgentChat({ chat: { title: title?.slice(0, 120) } })
        return (r.data || r).id
      },
      async addParticipant(roomId, h, idHint) {
        const id = (await resolveId(h)) || idHint
        if (!id) throw new Error(`Cannot resolve participant id for ${h}`)
        await rest.agentApiParticipants.addAgentChatParticipant(roomId, { participant: { participant_id: id, role: 'member' } })
      },
      async removeParticipant(roomId, h, idHint) {
        const id = (await resolveId(h)) || idHint
        await rest.agentApiParticipants.removeAgentChatParticipant(roomId, id)
      },
      async requestContact(toHandle, message) {
        const r = await rest.agentApiContacts.addAgentContact({ handle: '@' + norm(toHandle), message })
        return r.data || r
      },
      async respondContact(req, action) {
        await rest.agentApiContacts.respondToAgentContactRequest({ action, ...(req.id ? { request_id: req.id } : { handle: req.fromHandle }) })
      },
      async removeContact(h) {
        await rest.agentApiContacts.removeAgentContact({ handle: '@' + norm(h) })
      },
    }
    Object.defineProperty(api, 'handle', { get: () => self.handle, enumerable: true })
    return api
  }
  return { kind: 'band', connect, remember }
}
