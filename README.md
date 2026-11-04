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
- **Zero paid APIs.** The AI runs locally via [Ollama](https://ollama.com) (`qwen2.5:7b`,
  tool-calling capable) — no Anthropic/OpenAI key, no billing risk. PayPal's own sandbox is
  free by design. Total cost to run or judge this project: $0.

## Setup (for judges / local run)

1. **Node 20.6+** (uses `node --env-file`, no `dotenv` dependency). Zero npm dependencies —
   nothing to `npm install`.
2. **Ollama** (free, local):
   ```
   brew install ollama        # or see ollama.com/download
   brew services start ollama
   ollama pull qwen2.5:7b
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
  output is always a parseable cart, never prose. Recovers three malformed shapes seen in
  testing (JSON embedded in prose, `{parameters}`/`{arguments}` envelopes, a bare `{id,qty}`
  with no envelope at all) instead of silently dropping them. Temperature 0 for determinism.
- `lib/paypal.js` — thin wrapper over PayPal's REST API (`fetch`, no SDK dependency) for
  OAuth client-credentials, order create, and capture.
- `server.js` — zero-dependency `node:http` server: static files + 4 JSON routes.
- `public/` — vanilla HTML/CSS/JS chat UI. One decorative touch: a small hand-jittered p5.js
  stroke under the header (`flourish.js`), not load-bearing, fails silently if it can't load.

## Swapping the model

`lib/agent.js` reads `OLLAMA_MODEL` (default `qwen2.5:7b`) and `OLLAMA_HOST`
(default `http://localhost:11434`) from the environment — point at any local model or any
OpenAI/Ollama-compatible endpoint without touching code. `llama3.2:3b` also runs (faster,
smaller) but was measurably less reliable at tracking cart state across turns in testing —
see `scripts/demo_repro_test.js`.

## Known limitation

One specific conversational pattern is unreliable: a bare "yes" right after the agent has
suggested *more than one* item, followed immediately by naming one of them by name. The model
correctly asks "which one?" but the follow-up naming sometimes fails to register (tracked in
`scripts/demo_repro_test.js`, root-caused to the model occasionally emitting a bare `{id, qty}`
tool call with no reply/cart envelope in that exact context — partially mitigated, not fully
fixed). Workaround used in the demo: avoid that exact sequence — either confirm a single
suggested item directly, or use explicit checkout language ("yes checkout") to confirm
everything suggested at once. Both of those patterns tested 100% reliable across 20+ runs.
Per the official rules, judges are not required to run the project themselves and may judge
from the video alone, so the recorded demo uses only the reliable patterns.

## Judging criteria fit

| Criterion | How this build addresses it |
|---|---|
| Technological Implementation | Real PayPal Orders v2 lifecycle (create/approve/capture), forced tool-use for reliable AI↔cart structure, server-side price trust boundary |
| Design | Single coherent flow: chat → cart → pay, no dead-end screens, cart updates live as the agent reasons |
| Potential Impact | Agentic commerce is PayPal's own named prize category — this is the direct, minimal expression of "let an agent shop for you and pay" |
| Innovation/Idea | No manual cart controls at all — the agent *is* the only path to checkout, forcing the AI integration to be real rather than cosmetic |
| Presentation | Demo video walks one conversation from request → cart → PayPal capture in under 3 minutes |

## Status

Backend fully wired and tested end-to-end against a live local Ollama instance. UI redesigned
(PayPal-accent palette, typing indicator, quick prompts, voice input, order receipt). Agent
reliability hardened and verified deterministic (temperature 0, byte-identical output across
5 runs of the exact demo script — see "Known limitation" above for the one pattern still
avoided rather than fixed). **Not yet tested against real PayPal sandbox credentials** —
waiting on a developer.paypal.com account. Demo video and Devpost submission text not yet
written. Repo not yet pushed to GitHub (required for the public-repo submission rule).
