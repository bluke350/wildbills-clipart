# Local end-to-end test for the merged `wildbills-vault-worker.js`
Proves the gated-delivery merge works before the owner pastes the file into the
Cloudflare dashboard editor. Runs the real worker file under `wrangler dev`
(miniflare) with local R2 buckets and a local mock of the Stripe REST API.
Nothing is deployed; nothing touches the live bucket, the live Worker, or the
owner's Stripe account.

The suite is **self-contained**: `node run-tests.mjs` spawns the mock and five
wrangler dev configurations itself and kills them on exit.

## Files
| File | Purpose |
|---|---|
| `wrangler.toml` | phase 1 (:8787) — R2 bound as `PAID_BUNDLES`, no assets binding (mirrors the gated-delivery docs) |
| `wrangler.assets.toml` | phase 2 (:8788) — assets directory bound as `ASSETS` + R2 as `PAID_BUNDLES`, `run_worker_first` mirrors production worker-first shape; proves the preview route serves R2-FIRST (an R2 object wins over a same-named asset) and falls back to ASSETS identically on a miss |
| `wrangler.alt.toml` | phase 3 (:8789) — R2 bound as **`wildbills`** (the owner's real binding name) and `LEADS_ADMIN_KEY` set; proves zero-binding-change delivery + admin-key env resolution |
| `wrangler.nobind.toml` | phase 4 (:8790) — no R2 binding at all; proves downloads fail closed and the error names both binding names |
| `wrangler.assetsonly.toml` | phase 5 (:8791) — assets bound, NO R2 binding; proves previews still serve from ASSETS (never 500) and downloads still fail closed |
| `.dev.vars` | LOCAL TEST DUMMIES ONLY (signing secret, fake Stripe key, `whsec_` dummy, `STRIPE_API_BASE` override) |
| `mock-stripe.mjs` | mock of `POST /v1/checkout/sessions` + `GET /v1/checkout/sessions/:id` on 127.0.0.1:9799; records `price_id` / `unit_amount` / `product_name` so tests assert exactly what the worker sent to Stripe |
| `fixture/bundle_bass_fishing.zip` | synthetic ~2.5 MB fixture (NOT a real bundle), seeded into the local R2 sim |
| `fixture/assets/static/previews/WB-BND-001_preview.jpg` | 415-byte JPEG served by the asset layer in phases 2 and 5 |
| `fixture/assets/static/previews/WB-BND-016_preview.jpg` | 432-byte JPEG present in BOTH R2 and assets in phase 2 — proves R2 wins |
| `fixture/r2-preview/WB-BND-016_preview.jpg` | 428-byte JPEG seeded into the local R2 sim at `static/previews/WB-BND-016_preview.jpg` |
| `TEST-OUTPUT.txt` | recorded passing run (115/115) |

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
node run-tests.mjs          # expect: 115 passed, 0 failed
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
- **renamed catalogue**: the five owner-approved pack names are served (`WB-BND-016/017/019/020/021`), zero franchise names anywhere in the served catalogue, and every `zip_filename` delivery key is byte-identical to before
- **preview route, R2-first**: an object at `static/previews/<file>` in the private bucket serves with `image/jpeg` + `cache-control: public, max-age=3600` even with NO assets binding; `..%2F` traversal, normalized dot-dot paths and non-image extensions all 404 (the preview route is not a general file server)

Phase 2 (:8788, assets bound as `ASSETS` + R2, worker-first):
- `/static/previews/WB-BND-001_preview.jpg` → 200 `image/jpeg`, bytes identical to the asset on disk (R2 miss → ASSETS fallback, unchanged behaviour)
- `/static/previews/WB-BND-016_preview.jpg` exists in BOTH R2 and assets → the R2 bytes win, with cache-control; HEAD → 200 with content-length
- missing preview (absent from R2 AND assets) → 404 clean; API routes and `/products.json` still served by the worker; catalogue redaction intact

Phase 3 (:8789, R2 bound as `wildbills` — the owner's real name, `LEADS_ADMIN_KEY` set):
- valid token delivers the zip via `env.wildbills` with `PAID_BUNDLES` absent (sha256-identical; range requests work)
- `LEADS_ADMIN_KEY` env value accepted; the `wildbill2026` migration fallback is rejected once the env var is set (env wins); no key → 401

Phase 4 (:8790, no R2 binding):
- `/api/download/<token>` → 500 fail-closed, error names both `PAID_BUNDLES` and `wildbills`
- preview request → clean 404 (never 500)

Phase 5 (:8791, assets bound, NO R2 binding):
- preview → 200 from ASSETS, bytes identical to disk (the owner can keep serving previews before/without R2)
- preview absent from both → clean 404; `/api/download` still fails closed (500 naming both bindings)

## Difference vs production
Phase 1 mirrors the owner's pasted config (no assets binding): only R2-served
previews are testable there. Phases 2 and 5 set `run_worker_first` so the
Worker sees preview requests first — the same worker-first shape production
has (the pasted `_worker.js` handles every request, calling `env.ASSETS`
explicitly). The `STRIPE_API_BASE` env override exists ONLY in `.dev.vars`;
production defaults to `https://api.stripe.com`.
