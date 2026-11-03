const messagesEl = document.getElementById("messages");
const formEl = document.getElementById("chat-form");
const inputEl = document.getElementById("chat-input");
const cartItemsEl = document.getElementById("cart-items");
const cartTotalEl = document.getElementById("cart-total");
const statusEl = document.getElementById("order-status");

let history = [];
let cart = []; // [{id, qty}]

function addMessage(role, text) {
  const div = document.createElement("div");
  div.className = `msg ${role}`;
  div.textContent = text;
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function renderCart(enrichedCart) {
  cartItemsEl.innerHTML = "";
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

formEl.addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = inputEl.value.trim();
  if (!text) return;
  addMessage("user", text);
  inputEl.value = "";
  history.push({ role: "user", content: text });

  const thinking = document.createElement("div");
  thinking.className = "msg agent";
  thinking.textContent = "…";
  messagesEl.appendChild(thinking);

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
});

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
          statusEl.textContent = "Payment captured. Order complete.";
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

addMessage("agent", "Hi! Tell me what you're shopping for and I'll put together a cart.");
setupPaypal();
