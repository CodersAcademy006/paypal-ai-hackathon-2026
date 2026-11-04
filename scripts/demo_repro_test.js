// ponytail: smallest useful check for prompt-following regressions, not a test suite.
// Replays scripted conversations against a running server and asserts cart state
// after each turn, not just that a response came back. Catches the three bugs found
// on camera: leaked catalog ids, near-verbatim repeats, and premature cart-adds.
const BASE = process.env.BASE_URL || "http://localhost:3000";
const RUNS = Number(process.env.RUNS || 3);
const ID_PATTERN = /\b[a-z]{2}-\d{2}\b/i;

function similarity(a, b) {
  const wa = new Set(a.toLowerCase().split(/\W+/).filter(Boolean));
  const wb = new Set(b.toLowerCase().split(/\W+/).filter(Boolean));
  const inter = [...wa].filter((w) => wb.has(w)).length;
  const union = new Set([...wa, ...wb]).size;
  return union === 0 ? 0 : inter / union;
}

// Each step: user line + assertion on the resulting state.
const SCENARIOS = {
  "suggestion-then-single-confirm": [
    { say: "something for a rainy commute, under $60", expectCartSize: 0, note: "suggestion only, nothing confirmed yet" },
    { say: "yes add it", expectCartSize: 1, note: "single item was suggested, bare yes should confirm it" },
  ],
  "trekking-ambiguous-yes-then-specific": [
    { say: "i need something for my trecking", expectCartSize: 0, note: "suggestion only" },
    { say: "find me more", expectCartSize: 0, note: "still just suggesting, and should not repeat verbatim" },
    { say: "yes", expectCartSize: 0, note: "multiple items were on the table, bare yes is ambiguous — must ask, not add" },
    { say: "add the sneakers", expectCartSize: 1, note: "named item should be added" },
  ],
  "multi-item-checkout-language": [
    { say: "I need a jacket for rain and a backpack, budget under 100 total", expectCartSize: 0, note: "suggestion only" },
    { say: "yes checkout please", expectCartSize: 2, expectCheckoutReady: true, note: "checkout language should confirm ALL suggested items" },
  ],
};

async function runScenario(name, steps, runNum) {
  let history = [];
  let cart = [];
  const replies = [];
  const failures = [];

  for (const step of steps) {
    history.push({ role: "user", content: step.say });
    const res = await fetch(`${BASE}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ history, cart }),
    });
    const data = await res.json();
    history.push({ role: "assistant", content: data.reply });
    cart = data.cart.map((i) => ({ id: i.id, qty: i.qty }));

    const cartSize = cart.reduce((n, i) => n + i.qty, 0);
    if (step.expectCartSize !== undefined && cartSize !== step.expectCartSize) {
      failures.push(
        `after "${step.say}": expected cart size ${step.expectCartSize}, got ${cartSize} (${step.note})`
      );
    }
    if (step.expectCheckoutReady !== undefined && data.checkoutReady !== step.expectCheckoutReady) {
      failures.push(`after "${step.say}": expected checkoutReady=${step.expectCheckoutReady}, got ${data.checkoutReady}`);
    }
    if (ID_PATTERN.test(data.reply)) {
      failures.push(`after "${step.say}": catalog id leaked in reply: "${data.reply}"`);
    }
    for (const prev of replies) {
      if (similarity(prev, data.reply) > 0.6) {
        failures.push(`after "${step.say}": near-duplicate reply ("${prev}" vs "${data.reply}")`);
      }
    }
    replies.push(data.reply);
  }

  if (failures.length) {
    console.log(`  [run ${runNum}] ${name}: FAIL`);
    for (const f of failures) console.log(`    - ${f}`);
  }
  return failures.length === 0;
}

let total = 0;
let passed = 0;
for (let n = 1; n <= RUNS; n++) {
  console.log(`Run ${n}/${RUNS}...`);
  for (const [name, steps] of Object.entries(SCENARIOS)) {
    total++;
    if (await runScenario(name, steps, n)) passed++;
  }
}

console.log(`\n${passed}/${total} scenario-runs clean (model: ${process.env.OLLAMA_MODEL || "llama3.2:3b"}).`);
process.exit(passed === total ? 0 : 1);
