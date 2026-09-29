# Local end-to-end test for the merged `wildbills-vault-worker.js`
Proves the gated-delivery merge works before the owner pastes the file into the
Cloudflare dashboard editor. Runs the real worker file under `wrangler dev`
(miniflare) with local R2 buckets and a local mock of the Stripe REST API.
Nothing is deployed; nothing touches the live bucket, the live Worker, or the
owner's Stripe account.

The suite is **self-contained**: `node run-tests.mjs` spawns the mock and four
wrangler dev configurations itself and kills them on exit.

## Files
| File | Purpose |
|---|---|
| `wrangler.toml` | phase 1 (:8787) — R2 bound as `PAID_BUNDLES`, no assets binding (mirrors the gated-delivery docs) |
| `wrangler.assets.toml` | phase 2 (:8788) — assets directory bound as `ASSETS`, proves real previews are served by the platform asset layer and the catch-all cannot shadow them |
| `wrangler.alt.toml` | phase 3 (:8789) — R2 bound as **`wildbills`** (the owner's real binding name) and `LEADS_ADMIN_KEY` set; proves zero-binding-change delivery + admin-key env resolution |
| `wrangler.nobind.toml` | phase 4 (:8790) — no R2 binding at all; proves downloads fail closed and the error names both binding names |
| `.dev.vars` | LOCAL TEST DUMMIES ONLY (signing secret, fake Stripe key, `whsec_` dummy, `STRIPE_API_BASE` override) |
| `mock-stripe.mjs` | mock of `POST /v1/checkout/sessions` + `GET /v1/checkout/sessions/:id` on 127.0.0.1:9799; records `price_id` / `unit_amount` / `product_name` so tests assert exactly what the worker sent to Stripe |
| `fixture/bundle_bass_fishing.zip` | synthetic ~2.5 MB fixture (NOT a real bundle), seeded into the local R2 sim |
| `fixture/assets/static/previews/WB-BND-001_preview.jpg` | 415-byte JPEG served by the asset layer in phase 2 |
| `TEST-OUTPUT.txt` | recorded passing run (85/85) |

## Setup note (this machine)
`npm install` here can hit the 600 MB `/home` disk limit. The working wrangler
install is kept OUTSIDE `/home` and symlinked in:
```bash
mkdir -p /tmp/eng-deps && mv <existing node_modules> /tmp/eng-deps/node_modules
ln -s /tmp/eng-deps/node_modules node_modules
```
(On a normal machine: `npm install` instead. /tmp is wiped on reboot — recreate
the symlink after.)

## Run
```bash
node run-tests.mjs          # expect: 85 passed, 0 failed
```
Logs of the spawned processes land in `/tmp/wrangler-<port>.log` and
`/tmp/mock-stripe.log`; local R2 state in `/tmp/wv-state-<port>/`.

## What is covered
Phases 1 (all on :8787 unless noted):
- `GET /api/download` with no token → 400; legacy `?sku=` / `?file=` shape → 401 JSON, never a redirect
- tampered / garbage / expired tokens → 403
- valid token → 200 `application/zip`, sha256-identical to the stored object, `cache-control: private, no-store`
- range requests → 206 with correct `content-range`
- **server-side pricing**: `POST /api/create-checkout` with client `price: 0.01`
  → Stripe is still sent `unit_amount=2499` (24.99, the catalogue price);
  hostile `name` / `product_id` / `stripe_price_id` are ignored (the catalogue
  name and SKU are sent instead); unknown SKU, missing SKU, malformed body → 400 fail-closed
- `POST /api/stripe-webhook`: valid signature → purchase recorded + link minted; bad signature / stale timestamp → 400; unpaid session / unknown SKU → no link
- `GET /api/download-link` (success path): only a session Stripe reports `payment_status: "paid"` mints a link; SKU mismatch → 403
- `GET /success` and `/success.html` render the buyer page that drives `/api/download-link`
- `/products.json` + `/static/products.json`: 27 products, zero `r2.dev` strings, zero `r2_download_url`/`download_url`/`zip_path` fields, prices unchanged
- existing routes intact: `/api/auto-promote`, `/api/free-sample` (401 without admin key), CORS preflight
- unknown paths → clean 404 JSON (no more 500 `error code: 1101` when no ASSETS binding exists)

Phase 2 (:8788, assets bound as `ASSETS`):
- `/static/previews/WB-BND-001_preview.jpg` → 200 `image/jpeg`, bytes identical to the asset on disk — the platform asset layer serves real previews and the worker's catch-all cannot shadow them
- missing asset path → 404 clean; API routes and `/products.json` still served by the worker; catalogue redaction intact

Phase 3 (:8789, R2 bound as `wildbills` — the owner's real name, `LEADS_ADMIN_KEY` set):
- valid token delivers the zip via `env.wildbills` with `PAID_BUNDLES` absent (sha256-identical; range requests work)
- `LEADS_ADMIN_KEY` env value accepted; the `wildbill2026` migration fallback is rejected once the env var is set (env wins); no key → 401

Phase 4 (:8790, no R2 binding):
- `/api/download/<token>` → 500 fail-closed, error names both `PAID_BUNDLES` and `wildbills`

## Difference vs production
Phase 1 mirrors the owner's pasted config (no assets binding): previews are NOT
testable there, matching production where the platform serves `/static/*`
before the Worker runs. Phase 2 runs the same Worker with an assets directory
bound, proving the catch-all pass-through. The `STRIPE_API_BASE` env override
exists ONLY in `.dev.vars`; production defaults to `https://api.stripe.com`.
