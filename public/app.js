const messagesEl = document.getElementById("messages");
const formEl = document.getElementById("chat-form");
const inputEl = document.getElementById("chat-input");
const micBtn = document.getElementById("mic-btn");
const chipsEl = document.getElementById("chips");
const cartItemsEl = document.getElementById("cart-items");
const cartEmptyEl = document.getElementById("cart-empty");
const cartTotalEl = document.getElementById("cart-total");
const statusEl = document.getElementById("order-status");
const receiptSlot = document.getElementById("receipt-slot");

let history = [];
let cart = []; // [{id, qty}]

const STARTER_PROMPTS = [
  "Something for a rainy commute, under $60",
  "Travel gear for a weekend trip",
  "Everyday casual basics",
  "Formal shoes for an interview",
];

function renderChips() {
  chipsEl.innerHTML = "";
  for (const text of STARTER_PROMPTS) {
    const btn = document.createElement("button");
    btn.className = "chip";
    btn.type = "button";
    btn.textContent = text;
    btn.addEventListener("click", () => {
      inputEl.value = text;
      formEl.requestSubmit();
    });
    chipsEl.appendChild(btn);
  }
}

function addMessage(role, text) {
  const row = document.createElement("div");
  row.className = `row ${role}`;
  const avatar = document.createElement("div");
  avatar.className = "avatar";
  avatar.textContent = role === "agent" ? "AI" : "U";
  const bubble = document.createElement("div");
  bubble.className = "msg";
  bubble.textContent = text;
  row.appendChild(avatar);
  row.appendChild(bubble);
  messagesEl.appendChild(row);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return row;
}

function addTypingRow() {
  const row = document.createElement("div");
  row.className = "row agent";
  row.innerHTML = `
    <div class="avatar">AI</div>
    <div class="msg"><span class="typing"><span></span><span></span><span></span></span></div>
  `;
  messagesEl.appendChild(row);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return row;
}

function renderCart(enrichedCart) {
  cartItemsEl.innerHTML = "";
  cartEmptyEl.style.display = enrichedCart.length ? "none" : "block";
  let total = 0;
  for (const item of enrichedCart) {
    total += item.price * item.qty;
    const li = document.createElement("li");
    li.textContent = `${item.qty} × ${item.name}`;
    const span = document.createElement("span");
    span.textContent = `$${(item.price * item.qty).toFixed(2)}`;
    li.appendChild(span);
    cartItemsEl.appendChild(li);
  }
  cartTotalEl.textContent = enrichedCart.length ? `Total: $${total.toFixed(2)}` : "";
}

async function sendMessage(text) {
  addMessage("user", text);
  history.push({ role: "user", content: text });
  if (chipsEl.firstChild) chipsEl.innerHTML = "";

  const thinking = addTypingRow();

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ history, cart }),
    });
    const data = await res.json();
    thinking.remove();
    addMessage("agent", data.reply);
    history.push({ role: "assistant", content: data.reply });
    cart = data.cart.map((item) => ({ id: item.id, qty: item.qty }));
    renderCart(data.cart);
  } catch (err) {
    thinking.remove();
    addMessage("agent", "Something went wrong talking to the agent. Is the server running?");
    console.error(err);
  }
}

formEl.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = inputEl.value.trim();
  if (!text) return;
  inputEl.value = "";
  sendMessage(text);
});

// Voice input: native Web Speech API, no dependency. Silently hides the mic
// button on browsers that don't support it (e.g. Firefox) instead of erroring.
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
if (SpeechRecognition) {
  const recognizer = new SpeechRecognition();
  recognizer.lang = "en-US";
  recognizer.interimResults = false;

  micBtn.addEventListener("click", () => {
    if (micBtn.classList.contains("listening")) {
      recognizer.stop();
      return;
    }
    micBtn.classList.add("listening");
    recognizer.start();
  });

  recognizer.addEventListener("result", (e) => {
    inputEl.value = e.results[0][0].transcript;
  });
  recognizer.addEventListener("end", () => micBtn.classList.remove("listening"));
  recognizer.addEventListener("error", () => micBtn.classList.remove("listening"));
} else {
  micBtn.style.display = "none";
}

async function setupPaypal() {
  const res = await fetch("/api/config");
  const { paypalClientId } = await res.json();
  if (!paypalClientId) {
    statusEl.textContent = "PayPal not configured yet (missing PAYPAL_CLIENT_ID in .env).";
    return;
  }
  const script = document.createElement("script");
  script.src = `https://www.paypal.com/sdk/js?client-id=${paypalClientId}&currency=USD`;
  script.onload = renderButtons;
  document.body.appendChild(script);
}

function renderButtons() {
  window.paypal
    .Buttons({
      createOrder: async () => {
        if (!cart.length) {
          statusEl.textContent = "Cart is empty — chat with the agent first.";
          throw new Error("empty cart");
        }
        const res = await fetch("/api/order/create", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ cart }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "order create failed");
        return data.id;
      },
      onApprove: async (data) => {
        statusEl.textContent = "Capturing payment…";
        const res = await fetch(`/api/order/${data.orderID}/capture`, { method: "POST" });
        const capture = await res.json();
        if (capture.status === "COMPLETED") {
          statusEl.textContent = "";
          showReceipt(capture);
          cart = [];
          renderCart([]);
        } else {
          statusEl.textContent = `Capture status: ${capture.status || "unknown"}`;
        }
      },
      onError: (err) => {
        statusEl.textContent = "PayPal error — see console.";
        console.error(err);
      },
    })
    .render("#paypal-button-container");
}

function showReceipt(capture) {
  const captureId = capture.purchase_units?.[0]?.payments?.captures?.[0]?.id || capture.id;
  const div = document.createElement("div");
  div.className = "receipt";
  div.innerHTML = `
    <div class="ok-line">Payment captured — order complete.</div>
    <div class="id-line">PayPal order ${capture.id}${captureId !== capture.id ? ` · capture ${captureId}` : ""}</div>
  `;
  receiptSlot.innerHTML = "";
  receiptSlot.appendChild(div);
}

renderChips();
addMessage("agent", "Hi! Tell me what you're shopping for and I'll put together a cart.");
renderCart([]);
setupPaypal();
