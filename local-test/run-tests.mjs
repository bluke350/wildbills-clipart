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
 * Self-contained: the suite spawns mock-stripe.mjs and FOUR wrangler dev
 * configurations itself (see ORCHESTRATION below) and kills them on exit.
 *
 * Extra coverage on top of the first merge:
 *   - server-side pricing: client price/stripe_price_id/name ignored, unknown
 *     or missing SKU -> 400 (fixes POST {"sku":...,"price":0.01})
 *   - R2 binding fallback: env.wildbills delivers when PAID_BUNDLES is absent
 *     (owner's real binding name; zero dashboard changes needed)
 *   - no-binding configuration fails closed, error names both binding names
 *   - LEADS_ADMIN_KEY resolves from env and overrides the migration fallback
 *   - preview JPEGs served R2-FIRST from the private bucket (owner swaps a
 *     preview by uploading static/previews/<SKU>_preview.jpg to R2 — no code
 *     paste): R2 object wins over a same-named asset; absent from R2 the
 *     asset serves identically; absent from both is a clean 404; with NO R2
 *     binding previews still serve from ASSETS and never 500
 */
import crypto from "node:crypto";
import fs from "node:fs";
import { spawn, spawnSync } from "node:child_process";

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

/* ===================== ORCHESTRATION =====================
   Spawns everything the suite needs and tears it down on exit:
   - mock Stripe API on 127.0.0.1:9799 (up for the whole run)
   - :8787 wrangler dev with wrangler.toml      (R2 bound PAID_BUNDLES, no ASSETS)
   - :8788 wrangler dev with wrangler.assets.toml (assets directory bound ASSETS)
   - :8789 wrangler dev with wrangler.alt.toml  (R2 bound `wildbills`, LEADS_ADMIN_KEY set)
   - :8790 wrangler dev with wrangler.nobind.toml (NO R2 binding at all)
   - :8791 wrangler dev with wrangler.assetsonly.toml (ASSETS, NO R2 binding)
   Local R2 state lives in /tmp so nothing is written under /home. */
const HERE = new URL(".", import.meta.url).pathname;
const WRANGLER = "node_modules/wrangler/bin/wrangler.js";
const SPAWNED = [];
function killSpawned() {
  for (const p of SPAWNED) { try { process.kill(-p.pid, "SIGKILL"); } catch {} }
  SPAWNED.length = 0;
}
process.on("exit", killSpawned);
process.on("SIGINT", () => { killSpawned(); process.exit(130); });

function startProc(args, logPath) {
  const log = fs.openSync(logPath, "a");
  const p = spawn(process.execPath, args, {
    cwd: HERE, detached: true, stdio: ["ignore", log, log],
    env: { ...process.env, CI: "true", WRANGLER_SEND_METRICS: "false", NODE_OPTIONS: "" },
  });
  SPAWNED.push(p);
  return p;
}
function stopProc(p) {
  try { process.kill(-p.pid, "SIGTERM"); } catch {}
  const i = SPAWNED.indexOf(p);
  if (i >= 0) SPAWNED.splice(i, 1);
}
async function waitReady(url, label, timeoutMs = 120000) {
  const t0 = Date.now();
  for (;;) {
    try { await fetch(url); return; } catch {}
    if (Date.now() - t0 > timeoutMs) throw new Error(`${label} not ready on ${url} after ${timeoutMs}ms`);
    await new Promise((res) => setTimeout(res, 500));
  }
}
function seedR2(config, persistTo) {
  const common = { cwd: HERE, encoding: "utf8", env: { ...process.env, CI: "true", WRANGLER_SEND_METRICS: "false" } };
  const key = "wildbills-vault-bundles-local/bundle_bass_fishing.zip";
  let r = spawnSync(process.execPath, [WRANGLER, "r2", "object", "put", key, "--path", "fixture/bundle_bass_fishing.zip", "--local", "--config", config, "--persist-to", persistTo], common);
  if (r.status !== 0) r = spawnSync(process.execPath, [WRANGLER, "r2", "object", "put", key, "--file", "fixture/bundle_bass_fishing.zip", "--local", "--config", config, "--persist-to", persistTo], common);
  if (r.status !== 0) throw new Error(`R2 seed failed for ${config}: ${(r.stdout || "") + (r.stderr || "")}`);
  console.log(`  (local R2 seeded for ${config})`);
}
function seedPreview(config, persistTo) {
  const common = { cwd: HERE, encoding: "utf8", env: { ...process.env, CI: "true", WRANGLER_SEND_METRICS: "false" } };
  const key = "wildbills-vault-bundles-local/static/previews/WB-BND-016_preview.jpg";
  const path = "fixture/r2-preview/WB-BND-016_preview.jpg";
  let r = spawnSync(process.execPath, [WRANGLER, "r2", "object", "put", key, "--path", path, "--local", "--config", config, "--persist-to", persistTo], common);
  if (r.status !== 0) r = spawnSync(process.execPath, [WRANGLER, "r2", "object", "put", key, "--file", path, "--local", "--config", config, "--persist-to", persistTo], common);
  if (r.status !== 0) throw new Error(`R2 preview seed failed for ${config}: ${(r.stdout || "") + (r.stderr || "")}`);
  console.log(`  (local R2 preview seeded for ${config})`);
}
async function startWorker(port, config, persistTo) {
  const p = startProc([WRANGLER, "dev", "--port", String(port), "--ip", "127.0.0.1", "--config", config, "--persist-to", persistTo], `/tmp/wrangler-${port}.log`);
  await waitReady(`http://127.0.0.1:${port}/products.json`, `wrangler dev :${port} (${config})`);
  console.log(`  (worker up on :${port} with ${config})`);
  return p;
}

startProc(["mock-stripe.mjs"], "/tmp/mock-stripe.log");
await waitReady("http://127.0.0.1:9799/v1/checkout/sessions/__probe", "mock-stripe");
seedR2("wrangler.toml", "/tmp/wv-state-8787");
seedPreview("wrangler.toml", "/tmp/wv-state-8787");
const w8787 = await startWorker(8787, "wrangler.toml", "/tmp/wv-state-8787");

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

/* ---------- 11b. renamed catalogue: approved names in, franchise names out ---------- */
{
  const r = await req("/products.json");
  const cat = Array.isArray(r.json) ? r.json : [];
  const bySku = Object.fromEntries(cat.map((p) => [p.sku, p]));
  const names = {
    "WB-BND-016": "Haunted Small Town Horror",
    "WB-BND-017": "Crimson Queen Gothic",
    "WB-BND-019": "Twisted Gothic Dark Evil",
    "WB-BND-020": "Twisted Gothic Evil",
    "WB-BND-021": "Twisted Crimson Queen Horror",
  };
  const zips = {
    "WB-BND-016": "bundle_stranger_things_tv_show.zip",
    "WB-BND-017": "bundle_the_red_queen_from_alice_in_wonderland.zip",
    "WB-BND-019": "bundle_twisted_alice_in_wonderland_twisted_dark_evil.zip",
    "WB-BND-020": "bundle_twisted_alice_in_wonderland_twisted_evil.zip",
    "WB-BND-021": "bundle_twisted_crazy_red_queen_from_alice_in_wonderland.zip",
  };
  for (const [sku, name] of Object.entries(names)) {
    check(`${sku} renamed -> "${name}"`, bySku[sku]?.name === `${name} Clipart Mega-Bundle` && bySku[sku]?.title === `${name} Clipart Collection` && bySku[sku]?.category === name, bySku[sku]?.name || "(missing)");
    check(`${sku} zip_filename UNCHANGED (delivery key preserved)`, bySku[sku]?.zip_filename === zips[sku], bySku[sku]?.zip_filename || "(missing)");
  }
  check("no franchise names left in the served catalogue", !/stranger things|alice in wonderland|red queen/i.test(r.text), "");
  check("all 27 products still priced 24.99 / 79.99", cat.length === 27 && cat.every((p) => p.price === 24.99 && p.original_price === 79.99), `${cat.length} products`);
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

/* ---------- 14. server-side pricing: client-supplied values are ignored ---------- */
{
  const post = (obj) => req("/api/create-checkout", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(obj) });
  const mockGet = async (id) => (await fetch(`http://127.0.0.1:9799/v1/checkout/sessions/${id}`)).json();

  const r = await post({ sku: SKU, price: 0.01 });
  check("POST price=0.01 with known SKU -> 200", r.status === 200, `status=${r.status} ${r.text.slice(0, 80)}`);
  const s1 = await mockGet(r.json?.sessionId || "");
  check("client price 0.01 IGNORED - Stripe is sent the catalogue 2499", s1.unit_amount === "2499", `unit_amount=${s1.unit_amount}`);
  check("no client-supplied Stripe price id forwarded", s1.price_id == null, `price_id=${s1.price_id}`);

  const r2 = await post({ sku: SKU, name: "HACKED NAME", price: 0.01, product_id: "pwn", stripe_price_id: "price_1HACKED" });
  check("hostile body (price/name/product_id/stripe_price_id) -> 200", r2.status === 200, `status=${r2.status}`);
  const s2 = await mockGet(r2.json?.sessionId || "");
  check("hostile price ignored -> unit_amount 2499", s2.unit_amount === "2499", `unit_amount=${s2.unit_amount}`);
  check("hostile name ignored - catalogue name sent to Stripe", (s2.product_name || "").toLowerCase().includes("bass fishing"), s2.product_name || "(none)");
  check("hostile stripe_price_id ignored", s2.price_id == null, `price_id=${s2.price_id}`);
  check("metadata sku/product_id resolved from the catalogue", s2.metadata?.sku === SKU && s2.metadata?.product_id === SKU, JSON.stringify(s2.metadata));

  const r3 = await post({ sku: "WB-BND-999", price: 0.01 });
  check("unknown SKU -> 400 (fail closed)", r3.status === 400, `status=${r3.status} ${r3.text.slice(0, 80)}`);
  const r4 = await post({ price: 0.01 });
  check("missing SKU -> 400 (fail closed)", r4.status === 400, `status=${r4.status}`);
  const r5 = await req("/api/create-checkout", { method: "POST", headers: { "content-type": "application/json" }, body: "{not json" });
  check("malformed body -> 400 (fail closed)", r5.status === 400, `status=${r5.status} ${r5.text.slice(0, 60)}`);
}

/* ---------- 14b. preview route: R2-FIRST, no ASSETS binding present ---------- */
{
  const r2Jpg = fs.readFileSync(new URL("./fixture/r2-preview/WB-BND-016_preview.jpg", import.meta.url));
  const r = await req("/static/previews/WB-BND-016_preview.jpg");
  check("preview present in R2 -> 200 even with NO ASSETS binding", r.status === 200, `status=${r.status}`);
  check("preview content-type image/jpeg", (r.headers["content-type"] || "").includes("image/jpeg"), r.headers["content-type"]);
  check("preview bytes are the R2 object", r.body.equals(r2Jpg), `${r.body.length}B vs ${r2Jpg.length}B`);
  check("preview response is cacheable (cache-control public)", (r.headers["cache-control"] || "").includes("public"), r.headers["cache-control"]);
  const miss = await req("/static/previews/WB-BND-001_preview.jpg");
  check("preview absent from R2 with NO ASSETS -> clean 404", miss.status === 404, `status=${miss.status}`);
  const traversal = await req("/static/previews/..%2Fbundle_bass_fishing.zip");
  check("preview path traversal (..%2F) -> 404, never the zip", traversal.status === 404, `status=${traversal.status}`);
  const normalized = await req("/static/previews/../../bundle_bass_fishing.zip");
  check("dot-dot traversal normalized away by URL -> 404", normalized.status === 404, `status=${normalized.status}`);
  const wrongExt = await req("/static/previews/bundle_bass_fishing.zip");
  check("non-image extension under previews -> 404 (not a file server)", wrongExt.status === 404, `status=${wrongExt.status}`);
}

stopProc(w8787);

/* ---------- 15. preview fallback to ASSETS + R2 wins over a same-named asset ---------- */
{
  console.log("\n[phase 2] wrangler.assets.toml on :8788 (assets ASSETS + R2 PAID_BUNDLES, worker-first)");
  seedPreview("wrangler.assets.toml", "/tmp/wv-state-8788");
  const w8788 = await startWorker(8788, "wrangler.assets.toml", "/tmp/wv-state-8788");
  try {
    const A = "http://127.0.0.1:8788";
    const fixtureJpg = fs.readFileSync(new URL("./fixture/assets/static/previews/WB-BND-001_preview.jpg", import.meta.url));
    const res = await fetch(A + "/static/previews/WB-BND-001_preview.jpg");
    const buf = Buffer.from(await res.arrayBuffer());
    check("GET /static/previews/WB-BND-001_preview.jpg -> 200 (R2 miss -> ASSETS fallback)", res.status === 200, `status=${res.status}`);
    check("fallback preview content-type image/jpeg", (res.headers.get("content-type") || "").includes("image/jpeg"), res.headers.get("content-type") || "");
    check("fallback preview bytes identical to the asset on disk", buf.equals(fixtureJpg), `${buf.length}B vs ${fixtureJpg.length}B`);
    const miss = await fetch(A + "/static/previews/definitely-not-there.jpg");
    check("missing preview (absent from R2 AND assets) -> 404 clean (no 500/1101)", miss.status === 404, `status=${miss.status}`);

    const r2Jpg = fs.readFileSync(new URL("./fixture/r2-preview/WB-BND-016_preview.jpg", import.meta.url));
    const assetsJpg = fs.readFileSync(new URL("./fixture/assets/static/previews/WB-BND-016_preview.jpg", import.meta.url));
    const w16 = await fetch(A + "/static/previews/WB-BND-016_preview.jpg");
    const b16 = Buffer.from(await w16.arrayBuffer());
    check("preview in BOTH R2 and assets -> R2 WINS (200)", w16.status === 200, `status=${w16.status}`);
    check("R2 preview bytes served, not the asset copy", b16.equals(r2Jpg) && !b16.equals(assetsJpg), `${b16.length}B (R2 ${r2Jpg.length}B / asset ${assetsJpg.length}B)`);
    check("R2-served preview carries cache-control", (w16.headers.get("cache-control") || "").includes("public"), w16.headers.get("cache-control") || "");
    const h16 = await fetch(A + "/static/previews/WB-BND-016_preview.jpg", { method: "HEAD" });
    check("HEAD preview -> 200 with content-length", h16.status === 200 && h16.headers.get("content-length") === String(r2Jpg.length), `status=${h16.status} len=${h16.headers.get("content-length")}`);

    const api = await fetch(A + "/api/download", { redirect: "manual" });
    check("API routes still reach the worker with assets bound (-> 400)", api.status === 400, `status=${api.status}`);
    const cat = await fetch(A + "/products.json");
    const catText = await cat.text();
    check("/products.json still served by the worker with assets bound", cat.status === 200 && catText.includes("WB-BND-003"), `status=${cat.status}`);
    check("catalogue redaction intact with assets bound", !catText.includes("r2.dev"), "");
  } finally { stopProc(w8788); }
}

/* ---------- 16+17. R2 binding fallback (env.wildbills) + LEADS_ADMIN_KEY env ---------- */
{
  console.log("\n[phase 3] wrangler.alt.toml on :8789 (R2 bound as `wildbills`, LEADS_ADMIN_KEY set)");
  seedR2("wrangler.alt.toml", "/tmp/wv-state-8789");
  const w8789 = await startWorker(8789, "wrangler.alt.toml", "/tmp/wv-state-8789");
  try {
    const B = "http://127.0.0.1:8789";
    const tok = mint(SKU);
    const res = await fetch(B + `/api/download/${tok}`, { redirect: "manual" });
    const buf = Buffer.from(await res.arrayBuffer());
    check("valid token delivered via env.wildbills (PAID_BUNDLES absent) -> 200", res.status === 200, `status=${res.status}`);
    check("wildbills-binding bytes sha256-identical to the object", crypto.createHash("sha256").update(buf).digest("hex") === crypto.createHash("sha256").update(expectedZip).digest("hex"), `${buf.length}B`);
    check("content-type application/zip via wildbills binding", (res.headers.get("content-type") || "").includes("application/zip"), res.headers.get("content-type") || "");
    const res2 = await fetch(B + `/api/download/${tok}`, { headers: { range: "bytes=0-99" } });
    const b2 = Buffer.from(await res2.arrayBuffer());
    check("range request via env.wildbills -> 206 / 100B", res2.status === 206 && b2.length === 100, `status=${res2.status} len=${b2.length}`);

    const envOk = await fetch(B + "/api/free-sample?key=alt-config-admin-key-123");
    check("LEADS_ADMIN_KEY env value accepted (not 401)", envOk.status !== 401, `status=${envOk.status} (500 = LEADS_KV unbound locally, as designed)`);
    const envWins = await fetch(B + "/api/free-sample?key=wildbill2026");
    check("migration fallback literal rejected once LEADS_ADMIN_KEY is set (env wins)", envWins.status === 401, `status=${envWins.status}`);
    const noKey = await fetch(B + "/api/free-sample");
    check("no key -> 401", noKey.status === 401, `status=${noKey.status}`);
  } finally { stopProc(w8789); }
}

/* ---------- 18. no R2 binding at all -> fail closed, naming both bindings ---------- */
{
  console.log("\n[phase 4] wrangler.nobind.toml on :8790 (NO R2 binding)");
  const w8790 = await startWorker(8790, "wrangler.nobind.toml", "/tmp/wv-state-8790");
  try {
    const C = "http://127.0.0.1:8790";
    const res = await fetch(C + `/api/download/${mint(SKU)}`, { redirect: "manual" });
    const text = await res.text();
    check("download with NO R2 binding -> 500 fail-closed", res.status === 500, `status=${res.status}`);
    check("misconfiguration error names both bindings", text.includes("PAID_BUNDLES") && text.includes("wildbills"), text.slice(0, 120));
    const pv = await fetch(C + "/static/previews/WB-BND-016_preview.jpg");
    check("preview with NO R2 and NO assets -> clean 404, never 500", pv.status === 404, `status=${pv.status}`);
  } finally { stopProc(w8790); }
}

/* ---------- 19. previews with NO R2 binding: assets still serve, never 500 ---------- */
{
  console.log("\n[phase 5] wrangler.assetsonly.toml on :8791 (ASSETS bound, NO R2 binding)");
  const w8791 = await startWorker(8791, "wrangler.assetsonly.toml", "/tmp/wv-state-8791");
  try {
    const D = "http://127.0.0.1:8791";
    const fixtureJpg = fs.readFileSync(new URL("./fixture/assets/static/previews/WB-BND-001_preview.jpg", import.meta.url));
    const res = await fetch(D + "/static/previews/WB-BND-001_preview.jpg");
    const buf = Buffer.from(await res.arrayBuffer());
    check("preview with NO R2 binding -> 200 from ASSETS", res.status === 200, `status=${res.status}`);
    check("no-R2 fallback bytes identical to the asset on disk", buf.equals(fixtureJpg), `${buf.length}B vs ${fixtureJpg.length}B`);
    check("no-R2 fallback content-type image/jpeg", (res.headers.get("content-type") || "").includes("image/jpeg"), res.headers.get("content-type") || "");
    const miss = await fetch(D + "/static/previews/not-anywhere.jpg");
    check("preview absent from both (NO R2) -> clean 404", miss.status === 404, `status=${miss.status}`);
    const dl = await fetch(D + `/api/download/${mint(SKU)}`, { redirect: "manual" });
    const dlText = await dl.text();
    check("download with NO R2 binding still fails closed (-> 500, names both bindings)", dl.status === 500 && dlText.includes("PAID_BUNDLES") && dlText.includes("wildbills"), `status=${dl.status}`);
  } finally { stopProc(w8791); }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
