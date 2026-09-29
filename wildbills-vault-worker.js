var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// index.js
var __defProp2 = Object.defineProperty;
var __name2 = /* @__PURE__ */ __name((target, value) => __defProp2(target, "name", { value, configurable: true }), "__name");
async function onRequestPost(context) {
  const { request, env } = context;
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };
  try {
    const STRIPE_SECRET = env.STRIPE_SECRET_KEY;
    if (!STRIPE_SECRET) {
      return new Response(
        JSON.stringify({ error: "Stripe secret key is missing in environment variables (STRIPE_SECRET_KEY)." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const STRIPE_API_BASE = env.STRIPE_API_BASE || "https://api.stripe.com";
    const body = await request.json().catch(() => ({}));
    const origin = new URL(request.url).origin;
    /* SERVER-SIDE PRICING: the amount charged is resolved from the embedded
       catalogue by SKU. Client-supplied price/name/stripe_price_id/product_id
       values are never trusted, so a tampered request body cannot make Stripe
       charge less than the advertised price. Fail closed on unknown/missing SKU. */
    const requestedSku = body && body.sku ? String(body.sku).trim() : "";
    const product = requestedSku ? wvFindProduct(requestedSku) : null;
    if (!product || typeof product.price !== "number" || !(product.price > 0)) {
      return new Response(
        JSON.stringify({ error: "Unknown or missing SKU. Prices are resolved server-side from the catalogue; send a valid product SKU." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const sku = product.sku;
    const itemPriceInCents = Math.round(product.price * 100);
    const itemName = product.name || product.title || `Clipart Bundle ${sku}`;
    const itemProductId = sku;
    const successUrl = `${origin}/success.html?session_id={CHECKOUT_SESSION_ID}&sku=${encodeURIComponent(sku)}`;
    const cancelUrl = `${origin}/product.html?sku=${encodeURIComponent(sku)}&canceled=true`;
    const params = new URLSearchParams();
    params.append("mode", "payment");
    params.append("success_url", successUrl);
    params.append("cancel_url", cancelUrl);
    if (product.stripe_price_id) {
      // A Stripe Price object may only come from the catalogue entry itself -
      // never from the client body.
      params.append("line_items[0][price]", String(product.stripe_price_id));
      params.append("line_items[0][quantity]", "1");
    } else {
      params.append("line_items[0][price_data][currency]", "usd");
      params.append("line_items[0][price_data][product_data][name]", itemName);
      params.append("line_items[0][price_data][product_data][tax_code]", "txcd_10000000");
      params.append("line_items[0][price_data][product_data][metadata][sku]", sku);
      params.append("line_items[0][price_data][product_data][metadata][product_id]", itemProductId);
      params.append("line_items[0][price_data][unit_amount]", itemPriceInCents.toString());
      params.append("line_items[0][quantity]", "1");
    }
    params.append("metadata[sku]", sku);
    params.append("metadata[product_id]", itemProductId);
    const stripeResponse = await fetch(`${STRIPE_API_BASE}/v1/checkout/sessions`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${STRIPE_SECRET}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: params.toString()
    });
    const session = await stripeResponse.json();
    if (!stripeResponse.ok) {
      console.error("Stripe API error:", session);
      return new Response(
        JSON.stringify({ error: session.error?.message || "Failed to create Stripe Checkout session" }),
        { status: stripeResponse.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    return new Response(
      JSON.stringify({ url: session.url, sessionId: session.id }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Create Checkout error:", err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}
__name(onRequestPost, "onRequestPost");
__name2(onRequestPost, "onRequestPost");
async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    }
  });
}
__name(onRequestOptions, "onRequestOptions");
__name2(onRequestOptions, "onRequestOptions");
async function onRequestPost2(context) {
  const { request, env } = context;
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };
  try {
    const body = await request.json().catch(() => ({}));
    const email = (body.email || "").trim().toLowerCase();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email || !emailRegex.test(email)) {
      return new Response(
        JSON.stringify({ error: "Please enter a valid email address to claim your free clipart pack." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const timestamp = (/* @__PURE__ */ new Date()).toISOString();
    const leadData = { email, timestamp, source: "free-sample-pack" };
    if (env.LEADS_KV) {
      const key = `lead:${email}:${Date.now()}`;
      await env.LEADS_KV.put(key, JSON.stringify(leadData));
    }
    console.log(`[Lead Captured & Saved to LEADS_KV] Email: ${email} | Timestamp: ${timestamp}`);
    const origin = new URL(request.url).origin;
    const downloadUrl = `${origin}/static/bundles/WB-FREE-SAMPLE.zip`;
    return new Response(
      JSON.stringify({
        success: true,
        download_url: downloadUrl,
        message: "Success! Your 10 Free Premium Clipart Assets are ready for download.",
        email
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Free Sample API error:", err);
    return new Response(
      JSON.stringify({ error: "An unexpected error occurred. Please try again." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}
__name(onRequestPost2, "onRequestPost2");
__name2(onRequestPost2, "onRequestPost");
async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };
  const adminSecret = url.searchParams.get("key");
  /* The real key is the LEADS_ADMIN_KEY dashboard secret / env var. The literal
     below is a MIGRATION FALLBACK ONLY so existing access keeps working until
     LEADS_ADMIN_KEY is set - once it is configured, delete the literal. */
  const expectedKey = String(env.LEADS_ADMIN_KEY || "wildbill2026");
  if (!adminSecret || !wvTimingSafeEqual(String(adminSecret), expectedKey)) {
    return new Response(JSON.stringify({ error: "Unauthorized access" }), { status: 401, headers: corsHeaders });
  }
  if (!env.LEADS_KV) {
    return new Response(JSON.stringify({ error: "LEADS_KV namespace not bound in environment" }), { status: 500, headers: corsHeaders });
  }
  const list = await env.LEADS_KV.list({ prefix: "lead:" });
  const leads = [];
  for (const k of list.keys) {
    const val = await env.LEADS_KV.get(k.name);
    if (val) {
      try {
        leads.push(JSON.parse(val));
      } catch (e) {
        leads.push({ key: k.name, value: val });
      }
    }
  }
  return new Response(JSON.stringify({ count: leads.length, leads }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
}
__name(onRequestGet, "onRequestGet");
__name2(onRequestGet, "onRequestGet");
async function onRequestOptions2() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    }
  });
}
__name(onRequestOptions2, "onRequestOptions2");
__name2(onRequestOptions2, "onRequestOptions");
async function onRequestPost3(context) {
  const { request, env } = context;
  const WEBHOOK_SECRET = env.STRIPE_WEBHOOK_SECRET;
  if (!WEBHOOK_SECRET) {
    return new Response(
      JSON.stringify({ error: "Stripe webhook secret is missing in environment variables (STRIPE_WEBHOOK_SECRET)." }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
  const payload = await request.text();
  const sigHeader = request.headers.get("stripe-signature");
  const okSig = await wvVerifyStripeSignature(payload, sigHeader, WEBHOOK_SECRET);
  if (!okSig) {
    return new Response(JSON.stringify({ error: "invalid Stripe signature" }), {
      status: 400,
      headers: { "Content-Type": "application/json" }
    });
  }
  let event;
  try {
    event = JSON.parse(payload);
  } catch (err) {
    return new Response("Webhook Error: bad payload", { status: 400 });
  }
  if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
    const session = event.data && event.data.object ? event.data.object : {};
    if (session.payment_status !== "paid") {
      console.log(`Checkout session ${session.id || "unknown"} not yet paid (${session.payment_status}); no link minted.`);
      return new Response(JSON.stringify({ received: true, minted: false, reason: "session not paid" }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }
    const customerEmail = session.customer_details ? session.customer_details.email : session.customer_email;
    const rawSku = (session.client_reference_id || (session.metadata ? session.metadata.sku || session.metadata.product_id : "") || "").toString();
    const sku = rawSku.trim().toUpperCase();
    console.log(`Purchase Completed for ${customerEmail || "unknown"} - SKU: ${sku}`);
    if (env.LEADS_KV) {
      try {
        await env.LEADS_KV.put(`purchase:${session.id || Date.now()}`, JSON.stringify({
          session_id: session.id,
          sku,
          email: customerEmail,
          amount_total: session.amount_total,
          timestamp: (/* @__PURE__ */ new Date()).toISOString()
        }));
      } catch (e) {
        console.error("Purchase record error:", e);
      }
    }
    let downloadLink = null;
    if (sku && wvFindProduct(sku) && env.DOWNLOAD_SIGNING_SECRET) {
      downloadLink = `${new URL(request.url).origin}/api/download/${encodeURIComponent(await wvMintToken(sku, env))}`;
      console.log(`Generated secure download link: ${downloadLink}`);
    }
    return new Response(JSON.stringify({ received: true, minted: !!downloadLink, sku: sku || undefined, download_url: downloadLink }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  }
  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}
__name(onRequestPost3, "onRequestPost3");
__name2(onRequestPost3, "onRequestPost");
// generateB2DownloadUrl and its hardcoded B2 credentials were removed: delivery now
// goes through the private R2 binding (PAID_BUNDLES or wildbills) with signed tokens only.
async function onRequest(context) {
  const BASE_URL = "https://clipart.wildbillsproplans.com";
  const INDEXNOW_KEY = "pixelforge2026indexnowkey";
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json"
  };
  if (context.request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  try {
    const urlList = [
      `${BASE_URL}/`,
      `${BASE_URL}/sitemap.xml`,
      `${BASE_URL}/google_shopping_feed.xml`,
      `${BASE_URL}/pinterest_catalog.csv`,
      `${BASE_URL}/pinterest_shopping_catalog.csv`,
      `${BASE_URL}/feed.xml`,
      `${BASE_URL}/ads.txt`
    ];
    let pingResults = [];
    if (context.request.method === "POST") {
      const endpoints = [
        "https://api.indexnow.org/indexnow",
        "https://www.bing.com/indexnow",
        "https://yandex.com/indexnow",
        "https://search.seznam.cz/indexnow"
      ];
      const payload = {
        host: "clipart.wildbillsproplans.com",
        key: INDEXNOW_KEY,
        keyLocation: `${BASE_URL}/pixelforge2026indexnowkey.txt`,
        urlList
      };
      for (const ep of endpoints) {
        try {
          const res = await fetch(ep, {
            method: "POST",
            headers: { "Content-Type": "application/json; charset=utf-8" },
            body: JSON.stringify(payload)
          });
          pingResults.push({ endpoint: ep, status: res.status, ok: res.ok });
        } catch (e) {
          pingResults.push({ endpoint: ep, error: e.message });
        }
      }
    }
    return new Response(JSON.stringify({
      success: true,
      message: "Wild Bill Vault Self-Promoting API Active",
      indexnow_key: INDEXNOW_KEY,
      key_location: `${BASE_URL}/pixelforge2026indexnowkey.txt`,
      syndication_feeds: {
        google_shopping_xml: `${BASE_URL}/google_shopping_feed.xml`,
        pinterest_catalog_csv: `${BASE_URL}/pinterest_catalog.csv`,
        pinterest_shopping_csv: `${BASE_URL}/pinterest_shopping_catalog.csv`,
        rss_feed_xml: `${BASE_URL}/feed.xml`,
        sitemap_xml: `${BASE_URL}/sitemap.xml`,
        social_posts_json: `${BASE_URL}/social_posts.json`
      },
      indexnow_ping_results: pingResults,
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    }), {
      status: 200,
      headers: corsHeaders
    });
  } catch (err) {
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 500,
      headers: corsHeaders
    });
  }
}
__name(onRequest, "onRequest");
__name2(onRequest, "onRequest");
var products_default = [
  {
    sku: "WB-BND-001",
    title: "90s Grunge Nostalgic Punk Zine Clipart Collection",
    name: "90s Grunge Nostalgic Punk Zine Clipart Mega-Bundle",
    category: "90s Grunge Nostalgic Punk Zine",
    price: 24.99,
    original_price: 79.99,
    preview_url: "/static/previews/WB-BND-001_preview.jpg",
    image_url: "/static/previews/WB-BND-001_preview.jpg",
    previews: [
      "/static/previews/WB-BND-001_preview.jpg"
    ],
    zip_filename: "bundle_90s_grunge_nostalgic_punk_zine.zip",
    file_count: 2872,
    design_count: 359,
    size_mb: 5881.78,
    description: "\u2728 90S GRUNGE NOSTALGIC PUNK ZINE MEGA CLIPART BUNDLE (359 DESIGNS / 2872 FILES) \u2728\n\nInstantly elevate your print-on-demand shop, sticker collection, and craft projects with the ultimate 90s Grunge Nostalgic Punk Zine Clipart Bundle! Created in crisp 3072x3072 resolution, every asset comes isolated with a clean transparent background and multi-vector formats.\n\n\u{1F4E6} WHAT IS INCLUDED IN YOUR DOWNLOAD:\n--------------------------------------------------\n\u2714 359 High-Resolution Asset Designs (3072 x 3072 pixels, 300 DPI)\n\u2714 Transparent PNG Files (Crisp isolated backgrounds)\n\u2714 Scalable Vector SVG Files (Fully editable & layered)\n\u2714 Master EPS & DXF Files (For vinyl cutters, Silhouette, Cricut, Laser)\n\u2714 Web-Optimized WEBP & JPG Previews\n\u2714 Print-Ready PDF & TIFF Master Files\n\u2714 Full Commercial Use License Included\n\n\u{1F3A8} PERFECT FOR:\n--------------------------------------------------\n\u2022 Sublimation Tumblers, Mugs, & Apparel (Printify / Printful / Gelato)\n\u2022 Sticker Sheet Crafts & Cricut Cut Projects\n\u2022 Twitch / YouTube Stream Overlays & Banners\n\u2022 Digital Planners, Scrapbooking, & Stationery\n\u2022 Wall Art Prints & Graphic Tee Branding\n\n\u{1F680} INSTANT DELIVERY ACCESS:\nUpon purchase, you will receive an official Delivery PDF containing your high-speed cloud link to instantly access and download your organized ZIP folders.\n",
    seo_title: "90s Grunge Nostalgic Punk Zine Clipart Bundle, 359 PNG & SVG Vectors, Sublimation Graphic PNGs, Commercial Use",
    etsy_tags: [
      "90s grunge nostalgic",
      "90s grunge nostalgic",
      "90s grunge nostalgic",
      "90s bundle",
      "sublimation png",
      "vector graphics",
      "commercial license",
      "cricut svg cut file",
      "sticker pack png",
      "t shirt graphic png",
      "digital download",
      "pod graphics",
      "300 dpi png"
    ],
    theme_key: "90s_grunge_nostalgic_punk_zine",
    Gumroad_URL: "https://clipart.wildbillsproplans.com/product/wb-bnd-001",
    curated_designs_count: 30
  },
  {
    sku: "WB-BND-002",
    title: "Acid Core Neon Gradients Clipart Collection",
    name: "Acid Core Neon Gradients Clipart Mega-Bundle",
    category: "Acid Core Neon Gradients",
    price: 24.99,
    original_price: 79.99,
    preview_url: "/static/previews/WB-BND-002_preview.jpg",
    image_url: "/static/previews/WB-BND-002_preview.jpg",
    previews: [
      "/static/previews/WB-BND-002_preview.jpg"
    ],
    zip_filename: "bundle_acid_core_neon_gradients.zip",
    file_count: 80,
    design_count: 10,
    size_mb: 95.93,
    description: "\u2728 ACID CORE NEON GRADIENTS MEGA CLIPART BUNDLE (10 DESIGNS / 80 FILES) \u2728\n\nInstantly elevate your print-on-demand shop, sticker collection, and craft projects with the ultimate Acid Core Neon Gradients Clipart Bundle! Created in crisp 3072x3072 resolution, every asset comes isolated with a clean transparent background and multi-vector formats.\n\n\u{1F4E6} WHAT IS INCLUDED IN YOUR DOWNLOAD:\n--------------------------------------------------\n\u2714 10 High-Resolution Asset Designs (3072 x 3072 pixels, 300 DPI)\n\u2714 Transparent PNG Files (Crisp isolated backgrounds)\n\u2714 Scalable Vector SVG Files (Fully editable & layered)\n\u2714 Master EPS & DXF Files (For vinyl cutters, Silhouette, Cricut, Laser)\n\u2714 Web-Optimized WEBP & JPG Previews\n\u2714 Print-Ready PDF & TIFF Master Files\n\u2714 Full Commercial Use License Included\n\n\u{1F3A8} PERFECT FOR:\n--------------------------------------------------\n\u2022 Sublimation Tumblers, Mugs, & Apparel (Printify / Printful / Gelato)\n\u2022 Sticker Sheet Crafts & Cricut Cut Projects\n\u2022 Twitch / YouTube Stream Overlays & Banners\n\u2022 Digital Planners, Scrapbooking, & Stationery\n\u2022 Wall Art Prints & Graphic Tee Branding\n\n\u{1F680} INSTANT DELIVERY ACCESS:\nUpon purchase, you will receive an official Delivery PDF containing your high-speed cloud link to instantly access and download your organized ZIP folders.\n",
    seo_title: "Acid Core Neon Gradients Clipart Bundle, 10 PNG & SVG Vectors, Sublimation Graphic PNGs, Commercial Use",
    etsy_tags: [
      "acid core neon gradi",
      "acid core neon gradi",
      "acid core neon gradi",
      "acid bundle",
      "sublimation png",
      "vector graphics",
      "commercial license",
      "cricut svg cut file",
      "sticker pack png",
      "t shirt graphic png",
      "digital download",
      "pod graphics",
      "300 dpi png"
    ],
    theme_key: "acid_core_neon_gradients",
    Gumroad_URL: "https://clipart.wildbillsproplans.com/product/wb-bnd-002",
    curated_designs_count: 10
  },
  {
    sku: "WB-BND-003",
    title: "Bass Fishing Clipart Collection",
    name: "Bass Fishing Clipart Mega-Bundle",
    category: "Bass Fishing",
    price: 24.99,
    original_price: 79.99,
    preview_url: "/static/previews/WB-BND-003_preview.jpg",
    image_url: "/static/previews/WB-BND-003_preview.jpg",
    previews: [
      "/static/previews/WB-BND-003_preview.jpg"
    ],
    zip_filename: "bundle_bass_fishing.zip",
    file_count: 2e3,
    design_count: 250,
    size_mb: 338.69,
    description: "\u2728 BASS FISHING MEGA CLIPART BUNDLE (250 DESIGNS / 2000 FILES) \u2728\n\nInstantly elevate your print-on-demand shop, sticker collection, and craft projects with the ultimate Bass Fishing Clipart Bundle! Created in crisp 3072x3072 resolution, every asset comes isolated with a clean transparent background and multi-vector formats.\n\n\u{1F4E6} WHAT IS INCLUDED IN YOUR DOWNLOAD:\n--------------------------------------------------\n\u2714 250 High-Resolution Asset Designs (3072 x 3072 pixels, 300 DPI)\n\u2714 Transparent PNG Files (Crisp isolated backgrounds)\n\u2714 Scalable Vector SVG Files (Fully editable & layered)\n\u2714 Master EPS & DXF Files (For vinyl cutters, Silhouette, Cricut, Laser)\n\u2714 Web-Optimized WEBP & JPG Previews\n\u2714 Print-Ready PDF & TIFF Master Files\n\u2714 Full Commercial Use License Included\n\n\u{1F3A8} PERFECT FOR:\n--------------------------------------------------\n\u2022 Sublimation Tumblers, Mugs, & Apparel (Printify / Printful / Gelato)\n\u2022 Sticker Sheet Crafts & Cricut Cut Projects\n\u2022 Twitch / YouTube Stream Overlays & Banners\n\u2022 Digital Planners, Scrapbooking, & Stationery\n\u2022 Wall Art Prints & Graphic Tee Branding\n\n\u{1F680} INSTANT DELIVERY ACCESS:\nUpon purchase, you will receive an official Delivery PDF containing your high-speed cloud link to instantly access and download your organized ZIP folders.\n",
    seo_title: "Bass Fishing Clipart Bundle, 250 PNG & SVG Vectors, Sublimation Graphic PNGs, Commercial Use",
    etsy_tags: [
      "bass fishing clipart",
      "bass fishing png",
      "bass fishing svg",
      "bass bundle",
      "sublimation png",
      "vector graphics",
      "commercial license",
      "cricut svg cut file",
      "sticker pack png",
      "t shirt graphic png",
      "digital download",
      "pod graphics",
      "300 dpi png"
    ],
    theme_key: "bass_fishing",
    Gumroad_URL: "https://clipart.wildbillsproplans.com/product/wb-bnd-003",
    curated_designs_count: 30
  },
  {
    sku: "WB-BND-004",
    title: "Crazy Wild Cyberpunk Clipart Collection",
    name: "Crazy Wild Cyberpunk Clipart Mega-Bundle",
    category: "Crazy Wild Cyberpunk",
    price: 24.99,
    original_price: 79.99,
    preview_url: "/static/previews/WB-BND-004_preview.jpg",
    image_url: "/static/previews/WB-BND-004_preview.jpg",
    previews: [
      "/static/previews/WB-BND-004_preview.jpg"
    ],
    zip_filename: "bundle_crazy_wild_cyberpunk.zip",
    file_count: 1864,
    design_count: 233,
    size_mb: 150,
    description: "\u2728 CRAZY WILD CYBERPUNK MEGA CLIPART BUNDLE (233 DESIGNS / 1864 FILES) \u2728\n\nInstantly elevate your print-on-demand shop, sticker collection, and craft projects with the ultimate Crazy Wild Cyberpunk Clipart Bundle! Created in crisp 3072x3072 resolution, every asset comes isolated with a clean transparent background and multi-vector formats.\n\n\u{1F4E6} WHAT IS INCLUDED IN YOUR DOWNLOAD:\n--------------------------------------------------\n\u2714 233 High-Resolution Asset Designs (3072 x 3072 pixels, 300 DPI)\n\u2714 Transparent PNG Files (Crisp isolated backgrounds)\n\u2714 Scalable Vector SVG Files (Fully editable & layered)\n\u2714 Master EPS & DXF Files (For vinyl cutters, Silhouette, Cricut, Laser)\n\u2714 Web-Optimized WEBP & JPG Previews\n\u2714 Print-Ready PDF & TIFF Master Files\n\u2714 Full Commercial Use License Included\n\n\u{1F3A8} PERFECT FOR:\n--------------------------------------------------\n\u2022 Sublimation Tumblers, Mugs, & Apparel (Printify / Printful / Gelato)\n\u2022 Sticker Sheet Crafts & Cricut Cut Projects\n\u2022 Twitch / YouTube Stream Overlays & Banners\n\u2022 Digital Planners, Scrapbooking, & Stationery\n\u2022 Wall Art Prints & Graphic Tee Branding\n\n\u{1F680} INSTANT DELIVERY ACCESS:\nUpon purchase, you will receive an official Delivery PDF containing your high-speed cloud link to instantly access and download your organized ZIP folders.\n",
    seo_title: "Crazy Wild Cyberpunk Clipart Bundle, 233 PNG & SVG Vectors, Sublimation Graphic PNGs, Commercial Use",
    etsy_tags: [
      "crazy wild cyberpunk",
      "crazy wild cyberpunk",
      "crazy wild cyberpunk",
      "crazy bundle",
      "sublimation png",
      "vector graphics",
      "commercial license",
      "cricut svg cut file",
      "sticker pack png",
      "t shirt graphic png",
      "digital download",
      "pod graphics",
      "300 dpi png"
    ],
    theme_key: "crazy_wild_cyberpunk",
    Gumroad_URL: "https://clipart.wildbillsproplans.com/product/wb-bnd-004",
    curated_designs_count: 30
  },
  {
    sku: "WB-BND-005",
    title: "Creepy Cute Pastel Goth Halloween Clipart Collection",
    name: "Creepy Cute Pastel Goth Halloween Clipart Mega-Bundle",
    category: "Creepy Cute Pastel Goth Halloween",
    price: 24.99,
    original_price: 79.99,
    preview_url: "/static/previews/WB-BND-005_preview.jpg",
    image_url: "/static/previews/WB-BND-005_preview.jpg",
    previews: [
      "/static/previews/WB-BND-005_preview.jpg"
    ],
    zip_filename: "bundle_creepy_cute_pastel_goth_halloween.zip",
    file_count: 3560,
    design_count: 445,
    size_mb: 150,
    description: "\u2728 CREEPY CUTE PASTEL GOTH HALLOWEEN MEGA CLIPART BUNDLE (445 DESIGNS / 3560 FILES) \u2728\n\nInstantly elevate your print-on-demand shop, sticker collection, and craft projects with the ultimate Creepy Cute Pastel Goth Halloween Clipart Bundle! Created in crisp 3072x3072 resolution, every asset comes isolated with a clean transparent background and multi-vector formats.\n\n\u{1F4E6} WHAT IS INCLUDED IN YOUR DOWNLOAD:\n--------------------------------------------------\n\u2714 445 High-Resolution Asset Designs (3072 x 3072 pixels, 300 DPI)\n\u2714 Transparent PNG Files (Crisp isolated backgrounds)\n\u2714 Scalable Vector SVG Files (Fully editable & layered)\n\u2714 Master EPS & DXF Files (For vinyl cutters, Silhouette, Cricut, Laser)\n\u2714 Web-Optimized WEBP & JPG Previews\n\u2714 Print-Ready PDF & TIFF Master Files\n\u2714 Full Commercial Use License Included\n\n\u{1F3A8} PERFECT FOR:\n--------------------------------------------------\n\u2022 Sublimation Tumblers, Mugs, & Apparel (Printify / Printful / Gelato)\n\u2022 Sticker Sheet Crafts & Cricut Cut Projects\n\u2022 Twitch / YouTube Stream Overlays & Banners\n\u2022 Digital Planners, Scrapbooking, & Stationery\n\u2022 Wall Art Prints & Graphic Tee Branding\n\n\u{1F680} INSTANT DELIVERY ACCESS:\nUpon purchase, you will receive an official Delivery PDF containing your high-speed cloud link to instantly access and download your organized ZIP folders.\n",
    seo_title: "Creepy Cute Pastel Goth Halloween Clipart Bundle, 445 PNG & SVG Vectors, Sublimation Graphic PNGs, Commercial Use",
    etsy_tags: [
      "creepy cute pastel g",
      "creepy cute pastel g",
      "creepy cute pastel g",
      "creepy bundle",
      "sublimation png",
      "vector graphics",
      "commercial license",
      "cricut svg cut file",
      "sticker pack png",
      "t shirt graphic png",
      "digital download",
      "pod graphics",
      "300 dpi png"
    ],
    theme_key: "creepy_cute_pastel_goth_halloween",
    Gumroad_URL: "https://clipart.wildbillsproplans.com/product/wb-bnd-005",
    curated_designs_count: 30
  },
  {
    sku: "WB-BND-006",
    title: "Creepy Cute Seasonal Holidays Clipart Collection",
    name: "Creepy Cute Seasonal Holidays Clipart Mega-Bundle",
    category: "Creepy Cute Seasonal Holidays",
    price: 24.99,
    original_price: 79.99,
    preview_url: "/static/previews/WB-BND-006_preview.jpg",
    image_url: "/static/previews/WB-BND-006_preview.jpg",
    previews: [
      "/static/previews/WB-BND-006_preview.jpg"
    ],
    zip_filename: "bundle_creepy_cute_seasonal_holidays.zip",
    file_count: 32,
    design_count: 4,
    size_mb: 150,
    description: "\u2728 CREEPY CUTE SEASONAL HOLIDAYS MEGA CLIPART BUNDLE (4 DESIGNS / 32 FILES) \u2728\n\nInstantly elevate your print-on-demand shop, sticker collection, and craft projects with the ultimate Creepy Cute Seasonal Holidays Clipart Bundle! Created in crisp 3072x3072 resolution, every asset comes isolated with a clean transparent background and multi-vector formats.\n\n\u{1F4E6} WHAT IS INCLUDED IN YOUR DOWNLOAD:\n--------------------------------------------------\n\u2714 4 High-Resolution Asset Designs (3072 x 3072 pixels, 300 DPI)\n\u2714 Transparent PNG Files (Crisp isolated backgrounds)\n\u2714 Scalable Vector SVG Files (Fully editable & layered)\n\u2714 Master EPS & DXF Files (For vinyl cutters, Silhouette, Cricut, Laser)\n\u2714 Web-Optimized WEBP & JPG Previews\n\u2714 Print-Ready PDF & TIFF Master Files\n\u2714 Full Commercial Use License Included\n\n\u{1F3A8} PERFECT FOR:\n--------------------------------------------------\n\u2022 Sublimation Tumblers, Mugs, & Apparel (Printify / Printful / Gelato)\n\u2022 Sticker Sheet Crafts & Cricut Cut Projects\n\u2022 Twitch / YouTube Stream Overlays & Banners\n\u2022 Digital Planners, Scrapbooking, & Stationery\n\u2022 Wall Art Prints & Graphic Tee Branding\n\n\u{1F680} INSTANT DELIVERY ACCESS:\nUpon purchase, you will receive an official Delivery PDF containing your high-speed cloud link to instantly access and download your organized ZIP folders.\n",
    seo_title: "Creepy Cute Seasonal Holidays Clipart Bundle, 4 PNG & SVG Vectors, Sublimation Graphic PNGs, Commercial Use",
    etsy_tags: [
      "creepy cute seasonal",
      "creepy cute seasonal",
      "creepy cute seasonal",
      "creepy bundle",
      "sublimation png",
      "vector graphics",
      "commercial license",
      "cricut svg cut file",
      "sticker pack png",
      "t shirt graphic png",
      "digital download",
      "pod graphics",
      "300 dpi png"
    ],
    theme_key: "creepy_cute_seasonal_holidays",
    Gumroad_URL: "https://clipart.wildbillsproplans.com/product/wb-bnd-006",
    curated_designs_count: 4
  },
  {
    sku: "WB-BND-007",
    title: "Cyberpunk Neon Synthwave Clipart Collection",
    name: "Cyberpunk Neon Synthwave Clipart Mega-Bundle",
    category: "Cyberpunk Neon Synthwave",
    price: 24.99,
    original_price: 79.99,
    preview_url: "/static/previews/WB-BND-007_preview.jpg",
    image_url: "/static/previews/WB-BND-007_preview.jpg",
    previews: [
      "/static/previews/WB-BND-007_preview.jpg"
    ],
    zip_filename: "bundle_cyberpunk_neon_synthwave.zip",
    file_count: 2840,
    design_count: 355,
    size_mb: 150,
    description: "\u2728 CYBERPUNK NEON SYNTHWAVE MEGA CLIPART BUNDLE (355 DESIGNS / 2840 FILES) \u2728\n\nInstantly elevate your print-on-demand shop, sticker collection, and craft projects with the ultimate Cyberpunk Neon Synthwave Clipart Bundle! Created in crisp 3072x3072 resolution, every asset comes isolated with a clean transparent background and multi-vector formats.\n\n\u{1F4E6} WHAT IS INCLUDED IN YOUR DOWNLOAD:\n--------------------------------------------------\n\u2714 355 High-Resolution Asset Designs (3072 x 3072 pixels, 300 DPI)\n\u2714 Transparent PNG Files (Crisp isolated backgrounds)\n\u2714 Scalable Vector SVG Files (Fully editable & layered)\n\u2714 Master EPS & DXF Files (For vinyl cutters, Silhouette, Cricut, Laser)\n\u2714 Web-Optimized WEBP & JPG Previews\n\u2714 Print-Ready PDF & TIFF Master Files\n\u2714 Full Commercial Use License Included\n\n\u{1F3A8} PERFECT FOR:\n--------------------------------------------------\n\u2022 Sublimation Tumblers, Mugs, & Apparel (Printify / Printful / Gelato)\n\u2022 Sticker Sheet Crafts & Cricut Cut Projects\n\u2022 Twitch / YouTube Stream Overlays & Banners\n\u2022 Digital Planners, Scrapbooking, & Stationery\n\u2022 Wall Art Prints & Graphic Tee Branding\n\n\u{1F680} INSTANT DELIVERY ACCESS:\nUpon purchase, you will receive an official Delivery PDF containing your high-speed cloud link to instantly access and download your organized ZIP folders.\n",
    seo_title: "Cyberpunk Neon Synthwave Clipart Bundle, 355 PNG & SVG Vectors, Sublimation Graphic PNGs, Commercial Use",
    etsy_tags: [
      "cyberpunk neon synth",
      "cyberpunk neon synth",
      "cyberpunk neon synth",
      "cyberpunk bundle",
      "sublimation png",
      "vector graphics",
      "commercial license",
      "cricut svg cut file",
      "sticker pack png",
      "t shirt graphic png",
      "digital download",
      "pod graphics",
      "300 dpi png"
    ],
    theme_key: "cyberpunk_neon_synthwave",
    Gumroad_URL: "https://clipart.wildbillsproplans.com/product/wb-bnd-007",
    curated_designs_count: 30
  },
  {
    sku: "WB-BND-008",
    title: "Dark Cottagecore Poisonous Botanicals Clipart Collection",
    name: "Dark Cottagecore Poisonous Botanicals Clipart Mega-Bundle",
    category: "Dark Cottagecore Poisonous Botanicals",
    price: 24.99,
    original_price: 79.99,
    preview_url: "/static/previews/WB-BND-008_preview.jpg",
    image_url: "/static/previews/WB-BND-008_preview.jpg",
    previews: [
      "/static/previews/WB-BND-008_preview.jpg"
    ],
    zip_filename: "bundle_dark_cottagecore_poisonous_botanicals.zip",
    file_count: 3368,
    design_count: 421,
    size_mb: 150,
    description: "\u2728 DARK COTTAGECORE POISONOUS BOTANICALS MEGA CLIPART BUNDLE (421 DESIGNS / 3368 FILES) \u2728\n\nInstantly elevate your print-on-demand shop, sticker collection, and craft projects with the ultimate Dark Cottagecore Poisonous Botanicals Clipart Bundle! Created in crisp 3072x3072 resolution, every asset comes isolated with a clean transparent background and multi-vector formats.\n\n\u{1F4E6} WHAT IS INCLUDED IN YOUR DOWNLOAD:\n--------------------------------------------------\n\u2714 421 High-Resolution Asset Designs (3072 x 3072 pixels, 300 DPI)\n\u2714 Transparent PNG Files (Crisp isolated backgrounds)\n\u2714 Scalable Vector SVG Files (Fully editable & layered)\n\u2714 Master EPS & DXF Files (For vinyl cutters, Silhouette, Cricut, Laser)\n\u2714 Web-Optimized WEBP & JPG Previews\n\u2714 Print-Ready PDF & TIFF Master Files\n\u2714 Full Commercial Use License Included\n\n\u{1F3A8} PERFECT FOR:\n--------------------------------------------------\n\u2022 Sublimation Tumblers, Mugs, & Apparel (Printify / Printful / Gelato)\n\u2022 Sticker Sheet Crafts & Cricut Cut Projects\n\u2022 Twitch / YouTube Stream Overlays & Banners\n\u2022 Digital Planners, Scrapbooking, & Stationery\n\u2022 Wall Art Prints & Graphic Tee Branding\n\n\u{1F680} INSTANT DELIVERY ACCESS:\nUpon purchase, you will receive an official Delivery PDF containing your high-speed cloud link to instantly access and download your organized ZIP folders.\n",
    seo_title: "Dark Cottagecore Poisonous Botanicals Clipart Bundle, 421 PNG & SVG Vectors, Sublimation Graphic PNGs, Commercial Use",
    etsy_tags: [
      "dark cottagecore poi",
      "dark cottagecore poi",
      "dark cottagecore poi",
      "dark bundle",
      "sublimation png",
      "vector graphics",
      "commercial license",
      "cricut svg cut file",
      "sticker pack png",
      "t shirt graphic png",
      "digital download",
      "pod graphics",
      "300 dpi png"
    ],
    theme_key: "dark_cottagecore_poisonous_botanicals",
    Gumroad_URL: "https://clipart.wildbillsproplans.com/product/wb-bnd-008",
    curated_designs_count: 30
  },
  {
    sku: "WB-BND-009",
    title: "Dark Fantasy D D Classes Clipart Collection",
    name: "Dark Fantasy D D Classes Clipart Mega-Bundle",
    category: "Dark Fantasy D D Classes",
    price: 24.99,
    original_price: 79.99,
    preview_url: "/static/previews/WB-BND-009_preview.jpg",
    image_url: "/static/previews/WB-BND-009_preview.jpg",
    previews: [
      "/static/previews/WB-BND-009_preview.jpg"
    ],
    zip_filename: "bundle_dark_fantasy_d_d_classes.zip",
    file_count: 48,
    design_count: 6,
    size_mb: 150,
    description: "\u2728 DARK FANTASY D D CLASSES MEGA CLIPART BUNDLE (6 DESIGNS / 48 FILES) \u2728\n\nInstantly elevate your print-on-demand shop, sticker collection, and craft projects with the ultimate Dark Fantasy D D Classes Clipart Bundle! Created in crisp 3072x3072 resolution, every asset comes isolated with a clean transparent background and multi-vector formats.\n\n\u{1F4E6} WHAT IS INCLUDED IN YOUR DOWNLOAD:\n--------------------------------------------------\n\u2714 6 High-Resolution Asset Designs (3072 x 3072 pixels, 300 DPI)\n\u2714 Transparent PNG Files (Crisp isolated backgrounds)\n\u2714 Scalable Vector SVG Files (Fully editable & layered)\n\u2714 Master EPS & DXF Files (For vinyl cutters, Silhouette, Cricut, Laser)\n\u2714 Web-Optimized WEBP & JPG Previews\n\u2714 Print-Ready PDF & TIFF Master Files\n\u2714 Full Commercial Use License Included\n\n\u{1F3A8} PERFECT FOR:\n--------------------------------------------------\n\u2022 Sublimation Tumblers, Mugs, & Apparel (Printify / Printful / Gelato)\n\u2022 Sticker Sheet Crafts & Cricut Cut Projects\n\u2022 Twitch / YouTube Stream Overlays & Banners\n\u2022 Digital Planners, Scrapbooking, & Stationery\n\u2022 Wall Art Prints & Graphic Tee Branding\n\n\u{1F680} INSTANT DELIVERY ACCESS:\nUpon purchase, you will receive an official Delivery PDF containing your high-speed cloud link to instantly access and download your organized ZIP folders.\n",
    seo_title: "Dark Fantasy D D Classes Clipart Bundle, 6 PNG & SVG Vectors, Sublimation Graphic PNGs, Commercial Use",
    etsy_tags: [
      "dark fantasy d d cla",
      "dark fantasy d d cla",
      "dark fantasy d d cla",
      "dark bundle",
      "sublimation png",
      "vector graphics",
      "commercial license",
      "cricut svg cut file",
      "sticker pack png",
      "t shirt graphic png",
      "digital download",
      "pod graphics",
      "300 dpi png"
    ],
    theme_key: "dark_fantasy_d_d_classes",
    Gumroad_URL: "https://clipart.wildbillsproplans.com/product/wb-bnd-009",
    curated_designs_count: 6
  },
  {
    sku: "WB-BND-010",
    title: "Gold Glamour Maximalist Metallics Clipart Collection",
    name: "Gold Glamour Maximalist Metallics Clipart Mega-Bundle",
    category: "Gold Glamour Maximalist Metallics",
    price: 24.99,
    original_price: 79.99,
    preview_url: "/static/previews/WB-BND-010_preview.jpg",
    image_url: "/static/previews/WB-BND-010_preview.jpg",
    previews: [
      "/static/previews/WB-BND-010_preview.jpg"
    ],
    zip_filename: "bundle_gold_glamour_maximalist_metallics.zip",
    file_count: 3952,
    design_count: 494,
    size_mb: 150,
    description: "\u2728 GOLD GLAMOUR MAXIMALIST METALLICS MEGA CLIPART BUNDLE (494 DESIGNS / 3952 FILES) \u2728\n\nInstantly elevate your print-on-demand shop, sticker collection, and craft projects with the ultimate Gold Glamour Maximalist Metallics Clipart Bundle! Created in crisp 3072x3072 resolution, every asset comes isolated with a clean transparent background and multi-vector formats.\n\n\u{1F4E6} WHAT IS INCLUDED IN YOUR DOWNLOAD:\n--------------------------------------------------\n\u2714 494 High-Resolution Asset Designs (3072 x 3072 pixels, 300 DPI)\n\u2714 Transparent PNG Files (Crisp isolated backgrounds)\n\u2714 Scalable Vector SVG Files (Fully editable & layered)\n\u2714 Master EPS & DXF Files (For vinyl cutters, Silhouette, Cricut, Laser)\n\u2714 Web-Optimized WEBP & JPG Previews\n\u2714 Print-Ready PDF & TIFF Master Files\n\u2714 Full Commercial Use License Included\n\n\u{1F3A8} PERFECT FOR:\n--------------------------------------------------\n\u2022 Sublimation Tumblers, Mugs, & Apparel (Printify / Printful / Gelato)\n\u2022 Sticker Sheet Crafts & Cricut Cut Projects\n\u2022 Twitch / YouTube Stream Overlays & Banners\n\u2022 Digital Planners, Scrapbooking, & Stationery\n\u2022 Wall Art Prints & Graphic Tee Branding\n\n\u{1F680} INSTANT DELIVERY ACCESS:\nUpon purchase, you will receive an official Delivery PDF containing your high-speed cloud link to instantly access and download your organized ZIP folders.\n",
    seo_title: "Gold Glamour Maximalist Metallics Clipart Bundle, 494 PNG & SVG Vectors, Sublimation Graphic PNGs, Commercial Use",
    etsy_tags: [
      "gold glamour maximal",
      "gold glamour maximal",
      "gold glamour maximal",
      "gold bundle",
      "sublimation png",
      "vector graphics",
      "commercial license",
      "cricut svg cut file",
      "sticker pack png",
      "t shirt graphic png",
      "digital download",
      "pod graphics",
      "300 dpi png"
    ],
    theme_key: "gold_glamour_maximalist_metallics",
    Gumroad_URL: "https://clipart.wildbillsproplans.com/product/wb-bnd-010",
    curated_designs_count: 30
  },
  {
    sku: "WB-BND-011",
    title: "Hand Drawn Diy Collage Elements Clipart Collection",
    name: "Hand Drawn Diy Collage Elements Clipart Mega-Bundle",
    category: "Hand Drawn Diy Collage Elements",
    price: 24.99,
    original_price: 79.99,
    preview_url: "/static/previews/WB-BND-011_preview.jpg",
    image_url: "/static/previews/WB-BND-011_preview.jpg",
    previews: [
      "/static/previews/WB-BND-011_preview.jpg"
    ],
    zip_filename: "bundle_hand_drawn_diy_collage_elements.zip",
    file_count: 80,
    design_count: 10,
    size_mb: 150,
    description: "\u2728 HAND DRAWN DIY COLLAGE ELEMENTS MEGA CLIPART BUNDLE (10 DESIGNS / 80 FILES) \u2728\n\nInstantly elevate your print-on-demand shop, sticker collection, and craft projects with the ultimate Hand Drawn Diy Collage Elements Clipart Bundle! Created in crisp 3072x3072 resolution, every asset comes isolated with a clean transparent background and multi-vector formats.\n\n\u{1F4E6} WHAT IS INCLUDED IN YOUR DOWNLOAD:\n--------------------------------------------------\n\u2714 10 High-Resolution Asset Designs (3072 x 3072 pixels, 300 DPI)\n\u2714 Transparent PNG Files (Crisp isolated backgrounds)\n\u2714 Scalable Vector SVG Files (Fully editable & layered)\n\u2714 Master EPS & DXF Files (For vinyl cutters, Silhouette, Cricut, Laser)\n\u2714 Web-Optimized WEBP & JPG Previews\n\u2714 Print-Ready PDF & TIFF Master Files\n\u2714 Full Commercial Use License Included\n\n\u{1F3A8} PERFECT FOR:\n--------------------------------------------------\n\u2022 Sublimation Tumblers, Mugs, & Apparel (Printify / Printful / Gelato)\n\u2022 Sticker Sheet Crafts & Cricut Cut Projects\n\u2022 Twitch / YouTube Stream Overlays & Banners\n\u2022 Digital Planners, Scrapbooking, & Stationery\n\u2022 Wall Art Prints & Graphic Tee Branding\n\n\u{1F680} INSTANT DELIVERY ACCESS:\nUpon purchase, you will receive an official Delivery PDF containing your high-speed cloud link to instantly access and download your organized ZIP folders.\n",
    seo_title: "Hand Drawn Diy Collage Elements Clipart Bundle, 10 PNG & SVG Vectors, Sublimation Graphic PNGs, Commercial Use",
    etsy_tags: [
      "hand drawn diy colla",
      "hand drawn diy colla",
      "hand drawn diy colla",
      "hand bundle",
      "sublimation png",
      "vector graphics",
      "commercial license",
      "cricut svg cut file",
      "sticker pack png",
      "t shirt graphic png",
      "digital download",
      "pod graphics",
      "300 dpi png"
    ],
    theme_key: "hand_drawn_diy_collage_elements",
    Gumroad_URL: "https://clipart.wildbillsproplans.com/product/wb-bnd-011",
    curated_designs_count: 10
  },
  {
    sku: "WB-BND-012",
    title: "Highland Cows Floral Boho Clipart Collection",
    name: "Highland Cows Floral Boho Clipart Mega-Bundle",
    category: "Highland Cows Floral Boho",
    price: 24.99,
    original_price: 79.99,
    preview_url: "/static/previews/WB-BND-012_preview.jpg",
    image_url: "/static/previews/WB-BND-012_preview.jpg",
    previews: [
      "/static/previews/WB-BND-012_preview.jpg"
    ],
    zip_filename: "bundle_highland_cows_floral_boho.zip",
    file_count: 4064,
    design_count: 508,
    size_mb: 150,
    description: "\u2728 HIGHLAND COWS FLORAL BOHO MEGA CLIPART BUNDLE (508 DESIGNS / 4064 FILES) \u2728\n\nInstantly elevate your print-on-demand shop, sticker collection, and craft projects with the ultimate Highland Cows Floral Boho Clipart Bundle! Created in crisp 3072x3072 resolution, every asset comes isolated with a clean transparent background and multi-vector formats.\n\n\u{1F4E6} WHAT IS INCLUDED IN YOUR DOWNLOAD:\n--------------------------------------------------\n\u2714 508 High-Resolution Asset Designs (3072 x 3072 pixels, 300 DPI)\n\u2714 Transparent PNG Files (Crisp isolated backgrounds)\n\u2714 Scalable Vector SVG Files (Fully editable & layered)\n\u2714 Master EPS & DXF Files (For vinyl cutters, Silhouette, Cricut, Laser)\n\u2714 Web-Optimized WEBP & JPG Previews\n\u2714 Print-Ready PDF & TIFF Master Files\n\u2714 Full Commercial Use License Included\n\n\u{1F3A8} PERFECT FOR:\n--------------------------------------------------\n\u2022 Sublimation Tumblers, Mugs, & Apparel (Printify / Printful / Gelato)\n\u2022 Sticker Sheet Crafts & Cricut Cut Projects\n\u2022 Twitch / YouTube Stream Overlays & Banners\n\u2022 Digital Planners, Scrapbooking, & Stationery\n\u2022 Wall Art Prints & Graphic Tee Branding\n\n\u{1F680} INSTANT DELIVERY ACCESS:\nUpon purchase, you will receive an official Delivery PDF containing your high-speed cloud link to instantly access and download your organized ZIP folders.\n",
    seo_title: "Highland Cows Floral Boho Clipart Bundle, 508 PNG & SVG Vectors, Sublimation Graphic PNGs, Commercial Use",
    etsy_tags: [
      "highland cows floral",
      "highland cows floral",
      "highland cows floral",
      "highland bundle",
      "sublimation png",
      "vector graphics",
      "commercial license",
      "cricut svg cut file",
      "sticker pack png",
      "t shirt graphic png",
      "digital download",
      "pod graphics",
      "300 dpi png"
    ],
    theme_key: "highland_cows_floral_boho",
    Gumroad_URL: "https://clipart.wildbillsproplans.com/product/wb-bnd-012",
    curated_designs_count: 30
  },
  {
    sku: "WB-BND-013",
    title: "Mystical Tarot Clipart Collection",
    name: "Mystical Tarot Clipart Mega-Bundle",
    category: "Mystical Tarot",
    price: 24.99,
    original_price: 79.99,
    preview_url: "/static/previews/WB-BND-013_preview.jpg",
    image_url: "/static/previews/WB-BND-013_preview.jpg",
    previews: [
      "/static/previews/WB-BND-013_preview.jpg"
    ],
    zip_filename: "bundle_mystical_tarot.zip",
    file_count: 40,
    design_count: 5,
    size_mb: 150,
    description: "\u2728 MYSTICAL TAROT MEGA CLIPART BUNDLE (5 DESIGNS / 40 FILES) \u2728\n\nInstantly elevate your print-on-demand shop, sticker collection, and craft projects with the ultimate Mystical Tarot Clipart Bundle! Created in crisp 3072x3072 resolution, every asset comes isolated with a clean transparent background and multi-vector formats.\n\n\u{1F4E6} WHAT IS INCLUDED IN YOUR DOWNLOAD:\n--------------------------------------------------\n\u2714 5 High-Resolution Asset Designs (3072 x 3072 pixels, 300 DPI)\n\u2714 Transparent PNG Files (Crisp isolated backgrounds)\n\u2714 Scalable Vector SVG Files (Fully editable & layered)\n\u2714 Master EPS & DXF Files (For vinyl cutters, Silhouette, Cricut, Laser)\n\u2714 Web-Optimized WEBP & JPG Previews\n\u2714 Print-Ready PDF & TIFF Master Files\n\u2714 Full Commercial Use License Included\n\n\u{1F3A8} PERFECT FOR:\n--------------------------------------------------\n\u2022 Sublimation Tumblers, Mugs, & Apparel (Printify / Printful / Gelato)\n\u2022 Sticker Sheet Crafts & Cricut Cut Projects\n\u2022 Twitch / YouTube Stream Overlays & Banners\n\u2022 Digital Planners, Scrapbooking, & Stationery\n\u2022 Wall Art Prints & Graphic Tee Branding\n\n\u{1F680} INSTANT DELIVERY ACCESS:\nUpon purchase, you will receive an official Delivery PDF containing your high-speed cloud link to instantly access and download your organized ZIP folders.\n",
    seo_title: "Mystical Tarot Clipart Bundle, 5 PNG & SVG Vectors, Sublimation Graphic PNGs, Commercial Use",
    etsy_tags: [
      "mystical tarot clipa",
      "mystical tarot png",
      "mystical tarot svg",
      "mystical bundle",
      "sublimation png",
      "vector graphics",
      "commercial license",
      "cricut svg cut file",
      "sticker pack png",
      "t shirt graphic png",
      "digital download",
      "pod graphics",
      "300 dpi png"
    ],
    theme_key: "mystical_tarot",
    Gumroad_URL: "https://clipart.wildbillsproplans.com/product/wb-bnd-013",
    curated_designs_count: 5
  },
  {
    sku: "WB-BND-014",
    title: "Mystical Tarot Celestial Gold Clipart Collection",
    name: "Mystical Tarot Celestial Gold Clipart Mega-Bundle",
    category: "Mystical Tarot Celestial Gold",
    price: 24.99,
    original_price: 79.99,
    preview_url: "/static/previews/WB-BND-014_preview.jpg",
    image_url: "/static/previews/WB-BND-014_preview.jpg",
    previews: [
      "/static/previews/WB-BND-014_preview.jpg"
    ],
    zip_filename: "bundle_mystical_tarot_celestial_gold.zip",
    file_count: 4024,
    design_count: 503,
    size_mb: 150,
    description: "\u2728 MYSTICAL TAROT CELESTIAL GOLD MEGA CLIPART BUNDLE (503 DESIGNS / 4024 FILES) \u2728\n\nInstantly elevate your print-on-demand shop, sticker collection, and craft projects with the ultimate Mystical Tarot Celestial Gold Clipart Bundle! Created in crisp 3072x3072 resolution, every asset comes isolated with a clean transparent background and multi-vector formats.\n\n\u{1F4E6} WHAT IS INCLUDED IN YOUR DOWNLOAD:\n--------------------------------------------------\n\u2714 503 High-Resolution Asset Designs (3072 x 3072 pixels, 300 DPI)\n\u2714 Transparent PNG Files (Crisp isolated backgrounds)\n\u2714 Scalable Vector SVG Files (Fully editable & layered)\n\u2714 Master EPS & DXF Files (For vinyl cutters, Silhouette, Cricut, Laser)\n\u2714 Web-Optimized WEBP & JPG Previews\n\u2714 Print-Ready PDF & TIFF Master Files\n\u2714 Full Commercial Use License Included\n\n\u{1F3A8} PERFECT FOR:\n--------------------------------------------------\n\u2022 Sublimation Tumblers, Mugs, & Apparel (Printify / Printful / Gelato)\n\u2022 Sticker Sheet Crafts & Cricut Cut Projects\n\u2022 Twitch / YouTube Stream Overlays & Banners\n\u2022 Digital Planners, Scrapbooking, & Stationery\n\u2022 Wall Art Prints & Graphic Tee Branding\n\n\u{1F680} INSTANT DELIVERY ACCESS:\nUpon purchase, you will receive an official Delivery PDF containing your high-speed cloud link to instantly access and download your organized ZIP folders.\n",
    seo_title: "Mystical Tarot Celestial Gold Clipart Bundle, 503 PNG & SVG Vectors, Sublimation Graphic PNGs, Commercial Use",
    etsy_tags: [
      "mystical tarot celes",
      "mystical tarot celes",
      "mystical tarot celes",
      "mystical bundle",
      "sublimation png",
      "vector graphics",
      "commercial license",
      "cricut svg cut file",
      "sticker pack png",
      "t shirt graphic png",
      "digital download",
      "pod graphics",
      "300 dpi png"
    ],
    theme_key: "mystical_tarot_celestial_gold",
    Gumroad_URL: "https://clipart.wildbillsproplans.com/product/wb-bnd-014",
    curated_designs_count: 30
  },
  {
    sku: "WB-BND-015",
    title: "Retro Tech Glitch Vaporwave Clipart Collection",
    name: "Retro Tech Glitch Vaporwave Clipart Mega-Bundle",
    category: "Retro Tech Glitch Vaporwave",
    price: 24.99,
    original_price: 79.99,
    preview_url: "/static/previews/WB-BND-015_preview.jpg",
    image_url: "/static/previews/WB-BND-015_preview.jpg",
    previews: [
      "/static/previews/WB-BND-015_preview.jpg"
    ],
    zip_filename: "bundle_retro_tech_glitch_vaporwave.zip",
    file_count: 2920,
    design_count: 365,
    size_mb: 150,
    description: "\u2728 RETRO TECH GLITCH VAPORWAVE MEGA CLIPART BUNDLE (365 DESIGNS / 2920 FILES) \u2728\n\nInstantly elevate your print-on-demand shop, sticker collection, and craft projects with the ultimate Retro Tech Glitch Vaporwave Clipart Bundle! Created in crisp 3072x3072 resolution, every asset comes isolated with a clean transparent background and multi-vector formats.\n\n\u{1F4E6} WHAT IS INCLUDED IN YOUR DOWNLOAD:\n--------------------------------------------------\n\u2714 365 High-Resolution Asset Designs (3072 x 3072 pixels, 300 DPI)\n\u2714 Transparent PNG Files (Crisp isolated backgrounds)\n\u2714 Scalable Vector SVG Files (Fully editable & layered)\n\u2714 Master EPS & DXF Files (For vinyl cutters, Silhouette, Cricut, Laser)\n\u2714 Web-Optimized WEBP & JPG Previews\n\u2714 Print-Ready PDF & TIFF Master Files\n\u2714 Full Commercial Use License Included\n\n\u{1F3A8} PERFECT FOR:\n--------------------------------------------------\n\u2022 Sublimation Tumblers, Mugs, & Apparel (Printify / Printful / Gelato)\n\u2022 Sticker Sheet Crafts & Cricut Cut Projects\n\u2022 Twitch / YouTube Stream Overlays & Banners\n\u2022 Digital Planners, Scrapbooking, & Stationery\n\u2022 Wall Art Prints & Graphic Tee Branding\n\n\u{1F680} INSTANT DELIVERY ACCESS:\nUpon purchase, you will receive an official Delivery PDF containing your high-speed cloud link to instantly access and download your organized ZIP folders.\n",
    seo_title: "Retro Tech Glitch Vaporwave Clipart Bundle, 365 PNG & SVG Vectors, Sublimation Graphic PNGs, Commercial Use",
    etsy_tags: [
      "retro tech glitch va",
      "retro tech glitch va",
      "retro tech glitch va",
      "retro bundle",
      "sublimation png",
      "vector graphics",
      "commercial license",
      "cricut svg cut file",
      "sticker pack png",
      "t shirt graphic png",
      "digital download",
      "pod graphics",
      "300 dpi png"
    ],
    theme_key: "retro_tech_glitch_vaporwave",
    Gumroad_URL: "https://clipart.wildbillsproplans.com/product/wb-bnd-015",
    curated_designs_count: 30
  },
  {
    sku: "WB-BND-016",
    title: "Stranger Things Tv Show Clipart Collection",
    name: "Stranger Things Tv Show Clipart Mega-Bundle",
    category: "Stranger Things Tv Show",
    price: 24.99,
    original_price: 79.99,
    preview_url: "/static/previews/WB-BND-016_preview.jpg",
    image_url: "/static/previews/WB-BND-016_preview.jpg",
    previews: [
      "/static/previews/WB-BND-016_preview.jpg"
    ],
    zip_filename: "bundle_stranger_things_tv_show.zip",
    file_count: 1800,
    design_count: 225,
    size_mb: 150,
    description: "\u2728 STRANGER THINGS TV SHOW MEGA CLIPART BUNDLE (225 DESIGNS / 1800 FILES) \u2728\n\nInstantly elevate your print-on-demand shop, sticker collection, and craft projects with the ultimate Stranger Things Tv Show Clipart Bundle! Created in crisp 3072x3072 resolution, every asset comes isolated with a clean transparent background and multi-vector formats.\n\n\u{1F4E6} WHAT IS INCLUDED IN YOUR DOWNLOAD:\n--------------------------------------------------\n\u2714 225 High-Resolution Asset Designs (3072 x 3072 pixels, 300 DPI)\n\u2714 Transparent PNG Files (Crisp isolated backgrounds)\n\u2714 Scalable Vector SVG Files (Fully editable & layered)\n\u2714 Master EPS & DXF Files (For vinyl cutters, Silhouette, Cricut, Laser)\n\u2714 Web-Optimized WEBP & JPG Previews\n\u2714 Print-Ready PDF & TIFF Master Files\n\u2714 Full Commercial Use License Included\n\n\u{1F3A8} PERFECT FOR:\n--------------------------------------------------\n\u2022 Sublimation Tumblers, Mugs, & Apparel (Printify / Printful / Gelato)\n\u2022 Sticker Sheet Crafts & Cricut Cut Projects\n\u2022 Twitch / YouTube Stream Overlays & Banners\n\u2022 Digital Planners, Scrapbooking, & Stationery\n\u2022 Wall Art Prints & Graphic Tee Branding\n\n\u{1F680} INSTANT DELIVERY ACCESS:\nUpon purchase, you will receive an official Delivery PDF containing your high-speed cloud link to instantly access and download your organized ZIP folders.\n",
    seo_title: "Stranger Things Tv Show Clipart Bundle, 225 PNG & SVG Vectors, Sublimation Graphic PNGs, Commercial Use",
    etsy_tags: [
      "stranger things tv s",
      "stranger things tv s",
      "stranger things tv s",
      "stranger bundle",
      "sublimation png",
      "vector graphics",
      "commercial license",
      "cricut svg cut file",
      "sticker pack png",
      "t shirt graphic png",
      "digital download",
      "pod graphics",
      "300 dpi png"
    ],
    theme_key: "stranger_things_tv_show",
    Gumroad_URL: "https://clipart.wildbillsproplans.com/product/wb-bnd-016",
    curated_designs_count: 30
  },
  {
    sku: "WB-BND-017",
    title: "The Red Queen From Alice In Wonderland Clipart Collection",
    name: "The Red Queen From Alice In Wonderland Clipart Mega-Bundle",
    category: "The Red Queen From Alice In Wonderland",
    price: 24.99,
    original_price: 79.99,
    preview_url: "/static/previews/WB-BND-017_preview.jpg",
    image_url: "/static/previews/WB-BND-017_preview.jpg",
    previews: [
      "/static/previews/WB-BND-017_preview.jpg"
    ],
    zip_filename: "bundle_the_red_queen_from_alice_in_wonderland.zip",
    file_count: 488,
    design_count: 61,
    size_mb: 150,
    description: "\u2728 THE RED QUEEN FROM ALICE IN WONDERLAND MEGA CLIPART BUNDLE (61 DESIGNS / 488 FILES) \u2728\n\nInstantly elevate your print-on-demand shop, sticker collection, and craft projects with the ultimate The Red Queen From Alice In Wonderland Clipart Bundle! Created in crisp 3072x3072 resolution, every asset comes isolated with a clean transparent background and multi-vector formats.\n\n\u{1F4E6} WHAT IS INCLUDED IN YOUR DOWNLOAD:\n--------------------------------------------------\n\u2714 61 High-Resolution Asset Designs (3072 x 3072 pixels, 300 DPI)\n\u2714 Transparent PNG Files (Crisp isolated backgrounds)\n\u2714 Scalable Vector SVG Files (Fully editable & layered)\n\u2714 Master EPS & DXF Files (For vinyl cutters, Silhouette, Cricut, Laser)\n\u2714 Web-Optimized WEBP & JPG Previews\n\u2714 Print-Ready PDF & TIFF Master Files\n\u2714 Full Commercial Use License Included\n\n\u{1F3A8} PERFECT FOR:\n--------------------------------------------------\n\u2022 Sublimation Tumblers, Mugs, & Apparel (Printify / Printful / Gelato)\n\u2022 Sticker Sheet Crafts & Cricut Cut Projects\n\u2022 Twitch / YouTube Stream Overlays & Banners\n\u2022 Digital Planners, Scrapbooking, & Stationery\n\u2022 Wall Art Prints & Graphic Tee Branding\n\n\u{1F680} INSTANT DELIVERY ACCESS:\nUpon purchase, you will receive an official Delivery PDF containing your high-speed cloud link to instantly access and download your organized ZIP folders.\n",
    seo_title: "The Red Queen From Alice In Wonderland Clipart Bundle, 61 PNG & SVG Vectors, Sublimation Graphic PNGs, Commercial Use",
    etsy_tags: [
      "the red queen from a",
      "the red queen from a",
      "the red queen from a",
      "the bundle",
      "sublimation png",
      "vector graphics",
      "commercial license",
      "cricut svg cut file",
      "sticker pack png",
      "t shirt graphic png",
      "digital download",
      "pod graphics",
      "300 dpi png"
    ],
    theme_key: "the_red_queen_from_alice_in_wonderland",
    Gumroad_URL: "https://clipart.wildbillsproplans.com/product/wb-bnd-017",
    curated_designs_count: 30
  },
  {
    sku: "WB-BND-018",
    title: "Trinket Sticker Collector Icons Clipart Collection",
    name: "Trinket Sticker Collector Icons Clipart Mega-Bundle",
    category: "Trinket Sticker Collector Icons",
    price: 24.99,
    original_price: 79.99,
    preview_url: "/static/previews/WB-BND-018_preview.jpg",
    image_url: "/static/previews/WB-BND-018_preview.jpg",
    previews: [
      "/static/previews/WB-BND-018_preview.jpg"
    ],
    zip_filename: "bundle_trinket_sticker_collector_icons.zip",
    file_count: 16,
    design_count: 2,
    size_mb: 150,
    description: "\u2728 TRINKET STICKER COLLECTOR ICONS MEGA CLIPART BUNDLE (2 DESIGNS / 16 FILES) \u2728\n\nInstantly elevate your print-on-demand shop, sticker collection, and craft projects with the ultimate Trinket Sticker Collector Icons Clipart Bundle! Created in crisp 3072x3072 resolution, every asset comes isolated with a clean transparent background and multi-vector formats.\n\n\u{1F4E6} WHAT IS INCLUDED IN YOUR DOWNLOAD:\n--------------------------------------------------\n\u2714 2 High-Resolution Asset Designs (3072 x 3072 pixels, 300 DPI)\n\u2714 Transparent PNG Files (Crisp isolated backgrounds)\n\u2714 Scalable Vector SVG Files (Fully editable & layered)\n\u2714 Master EPS & DXF Files (For vinyl cutters, Silhouette, Cricut, Laser)\n\u2714 Web-Optimized WEBP & JPG Previews\n\u2714 Print-Ready PDF & TIFF Master Files\n\u2714 Full Commercial Use License Included\n\n\u{1F3A8} PERFECT FOR:\n--------------------------------------------------\n\u2022 Sublimation Tumblers, Mugs, & Apparel (Printify / Printful / Gelato)\n\u2022 Sticker Sheet Crafts & Cricut Cut Projects\n\u2022 Twitch / YouTube Stream Overlays & Banners\n\u2022 Digital Planners, Scrapbooking, & Stationery\n\u2022 Wall Art Prints & Graphic Tee Branding\n\n\u{1F680} INSTANT DELIVERY ACCESS:\nUpon purchase, you will receive an official Delivery PDF containing your high-speed cloud link to instantly access and download your organized ZIP folders.\n",
    seo_title: "Trinket Sticker Collector Icons Clipart Bundle, 2 PNG & SVG Vectors, Sublimation Graphic PNGs, Commercial Use",
    etsy_tags: [
      "trinket sticker coll",
      "trinket sticker coll",
      "trinket sticker coll",
      "trinket bundle",
      "sublimation png",
      "vector graphics",
      "commercial license",
      "cricut svg cut file",
      "sticker pack png",
      "t shirt graphic png",
      "digital download",
      "pod graphics",
      "300 dpi png"
    ],
    theme_key: "trinket_sticker_collector_icons",
    Gumroad_URL: "https://clipart.wildbillsproplans.com/product/wb-bnd-018",
    curated_designs_count: 2
  },
  {
    sku: "WB-BND-019",
    title: "Twisted Alice In Wonderland Twisted Dark Evil Clipart Collection",
    name: "Twisted Alice In Wonderland Twisted Dark Evil Clipart Mega-Bundle",
    category: "Twisted Alice In Wonderland Twisted Dark Evil",
    price: 24.99,
    original_price: 79.99,
    preview_url: "/static/previews/WB-BND-019_preview.jpg",
    image_url: "/static/previews/WB-BND-019_preview.jpg",
    previews: [
      "/static/previews/WB-BND-019_preview.jpg"
    ],
    zip_filename: "bundle_twisted_alice_in_wonderland_twisted_dark_evil.zip",
    file_count: 64,
    design_count: 8,
    size_mb: 150,
    description: "\u2728 TWISTED ALICE IN WONDERLAND TWISTED DARK EVIL MEGA CLIPART BUNDLE (8 DESIGNS / 64 FILES) \u2728\n\nInstantly elevate your print-on-demand shop, sticker collection, and craft projects with the ultimate Twisted Alice In Wonderland Twisted Dark Evil Clipart Bundle! Created in crisp 3072x3072 resolution, every asset comes isolated with a clean transparent background and multi-vector formats.\n\n\u{1F4E6} WHAT IS INCLUDED IN YOUR DOWNLOAD:\n--------------------------------------------------\n\u2714 8 High-Resolution Asset Designs (3072 x 3072 pixels, 300 DPI)\n\u2714 Transparent PNG Files (Crisp isolated backgrounds)\n\u2714 Scalable Vector SVG Files (Fully editable & layered)\n\u2714 Master EPS & DXF Files (For vinyl cutters, Silhouette, Cricut, Laser)\n\u2714 Web-Optimized WEBP & JPG Previews\n\u2714 Print-Ready PDF & TIFF Master Files\n\u2714 Full Commercial Use License Included\n\n\u{1F3A8} PERFECT FOR:\n--------------------------------------------------\n\u2022 Sublimation Tumblers, Mugs, & Apparel (Printify / Printful / Gelato)\n\u2022 Sticker Sheet Crafts & Cricut Cut Projects\n\u2022 Twitch / YouTube Stream Overlays & Banners\n\u2022 Digital Planners, Scrapbooking, & Stationery\n\u2022 Wall Art Prints & Graphic Tee Branding\n\n\u{1F680} INSTANT DELIVERY ACCESS:\nUpon purchase, you will receive an official Delivery PDF containing your high-speed cloud link to instantly access and download your organized ZIP folders.\n",
    seo_title: "Twisted Alice In Wonderland Twisted Dark Evil Clipart Bundle, 8 PNG & SVG Vectors, Sublimation Graphic PNGs, Commercial Use",
    etsy_tags: [
      "twisted alice in won",
      "twisted alice in won",
      "twisted alice in won",
      "twisted bundle",
      "sublimation png",
      "vector graphics",
      "commercial license",
      "cricut svg cut file",
      "sticker pack png",
      "t shirt graphic png",
      "digital download",
      "pod graphics",
      "300 dpi png"
    ],
    theme_key: "twisted_alice_in_wonderland_twisted_dark_evil",
    Gumroad_URL: "https://clipart.wildbillsproplans.com/product/wb-bnd-019",
    curated_designs_count: 8
  },
  {
    sku: "WB-BND-020",
    title: "Twisted Alice In Wonderland Twisted Evil Clipart Collection",
    name: "Twisted Alice In Wonderland Twisted Evil Clipart Mega-Bundle",
    category: "Twisted Alice In Wonderland Twisted Evil",
    price: 24.99,
    original_price: 79.99,
    preview_url: "/static/previews/WB-BND-020_preview.jpg",
    image_url: "/static/previews/WB-BND-020_preview.jpg",
    previews: [
      "/static/previews/WB-BND-020_preview.jpg"
    ],
    zip_filename: "bundle_twisted_alice_in_wonderland_twisted_evil.zip",
    file_count: 1472,
    design_count: 184,
    size_mb: 150,
    description: "\u2728 TWISTED ALICE IN WONDERLAND TWISTED EVIL MEGA CLIPART BUNDLE (184 DESIGNS / 1472 FILES) \u2728\n\nInstantly elevate your print-on-demand shop, sticker collection, and craft projects with the ultimate Twisted Alice In Wonderland Twisted Evil Clipart Bundle! Created in crisp 3072x3072 resolution, every asset comes isolated with a clean transparent background and multi-vector formats.\n\n\u{1F4E6} WHAT IS INCLUDED IN YOUR DOWNLOAD:\n--------------------------------------------------\n\u2714 184 High-Resolution Asset Designs (3072 x 3072 pixels, 300 DPI)\n\u2714 Transparent PNG Files (Crisp isolated backgrounds)\n\u2714 Scalable Vector SVG Files (Fully editable & layered)\n\u2714 Master EPS & DXF Files (For vinyl cutters, Silhouette, Cricut, Laser)\n\u2714 Web-Optimized WEBP & JPG Previews\n\u2714 Print-Ready PDF & TIFF Master Files\n\u2714 Full Commercial Use License Included\n\n\u{1F3A8} PERFECT FOR:\n--------------------------------------------------\n\u2022 Sublimation Tumblers, Mugs, & Apparel (Printify / Printful / Gelato)\n\u2022 Sticker Sheet Crafts & Cricut Cut Projects\n\u2022 Twitch / YouTube Stream Overlays & Banners\n\u2022 Digital Planners, Scrapbooking, & Stationery\n\u2022 Wall Art Prints & Graphic Tee Branding\n\n\u{1F680} INSTANT DELIVERY ACCESS:\nUpon purchase, you will receive an official Delivery PDF containing your high-speed cloud link to instantly access and download your organized ZIP folders.\n",
    seo_title: "Twisted Alice In Wonderland Twisted Evil Clipart Bundle, 184 PNG & SVG Vectors, Sublimation Graphic PNGs, Commercial Use",
    etsy_tags: [
      "twisted alice in won",
      "twisted alice in won",
      "twisted alice in won",
      "twisted bundle",
      "sublimation png",
      "vector graphics",
      "commercial license",
      "cricut svg cut file",
      "sticker pack png",
      "t shirt graphic png",
      "digital download",
      "pod graphics",
      "300 dpi png"
    ],
    theme_key: "twisted_alice_in_wonderland_twisted_evil",
    Gumroad_URL: "https://clipart.wildbillsproplans.com/product/wb-bnd-020",
    curated_designs_count: 30
  },
  {
    sku: "WB-BND-021",
    title: "Twisted Crazy Red Queen From Alice In Wonderland Clipart Collection",
    name: "Twisted Crazy Red Queen From Alice In Wonderland Clipart Mega-Bundle",
    category: "Twisted Crazy Red Queen From Alice In Wonderland",
    price: 24.99,
    original_price: 79.99,
    preview_url: "/static/previews/WB-BND-021_preview.jpg",
    image_url: "/static/previews/WB-BND-021_preview.jpg",
    previews: [
      "/static/previews/WB-BND-021_preview.jpg"
    ],
    zip_filename: "bundle_twisted_crazy_red_queen_from_alice_in_wonderland.zip",
    file_count: 1600,
    design_count: 200,
    size_mb: 150,
    description: "\u2728 TWISTED CRAZY RED QUEEN FROM ALICE IN WONDERLAND MEGA CLIPART BUNDLE (200 DESIGNS / 1600 FILES) \u2728\n\nInstantly elevate your print-on-demand shop, sticker collection, and craft projects with the ultimate Twisted Crazy Red Queen From Alice In Wonderland Clipart Bundle! Created in crisp 3072x3072 resolution, every asset comes isolated with a clean transparent background and multi-vector formats.\n\n\u{1F4E6} WHAT IS INCLUDED IN YOUR DOWNLOAD:\n--------------------------------------------------\n\u2714 200 High-Resolution Asset Designs (3072 x 3072 pixels, 300 DPI)\n\u2714 Transparent PNG Files (Crisp isolated backgrounds)\n\u2714 Scalable Vector SVG Files (Fully editable & layered)\n\u2714 Master EPS & DXF Files (For vinyl cutters, Silhouette, Cricut, Laser)\n\u2714 Web-Optimized WEBP & JPG Previews\n\u2714 Print-Ready PDF & TIFF Master Files\n\u2714 Full Commercial Use License Included\n\n\u{1F3A8} PERFECT FOR:\n--------------------------------------------------\n\u2022 Sublimation Tumblers, Mugs, & Apparel (Printify / Printful / Gelato)\n\u2022 Sticker Sheet Crafts & Cricut Cut Projects\n\u2022 Twitch / YouTube Stream Overlays & Banners\n\u2022 Digital Planners, Scrapbooking, & Stationery\n\u2022 Wall Art Prints & Graphic Tee Branding\n\n\u{1F680} INSTANT DELIVERY ACCESS:\nUpon purchase, you will receive an official Delivery PDF containing your high-speed cloud link to instantly access and download your organized ZIP folders.\n",
    seo_title: "Twisted Crazy Red Queen From Alice In Wonderland Clipart Bundle, 200 PNG & SVG Vectors, Sublimation Graphic PNGs, Commercial Use",
    etsy_tags: [
      "twisted crazy red qu",
      "twisted crazy red qu",
      "twisted crazy red qu",
      "twisted bundle",
      "sublimation png",
      "vector graphics",
      "commercial license",
      "cricut svg cut file",
      "sticker pack png",
      "t shirt graphic png",
      "digital download",
      "pod graphics",
      "300 dpi png"
    ],
    theme_key: "twisted_crazy_red_queen_from_alice_in_wonderland",
    Gumroad_URL: "https://clipart.wildbillsproplans.com/product/wb-bnd-021",
    curated_designs_count: 30
  },
  {
    sku: "WB-BND-022",
    title: "Vintage Circus Whimsical Carnival Clipart Collection",
    name: "Vintage Circus Whimsical Carnival Clipart Mega-Bundle",
    category: "Vintage Circus Whimsical Carnival",
    price: 24.99,
    original_price: 79.99,
    preview_url: "/static/previews/WB-BND-022_preview.jpg",
    image_url: "/static/previews/WB-BND-022_preview.jpg",
    previews: [
      "/static/previews/WB-BND-022_preview.jpg"
    ],
    zip_filename: "bundle_vintage_circus_whimsical_carnival.zip",
    file_count: 16,
    design_count: 2,
    size_mb: 150,
    description: "\u2728 VINTAGE CIRCUS WHIMSICAL CARNIVAL MEGA CLIPART BUNDLE (2 DESIGNS / 16 FILES) \u2728\n\nInstantly elevate your print-on-demand shop, sticker collection, and craft projects with the ultimate Vintage Circus Whimsical Carnival Clipart Bundle! Created in crisp 3072x3072 resolution, every asset comes isolated with a clean transparent background and multi-vector formats.\n\n\u{1F4E6} WHAT IS INCLUDED IN YOUR DOWNLOAD:\n--------------------------------------------------\n\u2714 2 High-Resolution Asset Designs (3072 x 3072 pixels, 300 DPI)\n\u2714 Transparent PNG Files (Crisp isolated backgrounds)\n\u2714 Scalable Vector SVG Files (Fully editable & layered)\n\u2714 Master EPS & DXF Files (For vinyl cutters, Silhouette, Cricut, Laser)\n\u2714 Web-Optimized WEBP & JPG Previews\n\u2714 Print-Ready PDF & TIFF Master Files\n\u2714 Full Commercial Use License Included\n\n\u{1F3A8} PERFECT FOR:\n--------------------------------------------------\n\u2022 Sublimation Tumblers, Mugs, & Apparel (Printify / Printful / Gelato)\n\u2022 Sticker Sheet Crafts & Cricut Cut Projects\n\u2022 Twitch / YouTube Stream Overlays & Banners\n\u2022 Digital Planners, Scrapbooking, & Stationery\n\u2022 Wall Art Prints & Graphic Tee Branding\n\n\u{1F680} INSTANT DELIVERY ACCESS:\nUpon purchase, you will receive an official Delivery PDF containing your high-speed cloud link to instantly access and download your organized ZIP folders.\n",
    seo_title: "Vintage Circus Whimsical Carnival Clipart Bundle, 2 PNG & SVG Vectors, Sublimation Graphic PNGs, Commercial Use",
    etsy_tags: [
      "vintage circus whims",
      "vintage circus whims",
      "vintage circus whims",
      "vintage bundle",
      "sublimation png",
      "vector graphics",
      "commercial license",
      "cricut svg cut file",
      "sticker pack png",
      "t shirt graphic png",
      "digital download",
      "pod graphics",
      "300 dpi png"
    ],
    theme_key: "vintage_circus_whimsical_carnival",
    Gumroad_URL: "https://clipart.wildbillsproplans.com/product/wb-bnd-022",
    curated_designs_count: 2
  },
  {
    sku: "WB-BND-023",
    title: "Vintage Trout Rustic Wildlife Clipart Collection",
    name: "Vintage Trout Rustic Wildlife Clipart Mega-Bundle",
    category: "Vintage Trout Rustic Wildlife",
    price: 24.99,
    original_price: 79.99,
    preview_url: "/static/previews/WB-BND-023_preview.jpg",
    image_url: "/static/previews/WB-BND-023_preview.jpg",
    previews: [
      "/static/previews/WB-BND-023_preview.jpg"
    ],
    zip_filename: "bundle_vintage_trout_rustic_wildlife.zip",
    file_count: 2808,
    design_count: 351,
    size_mb: 150,
    description: "\u2728 VINTAGE TROUT RUSTIC WILDLIFE MEGA CLIPART BUNDLE (351 DESIGNS / 2808 FILES) \u2728\n\nInstantly elevate your print-on-demand shop, sticker collection, and craft projects with the ultimate Vintage Trout Rustic Wildlife Clipart Bundle! Created in crisp 3072x3072 resolution, every asset comes isolated with a clean transparent background and multi-vector formats.\n\n\u{1F4E6} WHAT IS INCLUDED IN YOUR DOWNLOAD:\n--------------------------------------------------\n\u2714 351 High-Resolution Asset Designs (3072 x 3072 pixels, 300 DPI)\n\u2714 Transparent PNG Files (Crisp isolated backgrounds)\n\u2714 Scalable Vector SVG Files (Fully editable & layered)\n\u2714 Master EPS & DXF Files (For vinyl cutters, Silhouette, Cricut, Laser)\n\u2714 Web-Optimized WEBP & JPG Previews\n\u2714 Print-Ready PDF & TIFF Master Files\n\u2714 Full Commercial Use License Included\n\n\u{1F3A8} PERFECT FOR:\n--------------------------------------------------\n\u2022 Sublimation Tumblers, Mugs, & Apparel (Printify / Printful / Gelato)\n\u2022 Sticker Sheet Crafts & Cricut Cut Projects\n\u2022 Twitch / YouTube Stream Overlays & Banners\n\u2022 Digital Planners, Scrapbooking, & Stationery\n\u2022 Wall Art Prints & Graphic Tee Branding\n\n\u{1F680} INSTANT DELIVERY ACCESS:\nUpon purchase, you will receive an official Delivery PDF containing your high-speed cloud link to instantly access and download your organized ZIP folders.\n",
    seo_title: "Vintage Trout Rustic Wildlife Clipart Bundle, 351 PNG & SVG Vectors, Sublimation Graphic PNGs, Commercial Use",
    etsy_tags: [
      "vintage trout rustic",
      "vintage trout rustic",
      "vintage trout rustic",
      "vintage bundle",
      "sublimation png",
      "vector graphics",
      "commercial license",
      "cricut svg cut file",
      "sticker pack png",
      "t shirt graphic png",
      "digital download",
      "pod graphics",
      "300 dpi png"
    ],
    theme_key: "vintage_trout_rustic_wildlife",
    Gumroad_URL: "https://clipart.wildbillsproplans.com/product/wb-bnd-023",
    curated_designs_count: 30
  },
  {
    sku: "WB-BND-024",
    title: "Western Gothic Clipart Collection",
    name: "Western Gothic Clipart Mega-Bundle",
    category: "Western Gothic",
    price: 24.99,
    original_price: 79.99,
    preview_url: "/static/previews/WB-BND-024_preview.jpg",
    image_url: "/static/previews/WB-BND-024_preview.jpg",
    previews: [
      "/static/previews/WB-BND-024_preview.jpg"
    ],
    zip_filename: "bundle_western_gothic.zip",
    file_count: 48,
    design_count: 6,
    size_mb: 150,
    description: "\u2728 WESTERN GOTHIC MEGA CLIPART BUNDLE (6 DESIGNS / 48 FILES) \u2728\n\nInstantly elevate your print-on-demand shop, sticker collection, and craft projects with the ultimate Western Gothic Clipart Bundle! Created in crisp 3072x3072 resolution, every asset comes isolated with a clean transparent background and multi-vector formats.\n\n\u{1F4E6} WHAT IS INCLUDED IN YOUR DOWNLOAD:\n--------------------------------------------------\n\u2714 6 High-Resolution Asset Designs (3072 x 3072 pixels, 300 DPI)\n\u2714 Transparent PNG Files (Crisp isolated backgrounds)\n\u2714 Scalable Vector SVG Files (Fully editable & layered)\n\u2714 Master EPS & DXF Files (For vinyl cutters, Silhouette, Cricut, Laser)\n\u2714 Web-Optimized WEBP & JPG Previews\n\u2714 Print-Ready PDF & TIFF Master Files\n\u2714 Full Commercial Use License Included\n\n\u{1F3A8} PERFECT FOR:\n--------------------------------------------------\n\u2022 Sublimation Tumblers, Mugs, & Apparel (Printify / Printful / Gelato)\n\u2022 Sticker Sheet Crafts & Cricut Cut Projects\n\u2022 Twitch / YouTube Stream Overlays & Banners\n\u2022 Digital Planners, Scrapbooking, & Stationery\n\u2022 Wall Art Prints & Graphic Tee Branding\n\n\u{1F680} INSTANT DELIVERY ACCESS:\nUpon purchase, you will receive an official Delivery PDF containing your high-speed cloud link to instantly access and download your organized ZIP folders.\n",
    seo_title: "Western Gothic Clipart Bundle, 6 PNG & SVG Vectors, Sublimation Graphic PNGs, Commercial Use",
    etsy_tags: [
      "western gothic clipa",
      "western gothic png",
      "western gothic svg",
      "western bundle",
      "sublimation png",
      "vector graphics",
      "commercial license",
      "cricut svg cut file",
      "sticker pack png",
      "t shirt graphic png",
      "digital download",
      "pod graphics",
      "300 dpi png"
    ],
    theme_key: "western_gothic",
    Gumroad_URL: "https://clipart.wildbillsproplans.com/product/wb-bnd-024",
    curated_designs_count: 6
  },
  {
    sku: "WB-BND-025",
    title: "Western Gothic Outlaw Skulls Clipart Collection",
    name: "Western Gothic Outlaw Skulls Clipart Mega-Bundle",
    category: "Western Gothic Outlaw Skulls",
    price: 24.99,
    original_price: 79.99,
    preview_url: "/static/previews/WB-BND-025_preview.jpg",
    image_url: "/static/previews/WB-BND-025_preview.jpg",
    previews: [
      "/static/previews/WB-BND-025_preview.jpg"
    ],
    zip_filename: "bundle_western_gothic_outlaw_skulls.zip",
    file_count: 3304,
    design_count: 413,
    size_mb: 150,
    description: "\u2728 WESTERN GOTHIC OUTLAW SKULLS MEGA CLIPART BUNDLE (413 DESIGNS / 3304 FILES) \u2728\n\nInstantly elevate your print-on-demand shop, sticker collection, and craft projects with the ultimate Western Gothic Outlaw Skulls Clipart Bundle! Created in crisp 3072x3072 resolution, every asset comes isolated with a clean transparent background and multi-vector formats.\n\n\u{1F4E6} WHAT IS INCLUDED IN YOUR DOWNLOAD:\n--------------------------------------------------\n\u2714 413 High-Resolution Asset Designs (3072 x 3072 pixels, 300 DPI)\n\u2714 Transparent PNG Files (Crisp isolated backgrounds)\n\u2714 Scalable Vector SVG Files (Fully editable & layered)\n\u2714 Master EPS & DXF Files (For vinyl cutters, Silhouette, Cricut, Laser)\n\u2714 Web-Optimized WEBP & JPG Previews\n\u2714 Print-Ready PDF & TIFF Master Files\n\u2714 Full Commercial Use License Included\n\n\u{1F3A8} PERFECT FOR:\n--------------------------------------------------\n\u2022 Sublimation Tumblers, Mugs, & Apparel (Printify / Printful / Gelato)\n\u2022 Sticker Sheet Crafts & Cricut Cut Projects\n\u2022 Twitch / YouTube Stream Overlays & Banners\n\u2022 Digital Planners, Scrapbooking, & Stationery\n\u2022 Wall Art Prints & Graphic Tee Branding\n\n\u{1F680} INSTANT DELIVERY ACCESS:\nUpon purchase, you will receive an official Delivery PDF containing your high-speed cloud link to instantly access and download your organized ZIP folders.\n",
    seo_title: "Western Gothic Outlaw Skulls Clipart Bundle, 413 PNG & SVG Vectors, Sublimation Graphic PNGs, Commercial Use",
    etsy_tags: [
      "western gothic outla",
      "western gothic outla",
      "western gothic outla",
      "western bundle",
      "sublimation png",
      "vector graphics",
      "commercial license",
      "cricut svg cut file",
      "sticker pack png",
      "t shirt graphic png",
      "digital download",
      "pod graphics",
      "300 dpi png"
    ],
    theme_key: "western_gothic_outlaw_skulls",
    Gumroad_URL: "https://clipart.wildbillsproplans.com/product/wb-bnd-025",
    curated_designs_count: 30
  },
  {
    sku: "WB-BND-026",
    title: "Wilderkind Soft Cottage Animal Outfits Clipart Collection",
    name: "Wilderkind Soft Cottage Animal Outfits Clipart Mega-Bundle",
    category: "Wilderkind Soft Cottage Animal Outfits",
    price: 24.99,
    original_price: 79.99,
    preview_url: "/static/previews/WB-BND-026_preview.jpg",
    image_url: "/static/previews/WB-BND-026_preview.jpg",
    previews: [
      "/static/previews/WB-BND-026_preview.jpg"
    ],
    zip_filename: "bundle_wilderkind_soft_cottage_animal_outfits.zip",
    file_count: 96,
    design_count: 12,
    size_mb: 150,
    description: "\u2728 WILDERKIND SOFT COTTAGE ANIMAL OUTFITS MEGA CLIPART BUNDLE (12 DESIGNS / 96 FILES) \u2728\n\nInstantly elevate your print-on-demand shop, sticker collection, and craft projects with the ultimate Wilderkind Soft Cottage Animal Outfits Clipart Bundle! Created in crisp 3072x3072 resolution, every asset comes isolated with a clean transparent background and multi-vector formats.\n\n\u{1F4E6} WHAT IS INCLUDED IN YOUR DOWNLOAD:\n--------------------------------------------------\n\u2714 12 High-Resolution Asset Designs (3072 x 3072 pixels, 300 DPI)\n\u2714 Transparent PNG Files (Crisp isolated backgrounds)\n\u2714 Scalable Vector SVG Files (Fully editable & layered)\n\u2714 Master EPS & DXF Files (For vinyl cutters, Silhouette, Cricut, Laser)\n\u2714 Web-Optimized WEBP & JPG Previews\n\u2714 Print-Ready PDF & TIFF Master Files\n\u2714 Full Commercial Use License Included\n\n\u{1F3A8} PERFECT FOR:\n--------------------------------------------------\n\u2022 Sublimation Tumblers, Mugs, & Apparel (Printify / Printful / Gelato)\n\u2022 Sticker Sheet Crafts & Cricut Cut Projects\n\u2022 Twitch / YouTube Stream Overlays & Banners\n\u2022 Digital Planners, Scrapbooking, & Stationery\n\u2022 Wall Art Prints & Graphic Tee Branding\n\n\u{1F680} INSTANT DELIVERY ACCESS:\nUpon purchase, you will receive an official Delivery PDF containing your high-speed cloud link to instantly access and download your organized ZIP folders.\n",
    seo_title: "Wilderkind Soft Cottage Animal Outfits Clipart Bundle, 12 PNG & SVG Vectors, Sublimation Graphic PNGs, Commercial Use",
    etsy_tags: [
      "wilderkind soft cott",
      "wilderkind soft cott",
      "wilderkind soft cott",
      "wilderkind bundle",
      "sublimation png",
      "vector graphics",
      "commercial license",
      "cricut svg cut file",
      "sticker pack png",
      "t shirt graphic png",
      "digital download",
      "pod graphics",
      "300 dpi png"
    ],
    theme_key: "wilderkind_soft_cottage_animal_outfits",
    Gumroad_URL: "https://clipart.wildbillsproplans.com/product/wb-bnd-026",
    curated_designs_count: 12
  },
  {
    sku: "WB-BND-027",
    title: "Wilderkind Soft Cottage Animal Outfits Twitch Panel Icons Test Clipart Collection",
    name: "Wilderkind Soft Cottage Animal Outfits Twitch Panel Icons Test Clipart Mega-Bundle",
    category: "Wilderkind Soft Cottage Animal Outfits Twitch Panel Icons Test",
    price: 24.99,
    original_price: 79.99,
    preview_url: "/static/previews/WB-BND-027_preview.jpg",
    image_url: "/static/previews/WB-BND-027_preview.jpg",
    previews: [
      "/static/previews/WB-BND-027_preview.jpg"
    ],
    zip_filename: "bundle_wilderkind_soft_cottage_animal_outfits_twitch_panel_icons_test.zip",
    file_count: 8,
    design_count: 1,
    size_mb: 150,
    description: "\u2728 WILDERKIND SOFT COTTAGE ANIMAL OUTFITS TWITCH PANEL ICONS TEST MEGA CLIPART BUNDLE (1 DESIGNS / 8 FILES) \u2728\n\nInstantly elevate your print-on-demand shop, sticker collection, and craft projects with the ultimate Wilderkind Soft Cottage Animal Outfits Twitch Panel Icons Test Clipart Bundle! Created in crisp 3072x3072 resolution, every asset comes isolated with a clean transparent background and multi-vector formats.\n\n\u{1F4E6} WHAT IS INCLUDED IN YOUR DOWNLOAD:\n--------------------------------------------------\n\u2714 1 High-Resolution Asset Designs (3072 x 3072 pixels, 300 DPI)\n\u2714 Transparent PNG Files (Crisp isolated backgrounds)\n\u2714 Scalable Vector SVG Files (Fully editable & layered)\n\u2714 Master EPS & DXF Files (For vinyl cutters, Silhouette, Cricut, Laser)\n\u2714 Web-Optimized WEBP & JPG Previews\n\u2714 Print-Ready PDF & TIFF Master Files\n\u2714 Full Commercial Use License Included\n\n\u{1F3A8} PERFECT FOR:\n--------------------------------------------------\n\u2022 Sublimation Tumblers, Mugs, & Apparel (Printify / Printful / Gelato)\n\u2022 Sticker Sheet Crafts & Cricut Cut Projects\n\u2022 Twitch / YouTube Stream Overlays & Banners\n\u2022 Digital Planners, Scrapbooking, & Stationery\n\u2022 Wall Art Prints & Graphic Tee Branding\n\n\u{1F680} INSTANT DELIVERY ACCESS:\nUpon purchase, you will receive an official Delivery PDF containing your high-speed cloud link to instantly access and download your organized ZIP folders.\n",
    seo_title: "Wilderkind Soft Cottage Animal Outfits Twitch Panel Icons Test Clipart Bundle, 1 PNG & SVG Vectors, Sublimation Graphic PNGs, Commercial Use",
    etsy_tags: [
      "wilderkind soft cott",
      "wilderkind soft cott",
      "wilderkind soft cott",
      "wilderkind bundle",
      "sublimation png",
      "vector graphics",
      "commercial license",
      "cricut svg cut file",
      "sticker pack png",
      "t shirt graphic png",
      "digital download",
      "pod graphics",
      "300 dpi png"
    ],
    theme_key: "wilderkind_soft_cottage_animal_outfits_twitch_panel_icons_test",
    Gumroad_URL: "https://clipart.wildbillsproplans.com/product/wb-bnd-027",
    curated_designs_count: 1
  }
];
/* =====================================================================
   GATED DELIVERY (merged from the tested vault-fix design)
   Paid files leave storage ONLY through the PRIVATE R2 binding
   PAID_BUNDLES, and only with a valid, short-lived, single-object
   signed token minted after Stripe confirms payment. No redirects to
   any public bucket URL, ever.
   ===================================================================== */
const WV_JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "Content-Type",
  "access-control-allow-methods": "GET, POST, OPTIONS"
};
const wvJson = (body, status = 200, extra = {}) => new Response(JSON.stringify(body), { status, headers: { ...WV_JSON_HEADERS, ...extra } });
const WV_ENC = new TextEncoder();
function wvB64urlFromBuf(buf) {
  let s = "";
  const b = new Uint8Array(buf);
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function wvHmacSign(secret, msg) {
  const key = await crypto.subtle.importKey("raw", WV_ENC.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return wvB64urlFromBuf(await crypto.subtle.sign("HMAC", key, WV_ENC.encode(msg)));
}
function wvTimingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
function wvFindProduct(term) {
  const t = String(term || "").trim().toLowerCase();
  if (!t) return null;
  return products_default.find(
    (p) => p.sku && p.sku.toLowerCase() === t || p.zip_filename && p.zip_filename.toLowerCase() === t || p.theme_key && p.theme_key.toLowerCase() === t || p.zip_filename && p.zip_filename.toLowerCase() === `bundle_${t}.zip`
  ) || null;
}
/* Signed token: v1.<exp-unix-seconds>.<sku>.<nonce>.<hmac-sha256(secret, "v1|exp|sku|nonce")>
   The signature covers SKU + expiry, so a token is single-object-scoped (SKU maps
   through the catalogue to exactly one object key) and dies at its expiry. */
async function wvMintToken(sku, env) {
  const secret = env.DOWNLOAD_SIGNING_SECRET;
  if (!secret) throw new Error("DOWNLOAD_SIGNING_SECRET not set");
  const ttl = Number(env.TOKEN_TTL_SECONDS || 3600);
  const exp = Math.floor(Date.now() / 1000) + ttl;
  const nonce = wvB64urlFromBuf(crypto.getRandomValues(new Uint8Array(8)));
  const sig = await wvHmacSign(secret, `v1|${exp}|${sku}|${nonce}`);
  return `v1.${exp}.${sku}.${nonce}.${sig}`;
}
async function wvVerifyToken(token, env) {
  const secret = env.DOWNLOAD_SIGNING_SECRET;
  if (!secret) return { ok: false, status: 500, error: "server misconfigured: DOWNLOAD_SIGNING_SECRET missing" };
  const parts = String(token || "").split(".");
  if (parts.length !== 5 || parts[0] !== "v1") {
    return { ok: false, status: 403, error: "invalid download token" };
  }
  const [, expStr, sku, nonce, sig] = parts;
  const exp = Number(expStr);
  if (!Number.isInteger(exp) || !sku || !nonce || !sig) {
    return { ok: false, status: 403, error: "invalid download token" };
  }
  const expected = await wvHmacSign(secret, `v1|${exp}|${sku}|${nonce}`);
  if (!wvTimingSafeEqual(expected, sig)) {
    return { ok: false, status: 403, error: "invalid download token" };
  }
  if (exp < Math.floor(Date.now() / 1000)) {
    return { ok: false, status: 403, error: "download link expired", sku };
  }
  const product = wvFindProduct(sku);
  if (!product || !product.zip_filename) {
    return { ok: false, status: 403, error: "unknown product SKU", sku };
  }
  return { ok: true, sku: product.sku, objectKey: product.zip_filename, exp };
}
/* Stripe webhook signature: HMAC-SHA256 over "t=.payload", +/-300 s tolerance.
   whsec_ secrets are base64 of the real key - decode before hashing. */
async function wvStripeSignHex(keySource, msg) {
  const s = String(keySource);
  let keyBytes;
  if (s.startsWith("whsec_")) {
    const b64 = s.slice("whsec_".length).replace(/-/g, "+").replace(/_/g, "/");
    keyBytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  } else {
    keyBytes = WV_ENC.encode(s);
  }
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, WV_ENC.encode(msg)));
  return Array.from(sig).map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function wvVerifyStripeSignature(payload, sigHeader, secret, toleranceSeconds = 300) {
  if (!sigHeader || !secret) return false;
  let t = null;
  const v1s = [];
  for (const piece of sigHeader.split(",")) {
    const [k, v] = piece.split("=", 2).map((x) => (x || "").trim());
    if (k === "t") t = v;
    else if (k === "v1") v1s.push(v);
  }
  if (!t || v1s.length === 0) return false;
  const age = Math.abs(Math.floor(Date.now() / 1000) - Number(t));
  if (!Number.isFinite(age) || age > toleranceSeconds) return false;
  const expected = await wvStripeSignHex(secret, `${t}.${payload}`);
  return v1s.some((v1) => wvTimingSafeEqual(expected, v1));
}
function wvParseRange(header, size) {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null;
  let [, a, b] = m;
  if (a === "" && b === "") return null;
  if (a === "") {
    const n = Number(b);
    if (!Number.isInteger(n) || n <= 0) return null;
    return { offset: Math.max(0, size - n), length: Math.min(n, size) };
  }
  const start = Number(a);
  if (!Number.isInteger(start) || start >= size) return "invalid";
  const end = b === "" ? size - 1 : Math.min(Number(b), size - 1);
  if (!Number.isInteger(end) || end < start) return "invalid";
  return { offset: start, length: end - start + 1 };
}
/* The paid zips live in ONE bucket that may be bound under either name:
   PAID_BUNDLES (this repo's docs) or wildbills (the owner's existing binding).
   Resolve it once here; the bucket is the same either way, so object keys are
   unchanged and the owner never has to add a second R2 binding in the dashboard. */
function wvPaidBucket(env) {
  return env.PAID_BUNDLES || env.wildbills || null;
}
/* Gated download: /api/download?token=... and /api/download/<token>.
   The legacy public shape (?sku=/&file=) is rejected loudly - no redirect,
   no public bucket URL, ever. Streams from the PRIVATE R2 binding. */
async function onRequest2(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  try {
    const bucket = wvPaidBucket(env);
    if (!bucket) {
      return wvJson({ error: "server misconfigured: no R2 binding for paid bundles (expected PAID_BUNDLES or wildbills)" }, 500);
    }
    const token = context.params && context.params.token ? decodeURIComponent(context.params.token) : url.searchParams.get("token");
    if (!token) {
      const legacy = url.searchParams.get("sku") || url.searchParams.get("file");
      if (legacy) {
        return wvJson({ error: "downloads require a signed, expiring token issued after payment" }, 401, { "www-authenticate": "WBV1 signed-token" });
      }
      return wvJson({ error: "missing download token" }, 400);
    }
    const v = await wvVerifyToken(token, env);
    if (!v.ok) return wvJson({ error: v.error, sku: v.sku }, v.status);
    const meta = await bucket.head(v.objectKey);
    if (!meta) return wvJson({ error: "bundle file not found in storage", sku: v.sku }, 404);
    const headers = {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="${v.objectKey}"`,
      "accept-ranges": "bytes",
      "cache-control": "private, no-store",
      "etag": meta.etag ? `"${meta.etag}"` : `"${v.sku}-${meta.size}"`,
      "x-download-expiry": String(v.exp)
    };
    const range = wvParseRange(request.headers.get("range"), meta.size);
    if (range === "invalid") {
      return new Response(JSON.stringify({ error: "requested range not satisfiable" }), {
        status: 416,
        headers: { ...WV_JSON_HEADERS, "content-range": `bytes */${meta.size}` }
      });
    }
    if (range) {
      const obj = await bucket.get(v.objectKey, { range: { offset: range.offset, length: range.length } });
      if (!obj) return wvJson({ error: "bundle file not found in storage", sku: v.sku }, 404);
      return new Response(obj.body, {
        status: 206,
        headers: {
          ...headers,
          "content-range": `bytes ${range.offset}-${range.offset + range.length - 1}/${meta.size}`,
          "content-length": String(range.length)
        }
      });
    }
    const obj = await bucket.get(v.objectKey);
    if (!obj) return wvJson({ error: "bundle file not found in storage", sku: v.sku }, 404);
    return new Response(obj.body, { status: 200, headers: { ...headers, "content-length": String(meta.size) } });
  } catch (err) {
    console.error("Download error:", err);
    return wvJson({ error: "internal error" }, 500);
  }
}
__name(onRequest2, "onRequest2");
__name2(onRequest2, "onRequest");
/* Success-path issuance: verifies the Stripe checkout session SERVER-SIDE
   (payment_status === "paid") before minting a download token. */
async function onRequestDownloadLink(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  try {
    const sessionId = url.searchParams.get("session_id");
    const skuHint = (url.searchParams.get("sku") || "").trim().toUpperCase();
    if (!sessionId) return wvJson({ error: "missing session_id" }, 400);
    const STRIPE_SECRET = env.STRIPE_SECRET_KEY;
    if (!STRIPE_SECRET) {
      return wvJson({ error: "Stripe secret key is missing in environment variables (STRIPE_SECRET_KEY)." }, 500);
    }
    const STRIPE_API_BASE = env.STRIPE_API_BASE || "https://api.stripe.com";
    const res = await fetch(`${STRIPE_API_BASE}/v1/checkout/sessions/${encodeURIComponent(sessionId)}`, {
      headers: { "Authorization": `Bearer ${STRIPE_SECRET}` }
    });
    if (!res.ok) return wvJson({ error: "could not verify checkout session with Stripe" }, 502);
    const session = await res.json();
    if (!session || session.payment_status !== "paid") return wvJson({ error: "payment not completed" }, 402);
    const skuRaw = (session.metadata && (session.metadata.sku || session.metadata.product_id)) || session.client_reference_id || "";
    const product = wvFindProduct(String(skuRaw));
    if (!product) return wvJson({ error: "unknown or missing SKU on session" }, 403);
    if (skuHint && skuHint !== product.sku.toUpperCase()) return wvJson({ error: "SKU does not match the paid session" }, 403);
    const token = await wvMintToken(product.sku, env);
    return wvJson({
      sku: product.sku,
      download_url: `${url.origin}/api/download/${encodeURIComponent(token)}`,
      expires_in: Number(env.TOKEN_TTL_SECONDS || 3600)
    });
  } catch (err) {
    console.error("Download link error:", err);
    return wvJson({ error: "internal error" }, 500);
  }
}
__name(onRequestDownloadLink, "onRequestDownloadLink");
__name2(onRequestDownloadLink, "onRequestDownloadLink");
/* Success page (replaces the static success.html asset's own delivery logic):
   the buyer's download link is minted server-side by /api/download-link,
   after Stripe confirms the session is paid. */
async function onRequestSuccess(context) {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Thank You for Your Order - Wild Bill Vault</title>
    <style>
        body { background: #0c0808; color: #f5f2f2; font-family: Arial, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 20px; text-align: center; }
        .card { background: #151010; border: 1px solid #2a1d1d; border-radius: 16px; padding: 40px 30px; max-width: 500px; width: 100%; box-shadow: 0 16px 40px rgba(0,0,0,0.5); }
        h1 { margin: 0 0 12px; font-size: 22px; color: #f5f2f2; }
        p { color: #b3a5a5; font-size: 14px; line-height: 1.6; }
        .btn { display: inline-block; background: #16a34a; color: #fff; padding: 14px 24px; border-radius: 8px; font-weight: bold; text-decoration: none; font-size: 15px; margin-top: 14px; }
        .btn:hover { background: #128a3e; }
    </style>
</head>
<body>
    <div class="card">
        <div style="font-size: 44px;">\u{1F4E6}</div>
        <h1>Thank You for Your Order</h1>
        <p id="status">Confirming your payment...</p>
        <div id="dl"></div>
    </div>
    <script>
    (async () => {
      const qs = new URLSearchParams(location.search);
      const sid = qs.get("session_id");
      const sku = qs.get("sku") || "";
      const status = document.getElementById("status");
      if (!sid) { status.textContent = "Missing order reference. Check your email for your download link."; return; }
      try {
        const r = await fetch("/api/download-link?session_id=" + encodeURIComponent(sid) + "&sku=" + encodeURIComponent(sku));
        const data = await r.json();
        if (r.ok && data.download_url) {
          status.textContent = "Payment confirmed for " + (data.sku || sku) + ". Your secure link is valid for " + Math.round((data.expires_in || 3600) / 60) + " minutes.";
          const a = document.createElement("a");
          a.className = "btn";
          a.href = data.download_url;
          a.textContent = "\\u2B07 Download your bundle (.zip)";
          document.getElementById("dl").appendChild(a);
        } else {
          status.textContent = (data && data.error) || "We could not verify your order. Check your email for your download link.";
        }
      } catch (e) {
        status.textContent = "We could not verify your order. Check your email for your download link.";
      }
    })();
    </script>
</body>
</html>`;
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
}
__name(onRequestSuccess, "onRequestSuccess");
__name2(onRequestSuccess, "onRequestSuccess");
/* Redacted catalogue: /products.json and /static/products.json serve the same
   catalogue with every storage URL stripped, so product metadata can never
   publish a bucket URL again. Serves the live asset when available, falling
   back to the embedded catalogue; both are redacted. */
const WV_REDACTED_KEYS = new Set(["r2_download_url", "download_url", "zip_path", "public_url", "file_url"]);
function wvStripStorageUrls(value) {
  if (Array.isArray(value)) return value.map(wvStripStorageUrls);
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (WV_REDACTED_KEYS.has(k)) continue;
      out[k] = wvStripStorageUrls(v);
    }
    return out;
  }
  if (typeof value === "string" && (value.includes("r2.dev") || value.includes("/run/media/wildbill/storage/"))) return "";
  return value;
}
async function onRequestCatalogue(context) {
  const { request, env } = context;
  try {
    if (env.ASSETS) {
      try {
        const res = await env.ASSETS.fetch(new URL(request.url).pathname, { method: "GET" });
        if (res.ok) {
          const data = wvStripStorageUrls(await res.json());
          return wvJson(data, 200, { "cache-control": "public, max-age=300" });
        }
      } catch (e) {
        console.error("Asset catalogue redaction failed, using embedded catalogue:", e);
      }
    }
    return wvJson(wvStripStorageUrls(products_default), 200, { "cache-control": "public, max-age=300" });
  } catch (err) {
    console.error("Catalogue error:", err);
    return wvJson({ error: "internal error" }, 500);
  }
}
__name(onRequestCatalogue, "onRequestCatalogue");
__name2(onRequestCatalogue, "onRequestCatalogue");
__name(onRequest2, "onRequest2");
__name2(onRequest2, "onRequest");
var routes = [
  {
    routePath: "/api/create-checkout",
    mountPath: "/api",
    method: "OPTIONS",
    middlewares: [],
    modules: [onRequestOptions]
  },
  {
    routePath: "/api/create-checkout",
    mountPath: "/api",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost]
  },
  {
    routePath: "/api/free-sample",
    mountPath: "/api",
    method: "GET",
    middlewares: [],
    modules: [onRequestGet]
  },
  {
    routePath: "/api/free-sample",
    mountPath: "/api",
    method: "OPTIONS",
    middlewares: [],
    modules: [onRequestOptions2]
  },
  {
    routePath: "/api/free-sample",
    mountPath: "/api",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost2]
  },
  {
    routePath: "/api/stripe-webhook",
    mountPath: "/api",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost3]
  },
  {
    routePath: "/api/auto-promote",
    mountPath: "/api",
    method: "",
    middlewares: [],
    modules: [onRequest]
  },
  {
    routePath: "/api/download",
    mountPath: "/api",
    method: "",
    middlewares: [],
    modules: [onRequest2]
  },
  {
    routePath: "/api/download/:token",
    mountPath: "/api",
    method: "GET",
    middlewares: [],
    modules: [onRequest2]
  },
  {
    routePath: "/api/download-link",
    mountPath: "/api",
    method: "GET",
    middlewares: [],
    modules: [onRequestDownloadLink]
  },
  {
    routePath: "/success",
    mountPath: "",
    method: "GET",
    middlewares: [],
    modules: [onRequestSuccess]
  },
  {
    routePath: "/success.html",
    mountPath: "",
    method: "GET",
    middlewares: [],
    modules: [onRequestSuccess]
  },
  {
    routePath: "/products.json",
    mountPath: "",
    method: "GET",
    middlewares: [],
    modules: [onRequestCatalogue]
  },
  {
    routePath: "/static/products.json",
    mountPath: "",
    method: "GET",
    middlewares: [],
    modules: [onRequestCatalogue]
  }
];
function lexer(str) {
  var tokens = [];
  var i = 0;
  while (i < str.length) {
    var char = str[i];
    if (char === "*" || char === "+" || char === "?") {
      tokens.push({ type: "MODIFIER", index: i, value: str[i++] });
      continue;
    }
    if (char === "\\") {
      tokens.push({ type: "ESCAPED_CHAR", index: i++, value: str[i++] });
      continue;
    }
    if (char === "{") {
      tokens.push({ type: "OPEN", index: i, value: str[i++] });
      continue;
    }
    if (char === "}") {
      tokens.push({ type: "CLOSE", index: i, value: str[i++] });
      continue;
    }
    if (char === ":") {
      var name = "";
      var j = i + 1;
      while (j < str.length) {
        var code = str.charCodeAt(j);
        if (
          // `0-9`
          code >= 48 && code <= 57 || // `A-Z`
          code >= 65 && code <= 90 || // `a-z`
          code >= 97 && code <= 122 || // `_`
          code === 95
        ) {
          name += str[j++];
          continue;
        }
        break;
      }
      if (!name)
        throw new TypeError("Missing parameter name at ".concat(i));
      tokens.push({ type: "NAME", index: i, value: name });
      i = j;
      continue;
    }
    if (char === "(") {
      var count = 1;
      var pattern = "";
      var j = i + 1;
      if (str[j] === "?") {
        throw new TypeError('Pattern cannot start with "?" at '.concat(j));
      }
      while (j < str.length) {
        if (str[j] === "\\") {
          pattern += str[j++] + str[j++];
          continue;
        }
        if (str[j] === ")") {
          count--;
          if (count === 0) {
            j++;
            break;
          }
        } else if (str[j] === "(") {
          count++;
          if (str[j + 1] !== "?") {
            throw new TypeError("Capturing groups are not allowed at ".concat(j));
          }
        }
        pattern += str[j++];
      }
      if (count)
        throw new TypeError("Unbalanced pattern at ".concat(i));
      if (!pattern)
        throw new TypeError("Missing pattern at ".concat(i));
      tokens.push({ type: "PATTERN", index: i, value: pattern });
      i = j;
      continue;
    }
    tokens.push({ type: "CHAR", index: i, value: str[i++] });
  }
  tokens.push({ type: "END", index: i, value: "" });
  return tokens;
}
__name(lexer, "lexer");
__name2(lexer, "lexer");
function parse(str, options) {
  if (options === void 0) {
    options = {};
  }
  var tokens = lexer(str);
  var _a = options.prefixes, prefixes = _a === void 0 ? "./" : _a, _b = options.delimiter, delimiter = _b === void 0 ? "/#?" : _b;
  var result = [];
  var key = 0;
  var i = 0;
  var path = "";
  var tryConsume = /* @__PURE__ */ __name2(function(type) {
    if (i < tokens.length && tokens[i].type === type)
      return tokens[i++].value;
  }, "tryConsume");
  var mustConsume = /* @__PURE__ */ __name2(function(type) {
    var value2 = tryConsume(type);
    if (value2 !== void 0)
      return value2;
    var _a2 = tokens[i], nextType = _a2.type, index = _a2.index;
    throw new TypeError("Unexpected ".concat(nextType, " at ").concat(index, ", expected ").concat(type));
  }, "mustConsume");
  var consumeText = /* @__PURE__ */ __name2(function() {
    var result2 = "";
    var value2;
    while (value2 = tryConsume("CHAR") || tryConsume("ESCAPED_CHAR")) {
      result2 += value2;
    }
    return result2;
  }, "consumeText");
  var isSafe = /* @__PURE__ */ __name2(function(value2) {
    for (var _i = 0, delimiter_1 = delimiter; _i < delimiter_1.length; _i++) {
      var char2 = delimiter_1[_i];
      if (value2.indexOf(char2) > -1)
        return true;
    }
    return false;
  }, "isSafe");
  var safePattern = /* @__PURE__ */ __name2(function(prefix2) {
    var prev = result[result.length - 1];
    var prevText = prefix2 || (prev && typeof prev === "string" ? prev : "");
    if (prev && !prevText) {
      throw new TypeError('Must have text between two parameters, missing text after "'.concat(prev.name, '"'));
    }
    if (!prevText || isSafe(prevText))
      return "[^".concat(escapeString(delimiter), "]+?");
    return "(?:(?!".concat(escapeString(prevText), ")[^").concat(escapeString(delimiter), "])+?");
  }, "safePattern");
  while (i < tokens.length) {
    var char = tryConsume("CHAR");
    var name = tryConsume("NAME");
    var pattern = tryConsume("PATTERN");
    if (name || pattern) {
      var prefix = char || "";
      if (prefixes.indexOf(prefix) === -1) {
        path += prefix;
        prefix = "";
      }
      if (path) {
        result.push(path);
        path = "";
      }
      result.push({
        name: name || key++,
        prefix,
        suffix: "",
        pattern: pattern || safePattern(prefix),
        modifier: tryConsume("MODIFIER") || ""
      });
      continue;
    }
    var value = char || tryConsume("ESCAPED_CHAR");
    if (value) {
      path += value;
      continue;
    }
    if (path) {
      result.push(path);
      path = "";
    }
    var open = tryConsume("OPEN");
    if (open) {
      var prefix = consumeText();
      var name_1 = tryConsume("NAME") || "";
      var pattern_1 = tryConsume("PATTERN") || "";
      var suffix = consumeText();
      mustConsume("CLOSE");
      result.push({
        name: name_1 || (pattern_1 ? key++ : ""),
        pattern: name_1 && !pattern_1 ? safePattern(prefix) : pattern_1,
        prefix,
        suffix,
        modifier: tryConsume("MODIFIER") || ""
      });
      continue;
    }
    mustConsume("END");
  }
  return result;
}
__name(parse, "parse");
__name2(parse, "parse");
function match(str, options) {
  var keys = [];
  var re = pathToRegexp(str, keys, options);
  return regexpToFunction(re, keys, options);
}
__name(match, "match");
__name2(match, "match");
function regexpToFunction(re, keys, options) {
  if (options === void 0) {
    options = {};
  }
  var _a = options.decode, decode = _a === void 0 ? function(x) {
    return x;
  } : _a;
  return function(pathname) {
    var m = re.exec(pathname);
    if (!m)
      return false;
    var path = m[0], index = m.index;
    var params = /* @__PURE__ */ Object.create(null);
    var _loop_1 = /* @__PURE__ */ __name2(function(i2) {
      if (m[i2] === void 0)
        return "continue";
      var key = keys[i2 - 1];
      if (key.modifier === "*" || key.modifier === "+") {
        params[key.name] = m[i2].split(key.prefix + key.suffix).map(function(value) {
          return decode(value, key);
        });
      } else {
        params[key.name] = decode(m[i2], key);
      }
    }, "_loop_1");
    for (var i = 1; i < m.length; i++) {
      _loop_1(i);
    }
    return { path, index, params };
  };
}
__name(regexpToFunction, "regexpToFunction");
__name2(regexpToFunction, "regexpToFunction");
function escapeString(str) {
  return str.replace(/([.+*?=^!:${}()[\]|/\\])/g, "\\$1");
}
__name(escapeString, "escapeString");
__name2(escapeString, "escapeString");
function flags(options) {
  return options && options.sensitive ? "" : "i";
}
__name(flags, "flags");
__name2(flags, "flags");
function regexpToRegexp(path, keys) {
  if (!keys)
    return path;
  var groupsRegex = /\((?:\?<(.*?)>)?(?!\?)/g;
  var index = 0;
  var execResult = groupsRegex.exec(path.source);
  while (execResult) {
    keys.push({
      // Use parenthesized substring match if available, index otherwise
      name: execResult[1] || index++,
      prefix: "",
      suffix: "",
      modifier: "",
      pattern: ""
    });
    execResult = groupsRegex.exec(path.source);
  }
  return path;
}
__name(regexpToRegexp, "regexpToRegexp");
__name2(regexpToRegexp, "regexpToRegexp");
function arrayToRegexp(paths, keys, options) {
  var parts = paths.map(function(path) {
    return pathToRegexp(path, keys, options).source;
  });
  return new RegExp("(?:".concat(parts.join("|"), ")"), flags(options));
}
__name(arrayToRegexp, "arrayToRegexp");
__name2(arrayToRegexp, "arrayToRegexp");
function stringToRegexp(path, keys, options) {
  return tokensToRegexp(parse(path, options), keys, options);
}
__name(stringToRegexp, "stringToRegexp");
__name2(stringToRegexp, "stringToRegexp");
function tokensToRegexp(tokens, keys, options) {
  if (options === void 0) {
    options = {};
  }
  var _a = options.strict, strict = _a === void 0 ? false : _a, _b = options.start, start = _b === void 0 ? true : _b, _c = options.end, end = _c === void 0 ? true : _c, _d = options.encode, encode = _d === void 0 ? function(x) {
    return x;
  } : _d, _e = options.delimiter, delimiter = _e === void 0 ? "/#?" : _e, _f = options.endsWith, endsWith = _f === void 0 ? "" : _f;
  var endsWithRe = "[".concat(escapeString(endsWith), "]|$");
  var delimiterRe = "[".concat(escapeString(delimiter), "]");
  var route = start ? "^" : "";
  for (var _i = 0, tokens_1 = tokens; _i < tokens_1.length; _i++) {
    var token = tokens_1[_i];
    if (typeof token === "string") {
      route += escapeString(encode(token));
    } else {
      var prefix = escapeString(encode(token.prefix));
      var suffix = escapeString(encode(token.suffix));
      if (token.pattern) {
        if (keys)
          keys.push(token);
        if (prefix || suffix) {
          if (token.modifier === "+" || token.modifier === "*") {
            var mod = token.modifier === "*" ? "?" : "";
            route += "(?:".concat(prefix, "((?:").concat(token.pattern, ")(?:").concat(suffix).concat(prefix, "(?:").concat(token.pattern, "))*)").concat(suffix, ")").concat(mod);
          } else {
            route += "(?:".concat(prefix, "(").concat(token.pattern, ")").concat(suffix, ")").concat(token.modifier);
          }
        } else {
          if (token.modifier === "+" || token.modifier === "*") {
            throw new TypeError('Can not repeat "'.concat(token.name, '" without a prefix and suffix'));
          }
          route += "(".concat(token.pattern, ")").concat(token.modifier);
        }
      } else {
        route += "(?:".concat(prefix).concat(suffix, ")").concat(token.modifier);
      }
    }
  }
  if (end) {
    if (!strict)
      route += "".concat(delimiterRe, "?");
    route += !options.endsWith ? "$" : "(?=".concat(endsWithRe, ")");
  } else {
    var endToken = tokens[tokens.length - 1];
    var isEndDelimited = typeof endToken === "string" ? delimiterRe.indexOf(endToken[endToken.length - 1]) > -1 : endToken === void 0;
    if (!strict) {
      route += "(?:".concat(delimiterRe, "(?=").concat(endsWithRe, "))?");
    }
    if (!isEndDelimited) {
      route += "(?=".concat(delimiterRe, "|").concat(endsWithRe, ")");
    }
  }
  return new RegExp(route, flags(options));
}
__name(tokensToRegexp, "tokensToRegexp");
__name2(tokensToRegexp, "tokensToRegexp");
function pathToRegexp(path, keys, options) {
  if (path instanceof RegExp)
    return regexpToRegexp(path, keys);
  if (Array.isArray(path))
    return arrayToRegexp(path, keys, options);
  return stringToRegexp(path, keys, options);
}
__name(pathToRegexp, "pathToRegexp");
__name2(pathToRegexp, "pathToRegexp");
var escapeRegex = /[.+?^${}()|[\]\\]/g;
function* executeRequest(request) {
  const requestPath = new URL(request.url).pathname;
  for (const route of [...routes].reverse()) {
    if (route.method && route.method !== request.method) {
      continue;
    }
    const routeMatcher = match(route.routePath.replace(escapeRegex, "\\$&"), {
      end: false
    });
    const mountMatcher = match(route.mountPath.replace(escapeRegex, "\\$&"), {
      end: false
    });
    const matchResult = routeMatcher(requestPath);
    const mountMatchResult = mountMatcher(requestPath);
    if (matchResult && mountMatchResult) {
      for (const handler of route.middlewares.flat()) {
        yield {
          handler,
          params: matchResult.params,
          path: mountMatchResult.path
        };
      }
    }
  }
  for (const route of routes) {
    if (route.method && route.method !== request.method) {
      continue;
    }
    const routeMatcher = match(route.routePath.replace(escapeRegex, "\\$&"), {
      end: true
    });
    const mountMatcher = match(route.mountPath.replace(escapeRegex, "\\$&"), {
      end: false
    });
    const matchResult = routeMatcher(requestPath);
    const mountMatchResult = mountMatcher(requestPath);
    if (matchResult && mountMatchResult && route.modules.length) {
      for (const handler of route.modules.flat()) {
        yield {
          handler,
          params: matchResult.params,
          path: matchResult.path
        };
      }
      break;
    }
  }
}
__name(executeRequest, "executeRequest");
__name2(executeRequest, "executeRequest");
var pages_template_worker_default = {
  async fetch(originalRequest, env, workerContext) {
    let request = originalRequest;
    const handlerIterator = executeRequest(request);
    let data = {};
    let isFailOpen = false;
    const next = /* @__PURE__ */ __name2(async (input, init) => {
      if (input !== void 0) {
        let url = input;
        if (typeof input === "string") {
          url = new URL(input, request.url).toString();
        }
        request = new Request(url, init);
      }
      const result = handlerIterator.next();
      if (result.done === false) {
        const { handler, params, path } = result.value;
        const context = {
          request: new Request(request.clone()),
          functionPath: path,
          next,
          params,
          get data() {
            return data;
          },
          set data(value) {
            if (typeof value !== "object" || value === null) {
              throw new Error("context.data must be an object");
            }
            data = value;
          },
          env,
          waitUntil: workerContext.waitUntil.bind(workerContext),
          passThroughOnException: /* @__PURE__ */ __name2(() => {
            isFailOpen = true;
          }, "passThroughOnException")
        };
        const response = await handler(context);
        if (!(response instanceof Response)) {
          throw new Error("Your Pages function should return a Response");
        }
        return cloneResponse(response);
      } else if (env.ASSETS) {
        const response = await env.ASSETS.fetch(request);
        return cloneResponse(response);
      } else {
        return new Response(JSON.stringify({ error: "not found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" }
        });
      }
    }, "next");
    try {
      return await next();
    } catch (error) {
      if (isFailOpen) {
        const response = await env["ASSETS"].fetch(request);
        return cloneResponse(response);
      }
      throw error;
    }
  }
};
var cloneResponse = /* @__PURE__ */ __name2((response) => (
  // https://fetch.spec.whatwg.org/#null-body-status
  new Response(
    [101, 204, 205, 304].includes(response.status) ? null : response.body,
    response
  )
), "cloneResponse");
export {
  pages_template_worker_default as default
};
//# sourceMappingURL=index.js.map
