#!/usr/bin/env node
/**
 * Local mock of the Stripe REST API surface used by the merged worker
 * (POST /v1/checkout/sessions, GET /v1/checkout/sessions/:id).
 * Runs on 127.0.0.1:9799; the worker reaches it via STRIPE_API_BASE in .dev.vars.
 * Clearly a mock: every session URL it returns is labelled "#mock".
 */
import http from "node:http";

const sessions = {
  cs_test_paid: {
    id: "cs_test_paid",
    object: "checkout.session",
    payment_status: "paid",
    status: "complete",
    metadata: { sku: "WB-BND-003" },
    url: "https://checkout.stripe.com/c/pay/cs_test_paid#mock",
  },
  cs_test_unpaid: {
    id: "cs_test_unpaid",
    object: "checkout.session",
    payment_status: "unpaid",
    status: "open",
    metadata: { sku: "WB-BND-003" },
    url: "https://checkout.stripe.com/c/pay/cs_test_unpaid#mock",
  },
};

const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    if (req.method === "POST" && req.url === "/v1/checkout/sessions") {
      const p = new URLSearchParams(body);
      const id = "cs_test_new_" + Date.now();
      const session = {
        id,
        object: "checkout.session",
        payment_status: "unpaid",
        status: "open",
        url: `https://checkout.stripe.com/c/pay/${id}#mock`,
        mode: p.get("mode"),
        // recorded so tests can assert EXACTLY what the worker sent to Stripe
        unit_amount: p.get("line_items[0][price_data][unit_amount]"),
        currency: p.get("line_items[0][currency]") || p.get("line_items[0][price_data][currency]"),
        price_id: p.get("line_items[0][price]") || null,
        product_name: p.get("line_items[0][price_data][product_data][name]") || null,
        metadata: {
          sku: p.get("metadata[sku]"),
          product_id: p.get("metadata[product_id]"),
        },
      };
      sessions[id] = session;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(session));
      console.log(`[mock-stripe] created ${id} sku=${session.metadata.sku} unit_amount=${session.unit_amount}`);
      return;
    }
    const m = /^\/v1\/checkout\/sessions\/([^/?]+)/.exec(req.url || "");
    if (req.method === "GET" && m) {
      const s = sessions[m[1]];
      if (!s) {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { message: "No such checkout session" } }));
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(s));
      console.log(`[mock-stripe] fetched ${m[1]} payment_status=${s.payment_status}`);
      return;
    }
    res.writeHead(404);
    res.end("not found");
  });
});

server.listen(9799, "127.0.0.1", () => console.log("mock Stripe API listening on 127.0.0.1:9799"));
