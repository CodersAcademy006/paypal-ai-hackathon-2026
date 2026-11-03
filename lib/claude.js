import { CATALOG, catalogAsText } from "./catalog.js";

const MODEL = process.env.CLAUDE_MODEL || "claude-haiku-5-5";

// Forcing a single tool call is the structured-output trick: Claude must return
// exactly this shape, so we never parse free text as JSON.
const CART_TOOL = {
  name: "update_cart",
  description: "Reply to the shopper and set the current state of their cart from the catalog.",
  input_schema: {
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
};

const SYSTEM_PROMPT = `You are a shopping agent for a small apparel/travel-gear store. Catalog (id: name — price [tags]):
${catalogAsText()}

Rules:
- Only ever add items that exist in the catalog above, by their exact id.
- Ask a clarifying question if the request is ambiguous (e.g. budget, size, color not in catalog).
- Keep replies short, one or two sentences.
- Set checkout_ready true only when the shopper has clearly said to proceed/pay/checkout, not just "I'll take the shoes".
- Always call update_cart with the FULL current cart (including items from earlier turns you are keeping), never a partial diff.`;

export async function chatTurn(history, currentCart) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set — see .env.example");

  const cartState = currentCart.length
    ? `Current cart: ${JSON.stringify(currentCart)}`
    : "Current cart: empty";

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 512,
      system: `${SYSTEM_PROMPT}\n\n${cartState}`,
      messages: history,
      tools: [CART_TOOL],
      tool_choice: { type: "tool", name: "update_cart" },
    }),
  });

  if (!res.ok) throw new Error(`Claude API failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  const toolUse = data.content.find((block) => block.type === "tool_use");
  if (!toolUse) throw new Error("Claude did not return a tool_use block");

  const result = toolUse.input;
  // Drop any id the model hallucinated outside the catalog, cheap defense-in-depth
  // on top of createOrder's own server-side price lookup.
  result.cart = result.cart.filter((item) => CATALOG.some((p) => p.id === item.id));
  return result;
}
