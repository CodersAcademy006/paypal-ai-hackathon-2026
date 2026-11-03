# AI Shopping Agent — PayPal AI Hackathon 2026

Chat with an agent about what you need. It builds a cart from a small catalog, then checks out
through a real PayPal sandbox order (create → approve → capture). Agentic commerce, end to end.

## Why this build

- **PayPal integration is central**, not decorative: the agent never touches money directly —
  every checkout goes through PayPal's own Orders v2 API (`create` → buyer approves via the
  PayPal button → `capture`), server-side, with the total computed from the catalog so the
  client can never submit a tampered price.
- **AI is the actual interface**, not a chatbot bolted on afterward: there is no manual
  "add to cart" button. The only way items enter the cart is the agent deciding to put them
  there, via a forced tool call (`update_cart`) so its output is always a real cart object,
  never free text that happens to look like one.
- **Zero paid APIs.** The AI runs locally via [Ollama](https://ollama.com) (`llama3.2:3b`,
  tool-calling capable) — no Anthropic/OpenAI key, no billing risk. PayPal's own sandbox is
  free by design. Total cost to run or judge this project: $0.

## Setup (for judges / local run)

1. **Node 20.6+** (uses `node --env-file`, no `dotenv` dependency). Zero npm dependencies —
   nothing to `npm install`.
2. **Ollama** (free, local):
   ```
   brew install ollama        # or see ollama.com/download
   brew services start ollama
   ollama pull llama3.2:3b
   ```
3. **PayPal sandbox app** (free): log into https://developer.paypal.com → Dashboard → Apps &
   Credentials → Sandbox → Create App. Copy the Client ID and Secret.
4. Copy `.env.example` to `.env` and fill in `PAYPAL_CLIENT_ID` / `PAYPAL_CLIENT_SECRET`.
5. `npm start` (just runs `node --env-file=.env server.js`), open http://localhost:3000.
6. To actually pay: PayPal sandbox gives you a test buyer account automatically under
   Sandbox → Accounts — log into the PayPal popup with that test account, not a real one.

## How it works

```
browser (chat + cart UI)
   │  POST /api/chat {history, cart}
   ▼
server.js ── lib/agent.js ── Ollama (localhost:11434), forced "update_cart" tool call
   │                          returns {reply, cart[{id,qty}], checkout_ready}
   │  enrich cart ids against lib/catalog.js (price is never client-trusted)
   ▼
browser renders cart + PayPal Smart Button
   │  PayPal button → POST /api/order/create (server computes total from catalog)
   ▼
lib/paypal.js ── PayPal Orders v2 REST (sandbox), create → buyer approves → POST .../capture
```

- `lib/catalog.js` — fixed 10-item catalog, source of truth for prices.
- `lib/agent.js` — talks to Ollama, forces a structured `update_cart` tool call so the model's
  output is always a parseable cart, never prose. Defensively coerces the odd stringified field
  a 3B model occasionally emits.
- `lib/paypal.js` — thin wrapper over PayPal's REST API (`fetch`, no SDK dependency) for
  OAuth client-credentials, order create, and capture.
- `server.js` — zero-dependency `node:http` server: static files + 4 JSON routes.
- `public/` — vanilla HTML/CSS/JS chat UI. One decorative touch: a small hand-jittered p5.js
  stroke under the header (`flourish.js`), not load-bearing, fails silently if it can't load.

## Swapping the model

`lib/agent.js` reads `OLLAMA_MODEL` (default `llama3.2:3b`) and `OLLAMA_HOST`
(default `http://localhost:11434`) from the environment — swap to a bigger local model
(`qwen2.5:7b` tested well for instruction-following) or point `OLLAMA_HOST` at any
OpenAI/Ollama-compatible endpoint without touching code.

## Judging criteria fit

| Criterion | How this build addresses it |
|---|---|
| Technological Implementation | Real PayPal Orders v2 lifecycle (create/approve/capture), forced tool-use for reliable AI↔cart structure, server-side price trust boundary |
| Design | Single coherent flow: chat → cart → pay, no dead-end screens, cart updates live as the agent reasons |
| Potential Impact | Agentic commerce is PayPal's own named prize category — this is the direct, minimal expression of "let an agent shop for you and pay" |
| Innovation/Idea | No manual cart controls at all — the agent *is* the only path to checkout, forcing the AI integration to be real rather than cosmetic |
| Presentation | Demo video walks one conversation from request → cart → PayPal capture in under 3 minutes |

## Status

Backend fully wired and tested end-to-end against a live local Ollama instance (multi-turn
cart building, checkout-confirmation detection, server-side total calculation all verified
working 2026-11-04). **Not yet tested against real PayPal sandbox credentials** — waiting on
a developer.paypal.com account. Demo video and Devpost submission text not yet written.
