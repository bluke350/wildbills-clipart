# Local end-to-end test for the merged `wildbills-vault-worker.js`

Proves the gated-delivery merge works before the owner pastes the file into the
Cloudflare dashboard editor. Runs the real worker file under `wrangler dev`
(miniflare) with a local R2 bucket bound as `PAID_BUNDLES` and a local mock of
the Stripe REST API. Nothing is deployed; nothing touches the live bucket.

## Files
| File | Purpose |
|---|---|
| `wrangler.toml` | local-only config: worker entry `../wildbills-vault-worker.js`, R2 binding `PAID_BUNDLES` → `wildbills-vault-bundles-local` |
| `.dev.vars` | LOCAL TEST DUMMIES ONLY (signing secret, fake Stripe key, `whsec_` dummy, `STRIPE_API_BASE` override) |
| `mock-stripe.mjs` | mock of `POST /v1/checkout/sessions` + `GET /v1/checkout/sessions/:id` on 127.0.0.1:9799 |
| `run-tests.mjs` | the test suite (extends the harness from `/home/team/shared/vault-fix/worker/test/run-tests.mjs`) |
| `fixture/bundle_bass_fishing.zip` | synthetic 2.5 MB fixture (NOT a real bundle) |
| `TEST-OUTPUT.txt` | recorded passing run (58/58) |

## Setup note (this machine)
`npm install` here hits a disk-space limit on `/home`. The working wrangler
install lives in `/home/team/shared/vault-fix/worker/node_modules` — symlink it:

```bash
ln -s /home/team/shared/vault-fix/worker/node_modules node_modules
```

(On a normal machine: `npm install` instead.)

## Run

```bash
# 1. seed the local R2 simulation (bucket NAME, not binding name)
node node_modules/wrangler/bin/wrangler.js r2 object put \
  "wildbills-vault-bundles-local/bundle_bass_fishing.zip" \
  --file fixture/bundle_bass_fishing.zip --local

# 2. start the mock Stripe API and the worker
node mock-stripe.mjs &                 # 127.0.0.1:9799
node node_modules/wrangler/bin/wrangler.js dev --port 8787 &

# 3. run the suite
node run-tests.mjs                     # expect: 58 passed, 0 failed
```

## What is covered
- `GET /api/download` with no token → 400; legacy `?sku=` / `?file=` shape → 401 JSON, never a redirect
- tampered / garbage / expired tokens → 403
- valid token → 200 `application/zip`, sha256-identical to the stored object, `cache-control: private, no-store`
- range requests → 206 with correct `content-range`
- `POST /api/create-checkout` → Stripe checkout URL; the handler sends `unit_amount=2499` (24.99) and `metadata[sku]`
- `POST /api/stripe-webhook`: valid signature → purchase recorded + link minted; bad signature / stale timestamp → 400; unpaid session / unknown SKU → no link
- `GET /api/download-link` (success path): only a session Stripe reports `payment_status: "paid"` mints a link; SKU mismatch → 403
- `GET /success` and `/success.html` render the buyer page that drives `/api/download-link`
- `/products.json` + `/static/products.json`: 27 products, zero `r2.dev` strings, zero `r2_download_url`/`download_url`/`zip_path` fields, prices unchanged
- existing routes intact: `/api/auto-promote`, `/api/free-sample` (401 without admin key), CORS preflight
- unknown paths → clean 404 JSON (no more 500 `error code: 1101` when the ASSETS binding is absent)

## Difference vs production
In production the catalogue is served from the worker's static ASSETS; the
redaction layer (`wvStripStorageUrls`) also runs over the asset-served JSON.
Locally there is no ASSETS binding, so the suite exercises the embedded-catalogue
fallback path of the same redaction code. The `STRIPE_API_BASE` env override
exists ONLY in `.dev.vars`; production defaults to `https://api.stripe.com`.
