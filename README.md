# Front Desk

**A merchant's agent team for shopper agents.** Shoppers now show up as AI agents that browse, compare, and check out
for their humans. Front Desk is the team on the merchant's side that greets them, turns legitimate ones into sales,
and stops bad ones (price scrapers, catalog extractors, prompt injectors) before they do damage.

The merchant is **Marlow & Pine**, a fictional San Francisco womenswear boutique (40-item synthetic catalog, test-mode checkout).

## How it works

```
 Shopper owner (Band account B)                 Merchant owner (Band account A)
 ┌──────────────────────┐   contact request    ┌───────────────────────────────────────────┐
 │ @shopper-legit (LLM) │ ───────────────────▶ │ @frontdesk  approves, opens a Band room    │
 │ @shopper-bot (script)│ ◀── approved ─────── │   │ @mention            │ @mention         │
 └──────────────────────┘                      │   ▼                     ▼                  │
            ▲  room messages via @mention      │ @trust (rules +       @catalog (search +   │
            └──────────────────────────────────│  ZooWork judge)        ZooWork stylist)    │
                                               │ owner gate: dashboard / Band app           │
                                               └───────────────────────────────────────────┘
```

- **Band** carries everything: registry handles, a contact request both sides must approve, one room per visit,
  and @mention routing between `@frontdesk`, `@trust`, and `@catalog`. Work only moves when a mention arrives, so
  removing Band breaks coordination. The room log is the audit trail.
- **ZooWork** hosts the merchant agents' reasoning: a front desk classifier, the catalog stylist that picks the
  outfit and writes a reason per item, and the trust judge. Each runs as a ZooWork Agent with one Session per room.
- **@trust** screens every visitor message and requested action. Deterministic rules set the floor, and the
  ZooWork judge can raise a verdict but never lower it. Every verdict comes with plain-English reasons.
  - Intent vs. actions mismatch (headline check): the stated need compared with what is actually being priced
  - Extraction pattern: breadth of price lookups with no cart activity
  - Injection: messages claiming system, admin, or merchant authority
  - Policy: discounts over 10%, carts over $400, bulk catalog requests
  - `allow` continues; `limit` stops sharing prices; `block` ends the session, removes the visitor, and revokes the contact
- **Owner gate**: carts over $400 or discounts over 10% wait for the owner (dashboard button, or "approve" from the Band app).

## Run

```bash
npm install
cp .env.example .env     # fill in keys; TRANSPORT=local runs without any keys
npm start                # merchant + dashboard on http://localhost:4000
npm run shoppers         # (TRANSPORT=band) shopper side as its own process / Band owner
npm run smoke            # headless end-to-end check on the local transport
```

Policy lives in `data/policy.json`, catalog in `data/catalog.json`.

## Notes
- ZooData has no public provisioning API, so the catalog is seeded.
- ZooWork Channels (WhatsApp/iMessage) are not available to Project API keys, so the owner gate uses the
  dashboard and the Band app.
- No real payments or customer data. Checkout is test mode only.
