// Small fixed catalog. Prices are the source of truth for order totals —
// the agent and the client only ever send item ids + quantities, never prices.
export const CATALOG = [
  { id: "sh-01", name: "Trail Runner Sneakers", price: 89.99, tags: ["shoes", "running", "outdoor"] },
  { id: "sh-02", name: "Classic Leather Loafers", price: 64.5, tags: ["shoes", "formal"] },
  { id: "jk-01", name: "Packable Rain Jacket", price: 54.0, tags: ["jacket", "outdoor", "rain"] },
  { id: "jk-02", name: "Wool Blend Overcoat", price: 149.0, tags: ["jacket", "formal", "winter"] },
  { id: "bp-01", name: "20L Commuter Backpack", price: 39.99, tags: ["bag", "commute", "travel"] },
  { id: "bp-02", name: "Carry-On Travel Duffel", price: 72.0, tags: ["bag", "travel"] },
  { id: "tw-01", name: "Merino Wool T-Shirt", price: 29.0, tags: ["shirt", "casual"] },
  { id: "tw-02", name: "Everyday Denim Jeans", price: 48.0, tags: ["pants", "casual"] },
  { id: "ac-01", name: "Polarized Sunglasses", price: 22.5, tags: ["accessory"] },
  { id: "ac-02", name: "Water Resistant Watch", price: 95.0, tags: ["accessory"] },
];

export function findById(id) {
  return CATALOG.find((p) => p.id === id);
}

export function catalogAsText() {
  return CATALOG.map((p) => `${p.id}: ${p.name} — $${p.price.toFixed(2)} [${p.tags.join(", ")}]`).join("\n");
}
