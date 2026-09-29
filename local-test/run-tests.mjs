#!/usr/bin/env node
/**
 * End-to-end local test for the MERGED wildbills-vault-worker.js
 * (wrangler dev + local R2 binding PAID_BUNDLES + local mock Stripe API).
 *
 * Extends the tested harness from /home/team/shared/vault-fix/worker/test/run-tests.mjs.
 *
 * Covers: no token / tampered token / expired token / unknown SKU / valid token
 * (sha256-verified) / range requests / legacy public shape rejection /
 * signature-verified webhook (valid, bad sig, unpaid, unknown SKU) /
 * /api/download-link success path through the mock Stripe API /
 * POST /api/create-checkout returns a Stripe URL at the 24.99 price point /
 * /success page / redacted /products.json + /static/products.json / clean 404s /
 * existing routes (auto-promote, free-sample admin, CORS preflight).
 *
 * Requires: mock-stripe.mjs running, `npx wrangler dev --port 8787` running,
 * local R2 seeded with fixture/bundle_bass_fishing.zip.
 */
import crypto from "node:crypto";
import fs from "node:fs";

const BASE = process.env.BASE_URL || "http://127.0.0.1:8787";
const SECRET = "local-test-signing-secret-do-not-use-in-prod";
const WEBHOOK_SECRET_RAW = "local-test-webhook-secret"; // what whsec_… in .dev.vars decodes to
const SKU = "WB-BND-003";

// same token algorithm as the worker's wvMintToken
function b64url(buf) { return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
function hmac(secret, msg) { return b64url(crypto.createHmac("sha256", secret).update(msg).digest()); }
function mint(sku, expIn = 3600, nonce = crypto.randomBytes(8).toString("base64url")) {
  const exp = Math.floor(Date.now() / 1000) + expIn;
  const sig = hmac(SECRET, `v1|${exp}|${sku}|${nonce}`);
  return `v1.${exp}.${sku}.${nonce}.${sig}`;
}

// Stripe signs with the key the whsec_ string DECODES to (worker mirrors this).
function stripeSignedHeader(payload, secretRaw, tOffset = 0) {
  const t = Math.floor(Date.now() / 1000) + tOffset;
  const v1 = crypto.createHmac("sha256", Buffer.from(secretRaw)).update(`${t}.${payload}`).digest("hex");
  return `t=${t},v1=${v1}`;
}

let pass = 0, fail = 0;
function check(name, cond, detail = "") {
  if (cond) { pass++; console.log(`  PASS  ${name}${detail ? "  —  " + detail : ""}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? "  —  " + detail : ""}`); }
}

async function req(path, opts = {}) {
  const res = await fetch(BASE + path, { redirect: "manual", ...opts });
  const headers = Object.fromEntries(res.headers.entries());
  const buf = Buffer.from(await res.arrayBuffer());
  const text = buf.toString("utf8");
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, headers, body: buf, text, json };
}

const expectedZip = fs.readFileSync(new URL("./fixture/bundle_bass_fishing.zip", import.meta.url));
const expectedSize = expectedZip.length;

console.log(`Testing merged worker at ${BASE}\n`);

/* ---------- 1. no token / legacy public shape ---------- */
{
  const r = await req("/api/download");
  check("no token -> 400", r.status === 400, `status=${r.status}`);
  const r2 = await req(`/api/download?sku=${SKU}`);
  check("legacy public shape (?sku=) rejected -> 401", r2.status === 401, `status=${r2.status}`);
  check("legacy rejection is JSON, not a redirect", !r2.headers.location, r2.text.slice(0, 90));
  const r3 = await req("/api/download?file=bundle_bass_fishing.zip");
  check("legacy ?file= shape rejected -> 401", r3.status === 401, `status=${r3.status}`);
}

/* ---------- 2. bad / tampered token ---------- */
{
  const bad = mint(SKU).replace(/.$/, (c) => (c === "A" ? "B" : "A"));
  const r = await req(`/api/download/${bad}`);
  check("tampered token -> 403", r.status === 403, `status=${r.status} body=${r.text.slice(0, 60)}`);
  const r2 = await req("/api/download/v1.9999999999.GARBAGE.deadbeef.AAAA");
  check("garbage token -> 403", r2.status === 403, `status=${r2.status}`);
  const r3 = await req(`/api/download?token=${encodeURIComponent(bad)}`);
  check("tampered token via ?token= query -> 403", r3.status === 403, `status=${r3.status}`);
}

/* ---------- 3. expired token ---------- */
{
  const expired = mint(SKU, -10);
  const r = await req(`/api/download/${expired}`);
  check("expired token -> 403", r.status === 403, `status=${r.status} body=${r.text.slice(0, 60)}`);
}

/* ---------- 4. unknown SKU ---------- */
{
  const r = await req(`/api/download/${mint("WB-BND-999")}`);
  check("unknown SKU (forged with our test secret) -> 403", r.status === 403, `status=${r.status} body=${r.text.slice(0, 70)}`);
}

/* ---------- 5. valid token ---------- */
{
  const tok = mint(SKU);
  const r = await req(`/api/download/${tok}`);
  check("valid token -> 200", r.status === 200, `status=${r.status}`);
  check("content-type is application/zip", (r.headers["content-type"] || "").includes("application/zip"), r.headers["content-type"]);
  check("content-disposition carries the filename", (r.headers["content-disposition"] || "").includes("bundle_bass_fishing.zip"), r.headers["content-disposition"]);
  check("content-length matches object", r.headers["content-length"] === String(expectedSize), `${r.headers["content-length"]} vs ${expectedSize}`);
  check("accept-ranges: bytes", r.headers["accept-ranges"] === "bytes", r.headers["accept-ranges"]);
  check("cache-control is private/no-store", (r.headers["cache-control"] || "").includes("private"), r.headers["cache-control"]);
  const sha = crypto.createHash("sha256").update(r.body).digest("hex");
  const shaExp = crypto.createHash("sha256").update(expectedZip).digest("hex");
  check("served bytes == object bytes (sha256)", sha === shaExp, `${sha.slice(0, 16)}…`);
  check("no public r2.dev URL leaked in body/headers", !r.text.includes("r2.dev"), "");
}

/* ---------- 6. range request ---------- */
{
  const tok = mint(SKU);
  const r = await req(`/api/download/${tok}`, { headers: { range: "bytes=0-99" } });
  check("range 0-99 -> 206", r.status === 206, `status=${r.status}`);
  check("content-range correct", r.headers["content-range"] === `bytes 0-99/${expectedSize}`, r.headers["content-range"]);
  check("100 bytes served", r.body.length === 100, `${r.body.length}B`);
  const r2 = await req(`/api/download/${tok}`, { headers: { range: `bytes=${expectedSize - 50}-` } });
  check("open-ended tail range -> 206", r2.status === 206 && r2.body.length === 50, `status=${r2.status} len=${r2.body.length}`);
}

/* ---------- 7. create-checkout still returns a Stripe URL (via mock API) ---------- */
{
  const r = await req("/api/create-checkout", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sku: SKU, name: "Bass Fishing Clipart Mega-Bundle", price: 24.99 }),
  });
  check("POST /api/create-checkout -> 200", r.status === 200, `status=${r.status}`);
  check("returns a Stripe checkout URL", typeof r.json?.url === "string" && r.json.url.startsWith("https://checkout.stripe.com/c/pay/"), r.json?.url || "(none)");
  check("session id returned", /^cs_test_new_/.test(r.json?.sessionId || ""), r.json?.sessionId);
  // verify what the handler actually sent to Stripe, via the created session on the mock
  const sess = await (await fetch(`http://127.0.0.1:9799/v1/checkout/sessions/${r.json?.sessionId}`)).json();
  check("price sent to Stripe is 24.99 (unit_amount 2499)", sess.unit_amount === "2499", `unit_amount=${sess.unit_amount} currency=${sess.currency} mode=${sess.mode}`);
  check("session metadata carries the sku", sess.metadata?.sku === SKU, JSON.stringify(sess.metadata));
  const r3 = await req("/api/create-checkout", { method: "OPTIONS" });
  check("OPTIONS /api/create-checkout -> 204 (CORS preserved)", r3.status === 204, `status=${r3.status}`);
}

/* ---------- 8. webhook: signature-verified, records purchase, mints ---------- */
{
  const event = {
    id: "evt_test_1", type: "checkout.session.completed",
    data: { object: { id: "cs_test_wh_1", object: "checkout.session", payment_status: "paid", status: "complete",
      customer_details: { email: "buyer@example.com" }, amount_total: 2499, metadata: { sku: SKU } } },
  };
  const payload = JSON.stringify(event);
  const r = await req("/api/stripe-webhook", {
    method: "POST", headers: { "content-type": "application/json", "stripe-signature": stripeSignedHeader(payload, WEBHOOK_SECRET_RAW) }, body: payload,
  });
  check("webhook valid signature + paid + known SKU -> 200 minted", r.status === 200 && r.json?.minted === true, `status=${r.status} body=${r.text.slice(0, 60)}`);
  check("webhook returns a download_url with our token shape", /^https?:\/\/[^/]+\/api\/download\/v1\./.test(r.json?.download_url || ""), (r.json?.download_url || "").slice(0, 60));
  const dl = await fetch(r.json?.download_url || BASE, { redirect: "manual" });
  check("webhook-minted link actually serves the zip", dl.status === 200, `status=${dl.status}`);

  // tampered signature must be rejected BEFORE any parsing/trust
  const r2 = await req("/api/stripe-webhook", {
    method: "POST", headers: { "content-type": "application/json", "stripe-signature": `t=${Math.floor(Date.now() / 1000)},v1=deadbeef` }, body: payload,
  });
  check("webhook BAD signature -> 400, no link", r2.status === 400 && !r2.json?.download_url, `status=${r2.status} body=${r2.text.slice(0, 50)}`);
  check("webhook without stripe-signature header -> 400", (await req("/api/stripe-webhook", { method: "POST", body: payload })).status === 400);

  const stale = stripeSignedHeader(payload, WEBHOOK_SECRET_RAW, -3600);
  const r2b = await req("/api/stripe-webhook", {
    method: "POST", headers: { "content-type": "application/json", "stripe-signature": stale }, body: payload,
  });
  check("webhook STALE timestamp (>5 min) -> 400", r2b.status === 400, `status=${r2b.status}`);

  const unpaid = JSON.stringify({ id: "evt_2", type: "checkout.session.completed", data: { object: { id: "cs_2", payment_status: "unpaid", metadata: { sku: SKU } } } });
  const r3 = await req("/api/stripe-webhook", {
    method: "POST", headers: { "stripe-signature": stripeSignedHeader(unpaid, WEBHOOK_SECRET_RAW) }, body: unpaid,
  });
  check("webhook signature ok but session NOT paid -> no link", r3.status === 200 && r3.json?.minted === false, `status=${r3.status} ${r3.text.slice(0, 70)}`);

  const unknownSku = JSON.stringify({ id: "evt_3", type: "checkout.session.completed", data: { object: { id: "cs_3", payment_status: "paid", metadata: { sku: "SKU-NOT-REAL" } } } });
  const r4 = await req("/api/stripe-webhook", {
    method: "POST", headers: { "stripe-signature": stripeSignedHeader(unknownSku, WEBHOOK_SECRET_RAW) }, body: unknownSku,
  });
  check("webhook unknown SKU -> no link", r4.status === 200 && r4.json?.minted === false, `status=${r4.status} ${r4.text.slice(0, 70)}`);
}

/* ---------- 9. /api/download-link: Stripe-verified success-path issuance ---------- */
{
  const r = await req(`/api/download-link?session_id=cs_test_paid&sku=${SKU}`);
  check("download-link with PAID session -> 200 + minted link", r.status === 200 && /^https?:\/\/[^/]+\/api\/download\/v1\./.test(r.json?.download_url || ""), `status=${r.status}`);
  check("issued sku echoes the paid SKU", r.json?.sku === SKU, r.json?.sku);
  const dl = await fetch(r.json?.download_url || BASE, { redirect: "manual" });
  check("download-link-minted link serves the zip", dl.status === 200, `status=${dl.status}`);
  check("download-link reports expires_in", r.json?.expires_in === 3600, String(r.json?.expires_in));

  const r2 = await req("/api/download-link?session_id=cs_test_unpaid&sku=" + SKU);
  check("download-link with UNPAID session -> 402, no link", r2.status === 402 && !r2.json?.download_url, `status=${r2.status} body=${r2.text.slice(0, 60)}`);

  const r3 = await req("/api/download-link?session_id=cs_test_nope&sku=" + SKU);
  check("download-link with UNKNOWN session -> 502, no link", r3.status === 502, `status=${r3.status}`);

  const r4 = await req(`/api/download-link?session_id=cs_test_paid&sku=WB-BND-001`);
  check("download-link SKU mismatch vs paid session -> 403", r4.status === 403, `status=${r4.status}`);

  const r5 = await req("/api/download-link");
  check("download-link without session_id -> 400", r5.status === 400, `status=${r5.status}`);
}

/* ---------- 10. /success page ---------- */
{
  const r = await req("/success?session_id=cs_test_paid&sku=" + SKU);
  check("GET /success -> 200 html", r.status === 200 && (r.headers["content-type"] || "").includes("text/html"), `status=${r.status}`);
  check("success page drives /api/download-link", r.text.includes("/api/download-link"), "");
  const r2 = await req("/success.html?session_id=cs_test_paid&sku=" + SKU);
  check("GET /success.html -> 200 (legacy path preserved)", r2.status === 200 && (r2.headers["content-type"] || "").includes("text/html"), `status=${r2.status}`);
}

/* ---------- 11. redacted catalogue ---------- */
{
  for (const p of ["/products.json", "/static/products.json"]) {
    const r = await req(p);
    if (r.status !== 200) { check(`${p} -> 200`, false, `status=${r.status} body=${r.text.slice(0, 80)}`); continue; }
    let cat = null;
    try { cat = JSON.parse(r.text); } catch {}
    check(`${p} parses as the catalogue`, Array.isArray(cat) && cat.length === 27, `products=${Array.isArray(cat) ? cat.length : "n/a"}`);
    const raw = r.text;
    check(`${p} contains no r2.dev URL`, !raw.includes("r2.dev"), "");
    check(`${p} has no storage-URL fields`, !/"(r2_download_url|download_url|zip_path)"/.test(raw), "");
    check(`${p} still lists ${SKU} with price 24.99`, Array.isArray(cat) && cat.some((x) => x.sku === SKU && x.price === 24.99), "");
  }
}

/* ---------- 12. other existing routes ---------- */
{
  const r = await req("/api/auto-promote");
  check("GET /api/auto-promote -> 200 JSON", r.status === 200 && r.json?.success === true, `status=${r.status}`);
  const r2 = await req("/api/free-sample?key=wildbill2026");
  check("GET /api/free-sample (admin key) reachable", r2.status === 200 || r2.status === 500, `status=${r2.status} (500 = LEADS_KV unbound locally, as designed)`);
  const r3 = await req("/api/free-sample");
  check("GET /api/free-sample without key -> 401 (unchanged)", r3.status === 401, `status=${r3.status}`);
}

/* ---------- 13. unknown path ---------- */
{
  const r = await req("/this/path/does/not/exist.png");
  check("unknown path -> clean 404 JSON (not 500/1101)", r.status === 404 && (r.headers["content-type"] || "").includes("json"), `status=${r.status} body=${r.text.slice(0, 40)}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
