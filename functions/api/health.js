import { json } from "../_shared.js";

// Diagnostic endpoint. Designed to make "KV not bound" failures
// self-explanatory: shows what bindings the running Function actually
// sees, the shape of BOOK_KV if present, and a live write+read probe.
//
// Hit https://<your-host>/api/health and inspect the JSON. The kv field
// should be true; if false, look at envKeys to see whether BOOK_KV was
// bound under a different name (case-sensitive!), or whether the
// deployment you're hitting doesn't have the binding at all (very
// common: binding was added in the dashboard but the older deployment
// is still serving traffic — redeploy).

export const onRequestGet = async ({ env, request }) => {
  const url = new URL(request.url);
  const envKeys = Object.keys(env || {});
  const hasKV = !!(env && env.BOOK_KV);
  const kvShape = hasKV
    ? {
        isObject: typeof env.BOOK_KV === "object",
        hasGet: typeof env.BOOK_KV.get === "function",
        hasPut: typeof env.BOOK_KV.put === "function",
        hasList: typeof env.BOOK_KV.list === "function",
      }
    : null;

  // Live probe: write a value with a 60s TTL, immediately read it back.
  // Catches the case where the binding name is right but the namespace it
  // points to has been deleted or has wrong permissions.
  let probe = null;
  if (hasKV) {
    const probeKey = "__health_probe__";
    const want = "ok-" + Date.now();
    try {
      await env.BOOK_KV.put(probeKey, want, { expirationTtl: 60 });
      const got = await env.BOOK_KV.get(probeKey);
      probe = {
        put: "ok",
        get: got === want ? "ok" : "mismatch:" + got,
      };
    } catch (e) {
      probe = { error: (e && e.message) || String(e) };
    }
  }

  return json({
    ok: true,
    kv: hasKV,
    kvShape,
    probe,
    envKeys,            // every binding/env var name the Function sees
    host: url.hostname, // make it obvious which deployment you're hitting
    time: Date.now(),
  });
};
