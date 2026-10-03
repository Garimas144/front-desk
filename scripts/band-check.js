import 'dotenv/config'
import { BandClient } from '@band-ai/rest-client'
for (const r of ['FRONTDESK','CATALOG','TRUST','SHOPPER_LEGIT','SHOPPER_BOT']) {
  try { const me = await new BandClient({ apiKey: process.env[`BAND_${r}_KEY`] }).agentApiIdentity.getAgentMe(); const d = me.data || me
    console.log(r, 'OK', d.id === process.env[`BAND_${r}_ID`] ? 'id-match' : 'ID MISMATCH '+d.id, d.handle, d.owner_handle || d.owner?.handle || '')
  } catch (e) { console.log(r, 'ERR', e.statusCode || e.status, e.message?.slice(0,200)) }
}
