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
const remember = (id, handle) => { if (id && handle) { handleById.set(id, handle); idByHandle.set(handle, id) } }

export function createBandTransport() {
  function connect({ role, name, handle }) {
    const [idVar, keyVar] = ENV[role]
    const agentId = process.env[idVar]
    const apiKey = process.env[keyVar]
    if (!agentId || !apiKey) throw new Error(`Missing ${idVar}/${keyVar} in .env`)
    const ev = new EventEmitter()
    const rest = new BandClient({ apiKey })
    const self = { id: agentId, name, handle }
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
          if (e.type === 'contact_request_received') ev.emit('contact_request', { id: p.id, fromHandle: p.from_handle, fromName: p.from_name, message: p.message })
          else if (e.type === 'contact_added') { remember(p.id, p.handle); ev.emit('contact_added', { id: p.id, handle: p.handle, name: p.name }) }
          else if (e.type === 'contact_removed') ev.emit('contact_removed', { id: p.id })
        },
      },
      onParticipantAdded: (roomId, participant) => { remember(participant.id, participant.handle); if (participant.id === agentId) ev.emit('room_added', roomId) },
      onParticipantRemoved: (roomId, pid) => { if (pid === agentId) ev.emit('room_removed', roomId) },
    })

    // Resolve a contact's participant id from its handle (contact ids and agent ids are different things).
    async function resolveId(h, hint) {
      if (idByHandle.has(h)) return idByHandle.get(h)
      try {
        const res = await rest.agentApiContacts.listAgentContacts({})
        for (const c of res.data || []) remember(c.contact_id || c.id, c.handle)
      } catch (e) { console.warn('[band] listContacts', e.message) }
      return idByHandle.get(h) || hint
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
        if (d.handle) { self.handle = d.handle; remember(agentId, d.handle) }
        console.log(`[band] ${name} online as ${self.handle}`)
        agent.start().catch((e) => console.error(`[band] ${name} runtime failed`, e))
      },
      async stop() { await agent.stop() },

      async send(roomId, content, mentionHandles = []) {
        const mentions = await Promise.all(
          mentionHandles.map(async (h) => {
            const id = idByHandle.get(h)
            return id ? { id } : { handle: h }
          }),
        )
        return rest.agentApiMessages.createAgentChatMessage(roomId, { message: { content, mentions } })
      },
      async createRoom(title) {
        const r = await rest.agentApiChats.createAgentChat({ chat: { title: title?.slice(0, 120) } })
        return (r.data || r).id
      },
      async addParticipant(roomId, h, idHint) {
        const id = idHint || (await resolveId(h))
        if (!id) throw new Error(`Cannot resolve participant id for ${h}`)
        await rest.agentApiParticipants.addAgentChatParticipant(roomId, { participant: { participant_id: id, role: 'member' } })
      },
      async removeParticipant(roomId, h, idHint) {
        const id = idHint || (await resolveId(h))
        await rest.agentApiParticipants.removeAgentChatParticipant(roomId, id)
      },
      async requestContact(toHandle, message) {
        const r = await rest.agentApiContacts.addAgentContact({ handle: toHandle, message })
        return r.data || r
      },
      async respondContact(req, action) {
        await rest.agentApiContacts.respondToAgentContactRequest({ action, ...(req.id ? { request_id: req.id } : { handle: req.fromHandle }) })
      },
      async removeContact(h) {
        await rest.agentApiContacts.removeAgentContact({ handle: h })
      },
    }
    Object.defineProperty(api, 'handle', { get: () => self.handle, enumerable: true })
    return api
  }
  return { kind: 'band', connect, remember }
}
