import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CATALOG, findById } from "./lib/catalog.js";
import { chatTurn } from "./lib/claude.js";
import { createOrder, captureOrder } from "./lib/paypal.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "public");
const PORT = process.env.PORT || 3000;

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function enrichCart(cart) {
  return cart
    .map((item) => {
      const product = findById(item.id);
      return product ? { ...product, qty: item.qty } : null;
    })
    .filter(Boolean);
}

function cartTotal(enriched) {
  return enriched.reduce((sum, item) => sum + item.price * item.qty, 0);
}

async function serveStatic(req, res) {
  const reqPath = req.url === "/" ? "/index.html" : req.url;
  const filePath = path.normalize(path.join(PUBLIC_DIR, reqPath));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403).end("Forbidden");
    return;
  }
  try {
    const body = await fs.readFile(filePath);
    const ext = path.extname(filePath);
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404).end("Not found");
  }
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/api/config") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ paypalClientId: process.env.PAYPAL_CLIENT_ID || "" }));
      return;
    }

    if (req.method === "POST" && req.url === "/api/chat") {
      const { history, cart } = await readJsonBody(req);
      const result = await chatTurn(history, cart || []);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          reply: result.reply,
          cart: enrichCart(result.cart),
          checkoutReady: result.checkout_ready,
        })
      );
      return;
    }

    if (req.method === "POST" && req.url === "/api/order/create") {
      const { cart } = await readJsonBody(req);
      const enriched = enrichCart(cart || []);
      if (!enriched.length) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Cart is empty" }));
        return;
      }
      const total = cartTotal(enriched);
      const order = await createOrder(enriched, total);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ id: order.id, total }));
      return;
    }

    const captureMatch = req.method === "POST" && req.url.match(/^\/api\/order\/([^/]+)\/capture$/);
    if (captureMatch) {
      const capture = await captureOrder(captureMatch[1]);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(capture));
      return;
    }

    if (req.method === "GET" && req.url === "/api/catalog") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(CATALOG));
      return;
    }

    await serveStatic(req, res);
  } catch (err) {
    console.error(err);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: err.message }));
  }
});

server.listen(PORT, () => console.log(`AI shopping agent on http://localhost:${PORT}`));
