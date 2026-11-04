import { CATALOG, catalogAsText } from "./catalog.js";

// Local, free, no API key: Ollama running on the same machine (`brew services start ollama`).
// Swapping back to a hosted model later is a one-line change — see README "Swapping the model".
const OLLAMA_HOST = process.env.OLLAMA_HOST || "http://localhost:11434";
// qwen2.5:7b, not llama3.2:3b: tested meaningfully more reliable on this
// structured cart-tracking task (see scripts/demo_repro_test.js results).
const MODEL = process.env.OLLAMA_MODEL || "qwen2.5:7b";

const CART_TOOL = {
  type: "function",
  function: {
    name: "update_cart",
    description: "Reply to the shopper and set the current state of their cart from the catalog.",
    parameters: {
      type: "object",
      properties: {
        reply: { type: "string", description: "Short, friendly reply shown in the chat." },
        cart: {
          type: "array",
          description: "The full cart after this turn (not a diff). Empty array clears it.",
          items: {
            type: "object",
            properties: {
              id: { type: "string", description: "Catalog item id, e.g. sh-01" },
              qty: { type: "integer", minimum: 1 },
            },
            required: ["id", "qty"],
          },
        },
        checkout_ready: {
          type: "boolean",
          description: "True only once the shopper has explicitly confirmed they want to pay.",
        },
      },
      required: ["reply", "cart", "checkout_ready"],
    },
  },
};

const SYSTEM_PROMPT = `You are a shopping agent for a small apparel/travel-gear store. Catalog (id: name — price [tags]):
${catalogAsText()}

Rules:
- Only ever add items that exist in the catalog above, by their exact id.
- MENTIONING or RECOMMENDING an item in your reply is NOT the same as adding it. Suggesting never changes the cart by itself.
- Track what you suggested in your PREVIOUS turn. On the shopper's next message:
  - If you suggested exactly ONE item last turn and they reply with any clear yes ("yes", "sure", "add it", "I'll take it", "checkout", "let's pay") — add that one item.
  - If you suggested MORE THAN ONE item last turn and they reply with a bare "yes"/"sure" that doesn't name which one — do NOT add anything yet. Ask which specific item(s) they want.
  - If you suggested MORE THAN ONE item last turn and they reply with checkout/pay language ("yes checkout", "let's pay", "get them all", "I'll take everything") — that confirms ALL of the items you just suggested. Add all of them.
  - If they name a specific item by description ("the jacket", "the sneakers") — add only that one, even if you suggested several.
- Never add anything the shopper has not clearly confirmed. When in doubt, don't add — ask instead.
- In your "reply" text, refer to items by NAME only. Never print a catalog id (like "sh-01") to the shopper — ids are for the cart field only.
- Ask a clarifying question if the request is ambiguous (e.g. budget, size, color not in catalog).
- If the shopper asks for "more" options and you already named every catalog item that matches, say plainly that's everything relevant in stock — do not repeat the same pitch a second time.
- Keep replies short, one or two sentences, and vary your phrasing turn to turn — never repeat a previous reply near-verbatim.
- Set checkout_ready true only on the same turn you add the last item the shopper confirmed, AND they used checkout/pay/proceed language (not just "I'll take the shoes" with no mention of paying).
- Always respond by calling update_cart with the FULL current cart (previously confirmed items + anything newly confirmed this turn), never a partial diff.
- You must always call the update_cart tool. Never answer in plain text.`;

// Some models (seen on qwen2.5) skip the native tool-call field under a long
// system prompt and instead write the call as text: a ```json fence, a bare
// object, or `update_cart({...})`. Recover the real data instead of losing it.
function extractEmbeddedCall(text) {
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
  const fnCall = text.match(/update_cart\(\s*(\{[\s\S]*\})\s*\)/);
  const bareBrace = text.indexOf("{") >= 0 ? text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1) : null;
  for (const candidate of [fenced?.[1], fnCall?.[1], bareBrace]) {
    if (!candidate) continue;
    try {
      return JSON.parse(candidate);
    } catch {
      // try the next candidate
    }
  }
  return null;
}

function normalize(result, fallbackReplyText, currentCart = []) {
  // Unwrap whichever envelope shape the model used: {parameters:{...}} or
  // {arguments:{...}} are both seen in the wild alongside the direct shape.
  if (result.parameters && typeof result.parameters === "object") result = result.parameters;
  else if (result.arguments && typeof result.arguments === "object") result = result.arguments;

  // Sometimes (seen on qwen2.5, single-item confirmations) the model skips the
  // {reply, cart, checkout_ready} envelope entirely and passes a bare cart item
  // directly: {id, qty}. Recover it by merging into what was already confirmed,
  // since "add the sneakers" means add-to, not replace.
  if (typeof result.id === "string" && !("cart" in result)) {
    const merged = currentCart.filter((i) => i.id !== result.id);
    merged.push({ id: result.id, qty: result.qty || 1 });
    result = { reply: result.reply, cart: merged, checkout_ready: result.checkout_ready };
  }

  if (typeof result.cart === "string") {
    try {
      result.cart = JSON.parse(result.cart);
    } catch {
      result.cart = [];
    }
  }
  if (typeof result.checkout_ready === "string") result.checkout_ready = result.checkout_ready === "true";

  // Prefer any prose the model wrote before the JSON blob starts as the reply
  // (that's its real sentence); cut at the first brace/bracket wherever it
  // falls, not just at a fence or update_cart(...) marker. Also strip a bare
  // "update_cart(" call-syntax fragment left dangling by that cut — it's
  // function-call text, not a sentence.
  const jsonStart = fallbackReplyText?.search(/[{[]/);
  let proseReply =
    jsonStart === undefined || jsonStart === -1 ? fallbackReplyText?.trim() : fallbackReplyText.slice(0, jsonStart).trim();
  proseReply = proseReply?.replace(/\b\w+\s*\($/, "").trim();
  const candidateReply = proseReply || result.reply;
  result.reply =
    typeof candidateReply === "string" && candidateReply && !/[{[]/.test(candidateReply)
      ? candidateReply
      : "Here's what I've got for you.";

  result.cart = Array.isArray(result.cart)
    ? result.cart.filter((item) => item && CATALOG.some((p) => p.id === item.id))
    : [];
  result.checkout_ready = Boolean(result.checkout_ready);
  return result;
}

export async function chatTurn(history, currentCart) {
  const cartState = currentCart.length
    ? `Current cart: ${JSON.stringify(currentCart)}`
    : "Current cart: empty";

  const res = await fetch(`${OLLAMA_HOST}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      stream: false,
      messages: [{ role: "system", content: `${SYSTEM_PROMPT}\n\n${cartState}` }, ...history],
      tools: [CART_TOOL],
      // Low temperature: this is a structured cart-state task, not creative
      // writing — determinism matters far more than varied phrasing here.
      options: { temperature: 0 },
    }),
  });

  if (!res.ok) {
    throw new Error(
      `Ollama request failed: ${res.status} ${await res.text()}. ` +
        `Is it running? (brew services start ollama / ollama pull ${MODEL})`
    );
  }
  const data = await res.json();
  const toolCall = data.message?.tool_calls?.[0];

  if (!toolCall) {
    const raw = data.message?.content?.trim() || "";
    const recovered = extractEmbeddedCall(raw);
    if (recovered) return normalize(recovered, raw, currentCart);
    return {
      reply: raw && !/^[{[]/.test(raw) ? raw : "Sorry, could you rephrase that?",
      cart: currentCart,
      checkout_ready: false,
    };
  }

  const parsed =
    typeof toolCall.function.arguments === "string"
      ? JSON.parse(toolCall.function.arguments)
      : toolCall.function.arguments;
  return normalize(parsed, undefined, currentCart);
}
