# Shop with an Agent

**Tagline:** An AI agent that chats, builds your cart, and pays with PayPal — there is no manual "add to cart" button.

## Inspiration

PayPal's Agentic Commerce prize category asks a direct question: what does it actually look like when an agent shops for you, not just chats about shopping? Most "AI shopping assistant" demos stop at recommendations. We wanted the AI to be the only path to checkout, so the PayPal integration has to be real, not decorative.

## What it does

You tell the agent what you need in plain language — "I need a jacket for rain and a backpack, budget under 100 total." It reads a small product catalog, proposes a cart, and waits for you to confirm. Once you do, the cart updates live, and a real PayPal Smart Button appears. Clicking it creates a live PayPal sandbox order, you approve it as the buyer, and the agent captures the payment — a genuine Orders v2 lifecycle (create → approve → capture), not a mock.

Every price is computed server-side from the catalog, so neither the AI nor the browser can ever submit a tampered total.

## How we built it

- **Backend:** a zero-dependency Node.js `http` server (no Express, no framework) — four JSON routes plus static file serving.
- **AI:** runs locally via Ollama (`qwen2.5:7b`), not a paid API. The model is forced into a structured `update_cart` tool call every turn, so its output is always a parseable cart object, never prose that happens to look like one.
- **Payments:** a thin wrapper over PayPal's own REST API using the platform `fetch` — OAuth client-credentials, order create, order capture. No PayPal SDK dependency.
- **Frontend:** vanilla HTML/CSS/JS. A chat panel, a live cart sidebar, and PayPal's own Smart Payment Buttons. Native Web Speech API for voice input, no library.

## Challenges we ran into

Getting a small, free, local model to reliably track conversational state turned out to be the hardest part of the build, harder than the PayPal integration itself. Early testing (we built a scripted reliability checker that replays fixed conversations and asserts cart state after every turn, not just that a response came back) caught three real bugs: items added to the cart on a mere suggestion before the shopper confirmed anything, catalog ids leaking into the visible chat text, and the model occasionally skipping its structured tool call entirely in favor of writing raw JSON as prose. We fixed all three, set the model to temperature 0 for determinism, and verified the core demo path byte-identical across repeated runs. One narrow conversational pattern (a bare "yes" right after multiple items are suggested, followed by naming one specifically) remains unreliable and is documented honestly in the repo rather than hidden — we chose to design the demo around the patterns proven reliable instead of chasing every edge case.

## Accomplishments we're proud of

A genuinely agent-mediated checkout: no manual cart controls exist anywhere in the UI. The only way an item reaches the cart is the agent deciding to put it there. And the whole thing, AI included, runs on exactly $0 — PayPal's sandbox is free by design, and the AI is a local model rather than a billed API.

## What we learned

That reliability work on a small local model is really a parsing and recovery problem as much as a prompt-engineering one. Several of the fixes that mattered most were about defensively recovering a malformed-but-recoverable model response, not asking the model to be smarter.

## What's next

The five vulnerability-class-style stubs aren't relevant here, but the natural next steps are: a bigger catalog with real inventory data, multi-currency support (PayPal supports it natively), and tightening the one known-unreliable conversational pattern with a two-call-per-turn design — ask-what-was-offered and classify-the-reply as separate steps instead of one combined call.

## Built with

Node.js · PayPal Orders v2 REST API · Ollama · Qwen2.5 · HTML/CSS/JavaScript (vanilla, zero frontend dependencies) · p5.js (decorative only) · Web Speech API
