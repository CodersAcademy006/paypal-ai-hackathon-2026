# Shop with an Agent

**An agent-mediated commerce reference implementation. A conversational AI agent assembles a
shopping cart and settles payment through the PayPal Orders v2 API. There is no manual
"add to cart" control anywhere in the interface.**

![License](https://img.shields.io/badge/license-MIT-blue)
![Node](https://img.shields.io/badge/node-%3E%3D20.6.0-339933)
![Dependencies](https://img.shields.io/badge/npm%20dependencies-0-success)
![Payments](https://img.shields.io/badge/payments-PayPal%20Orders%20v2-00457C)
![AI Runtime](https://img.shields.io/badge/AI-local%20via%20Ollama-black)
![Cost](https://img.shields.io/badge/cost%20to%20run-%240-success)

Submitted to the PayPal AI Hackathon 2026, Agentic Commerce category.

---

## Table of contents

- [Overview](#overview)
- [Design principles](#design-principles)
- [Architecture](#architecture)
- [Quick start](#quick-start)
- [Configuration](#configuration)
- [API reference](#api-reference)
- [Repository layout](#repository-layout)
- [Security model](#security-model)
- [Reliability engineering](#reliability-engineering)
- [Verification](#verification)
- [Known limitations](#known-limitations)
- [Project status](#project-status)
- [Roadmap](#roadmap)
- [License](#license)

---

## Overview

Most "AI shopping assistant" demonstrations stop at recommendation. The shopper still clicks
the buttons, and the AI layer could be removed without breaking checkout. This project inverts
that relationship: the agent holds exclusive write access to the cart, and the payment rail is
PayPal's production API surface running against the sandbox environment.

A shopper describes an intent in natural language, for example *"I need a jacket for rain and a
backpack, budget under 100 total."* The agent reads a fixed product catalog, proposes
candidates, and waits for explicit confirmation. On confirmation the cart updates and a PayPal
Smart Payment Button is rendered. The button drives a genuine three-phase Orders v2 lifecycle:
server-side order creation, buyer approval in PayPal's own flow, then server-side capture.

### What makes the integration non-decorative

| Property | Implementation |
|---|---|
| Agent is the only write path to the cart | No add, remove, or quantity control exists in the DOM. Cart mutations originate exclusively from a forced `update_cart` tool call. |
| Payment is a real API lifecycle | PayPal Orders v2 `create` then buyer `approve` then `capture`, server-to-server over OAuth 2.0 client credentials. No mock, no stub, no simulated receipt. |
| Totals are not client-trusted | The browser and the model transmit catalog ids and quantities only. Monetary values are resolved server-side from the catalog on every request. |
| Structured output is enforced, not requested | The model is bound to a JSON Schema tool definition, so its response is always a parseable cart object rather than prose that resembles one. |
| Operating cost is zero | Inference runs locally through Ollama. PayPal's sandbox is free. No metered API key is required to run or evaluate this project. |

---

## Design principles

1. **The agent must be load-bearing.** If removing the AI leaves a working storefront, the AI
   was ornamental. Removing the agent here leaves no way to transact at all.
2. **Money never crosses a client trust boundary.** Prices exist in one place on the server.
   Every other layer, including the model, handles opaque identifiers.
3. **Dependency count is a liability.** The application ships zero npm dependencies. Payments
   use the platform `fetch` against PayPal's REST endpoints rather than an SDK. Configuration
   uses Node's native `--env-file` rather than `dotenv`. The HTTP layer is `node:http` rather
   than a framework.
4. **Model unreliability is an engineering problem, not a prompt problem.** Malformed but
   recoverable model output is parsed and repaired rather than discarded. See
   [Reliability engineering](#reliability-engineering).
5. **Limitations are documented, not concealed.** One conversational pattern remains unreliable
   and is specified precisely in [Known limitations](#known-limitations).

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│  Browser (public/)                                                  │
│  Chat panel  ·  live cart sidebar  ·  PayPal Smart Payment Button   │
│  Vanilla HTML/CSS/JS. No framework, no bundler, no build step.      │
└───────────────┬─────────────────────────────────┬───────────────────┘
                │ POST /api/chat                  │ PayPal JS SDK
                │ { history, cart }               │ (loaded with public client id)
                ▼                                 │
┌─────────────────────────────────────────┐        │
│  server.js   node:http, zero deps       │        │
│  Static file serving + 5 JSON routes    │        │
└───────┬─────────────────────────┬───────┘        │
        │                         │                │
        ▼                         │                │
┌───────────────────────┐         │                │
│  lib/agent.js         │         │                │
│  Forced tool call     │         │                │
│  update_cart          │         │                │
│  temperature 0        │         │                │
└───────┬───────────────┘         │                │
        │ HTTP                    │                │
        ▼                         │                │
┌───────────────────────┐         │                │
│  Ollama               │         │                │
│  localhost:11434      │         │                │
│  qwen2.5:7b           │         │                │
└───────────────────────┘         │                │
                                  │                │
          ┌───────────────────────▼──────┐         │
          │  lib/catalog.js              │         │
          │  TRUST BOUNDARY              │         │
          │  Authoritative prices.       │         │
          │  Cart ids resolved to money  │         │
          │  here and nowhere else.      │         │
          └───────────────────────┬──────┘         │
                                  │                │
                                  ▼                ▼
                    ┌─────────────────────────────────────────┐
                    │  lib/paypal.js                          │
                    │  OAuth 2.0 client credentials           │
                    │  POST /v2/checkout/orders               │
                    │  POST /v2/checkout/orders/{id}/capture  │
                    └─────────────────┬───────────────────────┘
                                      ▼
                        PayPal REST API (sandbox or live)
```

### Request lifecycle, conversation turn

1. Browser posts the full message history plus the current cart to `POST /api/chat`.
2. `lib/agent.js` composes a system prompt containing the catalog and the serialized cart
   state, then calls Ollama with the `update_cart` tool definition attached.
3. The model returns a tool call containing `{ reply, cart, checkout_ready }`. Cart entries are
   `{ id, qty }` pairs only.
4. The server filters the returned ids against the catalog, discarding any hallucinated
   identifier, then enriches the surviving ids with authoritative names and prices.
5. The browser renders the reply and the enriched cart. When `checkoutReady` is true, the
   PayPal button becomes available.

### Request lifecycle, payment

1. The PayPal button invokes `POST /api/order/create` with catalog ids and quantities.
2. The server recomputes the total from `lib/catalog.js`, constructs the Orders v2 payload with
   a per-line-item breakdown, and returns the PayPal order id.
3. The buyer approves inside PayPal's own hosted flow. The application never sees buyer
   credentials.
4. The button invokes `POST /api/order/{orderId}/capture`. The server captures server-side and
   returns PayPal's capture response, which the UI renders as a receipt.

---

## Quick start

### Prerequisites

| Requirement | Version | Why |
|---|---|---|
| [Node.js](https://nodejs.org) | >= 20.6.0 | Native `--env-file` support, so no `dotenv` dependency |
| [Ollama](https://ollama.com) | Any current release | Local inference runtime, replaces a paid model API |
| PayPal developer account | Free | Sandbox client id and secret |

No `npm install` is required. The application has zero runtime dependencies.

### Installation

```bash
git clone https://github.com/CodersAcademy006/paypal-ai-hackathon-2026.git
cd paypal-ai-hackathon-2026
```

### 1. Start the local model

```bash
brew install ollama          # or see https://ollama.com/download
brew services start ollama
ollama pull qwen2.5:7b
```

`qwen2.5:7b` is the default because it is tool-calling capable and measurably more reliable at
multi-turn cart-state tracking than smaller alternatives. See
[Reliability engineering](#reliability-engineering).

### 2. Provision PayPal sandbox credentials

1. Sign in at [developer.paypal.com](https://developer.paypal.com).
2. Navigate to **Dashboard** then **Apps & Credentials** then **Sandbox**.
3. Create an app and copy the **Client ID** and **Secret**.
4. Note your sandbox buyer account under **Sandbox** then **Accounts**. Use that test account
   in the PayPal popup during checkout, never a real PayPal account.

### 3. Configure and run

```bash
cp .env.example .env
# populate PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET
npm start
```

The server listens on http://localhost:3000.

---

## Configuration

All configuration is environment-driven. `.env` is gitignored and never committed.

| Variable | Required | Default | Description |
|---|---|---|---|
| `PAYPAL_CLIENT_ID` | Yes | none | Sandbox or live client id. Exposed to the browser by design, see [Security model](#security-model). |
| `PAYPAL_CLIENT_SECRET` | Yes | none | Server-side only. Never transmitted to the client. |
| `PAYPAL_ENV` | No | `sandbox` | Set to `live` to target `api-m.paypal.com`. Any other value targets the sandbox host. |
| `PORT` | No | `3000` | HTTP listen port. |
| `OLLAMA_HOST` | No | `http://localhost:11434` | Inference endpoint. Accepts any Ollama-compatible host. |
| `OLLAMA_MODEL` | No | `qwen2.5:7b` | Model identifier. Any tool-calling capable model may be substituted without code changes. |

### Substituting the model

`lib/agent.js` resolves both the host and the model from the environment, so switching
inference backends requires no code change:

```bash
OLLAMA_MODEL=llama3.1:8b npm start
```

`llama3.2:3b` runs faster and uses less memory but tested measurably less reliable at tracking
cart state across turns, which is why it is not the default.

---

## API reference

Five JSON routes plus static file serving. All responses are `application/json`.

| Method | Path | Request body | Response | Purpose |
|---|---|---|---|---|
| `GET` | `/api/config` | none | `{ paypalClientId }` | Supplies the public client id so the browser can bootstrap the PayPal JS SDK. |
| `GET` | `/api/catalog` | none | `Product[]` | Full catalog. Useful for inspection and testing. |
| `POST` | `/api/chat` | `{ history, cart }` | `{ reply, cart, checkoutReady }` | Executes one agent turn. Returns the enriched cart with server-resolved prices. |
| `POST` | `/api/order/create` | `{ cart }` | `{ id, total }` | Recomputes the total server-side and creates a PayPal order. Returns `400` on an empty cart. |
| `POST` | `/api/order/{orderId}/capture` | none | PayPal capture response | Captures an approved order server-side. |

Unhandled exceptions return `500` with `{ error }`. Unknown paths fall through to static file
serving and return `404` when no file matches.

### Data shapes

```js
// Product, from lib/catalog.js
{ id: "jk-01", name: "Packable Rain Jacket", price: 54.00, tags: ["jacket", "outdoor", "rain"] }

// Cart entry on the wire, inbound. Identifiers and quantities only, never prices.
{ id: "jk-01", qty: 1 }

// Cart entry outbound, enriched server-side
{ id: "jk-01", name: "Packable Rain Jacket", price: 54.00, tags: [...], qty: 1 }
```

---

## Repository layout

```
.
├── server.js                    node:http server, routing, cart enrichment, total computation
├── lib
│   ├── agent.js                 Ollama client, forced tool call, malformed-response recovery
│   ├── catalog.js               Authoritative 10-item catalog and price lookup
│   └── paypal.js                Orders v2 wrapper: OAuth, create order, capture order
├── public
│   ├── index.html               Chat and cart markup
│   ├── app.js                   Chat loop, cart rendering, PayPal button wiring, voice input
│   ├── style.css                PayPal-accent visual design
│   └── flourish.js              Decorative p5.js header stroke. Non-functional, fails silently.
├── scripts
│   └── demo_repro_test.js       Scripted multi-run conversational reliability harness
├── .env.example                 Configuration template, no secrets
├── SUBMISSION.md                Devpost submission narrative
├── LICENSE                      MIT
└── package.json                 Zero dependencies, one start script
```

### A precise note on dependencies

The `npm dependencies: 0` badge is literal: `package.json` declares no dependency of any kind
and there is nothing to install. Two scripts are nevertheless loaded by the browser at runtime:

| Script | How it loads | Load-bearing |
|---|---|---|
| PayPal JS SDK | Injected by `public/app.js` after fetching the public client id from `/api/config` | Yes. Renders the Smart Payment Buttons. |
| p5.js (CDN) | Static deferred `<script>` tag in `public/index.html` | No. Drives only the decorative header stroke and is guarded by a `window.p5` check, so the application is fully functional without it. |

There is no bundler, no transpiler, and no build step. The files served are the files in the
repository.

---

## Security model

| Control | Implementation | Location |
|---|---|---|
| Price tampering prevention | Clients and the model submit catalog ids and quantities only. All monetary values are resolved server-side from `lib/catalog.js` before any PayPal call. A tampered price cannot be expressed in the request format. | `server.js`, `enrichCart` and `cartTotal` |
| Hallucinated product rejection | Returned cart ids are filtered against the catalog. Any identifier the model invents is dropped rather than propagated. | `lib/agent.js`, `normalize` |
| Credential separation | Only `PAYPAL_CLIENT_ID` is served to the browser, via `/api/config`. The client secret is read exclusively in the server process and is never serialized into a response. | `server.js`, `lib/paypal.js` |
| Path traversal prevention | Static paths are normalized and verified to resolve inside the public directory. Requests escaping it receive `403`. | `server.js`, `serveStatic` |
| Buyer credential isolation | Authentication and approval occur entirely inside PayPal's hosted flow. The application never receives, renders, or stores buyer credentials. | PayPal Smart Payment Buttons |
| Secret hygiene | `.env` is gitignored. `.env.example` contains empty placeholders only. No credential appears in any commit in repository history. | `.gitignore`, `.env.example` |

### Deliberate non-goals

This is a hackathon reference implementation, not a production storefront. The following are
knowingly absent and would be required before any real deployment: user authentication and
session management, persistent order storage, idempotency keys on capture, PayPal webhook
verification for asynchronous payment state, rate limiting, CSRF protection on state-changing
routes, and inventory reservation.

---

## Reliability engineering

Constraining a small local model to emit well-formed structured output across a multi-turn
conversation proved to be the hardest engineering problem in this build, harder than the
payments integration. Three classes of defect were found through scripted testing and fixed at
the source.

### Defects found and resolved

| Defect | Root cause | Resolution |
|---|---|---|
| Items entered the cart on mere suggestion, before the shopper confirmed | The prompt did not distinguish recommending from adding | Explicit prompt rules separating suggestion from confirmation, plus per-turn assertions in the test harness that the cart stays empty while the agent is only proposing |
| Internal catalog identifiers leaked into visible chat text | No constraint on reply content | Prompt rule restricting replies to product names, plus a regex assertion in the harness that fails on any `xx-00` pattern in a reply |
| The model bypassed its tool call and wrote raw JSON as prose | Native tool-call emission is unreliable under a long system prompt | Three-stage recovery in `extractEmbeddedCall`, covering fenced code blocks, `update_cart({...})` call syntax, and bare brace-delimited objects |

### Response normalization

`normalize` in `lib/agent.js` repairs every malformed-but-recoverable response shape observed
during testing rather than discarding the turn:

- `{ parameters: {...} }` and `{ arguments: {...} }` envelope variants are unwrapped.
- A bare `{ id, qty }` with no envelope is merged into the existing confirmed cart, because
  "add the sneakers" means add rather than replace.
- A `cart` field delivered as a JSON string instead of an array is parsed.
- A `checkout_ready` field delivered as the string `"true"` is coerced to boolean.
- Prose written before a JSON blob is preferred as the user-visible reply, with dangling
  function-call syntax stripped.
- Cart contents are filtered against the catalog as a final gate.

### Determinism

Inference runs at `temperature: 0`. The demonstration conversation path produces
byte-identical output across repeated runs.

---

## Verification

`scripts/demo_repro_test.js` replays fixed conversations against a running server and asserts
state after every turn, rather than merely asserting that a response arrived.

```bash
npm start                                  # terminal 1
node scripts/demo_repro_test.js            # terminal 2
RUNS=10 node scripts/demo_repro_test.js    # repeat each scenario 10 times
```

| Setting | Default | Purpose |
|---|---|---|
| `BASE_URL` | `http://localhost:3000` | Target server |
| `RUNS` | `3` | Repetitions per scenario, surfaces nondeterministic regressions |

### Scenarios covered

| Scenario | Asserts |
|---|---|
| `suggestion-then-single-confirm` | A suggestion alone leaves the cart empty, and a bare "yes" after exactly one suggested item confirms it |
| `trekking-ambiguous-yes-then-specific` | A bare "yes" after multiple suggestions adds nothing and triggers a clarifying question, then naming an item adds exactly that item |
| `multi-item-checkout-language` | Explicit checkout language confirms every suggested item at once and sets `checkoutReady` |

Every turn in every scenario is additionally checked for catalog id leakage and for
near-duplicate phrasing against all prior replies, using a Jaccard word-set similarity
threshold of 0.6.

---

## Known limitations

### Unreliable conversational pattern

One specific sequence is not reliable: a bare "yes" immediately after the agent has suggested
**more than one** item, followed immediately by naming one of those items.

The agent correctly declines to add anything and asks which item is wanted. The follow-up
naming turn then intermittently fails to register. Root cause: in this exact context the model
occasionally emits a bare `{ id, qty }` tool call with no `reply` or `cart` envelope.
`normalize` recovers this shape by merging into the existing cart, which mitigates but does not
fully eliminate the failure.

This pattern is covered by the `trekking-ambiguous-yes-then-specific` scenario in the test
harness and is therefore measurable rather than anecdotal.

**Reliable alternatives**, both of which passed across more than 20 runs:

- Confirm a single suggested item directly.
- Use explicit checkout language such as "yes checkout" to confirm all suggested items at once.

The recorded demonstration uses only these patterns.

### Scope limitations

- Currency is hardcoded to USD in the Orders v2 payload. PayPal supports multi-currency
  natively, so this is a payload change rather than an architectural one.
- The catalog is a fixed 10-item in-memory array with no inventory or availability data.
- No order persistence. Capture responses are rendered and discarded.

---

## Project status

| Component | State |
|---|---|
| Agent conversation loop | Complete. Tested end to end against a live local Ollama instance. |
| Cart state management | Complete. Three defect classes found and fixed, verified deterministic at temperature 0. |
| Server and routing | Complete. Five routes, zero dependencies. |
| PayPal integration code | Complete. OAuth, order creation, and capture implemented against Orders v2. |
| PayPal integration execution | **Not yet exercised against live sandbox credentials.** Pending a developer.paypal.com account. |
| User interface | Complete. PayPal-accent palette, typing indicator, quick prompts, voice input, order receipt. |
| Reliability harness | Complete. Three scenarios, configurable repetition count. |
| Demonstration video | Outstanding. |
| Devpost submission | Narrative drafted in `SUBMISSION.md`. Not yet uploaded. |

The honest summary: every line of the payment path is written and reviewed, but it has not yet
executed against real credentials. That is the single remaining risk in the build.

---

## Roadmap

1. Execute the full create, approve, capture lifecycle against live sandbox credentials.
2. Decompose the agent turn into two calls, one to recall what was offered and one to classify
   the shopper's reply, which addresses the known-unreliable pattern structurally rather than
   through recovery parsing.
3. Multi-currency support in the Orders v2 payload.
4. Replace the fixed catalog with a datastore carrying real inventory and availability.
5. Webhook verification for asynchronous payment state transitions.

---

## License

[MIT](LICENSE)
