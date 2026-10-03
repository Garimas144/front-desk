// Thin wrapper around ZooWork Managed Agents: one hosted Agent per role, one Session per Band room.
import fs from 'node:fs'
import { createZooworkClient, assistantText, isRunFinished, runOutcome } from '@zoowork-ai/sdk'

const STATE = new URL('../.state/zoowork.json', import.meta.url)
const enabled = !!process.env.ZOOWORK_API_KEY
const zc = enabled ? createZooworkClient() : null

let state = { model: null, agents: {} }
try { state = JSON.parse(fs.readFileSync(STATE)) } catch {}
const save = () => {
  fs.mkdirSync(new URL('../.state/', import.meta.url), { recursive: true })
  fs.writeFileSync(STATE, JSON.stringify(state, null, 2))
}

const sessions = new Map() // `${role}:${roomId}` -> { sessionId, cursor }
const ready = new Map() // role -> Promise<agentId>

export const zooworkEnabled = () => enabled

async function pickModel() {
  if (state.model) return state.model
  const models = await zc.listModels()
  const row = models.find((r) => r.selectable !== false && r.default_for?.includes('model'))
  if (!row) throw new Error('No selectable default ZooWork model')
  state.model = row.model
  save()
  return state.model
}

// Create (once) and start the hosted Agent for a role. Agents are created serially, as the docs require.
let createChain = Promise.resolve()
export function ensureAgent(role, persona) {
  if (!enabled) return Promise.resolve(null)
  if (ready.has(role)) return ready.get(role)
  const p = (createChain = createChain.then(async () => {
    let id = state.agents[role]
    if (!id) {
      const model = await pickModel()
      const created = await zc.createAgent(
        {
          resource: {
            name: `marlow-${role}`,
            model: { primary: model },
            persona: { docs: [{ name: 'ROLE.md', content: persona }] },
            include_global_skills: false,
            labels: { app: 'front-desk', role },
          },
        },
        `front-desk-${role}-v1`,
      )
      id = created.agent_id
      state.agents[role] = id
      save()
    }
    await zc.startAgent(id)
    await zc.waitUntilRunning(id, { timeoutMs: 60_000 })
    return id
  }))
  ready.set(role, p)
  p.catch(() => ready.delete(role))
  return p
}

// Ask a role's hosted Agent one question inside the Session for this room. Returns text, or null on failure/timeout.
export async function ask(role, roomId, prompt, { timeoutMs = 20_000 } = {}) {
  if (!enabled) return null
  const agentId = await ready.get(role)?.catch(() => null)
  if (!agentId) return null
  const key = `${role}:${roomId}`
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), timeoutMs)
  try {
    let s = sessions.get(key)
    if (!s) {
      const rec = await zc.createSession(agentId, {
        initial_events: [{ type: 'user.message', content: prompt }],
        metadata: { room: roomId, role },
      })
      s = { sessionId: rec.session_id, cursor: undefined }
      sessions.set(key, s)
    } else {
      await zc.postEvents(agentId, s.sessionId, [
        { type: 'user.message', content: prompt, idempotency_key: `${key}:${Date.now()}` },
      ])
    }
    let text = ''
    while (!ac.signal.aborted) {
      let finished = false
      for await (const ev of zc.streamEvents(agentId, s.sessionId, { ...(s.cursor ? { cursor: s.cursor } : {}), signal: ac.signal })) {
        s.cursor = ev.cursor ?? s.cursor
        text += assistantText(ev)
        if (isRunFinished(ev)) {
          finished = true
          if (runOutcome(ev) !== 'succeeded') { console.warn(`[zoowork] ${role} run ${runOutcome(ev)}`); return null }
          break
        }
      }
      if (finished) return text.trim() || null
    }
    console.warn(`[zoowork] ${role} timed out after ${timeoutMs}ms`)
    return null
  } catch (err) {
    console.warn(`[zoowork] ${role} ask failed:`, err?.status ?? '', err?.message)
    return null
  } finally {
    clearTimeout(timer)
  }
}

// Pull the first JSON object out of a model reply.
export function parseJson(text) {
  if (!text) return null
  const m = text.match(/\{[\s\S]*\}/)
  if (!m) return null
  try { return JSON.parse(m[0]) } catch { return null }
}
