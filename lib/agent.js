import { CATALOG, catalogAsText } from "./catalog.js";

// Local, free, no API key: Ollama running on the same machine (`brew services start ollama`).
// Swapping back to a hosted model later is a one-line change — see README "Swapping the model".
const OLLAMA_HOST = process.env.OLLAMA_HOST || "http://localhost:11434";
const MODEL = process.env.OLLAMA_MODEL || "llama3.2:3b";

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
- Ask a clarifying question if the request is ambiguous (e.g. budget, size, color not in catalog).
- Keep replies short, one or two sentences.
- Set checkout_ready true only when the shopper has clearly said to proceed/pay/checkout, not just "I'll take the shoes".
- Always respond by calling update_cart with the FULL current cart (including items from earlier turns you are keeping), never a partial diff.
- You must always call the update_cart tool. Never answer in plain text.`;

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
    // Small local models occasionally reply in plain text instead of calling the
    // tool. Surface the raw reply rather than crash the chat.
    return { reply: data.message?.content || "Sorry, could you rephrase that?", cart: currentCart, checkout_ready: false };
  }

  const result =
    typeof toolCall.function.arguments === "string"
      ? JSON.parse(toolCall.function.arguments)
      : toolCall.function.arguments;

  // Small local models sometimes stringify nested fields instead of emitting
  // real JSON types — coerce before trusting the shape.
  if (typeof result.cart === "string") result.cart = JSON.parse(result.cart);
  if (typeof result.checkout_ready === "string") result.checkout_ready = result.checkout_ready === "true";

  result.cart = (result.cart || []).filter((item) => CATALOG.some((p) => p.id === item.id));
  return result;
}
