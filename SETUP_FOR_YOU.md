# Front Desk: what I need from you (do these now, in parallel with my build)

I can't create accounts or paste API keys for you. Everything else I'm building now,
with a local in-memory transport so the demo works end to end before your keys arrive.

Put every key in `front-desk/.env` (I created `.env.example` with the exact names). Don't paste keys in chat.

## 1. ZooWork (5 min)
- Create a Project API key at https://platform.zoowork.ai (initialize org billing if asked).
- `.env`: `ZOOWORK_API_KEY=zwp_live_...`

## 2. Band: TWO separate accounts (15 min)
The cross-company boundary needs two different Band *owners*. Agents under the same owner see
each other automatically and never need a contact request.

**Account A: the merchant** (your main email), at https://app.band.ai/agents
Register 3 **Remote Agents** with these names (Band builds handles from them):
- `Marlow Front Desk`  → env `BAND_FRONTDESK_ID`, `BAND_FRONTDESK_KEY`
- `Marlow Catalog`     → env `BAND_CATALOG_ID`, `BAND_CATALOG_KEY`
- `Marlow Trust`       → env `BAND_TRUST_ID`, `BAND_TRUST_KEY`

**Account B: the shoppers** (a second email, e.g. a `+shopper` alias), register 2 Remote Agents:
- `Napa Wedding Shopper` → env `BAND_SHOPPER_LEGIT_ID`, `BAND_SHOPPER_LEGIT_KEY`
- `Deal Hunter Scout`    → env `BAND_SHOPPER_BOT_ID`, `BAND_SHOPPER_BOT_KEY`

(Band advises against names like "Bot" or "Agent", hence these names.)
The API key is shown once: copy it immediately. The Agent UUID is in each agent's settings.

Then tell me the merchant front desk **handle** (looks like `@yourname/marlow-front-desk`):
`.env`: `BAND_FRONTDESK_HANDLE=@.../marlow-front-desk`

Optional, for the "owner's phone buzzes" moment: install the Band app on your phone, signed in
as Account A. You'll be added to each room as the owner and can approve from there.

## 3. Entire (5 min)
Install the Entire CLI from entire.io and run `entire enable` in `front-desk/` (it hooks this
Claude Code session so commits carry session data). Tell me if it asks for anything.

## 4. Optional
- `npx skills add SerendipityOneInc/zoowork-sdk-skills` (I already read the same docs from the repo).

## Known constraints (from the docs, not guesses)
- ZooData has no public provisioning API, so the catalog is a 40-item seed file.
- ZooWork Channels (WhatsApp/iMessage) return 404 for Project API keys, so the owner gate is the
  dashboard button plus approval from the Band app.
